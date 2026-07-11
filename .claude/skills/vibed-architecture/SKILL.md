# Vibed Architecture Skill

## When to use
Load this skill when working on:
- The AI agent pipeline (IntentParser through MediaExecutionEngine)
- Timeline store mutations and transactions
- Export pipeline debugging
- GCS path resolution
- Adding new routes or job processors

## Full file map

### client/src/agent/
Core AI pipeline:
- `IntentParser.js`         — local NLP_MAP classification + GPT-4o fallback
- `FallbackParser.js`       — regex safety net when NLP_MAP misses
- `IntentValidator.js`      — validates parsed intent before planning
- `EditPlanner.js`          — builds action plans for standard edits
- `LongFormEditPlanner.js`  — CLEAN_EDIT / YOUTUBE_OPTIMIZED / FULL_BUILD mode planner
- `LongFormVideoProcessor.js` — executes long-form edit plans (content-aware cuts)
- `CommandCompiler.js`      — compiles plans to ENGINE commands via COMMAND_REGISTRY
- `CommandConstants.js`     — INTENT_TYPES, OPERATIONS, ENGINE_TYPES enums
- `MediaExecutionEngine.js` — dispatches to STORE / FFMPEG / API / MEDIABUNNY engines
- `VideoEditorTools.js`     — store-level operations (addClip, splitClip, trimClip…)

Supporting agents:
- `AgentOrchestrator.js`    — top-level agent coordination
- `AgentSystem.js`          — agent initialization and wiring
- `AgentFeedbackService.js` — streams feedback to the UI during execution
- `AutonomousEditingMode.js`— handles autonomous multi-step editing sessions
- `ContentAnalyzer.js`      — GPT-4o content analysis (segments, structure, edit mode)
- `ContextGenerator.js`     — builds prompt context from current timeline state
- `CreativeDirector.js`     — creative suggestions and style guidance
- `ClarificationGenerator.js` — generates clarification questions when intent is ambiguous
- `EditJobManager.js`       — job lifecycle management
- `EditSessionMemory.js`    — retains edit history within a session
- `ErrorRecoveryAgent.js`   — handles failed steps and retries
- `EventBus.js`             — inter-agent event pubsub
- `ExecutionSupervisor.js`  — monitors execution progress and timeouts
- `IterationEngine.js`      — re-runs edits with refined parameters
- `JobStateMachine.js`      — per-job FSM (pending → running → done/failed)
- `TimelineTransaction.js`  — wraps timeline mutations in atomic transactions
- `TimelineValidator.js`    — post-mutation invariant checks (must always pass)
- `TranscriptionManager.js` — manages Whisper transcription state and readiness
- `UserApprovalAgent.js`    — pauses execution and requests user approval
- `ValidationService.js`    — shared validation utilities
- `VersionManager.js`       — timeline version snapshots for undo
- `WorkflowController.js`   — orchestrates multi-step workflows
- `ZoomAnalyzer.js`         — talking-head zoom / Ken Burns analysis

Orchestrator FSM (multi-step autonomous editing):
- `orchestrator/OrchestratorConfig.js`
- `orchestrator/OrchestratorController.js`
- `orchestrator/OrchestratorEvents.js`
- `orchestrator/OrchestratorFSM.js`
- `orchestrator/index.js`

### client/src/store/
- `useTimelineStore.js`  — primary store: tracks, captions, project, autosave
- `useJobStore.js`       — job lifecycle (JOB_STATES FSM, polling, TERMINAL_STATES)
- `useAIStore.js`        — AI panel state (thinking flag, message history)
- `useEditorStore.js`    — editor UI state (selected clip, panel layout)
- `useSessionStore.js`   — session ID and auth state
- `useUserPreferences.js`— persisted user settings

### client/src/timeline/
- `index.js`               — TimelineManager (entity-based engine, begin/commitTransaction)
- `TimelineSchema.js`      — ENTITY_TYPES, CLIP_TYPES, LAYER_TYPES, EFFECT_TYPES constants
- `TimelineStateManager.js`— low-level state transitions
- `TimelineHistory.js`     — undo/redo stack (localStorage-backed, size-capped)
- `TimelineEvents.js`      — timeline event definitions
- `ImmutableUtils.js`      — immutable update helpers

