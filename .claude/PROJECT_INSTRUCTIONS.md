# Vibed — Claude Project Instructions

You are an expert full-stack engineer working on **Vibed** — an AI-native video editing IDE
positioned as "Cursor for video", targeting podcasters and long-form content creators.

## Stack
- **Frontend:** React 18 + Vite + Zustand + TailwindCSS
- **Backend:** Node.js + Express + BullMQ + Redis (ioredis)
- **Database:** Supabase (PostgreSQL + pgvector + RLS)
- **Storage:** Google Cloud Storage (`viral-pilot_bucket`)
- **Rendering:** Revideo (Puppeteer/Chromium) running inside an **AWS Lambda container**
- **Payments:** Polar.sh (webhook at `routes/polarWebhook.js`)
- **Deployment:** Railway (main server + BullMQ worker) + AWS Lambda (render worker)

## Module system
- **Backend:** CommonJS (`require` / `module.exports`) — no exceptions
- **Frontend:** ES modules + JSX (`.js` and `.jsx`)

## AI Pipeline
```
User prompt
  → IntentParser (local NLP_MAP first, GPT-4o fallback)
  → FallbackParser (regex safety net)
  → IntentValidator
  → EditPlanner / LongFormEditPlanner (for ANALYZE / LONG_FORM_BUILD intents)
  → CommandCompiler (COMMAND_REGISTRY lookup)
  → MediaExecutionEngine.execute(command, job)
      ├─ ENGINE_TYPES.STORE      → executeStoreAction() → VideoEditorTools
      ├─ ENGINE_TYPES.FFMPEG     → executeFFmpegCommand()
      ├─ ENGINE_TYPES.API        → executeApiCall()
      └─ ENGINE_TYPES.MEDIABUNNY → executeMediaBunnyCommand()
  → validateTimeline()
```

The orchestrator layer (`agent/orchestrator/`) manages FSM state, events, and config
across multi-step autonomous editing sessions.

## Render pipeline (AWS Lambda — async)
```
POST /api/revideo/render (revideoRenderRoutes.js)
  → normalize clip URLs (blob: / undefined → signed GCS URL)
  → invoke AWS Lambda async (InvocationType: 'Event')
        Lambda: render-lambda/ (Revideo + Puppeteer in container)
        - renders to /tmp, uploads MP4 to GCS
        - POSTs completion to POST /api/revideo/webhook?jobId=...
  → client polls job status until webhook fires
```

## Key architectural rules
1. **AI never mutates the timeline directly.** All changes go through
   `TimelineManager.beginTransaction() … commitTransaction()`.
2. `validateTimeline()` (in `agent/TimelineValidator.js`) must be called after every
   AI-driven mutation. Any invariant violation is a fatal error — surface it, don't swallow it.
3. Clip URLs must be GCS signed v4 URLs before the Lambda invocation payload is built.
   `blob:` URLs and `undefined` URLs must be resolved to `raw/{userId}/{projectId}/{filename}`
   then signed — never forwarded raw.
4. GCS paths follow `raw/{userId}/{projectId}/{filename}`. Spaces in filenames must be encoded
   with `encodeURIComponent` per segment (not `encodeURI` on the full path).
5. Anonymous sessions use `X-Session-ID` header; authenticated sessions use Supabase JWT.
6. Each BullMQ Queue and Worker must get its own Redis connection via `makeRedisConnection()`
   from `queue/connection.js` — never share one connection across queues.
7. Job IDs are unique strings (not BullMQ auto-increment integers) — see `pendingJobs.js`.
8. Background transcription (Whisper) must complete before AI operations that need `captions`.
9. `render-worker/` (Fly.io) is **dead code** — do not reference or modify it.
   The live render path is `render-lambda/`.

## Stores
- `useTimelineStore` — timeline state, clips, tracks, captions, autosave
- `useJobStore` — BullMQ job lifecycle tracking (JOB_STATES FSM)
- `useAIStore` — agent UI state (thinking, streaming, messages)
- `useEditorStore` — editor UI state (panel widths, selected clip, etc.)
- `useSessionStore` — session ID, auth state
- `useUserPreferences` — persisted user settings

## Code style rules
- No unnecessary abstractions — prefer explicit over clever.
- Always null-check `clip.url` before forwarding to the renderer.
- Timeline schema validation lives in `client/src/timeline/TimelineSchema.js`
  (not a separate Zod file — it's vanilla JS with runtime assertions).
- When adding a new AI action, touch all five layers:
  IntentParser → EditPlanner → CommandCompiler → VideoEditorTools → TimelineValidator.

## Current active work
- Multi-project system (DashboardPage + Supabase autosave via `useSupabasePersistence`)
- Intelligent speech-aware cutting (word-boundary aligned, GPT-4o semantic analysis)
- Footage bin semantic search (pgvector + CLIP embeddings)
- Audio waveform visualization on timeline clips (`components/Timeline/Waveform.jsx`)
- Smart zoom / Ken Burns for talking-head content (`agent/ZoomAnalyzer.js`)
- Long-form editing modes: `CLEAN_EDIT`, `YOUTUBE_OPTIMIZED`, `FULL_BUILD`
  (handled by `LongFormEditPlanner` + `LongFormVideoProcessor`)
