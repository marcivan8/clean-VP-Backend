# Background Processing Architecture (HLS, BullMQ, SSE)

This plan outlines the architecture overhaul to solve the long video loading problem and process intensive FFmpeg tasks without blocking the main server or timing out on Railway.

## Goal Description
1. Replace synchronous FFmpeg encoding with a background worker architecture using BullMQ and Redis.
2. Implement an HLS-based proxy for immediate partial timeline playback (generating `.m3u8` and `.ts` chunks) uploaded directly to GCS.
3. Generate a waveform JSON during the proxy generation phase for timeline visualization and store it in GCS.
4. Replace client-side HTTP polling/blocking with Server-Sent Events (SSE) to push job progress back to the browser.
5. Update the agent's `MediaExecutionEngine` to operate asynchronously, subscribing to job progress instead of awaiting blocking HTTP responses.

## User Review Required

> [!WARNING]
> This is a significant architectural change that introduces a new infrastructure dependency (`Redis`) and splits the backend into two logical services (API and Worker).

- You must configure a **Redis Database** instance on Railway and provide the `REDIS_URL` environment variable for both your API service and your new Worker service.
- The `worker.js` file will need its own start command in Railway or be deployed as a separate service. The recommended Railway pattern is to deploy the exact same repo but set the start command to `node worker.js`.

## Open Questions

> [!IMPORTANT]
> 1. Does the FFmpeg silence detection also need to be moved to the worker, or is it fast enough to keep synchronous? **Resolved**: It will be moved to the queue.
> 2. For the waveform JSON, do we need a specific format (e.g., an array of peak values), or a tool like `audiowaveform`? **Resolved**: Waveform JSON will be generated using FFmpeg's `volumedetect` and `astats` filters via `ffmpeg-static`. Output: `{ peaks: number[], duration: number, sampleRate: number }`. No additional binary dependency required.

## Proposed Changes

---
### Backend Configuration & Dependencies
#### [MODIFY] package.json
- Install `bullmq` and `ioredis`.
- Add a `start:worker` script (`node worker.js`).

---
### Queue & Worker Infrastructure
#### [NEW] queue/connection.js
- Establishes the `ioredis` connection for BullMQ, reading from `REDIS_URL`.
#### [NEW] queue/queues.js
- Exports the `videoQueue` instance used to enqueue jobs from API routes.
#### [NEW] worker.js
- The main entry point for the worker service. Instantiates the BullMQ worker and binds job handlers.
#### [NEW] jobs/videoProcessor.js
- Contains the actual FFmpeg logic to generate HLS streams and waveform data.
- **HLS segments and waveform JSON are uploaded to GCS after generation.**
- **Local temp files are cleaned up after upload.**
#### [NEW] jobs/silenceProcessor.js
- Contains the FFmpeg silence detection logic (extracted from `silenceRoutes.js`).
#### [NEW] jobs/audioProcessor.js
- Contains transcribe, denoise, normalize, and beat-detect job handlers.
#### [NEW] jobs/analysisProcessor.js
- Contains the full videoAnalyzer pipeline logic.

---
### API Routes
#### [MODIFY] routes/proxyRoutes.js
- Updates the `/upload` endpoint to immediately return a `jobId` and enqueue a `generate-proxy` job instead of awaiting proxy generation.
#### [MODIFY] routes/silenceRoutes.js
- Updates `/detect` to enqueue a `detect-silence` job.
#### [MODIFY] routes/audioRoutes.js
- All four endpoints (transcribe, denoise, normalize, beat-detect) enqueue jobs instead of running FFmpeg directly.
#### [MODIFY] routes/analyzeRoutes.js
- Enqueue analysis job, return `jobId` immediately.
#### [NEW] routes/jobRoutes.js
- Exposes `GET /api/jobs/:jobId/progress` for SSE updates.
#### [MODIFY] index.js
- Mounts `/api/jobs` route.

---
### Frontend Client
#### [MODIFY] client/package.json
- Install `hls.js`.
#### [MODIFY] client/src/services/proxyService.js
- `uploadAndGenerateProxy()` now resolves with a `jobId` and subscribes to the SSE endpoint, resolving the full promise only when the proxy is ready.
#### [MODIFY] client/src/agent/TranscriptionManager.js
- Update to listen to the SSE endpoint (`/api/jobs/${jobId}/progress`) for progress events.
#### [MODIFY] client/src/agent/MediaExecutionEngine.js
- **Contract: async vs sync API responses**: If the API response contains `{ jobId }`, `executeApiCall` subscribes to `/api/jobs/:jobId/progress` via SSE and resolves when `state === 'completed'`. If the response contains any other shape, it resolves immediately as before. This is a backward-compatible change — existing direct-response endpoints work unchanged.

## Verification Plan

### Automated Tests
- Run `npm test` or specific file tests if available.

### Manual Verification
1. Upload a video file via the UI.
2. Verify that the upload completes almost instantly and the UI shows a processing progress state.
3. Check GCS bucket to confirm `.m3u8`, `.ts`, and waveform JSON files are generated and uploaded.
4. Run an AI agent command for silence detection, denoise, or normalization, ensuring it doesn't block the UI and successfully applies changes to the timeline when the job completes via SSE.