### client/src/engine/ (playback, not export)
- `PlaybackEngine.js` — WebCodecs-based playback orchestration
- `MasterClock.js`    — sync clock for audio/video tracks
- `MP4Demuxer.js`     — demuxes MP4 for frame-accurate scrubbing
- `VideoWorker.js`    — Web Worker for decode offloading
- `RingBuffer.js`     — lock-free ring buffer for worker communication

### client/src/hooks/
- `useAgentEvents.js`         — subscribes to agent EventBus (active job count etc.)
- `useJobStatus.js`           — polls job status endpoint
- `useJobRecovery.js`         — recovers pending jobs from localStorage on mount
- `useSupabasePersistence.js` — debounced Supabase autosave on track changes
- `useApprovalDialog.js`      — manages the UserApproval pause/resume flow
- `useClarificationDialog.js` — manages clarification request/response flow
- `useEffects.js`             — keyframe effect utilities
- `useDeviceType.js`          — mobile/desktop detection

### client/src/layouts/
- `IDELayout.jsx` — main editor shell: mounts all panels, registers beforeunload guard,
                    calls useSupabasePersistence(), useJobRecovery(), useAgentEvents()

### client/src/components/
- `Timeline/Timeline.jsx`       — timeline ruler + track container
- `Timeline/Track.jsx`          — single track row with clips
- `Timeline/Clip.jsx`           — clip block (drag, resize, context menu)
- `Timeline/Waveform.jsx`       — audio waveform visualization
- `Timeline/ClipContextMenu.jsx`
- `Timeline/QualityHUD.jsx`
- `Player/VideoPlayer.jsx`      — preview player
- `Player/CaptionOverlay.jsx`
- `Effects/KeyframeEditor.jsx`
- `Effects/EffectsPanel.jsx`
- `ExportModal.jsx`
- `ApprovalDialog.jsx`
- `ClarificationDialog.jsx`
- `AutonomousEditingPanel.jsx`

### server/routes/
- `revideoRenderRoutes.js` — normalizes clip URLs, invokes AWS Lambda async (InvocationType:'Event'), serves /webhook callback
- `exportRoutes.js`        — export orchestration (NLE + video)
- `nleExport.js`           — FCPXML / xmeml / OTIO export
- `silenceRoutes.js`       — FFmpeg silence detection
- `captionRoutes.js`       — Whisper transcription (enqueue + result)
- `proxyRoutes.js`         — GCS upload coordination (signed URLs, HLS proxy)
- `audioRoutes.js`         — audio processing (denoise, normalize, beat-detect)
- `analyzeRoutes.js`       — ContentAnalyzer server-side helpers
- `aiRoutes.js`            — AI inference proxy
- `jobRoutes.js`           — BullMQ job status polling
- `sessionRoutes.js`       — anonymous session management
- `effectsRoutes.js`       — effects presets
- `presetRoutes.js`        — user preset CRUD
- `auth.js`                — Supabase auth middleware
- `adminRoutes.js`         — admin utilities
- `polarWebhook.js`        — Polar.sh payment webhooks

### jobs/ (BullMQ processors — CommonJS)
- `videoProcessor.js`    — HLS proxy + waveform generation
- `audioProcessor.js`    — transcribe / denoise / normalize / beat-detect / diarize
- `analysisProcessor.js` — virality analysis + CLIP embeddings
- `silenceProcessor.js`  — FFmpeg silence detection

### queue/
- `connection.js` — `makeRedisConnection()` factory (keepAlive + retryStrategy)
- `queues.js`     — 4 BullMQ Queues, each with its own connection

### render-lambda/ (AWS Lambda — live render path)
- `index.ts`                      — Lambda handler: receives event, calls renderVideo(), uploads MP4 to GCS, POSTs webhook
- `revideo/src/project.ts`       — Revideo project bootstrap (runs inside Lambda container)
- `revideo/src/scenes/timeline.tsx` — Revideo scene compositor (reads tracks → MP4 in /tmp)

## Critical invariants
- `clip.url` must be a GCS signed URL before reaching the render worker — never `blob:` or undefined
- All AI timeline mutations must pass `TimelineValidator.validateTimeline()` after execution
- Job IDs are unique strings — never use BullMQ auto-increment integers
- Whisper transcription must be complete before any AI operation reads `captions`
- GCS path segments must be `encodeURIComponent`-encoded (spaces → %20)
- Each BullMQ Queue/Worker gets its own Redis connection via `makeRedisConnection()`
