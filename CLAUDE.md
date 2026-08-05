# CLAUDE.md — Vibed Architectural Knowledge Graph

> This file is the persistent architectural memory for this codebase.
> Future Claude sessions should read this before touching any file.
> Generated 2026-07-16. Update it when you add a new system or refactor a boundary.

---

## NODE 1 · SYSTEM ARCHITECTURE

Vibed is a **conversational AI video editor** deployed as a distributed system across three hosts.

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENT  React + Vite SPA (served from Railway as static)  │
│  - Zustand stores  - xstate agent FSM  - WebGL2 playback   │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTPS / REST
┌────────────────────▼────────────────────────────────────────┐
│  BACKEND  Express monolith on Railway (index.js)           │
│  - Auth middleware → Supabase JWT                          │
│  - BullMQ job queues → Redis                               │
│  - GCS or local file storage (StorageService)              │
│  - OpenAI GPT-4o for AI routes                             │
│  - Polar billing webhooks                                   │
└──────┬─────────────────┬──────────────────┬────────────────┘
       │ BullMQ / Redis  │ HTTP invoke      │ HTTP
┌──────▼──────────┐  ┌───▼───────────────┐  ┌▼──────────────────────┐
│  BullMQ WORKER  │  │  RENDER WORKER    │  │  DIARIZE SERVICE      │
│  Railway/same   │  │  AWS Lambda       │  │  Python / separate    │
│  worker.js      │  │  render-lambda/   │  │  Speaker diarization  │
│  FFmpeg export  │  │  Revideo renderer │  │  (pyannote)           │
│  Asset analysis │  │  GCS output       │  └───────────────────────┘
│  Embeddings     │  └───────────────────┘
└─────────────────┘

NOTE: render-worker/fly.toml is STALE — the Fly.io render worker was
replaced by render-lambda/ (AWS Lambda + Revideo). Do not redeploy
render-worker/. The fly.toml can be deleted once you confirm Lambda
is the sole render path.

External services:
  Supabase   → Auth (JWT) + DB (profiles, projects, usage_events, anonymous_sessions)
  GCS        → Video/asset storage (production)
  Redis      → BullMQ queue broker
  OpenAI     → GPT-4o at /api/ai/* routes
  Polar      → Billing / subscription webhooks → profiles.plan
  jsDelivr   → @fontsource v4 TTF downloads at Dockerfile build time
```

**Runtime entry point:** `index.js` (root) — Express app, all route mounts, rate limiters, CORS, CSP, inline worker boot.

---

## NODE 2 · FOLDER OWNERSHIP

```
/                           Root — backend Node/Express
  index.js                  Server entry: mounts all routers, starts BullMQ workers
  config/
    database.js             Supabase admin client singleton (supabaseAdmin)
    storage.js              GCS client init
  routes/                   One file per feature domain (see NODE 5 · API GRAPH)
  controllers/
    aiAgentController.js    GPT-4o chat completions, json_object response format
    effectsController.js    Video effects CRUD
    mainController.js       Health check, misc
  middleware/
    auth.js                 authenticateUser: Supabase JWT → req.user (id, email, plan)
    devAuth.js              Dev-only bypass (never production)
    usageGate.js            aiGate (monthly AI ops), nleGate (paid export only)
    usageLimits.js          Rate limiting config
    errorHandling.js        Global Express error handler
  jobs/                     BullMQ worker processors
    exportProcessor.js      FFmpeg export pipeline, FONT_SPECS, font download fallback
    audioProcessor.js       Audio extraction / normalization
    videoProcessor.js       Proxy generation (transcode for browser)
    silenceProcessor.js     Silence detection
    analysisProcessor.js    Video analysis (scene detection etc.)
  queue/
    queues.js               4 BullMQ queues: video-processing, audio-processing,
                            analysis-processing, export-processing
    connection.js           Redis connection shared by all queues
  services/
    StorageService.js       Unified file I/O: GCS in prod, local /uploads in dev
  models/                   DB model helpers
  migrations/               SQL migration files
  diarize-service/          Python — speaker diarization (separate deploy)
  ML_Dataset/               Training data (not part of runtime)
  ML_Models/                Trained model artifacts (virality_predictor)

/server/                    Creative Asset Intelligence System (SFX/LUT/preset search)
  routes/audioEngineRoutes.js   /api/audio/search, /recommend, /recommend/sfx
  audio-engine/
    search/                  QueryParser (NL → SemanticSearchQuery), AssetSearchEngine
                            (3-pass: metadata/embedding/context), TaxonomyService
                            (Supabase queries), RankingEngine, UserPreferenceEngine
    recommendations/        RecommendationEngine
    embeddings/             EmbeddingService/Worker/Scheduler (pgvector similarity)
    library/                starterLibrary.js (33 SFX), starterLUTs.js (10 LUTs),
                            systemPresets.js (8 presets), seeder.js, taxonomyMaps.js
    export/                 AudioExportService
    types.js                 AssetType/EditingIntent/EmotionTag/PresetType enums
  DB tables (Supabase, same project as everything else): assets, sound_effects,
    luts, presets, user_presets, asset_usage_log, user_asset_preferences,
    timeline_event_log, audio_exports

/client/                    Frontend React + Vite
  src/
    agent/                  AI agent system (see NODE 3 · FEATURE GRAPH § Agent)
    components/             UI components organized by domain
      Assistant/            ReasoningPanel, AgentPlanCard, SuggestionCard, etc.
      Timeline/             Timeline tracks, clips, ruler
      Player/               Playback controls
      Sidebar/              Panels (effects, captions, etc.)
      Effects/              Effects UI
      3D/                   Three.js 3D elements
    engine/                 PlaybackEngine (WebGL2, WebCodecs, MasterClock)
      libs/                 RingBuffer, MP4Demuxer
    effects/                Effect engines and presets
    hooks/                  React hooks (useJobStatus, useClarificationDialog, …)
    layouts/                IDELayout (the main editor shell)
    lib/                    Shared utilities (supabaseClient, planLimits, projectsApi)
    locales/                i18n JSON (en/, fr/) — 10 namespaces
    pages/                  Route-level page components
    presets/                Caption/export presets
    revideo/                Revideo render integration
    services/               Client-side API wrappers (exportService, etc.)
    store/                  Zustand stores (see NODE 3 · FEATURE GRAPH § Stores)
    timeline/               TimelineStateManager (core immutable entity store)
    utils/                  authFetch, captureProjectThumbnail, etc.
  public/
    fonts/                  Pre-downloaded TTFs for export (Dockerfile populates this)
```

---

## NODE 3 · FEATURE GRAPH

### 3A · AI Agent Pipeline (client-side)

All triggered from a user's natural language command in the assistant panel.

```
User input
  → WorkflowController.js     xstate FSM, 15-min timeout, OPERATION_META descriptions
  → EditJobManager.js         Full orchestration: intent → plan → compile → execute → validate
      → IntentParser.js       GPT-4o via POST /api/ai/parse-intent; FallbackParser for local NLP
      → FallbackParser.js     Keyword/regex NLP_MAP (no network, instant fallback)
      → ClarificationGenerator.js   Generates question sets when intent is ambiguous
      → EditPlanner.js        generatePlan() → ACTIONS enum steps; calls /api/ai/generate-plan
      → CommandCompiler.js    Pure synchronous compile(plan, stateSnapshot) → commands
                              Engines: STORE | MEDIABUNNY | API
                              Outcomes: OK | SKIP | VALIDATION_ERROR | FALLBACK_USED | TIMEOUT
      → MediaExecutionEngine.js    Executes compiled commands against the timeline
      → ValidationService.js  Post-execution timeline sanity checks
      → VersionManager.js     Snapshot / rollback support
  → UserApprovalAgent.js      Shows AgentPlanCard; waits for user approve/reject
  → AgentFeedbackService.js   Collects outcome feedback
```

Supporting agent files:
- `ContextGenerator.js` — builds timeline snapshot for LLM context
- `IntentValidator.js` — validates intent schema before planning
- `ErrorRecoveryAgent.js` — retry/recovery logic
- `ExecutionSupervisor.js` — monitors execution, applies timeouts
- `IterationEngine.js` — multi-step editing loops
- `JobStateMachine.js` — per-job FSM
- `LongFormEditPlanner.js` + `LongFormVideoProcessor.js` — large video handling
- `TimelineTransaction.js` — wraps timeline mutations in atomic transactions
- `TimelineValidator.js` — validates timeline state shape
- `TranscriptionManager.js` — caption/transcript integration
- `ZoomAnalyzer.js` — zoom-based content analysis
- `ContentAnalyzer.js` — scene/content analysis
- `CreativeDirector.js` — creative suggestions
- `EditSessionMemory.js` — per-session edit history for LLM context
- `AgentOrchestrator.js` + `AgentSystem.js` — higher-level orchestration
- `AutonomousEditingMode.js` — hands-off batch editing
- `EventBus.js` — pub/sub for agent ↔ UI events
- `VideoEditorTools.js` — TOOL_DEFINITIONS (cut_clip, remove_clip, move_clip, set_clip_speed, etc.)

### 3B · Zustand Stores

All live in `client/src/agent/` (co-located with agent code):

| Store | Key state | Notes |
|-------|-----------|-------|
| `useTimelineStore.js` | tracks, clips, assets, aspectRatio, previewQuality, projectId | Wraps `timelineManager` singleton; autosave to `localStorage.vp_autosave` (1.5s debounce); `subscribeWithSelector` |
| `useAIStore.js` | agent state, messages, job queue | AI assistant state |
| `useJobStore.js` | active BullMQ jobs, polling state | Syncs with `/api/jobs/:id` |
| `useSessionStore.js` | anonymous session lifecycle | `vp_session` localStorage key; `POST /api/session/create` |
| `useEditorStore.js` | UI state (panel open/close, selection) | Pure UI state |
| `useUserPreferences.js` | language, theme, etc. | Persisted to localStorage |

### 3C · Timeline Engine

```
client/src/timeline/TimelineStateManager.js
  - Immutable entity store (tracks, clips, assets)
  - ACTION_TYPES dispatch pattern
  - Undo/redo via versioned checkpoints
  - beginTransaction() / commitTransaction() / rollbackTransaction()
  - toLegacyTracks() — syncs to Zustand format
```

### 3D · Playback Engine

```
client/src/engine/PlaybackEngine.js
  - WebGL2 canvas rendering
  - State machine: IDLE → PRELOADING → READY → PLAYING → PAUSED → ERROR
  - MasterClock — master timeline clock
  - RingBuffer — audio sample buffer
  - MP4Demuxer — WebCodecs-based frame decode
```

### 3E · Export Pipeline

```
Client: POST /api/export  (routes/exportRoutes.js + services/exportService.js)
  → Validates auth + nleGate (paid plans only)
  → Pushes job to export-processing BullMQ queue
  → Returns jobId; client polls GET /api/jobs/:id

Worker (Railway, same host as backend): jobs/exportProcessor.js
  → FONT_SPECS registry: 11+ fonts (Anton, BebasNeue, Montserrat, Oswald, Inter,
    Nunito, PlayfairDisplay, Caveat, DMSans, Unbounded, CormorantGaramond)
  → Font resolution order: fontDir → runtime CDN download → system fallback (DejaVu)
  → FFmpeg drawtext filter for caption overlay
  → GCS upload → signed URL → client notified via job poll
```

### 3E-2 · Cinematic Export (Beta) — Revideo/Lambda

Second, opt-in export pipeline. User picks it via the "Render Engine" toggle in
`ExportModal.jsx` (`settings.engine: 'ffmpeg' | 'revideo'`, default `'ffmpeg'`).
Renders through a real Chromium context (Revideo) instead of FFmpeg's `drawtext`
filter — more faithful fonts/effects, but depends on backend env vars that may
not be configured on every deployment.

```
Client: ExportModal.jsx → IDELayout.jsx's handleRevideoExport()
  → POST /api/revideo/render  (routes/revideoRenderRoutes.js, authenticateUser)
  → 500 "Render proxy not configured" if RENDER_WORKER_URL / WORKER_SECRET
    are missing — surfaced to the user as an actionable message, not a crash
  → 202 { jobId } on success
  → client polls GET /api/revideo/status/:jobId via client/src/utils/revideoPoller.js
    (a SEPARATE poller from jobPoller.js — different field names: `status`
    'rendering'|'success'|'error', not BullMQ's `state` 'completed'|'failed')

Backend (routes/revideoRenderRoutes.js):
  → Resolves clip URLs to signed GCS URLs, extracts captionStyle from tracks
  → Invokes AWS Lambda asynchronously (AWS_LAMBDA_FUNCTION_NAME, default
    'revideo-render-lambda'), passing renderId=jobId so the Lambda's GCS
    output path (renders/{jobId}.mp4) is DETERMINISTIC
  → Completion detection is TWO-SOURCE (webhook-independent by design):
    1. POST /api/revideo/webhook (from Lambda) → in-memory renderJobs Map (fast path)
    2. GET /status/:jobId falls back to checking renders/{jobId}.mp4 directly
       in GCS (throttled ≥5s, after a 15s grace) — survives a lost webhook,
       a Railway restart wiping the Map (unknown jobIds are treated as
       possibly-in-flight and recovered via GCS), or an unset backendUrl.
       Success URLs are signed on read (bucket is private).
    The Map has a 60-min TTL janitor. HISTORY: completion used to be webhook-ONLY,
    and backendUrl fell back to the literal placeholder
    'https://your-railway-app.railway.app' when FRONTEND_URL/PUBLIC_URL were
    unset — every webhook died against a dead domain and every render hung at
    'rendering' until the client's poller timed out. Set PUBLIC_URL on Railway;
    without it the webhook + Lambda font fallback are disabled (GCS polling
    still completes renders, just slower).

Lambda (render-lambda/index.ts):
  → FontInstaller.ts resolves fonts: /opt/fonts (Layer) → /tmp cache →
    ${backendUrl}/fonts/<file> (the committed TTFs in client/public/fonts/,
    served statically by the SPA host — the RELIABLE no-Layer path, requires
    PUBLIC_URL set on the backend) → jsDelivr (kept last; dead in practice —
    @fontsource v4 never shipped TTFs at that URL pattern, the root cause of
    the FFmpeg pipeline's original font bug, see NODE 9 history).
  → Uses payload.renderId (the backend's jobId) for the GCS output path so
    the backend can detect completion without the webhook.
  → Fonts embedded as base64 @font-face data URLs, injected into the Revideo
    scene (render-lambda/revideo/src/scenes/timeline.tsx) before first frame
  → Renders MP4 → uploads to GCS → signed URL → webhook back to backend

Deployment prerequisites (not automated — verify before relying on this path):
  - Lambda function must already exist in AWS (render-lambda/deploy.sh only
    updates an existing function; first creation is manual via console —
    3GB+ memory, 15-min timeout, IAM role with GCS write access). deploy.sh
    also sets --maximum-retry-attempts 0 on updates (AWS's async-invoke
    default of 2 retries made crashed renders re-run for up to 30 extra
    minutes, firing stale webhooks — the "endlessly retrying" symptom).
  - Backend env vars: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (REQUIRED —
    the route 500s without them), AWS_REGION (REQUIRED in practice: it
    defaults to 'us-east-1', so a function living anywhere else — e.g.
    eu-north-1 — gets ResourceNotFoundException on every invoke, which
    presents as "the Lambda isn't connected"; must match the region in the
    Lambda console URL), PUBLIC_URL or FRONTEND_URL (this backend's public
    URL — enables the webhook fast path AND the Lambda's backend-font
    fallback; without it, renders still complete via GCS polling but fonts
    need the Layer), AWS_LAMBDA_FUNCTION_NAME (optional, defaults to
    'revideo-render-lambda').
    RENDER_WORKER_URL / WORKER_SECRET are DEAD (retired Fly.io worker) — the
    route used to hard-require both and 500 "Render proxy not configured"
    before ever contacting Lambda, so a correct Lambda setup still failed
    until two irrelevant vars were set. That gate is gone; don't reinstate it.
  - `GET /api/revideo/health` is the diagnostic: it calls
    GetFunctionConfiguration against the real function and reports
    credentials/region/function-state/timeout/memory plus a `problems` array.
    It used to ping the dead Fly worker and answer "ok" while Lambda was
    completely unreachable.
  - GCS_BUCKET_NAME set explicitly on the Lambda side (defaults to
    'viral-pilot_bucket' if unset) — must match the backend's bucket, since
    the backend's GCS completion check looks in ITS OWN bucket for
    renders/{jobId}.mp4
  - Font layer built (build-layer.sh) and attached to the Lambda — optional
    when PUBLIC_URL is set (backend-font fallback covers it); without either,
    captions render in system sans
  - Client poll budget is 16 min (revideoPoller.js DEFAULT_TIMEOUT_MS) to
    cover the Lambda's 15-min ceiling — do not shrink it back to the FFmpeg
    poller's 300s, that caused premature "Render timed out after 300s" while
    the Lambda was still legitimately rendering
```

### 3F · i18n System

```
client/src/locales/{en,fr}/
  Namespaces: common, editor, landing, errors, about, privacy, data, cookies, auth, dashboard

Language detection: i18next-browser-languagedetector → localStorage.vibed_lang
Hook: useTranslation(namespace) from react-i18next

Wired components (all complete):
  AuthPage, AuthPromptModal, SuccessPage, DashboardPage, ExportModal, SettingsPanel
```

---

## NODE 4 · SERVICE DEPENDENCY GRAPH

```
index.js (Express)
  ├── requires: config/database.js → supabaseAdmin (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  ├── requires: config/storage.js  → GCS client (GOOGLE_APPLICATION_CREDENTIALS or local)
  ├── requires: queue/connection.js → ioredis (REDIS_URL)
  ├── requires: queue/queues.js    → 4 BullMQ queues
  ├── requires: middleware/auth.js → supabaseAdmin.auth.getUser(token)
  ├── requires: middleware/usageGate.js → supabaseAdmin (usage_events + profiles tables)
  └── routes/* each require their own deps

jobs/exportProcessor.js (Fly.io worker)
  ├── requires: queue/connection.js → same Redis
  ├── requires: config/storage.js  → GCS
  ├── requires: ffmpeg (system binary — NOT ffmpeg-static, needs libfreetype for drawtext)
  └── requires: /usr/src/app/client/public/fonts/ → TTF files (pre-built in Dockerfile)

Client
  ├── requires: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (build-time env)
  ├── requires: /api/* (same-origin or Railway URL)
  └── requires: Supabase JS client (lib/supabaseClient.js singleton)
```

**Critical env vars:**
```
SUPABASE_URL                  Supabase project URL
SUPABASE_SERVICE_ROLE_KEY     Backend admin key (never in client)
VITE_SUPABASE_URL             Client-side Supabase URL
VITE_SUPABASE_ANON_KEY        Client-side anon key
REDIS_URL                     Redis connection string (BullMQ)
OPENAI_API_KEY                GPT-4o
AI_PROVIDER                   openai (default) | ollama | mock — see R45. Forced to
                              openai in production. Unset = unchanged behaviour.
OLLAMA_BASE_URL               default http://localhost:11434/v1 (staging only)
OLLAMA_MODEL / OLLAMA_VISION_MODEL   local model names (staging only)
GOOGLE_APPLICATION_CREDENTIALS / GCS_BUCKET_NAME
POLAR_WEBHOOK_SECRET          Polar billing webhook verification
BYPASS_USAGE_GATE=true        Local dev only — skips quota checks
```

---

## NODE 5 · API GRAPH

All routes mounted in `index.js`. Protected routes require `authenticateUser` middleware.

```
Auth / session
  POST   /api/session/create          sessionRoutes     public (anonymous sessions)
  GET    /api/session/:id             sessionRoutes     public
  DELETE /api/session/:id             sessionRoutes     public
  POST   /api/auth/*                  auth.js           Supabase passthrough

Projects
  GET    /api/projects                projectRoutes     authenticateUser
  POST   /api/projects                projectRoutes     authenticateUser
  GET    /api/projects/:id            projectRoutes     authenticateUser
  PUT    /api/projects/:id            projectRoutes     authenticateUser
  DELETE /api/projects/:id            projectRoutes     authenticateUser

AI / Agent
  POST   /api/ai/parse-intent         aiRoutes          authenticateUser + aiGate
  POST   /api/ai/generate-plan        aiRoutes          authenticateUser + aiGate
  POST   /api/ai/clarify              aiRoutes          authenticateUser + aiGate
  POST   /api/ai/agent                aiRoutes          authenticateUser + aiGate
  (all handled by aiAgentController.js, model: gpt-4o, response_format: json_object)

Export
  POST   /api/export                  exportRoutes      optionalAuth + nleGate
  GET    /api/export/presets          exportRoutes      public
  Platform presets: tiktok / youtube / reels / shorts

Jobs
  GET    /api/jobs/:id                jobRoutes         authenticateUser

Proxy / Upload
  POST   /api/proxy/upload            proxyRoutes       authenticateUser
  (multer → /uploads/temp → StorageService → proxy generation job)

Audio / Waveform
  POST   /api/audio/extract           audioRoutes       authenticateUser
  GET    /api/waveform/:id            waveformRoutes    authenticateUser

Captions
  POST   /api/captions/generate       captionRoutes     authenticateUser + aiGate
  POST   /api/captions/export         captionRoutes     authenticateUser

Silence
  POST   /api/silence/detect          silenceRoutes     authenticateUser

Analysis
  POST   /api/analyze                 analyzeRoutes     authenticateUser

Effects
  GET    /api/effects                 effectsRoutes     public
  POST   /api/effects/apply           effectsRoutes     authenticateUser

Presets
  GET    /api/presets                 presetRoutes      public

Interview
  POST   /api/interview               interviewRoutes   authenticateUser

NLE Export
  POST   /api/nle-export              nleExport.js      authenticateUser + nleGate

Revideo
  POST   /api/revideo/render          revideoRenderRoutes  authenticateUser

Billing
  POST   /api/polar/webhook           polarWebhook.js   public (HMAC verified)
  (canceled → markCancellation, revoked → setPlan free — NOT the same, see R46)
  POST   /api/polar/checkout          polarWebhook.js   authenticateUser
  POST   /api/checkout/create         polarWebhook.js   authenticateUser (alias)
  GET    /api/polar/subscription      polarWebhook.js   authenticateUser (live from Polar)
  POST   /api/polar/cancel            polarWebhook.js   authenticateUser (cancel at period end)
  POST   /api/polar/reactivate        polarWebhook.js   authenticateUser
  POST   /api/polar/portal            polarWebhook.js   authenticateUser (hosted Polar portal)

Admin
  GET    /api/admin/*                 adminRoutes       authenticateUser (admin role check)

Health
  GET    /health                      mainController    public
  GET    /api/health/data             dataHealthRoutes  x-admin-secret (R40)
  (dependency-table row counts — catches the "silently empty table" class: R12/R21/R37/R38)
  GET    /api/health/queues           dataHealthRoutes  x-admin-secret (R48)
  (BullMQ queue depth + diarize reachability — catches "the worker was never deployed")
```

---

## NODE 6 · DATABASE GRAPH

Supabase (Postgres). Access via `supabaseAdmin` (backend) or `supabase` JS client (frontend).

```
profiles
  id          uuid  (FK → auth.users.id)
  plan        text  ('free' | 'creator' | 'pro')
  email       text
  created_at  timestamp

projects
  id            uuid
  user_id       uuid  (FK → profiles.id)
  name          text
  timeline_state  jsonb   (full timeline snapshot)
  thumbnail_url text
  created_at    timestamp
  updated_at    timestamp

usage_events
  id          uuid
  user_id     uuid  (FK → profiles.id)
  operation   text  (req.path of the AI operation)
  created_at  timestamp
  (used by usageGate.aiGate to count monthly AI ops)

anonymous_sessions
  id          text  (session token)
  data        jsonb
  created_at  timestamp
  expires_at  timestamp
  (in-memory Map fallback used when Supabase is slow)
```

**Plan limits (middleware/usageGate.js):**
```
plan      ai_ops/month   max_duration(s)   projects   storage_days
free         10              1200             2            7
creator     100              5400            ∞           30
pro          ∞              14400            ∞           90
```

Client-side limits (client/src/lib/planLimits.js):
```
free: 2 projects,  creator: 10 projects,  pro: Infinity
```
⚠️ These two files have DIFFERENT project limits — server allows ∞ for creator, client caps at 10. Reconcile if you add enforcement.

---

## NODE 7 · DATA FLOW

### 7A · Video Upload → Playback
```
User drops file
→ proxyRoutes.js: multer upload → /uploads/temp/{uuid}
→ StorageService.uploadFile() → GCS or local
→ Push job to video-processing queue
→ videoProcessor.js: transcode to browser-compatible proxy
→ asset.proxyUrl stored in timeline state
→ PlaybackEngine loads via WebCodecs + MP4Demuxer
```

### 7B · AI Edit Command → Timeline Change
```
User types command in AssistantPanel
→ useAIStore triggers WorkflowController
→ IntentParser: POST /api/ai/parse-intent → GPT-4o → structured intent
  (FallbackParser if network fails)
→ If needs_clarification → ClarificationGenerator → ClarificationDialog UI
→ EditPlanner: POST /api/ai/generate-plan → action steps
→ UserApprovalAgent: renders AgentPlanCard → user approves/revises
→ CommandCompiler: compile(plan, stateSnapshot) → commands[] (pure, sync, 200ms timeout)
→ MediaExecutionEngine: executes commands → timeline mutations
→ useTimelineStore._saveHistory() + timelineManager mutations
→ ValidationService: sanity checks
→ React re-render via Zustand subscription
```

### 7C · Export Flow
```
User clicks Export → ExportModal → POST /api/export (with captions, platform preset)
→ nleGate: block free plan
→ export-processing BullMQ job enqueued (Fly.io worker picks up)
→ exportProcessor.js:
    1. Resolve fonts from FONT_SPECS → /client/public/fonts/ (pre-built by Dockerfile)
    2. If font missing or <5KB → download from jsDelivr CDN at runtime
    3. Assemble FFmpeg command with drawtext filter for captions
    4. Run FFmpeg → output MP4
    5. StorageService.uploadFile() → GCS → signed URL
→ Client polls GET /api/jobs/:jobId → status updates via useJobStore
→ Download link presented in UI
```

### 7D · Auth Flow
```
Signed-in user:
  supabase.auth.signIn() → JWT stored in Supabase session
  → All API calls include Authorization: Bearer <JWT>
  → middleware/auth.js: supabaseAdmin.auth.getUser(token) → profiles table lookup
  → req.user = { id, email, plan }

Anonymous user:
  useSessionStore → POST /api/session/create → in-memory Map (+ Supabase fallback)
  → sessionId stored in localStorage.vp_session
  → On sign-up: migrateSession() moves anonymous work to authenticated account
```

---

## NODE 8 · ARCHITECTURAL RULES

These rules exist for specific reasons. Break them only with intent.

**R1 — Module format split is absolute.**
Backend (routes/, controllers/, middleware/, jobs/): CommonJS (`require`/`module.exports`).
Frontend (client/src/): ESM (`import`/`export`). Mixing them breaks the build silently.

**R2 — Never use `var`, never leave empty catch.**
Every async function needs `try/catch` with `console.error`. Catch blocks in BullMQ jobs must not swallow errors — the worker needs to know a job failed.

**R3 — Every protected route must have `authenticateUser` first.**
Add it as middleware, not inline. Do not gate on `req.user` without the middleware already running.

**R4 — Timeline mutations require `_saveHistory()` before and a transaction.**
`get()._saveHistory()` → `timelineManager.beginTransaction()` → mutations → `commitTransaction()` → `set({ tracks: timelineManager.toLegacyTracks() })`. If you skip `toLegacyTracks()`, React won't see the change.

**R5 — CommandCompiler must stay pure and synchronous.**
No async, no store mutations, no imports of `useTimelineStore`. It receives `stateSnapshot` as an argument. Symbolic refs (`$playhead`, `$clip`) are resolved by the executor, not the compiler.

**R6 — The export worker on Fly.io uses system FFmpeg, not ffmpeg-static.**
Reason: ffmpeg-static omits libfreetype, which is required by `drawtext` (caption export). The Dockerfile installs `ffmpeg` (Debian package). Never switch to ffmpeg-static without verifying drawtext still works.

**R7 — Font directory for export is `/usr/src/app/client/public/fonts/`.**
Pre-populated at Docker build time via individual `curl` calls (no `declare -A` — Dockerfile runs under `/bin/sh` dash, not bash). The runtime CDN fallback only fires when a file is missing or <5KB.

**R8 — `BYPASS_USAGE_GATE=true` must never appear in production env.**
It skips all quota checks. It is guarded by an env check in `usageGate.js` and must only exist in `.env.local` on developer machines.

**R9 — AI routes all go through `aiGate` middleware.**
This records a usage event (even if the downstream request fails) and enforces monthly limits. New AI endpoints must add both `authenticateUser` and `aiGate`.

**R10 — Anonymous sessions use in-memory Map as primary, Supabase as fallback.**
The in-memory Map is lost on server restart. Anonymous sessions are ephemeral by design. Don't store anything critical there that isn't also in the client.

**R11 — `asset.proxyUrl` has two valid shapes; anything that parses it must handle both.**
`jobs/videoProcessor.js`'s `uploadToStorage()` returns `/api/proxy/gcs-media/<path>` in GCS mode and `/uploads/<path>` in local storage mode (the default when no `GOOGLE_CLOUD_BUCKET_NAME`/credentials are configured — see `config/storage.js`). `utils/waveformPath.js`'s `deriveGcsPath()` is the canonical place that turns a `proxyUrl` back into a storage-relative path; it strips *both* prefixes. This used to only handle the GCS shape, which made waveform extraction 400 forever in local/dev mode (silently — no console output, just a bare 400 in Network). If you write new code that parses `proxyUrl`, either reuse `deriveGcsPath()` or handle both shapes yourself, and add a case to `scripts/test_waveform_pipeline.js` (`node scripts/test_waveform_pipeline.js`).

**R27 — Every `interviewRoutes.js` handler that takes a client-supplied `filename`/`gcsPath`/`filePath` must resolve it through `resolveFfmpegInputArg()` or `resolveUploadPath()`, both of which now enforce ownership. Never call the GCS SDK or build a local path from client input directly.**
Storage paths embed the owning user's id (`raw/{userId}/{file}`, `proxies/{userId}/{file}/...` — see `proxyRoutes.js`, `videoProcessor.js`). Nothing checked that segment against the requesting user: any authenticated caller who knew or guessed another user's Supabase UUID could pass `raw/{victimUserId}/...` as `filename` to `/virtual-multicam`, `/organize-clips`, `/split-speakers`, `/rhythm-zoom`, `/analyze`, or `/refine-cut-frames` and the server would sign a GCS URL or resolve a local path for it without complaint — an IDOR. Fixed with three small helpers: `resolveRequestUserId(req)` (same real-user/`'dev-user'` fallback as `proxyRoutes.js`), `pathOwnerUserId(gcsPath)` (extracts the `{userId}` segment from a `raw/`/`proxies/` path, or `null` if the path doesn't match either shape), and `pathOwnedBy(gcsPath, requestUserId)` (the actual gate — a path with no recognizable owner segment is allowed through, since there's nothing to check and the separate uploads/-boundary check still applies; a path WITH an owner segment is denied if it doesn't match, and fails closed — denied, not allowed — if `requestUserId` is somehow unset).
`resolveFfmpegInputArg()` and `resolveUploadPath()` both take `requestUserId` as a required parameter now and call `pathOwnedBy()` before doing anything else. Every helper between a route and these two functions (`extractVideoFrame`, `detectHostSideViaVision`, `detectSceneLayout`, `detectSpeakerSides`) had `requestUserId` threaded through as an added parameter so the check can't be silently bypassed by a call several layers deep. `organize-clips`'s `clip.filePath` branch bypassed `resolveUploadPath` entirely (inline `path.resolve` + boundary check only) and got the same `pathOwnedBy()` call added directly.
Denied paths return exactly what a not-found path returns (`null` / the existing "Access denied: invalid file path" message) — never a distinct 403 — so the response can't be used to fingerprint whether a given path exists for another user.
If you add a new route or helper here that accepts a filename/path from the client, it MUST go through one of these two functions (or call `pathOwnedBy()` directly if neither fits) — anything that resolves a storage path itself, inline, silently reopens this hole.

**R34 — Anything that ffmpeg-decodes or `<video>`-seeks a source file must prefer the PROXY over the raw upload, and must WAIT for the proxy rather than fall back to raw for a video asset.**
Raw phone/camera uploads routinely have their moov atom at the END of the file — R7/R25 already established this for `refine-cut-frames`, which is why that route prefers the proxy. It's a general fact about raw uploads, not something specific to one route, and it kept re-surfacing because each new consumer had to independently discover it:
- `routes/waveformRoutes.js` decodes audio via ffmpeg reading a GCS stream. Against a non-faststart raw file, ffmpeg often can't produce output until it's buffered close to the entire file, because the sample table isn't available until the stream ends. A 4K interview upload hit this three times in a row — three ffmpeg-timeout 500s — before its proxy even finished encoding, at which point extraction would have been trivial.
- `client/src/utils/captureProjectThumbnail.js`'s `buildVideoUrl()` used to check `asset.sourceUrl` (raw) BEFORE `asset.proxyUrl` — backwards. Seeking a `<video>` element needs the same moov atom ffmpeg needs; observed in the wild as `[thumbnail] Video load error for .../raw/.../4K.mp4` immediately followed, once the proxy finished, by a successful capture on the next autosave tick. Fixed by re-ordering the priority: proxyUrl → url → sourceUrl (raw, last resort).
- `client/src/components/Timeline/Clip.jsx` was worse than "wrong order" — it would eagerly attempt waveform extraction against the raw file the INSTANT a clip was placed, before any proxy existed, wasting 2-3 ffmpeg timeouts per asset for nothing. Fixed with an `isUnproxiedVideoAsset = asset?.type === 'video' && !asset?.proxyUrl` gate that nulls out BOTH `asset.gcsPath` and the clip-URL fallback until the proxy exists, rather than racing it. `usePeaks`' `proxyUrl` dependency means it re-fires automatically once the proxy lands — waiting costs nothing.
THE SUBTLE TRAP if you touch any of these: `usePeaks(assetId, gcsPath, proxyUrl)`'s `gcsPath` argument is ALSO the raw path (asset.gcsPath is set from the raw upload's GCS key, not the proxy's). `deriveGcsPath()` used to check it FIRST, unconditionally — `if (rawGcsPath) return rawGcsPath` — so nulling `proxyUrl` alone while still passing `asset.gcsPath` did NOTHING.
**RESOLVED 2026-08-06 — `deriveGcsPath()` now prefers the PROXY and falls back to raw.** The original ordering meant every clip decoded the original camera file, because the client sends `gcsPath` for all of them: fixing the three CLIENT callers above never reached the shared resolver they all funnel through. Production surfaced it as two consecutive `ffmpeg decode timed out after 90s` failures on raw HEVC `.MOV` uploads whose proxies had *already finished encoding* — extraction from the proxy would have been trivial. The raw fallback is retained deliberately: audio-only assets have no proxy, and a video whose proxy job hasn't landed yet should still get a waveform eventually rather than none. `scripts/test_waveform_pipeline.js` had an assertion named "explicit gcsPath short-circuits proxyUrl derivation entirely" that pinned the OLD behaviour — it was inverted deliberately, not deleted, and the comment there records why a test can encode a bug as a contract.
`WAVEFORM_FFMPEG_TIMEOUT_MS` was also raised 45s → 90s as a second line of defense for whatever still legitimately needs to decode a large raw source (audio-only assets have no proxy concept to wait for).
Regression: `node scripts/test_clip_waveform_routing.js` (in `npm run test:regression`) pins both the Clip.jsx gate and the captureProjectThumbnail.js priority order.

**R35 — A file's early (pre-proxy) background transcription attempt and its post-proxy retry must not both run to completion for the same exact path.**
Upload triggers `TranscriptionManager.startBackgroundTranscription()` twice by design: once the instant the raw file lands on GCS (parallel with proxy encoding — Whisper and ffmpeg run simultaneously), and once more when the proxy finishes, as a fallback for the legacy path where the early call never got a gcsPath. The guard was `alreadyRunning = tmStatus in {transcribing, analyzing, ready}` — covers an attempt still in flight or already succeeded, but NOT one that already FAILED. `TranscriptionManager`'s own `finally` block clears its in-flight controller and sets status to `'failed'` the moment an attempt times out (300s client budget — diarization + Whisper on a real interview-length file routinely exceeds that), so a slow file got the ENTIRE pipeline run twice back to back: diarize → fallback transcribe → 300s timeout, then the exact same diarize → fallback transcribe → another 300s timeout, for the identical path.
This matters beyond wasted time: `worker.js`'s audio worker is deliberately capped at `concurrency: 1` (R24) precisely because two heavy jobs sharing that process starve each other. Doubling the load for one asset's transcription is what dragged waveform extraction and background scene analysis into their own timeouts in the same session — several "different" bugs, one real cause, all visible in one console log as a wall of `timed out after 300s` messages.
Fixed in `IDELayout.jsx`'s post-proxy retry block: an `alreadyAttemptedThisFile` check (same exact `transcriptPath` as the early attempt, status `failed`) suppresses the blind retry and logs why, instead of re-running an identical request that just proved it can't finish in time. A genuinely different path (the legacy fallback case) is still retried normally.
KNOWN GAP: there is currently no UI that lets a user manually retry a transcription that has genuinely failed (nothing subscribes to `EVENT_TYPES.TRANSCRIPTION_FAILED`). Suppressing the automatic duplicate is strictly better than the double-timeout it replaces, but a failed transcription now has no recovery path short of re-importing the clip — worth a retry control in `TextPanel.jsx`/`TranscriptPanel.jsx` as a follow-up.
Regression: `node scripts/test_no_duplicate_transcription.js` (in `npm run test:regression`).

**R36 — The proxy pipeline's cost scales with raw FILE SIZE (upload + re-download + decode), not just clip duration; nothing that budgets time for it may assume "typical clip" numbers.**
A 48-min 4K interview upload produced NO proxy, NO transcript, NO waveform, with nothing in the UI explaining why — reported as "it's due to the length and weight of the video," which was correct. Root-caused to three compounding, previously-undocumented costs, none of which scale the way the existing budgets assumed:
1. **`jobs/videoProcessor.js` ran a fully redundant full-file decode before the real encode.** A `generateWaveform()` step used ffmpeg's `astats` filter over the ENTIRE raw input with no `-vn`/`.noVideo()` — meaning ffmpeg-static (single-threaded, no hardware accel) decoded every 4K video frame just to compute audio RMS levels nobody read: grepping `client/src` for `waveformUrl` found zero consumers. Peaks are owned exclusively by `services/WaveformEngine.js` per R31; this was a leftover parallel path that predated that consolidation and was never removed. For 48 minutes of 4K source this doubled the job's ffmpeg work for literally nothing. REMOVED — the function, its call site, and the `waveform.json` upload/return field are gone; proxy-encode progress now reports 10→90 directly instead of sharing 10-30 with the dead waveform step.
2. **The worker re-downloads the entire raw file from GCS before touching it.** `uploadDirectToGCS` (`client/src/services/proxyService.js`) puts the raw file on GCS via a resumable signed URL — correctly bypassing the legacy multer 2GB cap (`routes/proxyRoutes.js`'s `/upload` endpoint, still present as a fallback for when GCS isn't configured, is NOT the active path here). But `processVideoJob` then finds no local copy and downloads the full object straight back down before ffmpeg can touch it (`bucket.file(gcsRawPath).download(...)`). This isn't a bug to fix — a local, seekable copy is required to survive the moov-atom-at-the-end problem (R7/R25/R34) — but it means total pipeline time scales with the RAW file's bytes twice over (upload once, download once) before any encoding starts, on top of the encode itself.
3. **The client's poll budget was a flat 15 minutes regardless of file size.** `PROXY_POLL_TIMEOUT_MS` in `proxyService.js` didn't scale with anything. For a 10-25GB 4K file (48 min at typical phone/camera bitrates), upload transfer time ALONE can exceed 15 minutes on an ordinary connection — before the worker's redownload-then-double-decode-then-encode sequence even starts. The client gives up, falls back to raw playback (`.then()`/`.catch()` in `IDELayout.jsx` already handle this — it isn't silently broken forever), but the UI gave no indication beforehand that a large file legitimately takes far longer than a normal clip, so it read as stuck.
FIXES: (1) above removes one whole redundant decode pass. `computeProxyPollTimeout(fileSizeBytes)` (now `export`ed from `proxyService.js`) replaces the flat constant: 15 min base for files ≤3GB, +2 min per GB beyond that, capped at 60 min — used by both `uploadDirectToGCS` and the legacy-upload fallback's `pollJobResult` calls. `client/src/layouts/IDELayout.jsx`'s `assetEntry` now also carries `fileSize` (bytes, from the raw `File` object) so the UI doesn't need to keep the non-serializable `File` reference around just to size-gate messaging. `DraggableAsset.jsx`'s upload overlay imports the SAME `computeProxyPollTimeout` (not a duplicated formula, to avoid drift) and — for files ≥3GB — swaps its generic "creating a lightweight preview" copy for a concrete `draggableAsset.largeFileEta` message (size, duration, and the actual minute budget being waited on) in both `en`/`fr`.
IF YOU ADD A NEW LONG-RUNNING STEP TO THIS PIPELINE: budget it against file size in GB, not "a video," and make sure the corresponding client wait/poll budget is derived from the same size, not a flat constant — that mismatch is exactly what made this look broken instead of slow.
Regression: `npm run test:regression` (existing `test_waveform_pipeline.js` / `test_clip_waveform_routing.js` scripts don't reference the removed waveform.json step and continue to pass; no new script added since this change has no new state-machine/coordination logic to pin beyond what a straightforward code read verifies).

**R37 — The Creator Memory profile learns from the REAL execution pipeline via `POST /api/brain/observe-command`. Learning must never depend on a route the client doesn't call.**
Every component of the editing-profile feature existed and was individually correct — `UserProfileEngine`, `PatternLearner`, all four Supabase tables (`user_editing_profiles`, `editing_sessions`, `suggestion_feedback` — verified APPLIED in prod, unlike the R21 `media_assets` case), the `/profile` + `/profile/reset` + `/profile/export` endpoints, and a fully built `UserStylePage.jsx`. What did not exist was the wiring between them, broken in THREE independent places at once, none visible from any single file. The feature never errored; it simply never learned.
1. **The learning hook was orphaned by an unrelated (correct) fix.** `UserProfileEngine.updateFromCommand()` — the only writer of `common_commands`, `typically_removes_silences`, `typically_adds_captions`, `typically_adds_music` — is called from `PatternLearner.persistAsync()` only when `engineResult?.success === true`. That condition is reachable ONLY from `Orchestrator` PHASE 5, which is reachable ONLY via `POST /api/brain/command`. The client deliberately stopped calling that route: the Brain was making a SECOND, independent GPT-4o interpretation of text the real pipeline had already parsed, which could disagree with what actually executed (see the comment block in `ReasoningPanel.jsx`). Removing it was right — but it silently took the profile's only learning input with it, because every surviving path (`/analyze`, all `advise`/`clarify`/`learn_only` branches) passes `executionResult = null`. Prod confirmed the damage: **2 of 7** profiles had any `common_commands`, and both were stale rows predating the change. Meanwhile `WorkflowController`'s `recordEdit()` (R19/R29) knew exactly which commands had succeeded and had no way to tell the server.
   FIX: `POST /api/brain/observe-command` — learning-only, NO model call, NO execution, no suggestions returned. It takes an ALREADY-RESOLVED command name from the pipeline that ran it, so there is no second interpretation to disagree with. `WorkflowController` calls it fire-and-forget immediately after `recordEdit()`, on the same success branch. It always answers `{ ok: true }`, even on internal failure — a lost learning event is strictly preferable to noise in the edit path. Do NOT "simplify" this by routing it back through `/command`; that reintroduces the double-GPT problem this design exists to avoid.
2. **`inferSkillLevel()` had ZERO callers** — `skill_level` was written once at row creation and never again, so all 7 prod profiles sat at `'beginner'` regardless of usage. Now recomputed inside `updateFromCommand()` from the FULL accumulated `common_commands` vocabulary (not just the triggering command, which would make the level flap edit to edit), so a corrected keyword list applies retroactively on the next write.
   THE BUG INSIDE THE BUG: its keyword lists were written in human prose (`'color grade'`, `'remove silence'`) and compared with `String.includes` — but the pipeline emits registry ids from `CommandRegistry.js` (`color_grade`, `silence_removal`). `'color_grade'.includes('color grade')` is FALSE on the underscore alone, so the single most clearly-advanced command scored as not-advanced; and `silence_removal` matched no beginner keyword either, which broke the `allBeginner` check and classified a pure beginner as `'intermediate'`. Both vocabularies are now normalised (`[_-]+` → space) before matching. Keep that normalisation if you extend the lists.
3. **`UserStylePage.jsx` had no `<Route>`.** Fully built, completely unreachable — including its GDPR right-to-erasure and right-to-portability controls. Same shape as R33's LUT import: a missing UI affordance and a missing backend are indistinguishable from the outside. Now routed at `/style` with an entry point in the dashboard header (a route with no entry point is only marginally better than no route).
WHAT STILL WORKED THROUGHOUT, and why that made this hard to see: the suggestion accept/reject half of the loop was fully wired (`sendFeedback` → `/api/brain/feedback` → `PatternLearner.recordFeedback` → `permanently_hidden` after 3 rejections). All 7 prod profiles had populated `permanently_hidden` and `suggestion_feedback` had 17 rows — so the system looked alive from the database while half of it was inert.
WHEN ADDING ANY NEW LEARNING SIGNAL: verify the path from the event to the DB write end to end, and pin it with a wiring test. Each component here passed its own unit tests; only the connections were missing.
Regression: `node scripts/test_creator_memory.js` (in `npm run test:regression`) — part static wiring analysis, part EXECUTION of the real `inferSkillLevel` against actual command ids (the normalisation bug is invisible to static analysis).

**R38 — `media_assets` rows must be CREATED before anything updates them, and the analyzers need a LOCAL file, never a GCS key. A PostgREST `.update()` that matches no row is not an error.**
`media_assets` had **0 rows in production** while the asset-analysis pipeline logged `✓ Asset … analyzed` on every upload. R21 had already created the table and wired the job; what was missing was subtler and had two independent halves, each of which alone would have produced exactly the same symptom — an empty table and a clean log.
1. **Nothing in the entire codebase ever INSERTed into `media_assets`.** Every reference in `MediaIntelligencePipeline.js` (and `brainRoutes.js`) is `.update()` or `.select()`. `.update(...).eq('id', assetId)` against a non-existent row affects zero rows and returns **no error** — so `analyzeAsset()`'s `if (updateError)` guard never fired, `_updateAssetStatus()` silently did nothing, and the success log printed regardless. The write path was a no-op from the very first upload and nothing anywhere could have told you. FIX: `_ensureAssetRow(assetId, projectId, userId, name)` upserts the identity row FIRST (before the `'processing'` status write, which is itself an update and equally a no-op without a row), using `ignoreDuplicates: true` so a re-analysis or two racing jobs can't clobber existing results. `id` is a TEXT column with no default — it's the client-generated `asset-…` id, so the row can only ever be created explicitly.
2. **The analyzers were handed a GCS key and silently degraded.** `AudioClassifier.classify()` and `VisualAnalyzer.analyze()` both begin with `fs.existsSync(filePath)` and return an `unknown`/empty result when it's false. The job receives `filePath = gcsPath` (`raw/{userId}/{file}` — what the client sends), which is never a local path in GCS mode, so BOTH analyzers bailed on every asset and returned `unknown` without raising anything. Even with fix 1 alone, the table would have filled with rows that were 100% `unknown` — worse than empty, because it looks like real analysis. FIX: `_resolveToLocalFile()` returns an existing local file untouched, otherwise downloads the object to `os.tmpdir()` (mirroring `jobs/audioProcessor.js`'s GCS fallback) and reports a `cleanupPath`; the `finally` block deletes ONLY a file we downloaded, never a pre-existing local upload. An unresolvable file now records `analysis_status='failed'` rather than persisting a row of `unknown`s.
ALSO: the asset `name` is now threaded route → job data → `analyzeAsset()` → the row (client sends `file.name`; the route falls back to the basename of the GCS key), because R22 wants the Brain to acknowledge footage BY NAME and an opaque `asset-1785…` id can't do that.
THE GENERAL LESSON — this is the third rule in this file about the same class of bug (R12 empty tables, R21 no migration, R37 orphaned hook): **a write that silently affects nothing is indistinguishable from a working feature.** When adding a Supabase write, verify a row actually lands (`SELECT count(*)`) rather than trusting an absent error, and check whether the row must be created before it can be updated.
Regression: `node scripts/test_creator_memory.js` (in `npm run test:regression`).

**R39 — The learned profile must be ACTIONABLE in the Brain's prompt, not merely rendered into it.**
Once R37 made the profile accumulate real data, `EditorialBrain.buildSystemPrompt()` was already printing a USER PROFILE block (skill level, `typically_*` patterns, top commands, permanently-hidden list) — but the PERSONA RULES only said "adapt language complexity to skill_level" and "never suggest anything in permanently_hidden". The habits and top commands were visible to the model and completely inert: nothing told it what a `removes silences=yes` should CHANGE about its advice. Added a USER PROFILE RULES section that makes each field do work: `skill_level` governs how much is explained (advanced = state the call, don't explain the command — over-explaining reads as condescending), a `yes` pattern is an established habit to propose first and never re-teach, top commands are the user's routine to reach for before unfamiliar alternatives, and an already-satisfied habit must not be suggested again.
TWO GUARDS THAT MATTER MORE THAN THEY LOOK: (a) the profile describes *tendencies, not rules* — if the footage calls for something else the Brain must say so and explain the exception, otherwise learned preferences ossify into a filter that can't respond to the actual material; (b) an empty/default profile means the user is **NEW, not unskilled** — without that line the model infers habits from absent data and gives a first-time user confidently wrong guidance. `_topCommands()`/`_skillDescription()` already degrade safely (`'none'` / beginner defaults), and `buildSystemPrompt` is executed against empty and null profiles in the regression script because a template-literal error here would only surface inside a route that swallows it.
Regression: `node scripts/test_creator_memory.js` — executes the real `buildSystemPrompt` with a populated, an empty, and a null profile.

**R40 — `services/DataHealthProbe.js` reports whether the tables features READ FROM actually contain data. Add a table to its registry whenever a feature gains a data dependency.**
This file now contains FOUR rules about one failure class — R12 (seed tables empty until someone runs `seeder.js` by hand), R21 (no migration, so the job wrote nowhere), R37 (learning hook orphaned by an unrelated correct fix), R38 (nothing ever INSERTed, so every `.update()` matched zero rows and PostgREST reported no error). Every one was found by a human reading code, sometimes months later, because **a write that silently affects nothing is indistinguishable from a working feature**. The probe makes the cheapest version of that check automatic.
WHAT IT DOES: `checkDataHealth()` runs a head-only `count` per declared table (no row data transferred) and returns `{ status, checks[], problems[], warnings[] }` — the same `problems`-array shape `GET /api/revideo/health` already established. `logDataHealth()` wraps it for boot, called fire-and-forget from `index.js`'s `app.listen` callback; it prints ONE line when everything is populated so the noisy case stands out in Railway logs.
THE TIERING IS THE WHOLE DESIGN. Each entry declares `expect`:
  - `'seeded'` (assets, sound_effects, luts, presets) — shipped reference data. Empty is ALWAYS wrong and raises a hard `problem`.
  - `'accumulating'` (media_assets, user_editing_profiles, editing_sessions) — grows from real usage. Empty raises a `warning` that explicitly states the ambiguity ("expected on a fresh deployment, but a broken write path on one that's been in use") and leaves `status: 'ok'`.
Without that split the probe would scream on every new environment, get ignored within a week, and be worth nothing — the same reasoning as R28's non-blocking DAST. For the same reason it is NOT wired into the public `GET /health` that Railway polls: an empty seed table must never fail a health check and roll back a deploy.
It also distinguishes UNREADABLE from EMPTY (`rows: null` + "cannot be read" vs `rows: 0`), because those have completely different fixes — run the migration vs. run the seeder — and conflating them sends you to the wrong one. That distinction is exactly what would have made R21 obvious immediately.
LIMITS, deliberately: it proves data EXISTS, not that writes WORK. A populated table can still have a broken write path (R37's profiles had rows the whole time while half the loop was inert). It is a smoke alarm, not a correctness proof — which is what keeps it cheap enough to run on every boot.
`GET /api/health/data` (routes/dataHealthRoutes.js, mounted at `/api/health`) exposes the same report on demand, gated by `x-admin-secret` against `ADMIN_SECRET` and failing CLOSED with a 503 when that var is unset, so it can never fall open. It returns 200 even when degraded — a data problem is not a server fault and must not read as "the API is down".
WHEN YOU ADD A FEATURE THAT READS A TABLE: add it to `DEPENDENCIES` with the right tier, the feature it powers, and a concrete fix hint. The fix hint is not decoration — a diagnostic that doesn't say what to do is half useless, and the person reading it at 2am is usually not the person who wrote the feature.
Regression: `node scripts/test_data_health.js` (in `npm run test:regression`) — EXECUTES the probe against a stubbed client across all five states (healthy, empty-seeded, empty-accumulating, unreadable, dead client). The dead-client case matters most: `index.js` calls this inside `app.listen`, so a throw there would take down the server the probe exists to protect.

**R41 — Never cache an EMPTY computed result, and never let a fresh state-machine actor's initial state overwrite a job that has already advanced.**
Two unrelated console errors, one shared shape: a cheap "success" being persisted as if it were an answer.
1. **`Peaks JSON contained no data` — a self-poisoning cache.** `extractPeaks()` only rejects when ffmpeg exits non-zero AND produced no PCM. A source with no audio track exits **0** with no PCM, so it resolved as `{ peaks: [] }` — a success. The route JSON-stringified that and `.save()`d it to `waveforms/{userId}/{assetId}.json`. The cache check in step 1 is an `exists()` test that NEVER inspects content, so from then on every request short-circuited to `cached: true` and handed the client a file it rejects; `WaveformEngine` burned its attempts and marked the asset permanently failed (R31). One bad extraction killed that asset's waveform forever, and fixing the underlying cause changed nothing because extraction never re-ran. FIXES: (a) `extractPeaks` now reports `hasAudio`, distinguishing "genuinely silent" from "extraction broke" — these were indistinguishable before and demand opposite handling; (b) the route REFUSES to persist a zero-peak result, returning it inline instead, so a transient failure stays recoverable and a silent file stays cheap; (c) `force: true` on the request bypasses the cache read, which is the ONLY way assets poisoned before this shipped can recover — `WaveformEngine` sets it automatically, once, when it receives an empty cached file (`err.poisonedCache`); (d) a `hasAudio === false` result is cached in memory as a FINAL answer (render an empty track, stop asking) but deliberately NOT persisted, since an asset that later resolves to a different file must not inherit a stored emptiness.
2. **`[Job] Invalid transition: PLANNING → IDLE` — an actor's initial state clobbering a live job.** `resumeAfterClarification()` builds a SECOND xstate actor for a jobId that already exists. `actor.start()` emits the machine's initial state (`idle`), the subscription forwarded it, and `useJobStore` correctly refused it — IDLE is only reachable from WAITING_APPROVAL. The initial snapshot is never new information (the store either just created the job in IDLE, or it has advanced well past it), so `createJobActor` now SKIPS the first emission. This preserves the legitimate `waiting_approval --REJECT--> idle` reset, which is a real later transition rather than an initial state. Compounding it, `mapStateToJobState()` ended in `|| JOB_STATES.IDLE`, silently converting ANY unmapped value into "send this job back to IDLE" — it returns `null` now and both callers skip it, so a renamed/nested state surfaces as a named warning instead of a misleading transition error pointing at the store.
   ALSO FIXED HERE: `cleanup()` deleted the actor reference without stopping the actor, leaving its store subscription live — after a clarification round-trip two actors drove one job. Retiring it inside `cleanup()` is WRONG and was reverted: both call sites sit in a `finally` guarding `return this.runPipeline(...)`, and in an async function that `finally` runs when the promise is RETURNED, not when it settles — stopping there silently drops every event the still-running pipeline sends. Stale actors are retired in `_retireActor()`, called only where a replacement is created, which is the one moment the old actor is provably done.
THE SHARED LESSON: an empty result and a missing result are different facts, and so are "initial state" and "transition to that state". Collapsing either distinction produces a confident, cached, permanent wrong answer.

**R41 FOLLOW-UP (found in production, 2026-08-06) — `hasAudio` was itself an instance of the bug it was written to fix.** The first version computed `hasAudio: pcm.length > 0 && peaks.length > 0`, which is ALSO false when ffmpeg merely FAILED — so "extraction broke" and "this source is silent" were still collapsed, just one level further down. Because (d) above caches a `hasAudio === false` result as a FINAL answer, a 90-second decode timeout presented permanently as "this clip has no audio". Observed on two clips whose transcripts contained 84 and 168 words, so they self-evidently had audio. `hasAudio` is now gated on `code === 0` and is `null` ("we don't know") on any non-clean exit; the route returns a real error for that case instead of a silent-looking success.
**IT MUST BE A 500, NOT A 503.** The first attempt at this fix returned 503 — wrong, because `WaveformEngine` deliberately treats 503 as backpressure that does NOT consume an attempt (so a saturated queue can't make it abandon a healthy asset). A permanently-failing source would then have retried every 5s forever. A failed extraction needs the BOUNDED path: a real error, a consumed attempt, an eventual clean give-up. The error path was always correct — the only thing wrong was calling the failure "silent".
Regression: the `waveformRoutes: failed extraction ≠ silent source` section of `scripts/test_waveform_pipeline.js`, verified to fail when the `code === 0` gate is removed.

**R46 — `subscription.canceled` ≠ `subscription.revoked`. Cancelling schedules the end of a paid period; only revocation downgrades the plan. Payout destination is NEVER code.**
`routes/polarWebhook.js` handled both events in one fall-through case, both calling `setPlan(email, 'free')`. In Polar those mean different things: **canceled** = the customer REQUESTED cancellation and keeps access until the period they have already paid for ends; **revoked** = access has actually ended. Collapsing them was harmless only while nothing could cancel — the moment a cancel button exists it means a user who cancels on day 2 of a paid month loses Creator/Pro instantly while fully paid up. Access a customer has paid for must never be revoked early. `canceled` now calls `markCancellation()` (records `subscription_status` + `plan_expires_at`, deliberately NOT `plan`), `revoked` downgrades, `uncanceled` clears the flag. The regression asserts the canceled branch contains no `setPlan(` at all.
**CANCELLATION IS SCHEDULED, NOT IMMEDIATE.** `POST /api/polar/cancel` sets `cancelAtPeriodEnd: true` via `subscriptions.update`. It must NOT call `subscriptions.revoke()` — that ends access at once and forfeits time already paid for. `POST /api/polar/reactivate` undoes it while the period is still running. `GET /api/polar/subscription` reads live from Polar rather than `profiles`, so the UI can never show "active" for something already cancelled.
**OWNERSHIP: the subscription is resolved from `req.user.email`, never from a client-supplied id.** Accepting a `subscriptionId` from the request body would let any signed-in user cancel anyone else's plan by guessing an id — the same IDOR shape as R27. The regression asserts the cancel handler reads no id from `req.body`.
**VERIFY BEFORE CLAIMING SUCCESS (R30 applied to money).** Polar accepting the update call is not the same as the flag being set: the handler re-reads `updated.cancelAtPeriodEnd` and returns 502 with `canceled: false` if it did not take. An already-scheduled cancellation returns `alreadyScheduled: true` rather than claiming to have just done it. Every failure path states explicitly that the subscription is unchanged, because "did my cancellation work?" is the one question a billing UI must never leave ambiguous.
**`profiles.polar_customer_id` / `polar_subscription_id` EXIST BUT ARE EMPTY** — 0 of 45 production rows, because nothing ever wrote them (R21/R38 shape). `findSubscriptionForUser()` therefore resolves by customer EMAIL, which works for every existing customer; building cancellation on those columns would have silently failed for all of them. `setPlan()` now backfills them opportunistically, but nothing reads them yet — do not add a dependency until they are populated everywhere.
**`/account` DID NOT EXIST** while every plan-confirmation email linked to it (`account_url` in this same file). A fourth instance of the R33/R37 pattern — LUT import, UserStylePage, `POST /api/brain/organize`, and now this. `client/src/pages/AccountPage.jsx` is routed there with a dashboard entry point.
**PAYOUTS ARE DASHBOARD-ONLY AND MUST STAY THAT WAY.** Money flows Polar → the Polar organization balance → the bank account verified in the Polar dashboard (Finance → Payout account, via Stripe Connect identity/bank verification). NOTHING in this repository configures, influences, or can redirect a payout destination, and nothing ever should — a payout target settable from application code or an env var would be a security hole, not a feature. §5 of the regression greps `routes/`, `services/`, `controllers/`, `middleware/` and `jobs/` for `payout`/`bank_account`/`iban`/`routing_number`/`sort_code` in non-comment lines and fails if any appear. If someone reports "payments aren't reaching the bank account", the answer is always in the Polar dashboard's payout settings, never here.
Regression: `node scripts/test_subscription_cancel.js` (in `npm run test:regression`) — 31 checks; verified to fail when the canceled/revoked fall-through is restored (5 failures) and when the cancel handler accepts a client-supplied subscription id.

**R45 — `services/AIProvider.js` is the ONLY place an OpenAI-compatible client is constructed. A non-openai provider is refused in production, and audio/embeddings never leave the real API.**
There were 15 separate `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })` calls across `routes/`, `controllers/`, `jobs/` and `server/brain/`, none setting a `baseURL`. Pointing the app anywhere else — a local Ollama in staging, a deterministic stub in CI — meant editing every one, and missing a single site would silently keep calling and BILLING the production API from staging. Same lesson as `analysisStatus.js` (R44): a value duplicated across files with no compile-time link will drift.
`AI_PROVIDER` selects `openai` (default) | `ollama` | `mock`. Unset behaves exactly as before, so prod is unchanged by construction.
**WHAT OLLAMA CANNOT SUBSTITUTE — the boundaries are load-bearing, not cautionary:**
- **AUDIO.** Ollama has no audio API of any kind; `whisper-1` has no local equivalent there. `getAIClient({ capability: 'audio' })` therefore returns the REAL client even under `AI_PROVIDER=ollama`, and warns. Only `mock` stubs transcription.
- **EMBEDDINGS.** `nomic-embed-text` is 768-dimensional; `text-embedding-3-small` is 1536 and the pgvector columns are fixed-width. Silently switching would write vectors that can never be compared against the ones already stored — worse than an error, because it succeeds. Same real-client treatment as audio. (The mock returns 1536 zeros precisely so a mocked vector still fits the column.)
- **VISION** is permitted but weak: the coordinate work in `detectSceneLayout`/`VisualAnalyzer` (per-frame face anchors `{cx,cy,h}`) degrades badly on a small multimodal model. Treat ollama vision output as "did the pipeline run", never as "is the answer right".
**PRODUCTION REFUSAL.** `resolveProvider()` forces `openai` whenever `NODE_ENV === 'production'`, logs an error, and does NOT throw — a misconfigured env var must degrade to correct-but-costly, never take the API down. Shipping a mocked Brain to real users would be worse than an outage: it would answer confidently and wrongly, the exact failure class R30/R43/R44 exist to prevent.
**THE MOCK ANNOUNCES ITSELF.** `mockBodyFor()` picks a canned body per caller schema (project map, organize ordering, pause classification, visual analysis, advisory) because one generic blob would make every consumer throw on a missing key and prove nothing. Every body is deliberately BLAND — `project_type: 'unknown'`, empty `coverage_gaps`, clip order unchanged, rationale containing the word "mock". A stub that produced confident-looking output would be indistinguishable from a real judgement in a screenshot, which is how a staging artefact ends up quoted as a product behaviour.
**AVAILABILITY IS A PROVIDER QUESTION, NOT A KEY QUESTION.** Call sites used to test `!process.env.OPENAI_API_KEY` directly; under mock/ollama, which need no key, that 503s every AI route in exactly the environments this factory exists to enable. Use `isAIConfigured()`. The regression asserts no file has reintroduced the raw env-var gate and that none constructs `new OpenAI(` itself — one bypass silently restores real billing.
NOT A QUALITY HARNESS: ollama exercises PLUMBING (auth, gating, BullMQ, JSON parsing, error paths, DAST reaching authenticated routes without spending credits). It is a different model with different behaviour, so a green staging run says nothing about prod output quality. R44's `normalizeMap()` clamping helps — weak output degrades rather than corrupts — but do not read staging AI results as validation.
Regression: `node scripts/test_ai_provider.js` (in `npm run test:regression`) — 66 checks; verified to fail when the production refusal or the audio/embeddings capability guard is removed.

**R48 — In production the WORKERS ARE A SEPARATE DEPLOY. Row counts prove data exists; only queue depth proves jobs are being consumed. `GET /api/health/queues` is the diagnostic.**
`index.js` starts the inline workers ONLY when `useLocalStorage || !bucket || WORKER_INLINE === 'true'`. Production has GCS configured, so that condition is FALSE and `worker.js` runs as a separate Railway service with its own deploy and its own log stream. **An API deploy does not redeploy the worker.** The Express side can be running today's code while the worker runs something months old — and nothing in the API's logs would reveal it, because the worker's `✅/❌ [AssetAnalysisQueue]` lines go somewhere else entirely.
This is the operational gap underneath R21/R38/R43/R44: `media_assets` sat at 0 rows through three separate, individually-correct code fixes (add the migration → add the INSERT → resolve the GCS key to a local file), and not one of them answered the prior question — *are the jobs even being consumed?* R40's `DataHealthProbe` reports whether rows EXIST; it cannot distinguish "the write path is broken" from "nothing ever ran".
`services/QueueHealthProbe.js` reads BullMQ job counts per queue and returns a VERDICT, because the raw numbers need interpreting and the two bad states need opposite fixes:
  - `no_consumer` — waiting high, active 0, **completed 0**: nothing is draining the queue. The worker service is down, undeployed, or lost `REDIS_URL`. Fix: deploy/restart the worker.
  - `failing` — failed high and exceeding completed: the worker IS consuming and every job throws. Fix: read the WORKER service's logs, not the API's.
  - `backlog` — deep queue but jobs moving: a warning only, never a hard problem. Screaming during a normal upload burst is how a probe gets ignored (same reasoning as R28 and R40's tiering).
It also reports the Python diarize service, because `ClipAnalysisService` failing degrades silently to the vision fallback — the ML tier can be dead for weeks behind one "ML classify failed" line. Not-configured is a WARNING (a deliberate state); configured-but-unreachable is a PROBLEM.
ALSO FIXED HERE: `/api/brain/analyze-asset` constructed `new Queue('asset-analysis')` **inside the handler on every request** and never closed it, leaking a wrapper per upload. It is a lazy module-level singleton now. The queue name is a named constant on the producer side and `scripts/test_queue_health.js` §8 asserts it equals the literal in `worker.js`'s `new Worker(...)` — producer and consumer are two string literals in two files with no compile-time link, the same drift hazard as R44's `analysis_status`. A mismatch would queue jobs nothing reads: no error, no log, and `media_assets` empty exactly as if the analyser were broken.
**QUEUE COUNTS ALONE ARE NOT ENOUGH — a worker on an OLD BUILD looks perfectly healthy.** Production proved this immediately after the probe above shipped. The worker logs read:
```
[VisualAnalyzer] File not found: raw/{userId}/IMG_8662.MOV     ← the GCS key, not a local path
[MediaPipeline] ✓ Asset asset-… analyzed (unknown, silent)     ← then claims success
✅ [AssetAnalysisQueue] Job 32 completed
```
waiting=0, active=0, failed=0, completed=N — every verdict `ok` — while every job ran **pre-R38 code**: the analyzers got a raw GCS key (R38 fault #2) and nothing INSERTed the row (R38 fault #1), so `media_assets` stayed at 0. The API had been redeployed; the worker never had. `DataHealthProbe` could say the table was empty, `QueueHealthProbe` could say the queue was drained, and neither could say *the worker is running code from before the fix*.
`services/buildInfo.js` adds that third signal. The worker publishes a heartbeat to Redis every 30s (90s TTL) carrying its build id and a hand-maintained `WORKER_CAPABILITY_VERSION`; the probe compares it against the API's own and raises a hard problem on a mismatch, **even when every queue is green**. Redis, not Postgres, so a DB outage can't make a live worker look dead.
**BUMP `WORKER_CAPABILITY_VERSION` whenever a change to worker-executed code must be paired with an API-side change**, and record what the bump requires — the constant's comment is the changelog. v1 → v2 is exactly this incident (`_ensureAssetRow` + `_resolveToLocalFile`). A missing heartbeat is only a hard problem when there is queued work; on an idle system it is a warning, because "nothing to do and no worker" is indistinguishable from a fresh environment.
WHEN A FEATURE THAT DEPENDS ON A JOB LOOKS DEAD: check `GET /api/health/queues` BEFORE reading the code, and read the `worker` block first — a stale build explains every "the fix didn't work" report that follows a deploy. Three of the rules in this file were written about code paths that were, at the time, either not being consumed or being consumed by the wrong build.
Regression: `node scripts/test_queue_health.js` (in `npm run test:regression`) — 33 checks, EXECUTING the probe against a stubbed BullMQ across all five states; verified to fail when the no_consumer/failing verdicts are collapsed, when the worker's queue name is renamed, and when the capability check is removed.

**R47 — A streamed response must ALWAYS be terminated. `if (!res.headersSent)` is not an error handler.**
`GET /api/proxy/gcs-media/*`'s range branch sets `res.status(206)` and its headers, then pipes a GCS read stream. Its error handler was `if (!res.headersSent) res.status(500).end()` — but on a range response the headers have *already* gone out, so `headersSent` is true and the handler logged the error and then did NOTHING. The response stayed open until Railway's edge timed it out and synthesised a **502**, which presented as one clip's `proxy.mp4` being unplayable (black canvas) while another streamed fine in the same session. Triggered by `request to storage.googleapis.com … failed, reason: socket hang up` — Railway → GCS occasionally drops a pooled socket mid-read.
TWO THINGS WERE MISSING, and the second is the important one:
1. `gcsRetry()` wrapped `getMetadata()` but never the read stream, so a single transient socket drop was fatal. Range reads now retry up to 3× with the same backoff — but ONLY while nothing has been written yet (`piped` flag), because you cannot restart a response whose body has already begun.
2. Every exit path now terminates: `res.status(502).end()` if headers haven't gone out, `res.destroy()` if they have. A truncated body is recoverable — the client re-requests the range — whereas a response that is never ended is not: the browser sees a stalled request, the edge invents a 502, and nothing downstream can tell what happened.
THE GENERAL RULE: an error handler guarded on `!res.headersSent` silently does nothing in exactly the case that matters most for streamed media, because streaming means the headers left early by definition. Any `stream.pipe(res)` needs an else-branch that destroys the socket. Grep for `headersSent` before adding another streaming route.
Regression: the `proxyRoutes: a range-stream error always ends the response` section of `scripts/test_waveform_pipeline.js`.

**R44 — `project_intelligence` is the PROJECT map, derived once per material change and never guessed. `media_assets.analysis_status` has exactly one definition, in `server/brain/media/analysisStatus.js`.**
Sprint 5. `media_assets` answers "what is each clip?" (R21/R38); this answers the level up — what the PROJECT is (`project_type`, `through_line`, `target_audience`, `tone`), what role each asset plays in it (`asset_roles`), and what it's MISSING (`coverage_gaps`). That last one is the genuinely new capability: "six minutes of talking head and zero cutaways" is invisible to any per-clip view, however good. Derived by `server/brain/ProjectIntelligence.js`, attached by `brainRoutes /analyze`, rendered by `EditorialBrain`. Migration `supabase/migrations/20240005_project_intelligence.sql`, APPLIED to prod (unlike R21's original media_assets case — verified via information_schema, not assumed).
THREE PROPERTIES, each one a rule from earlier in this file applied to a new surface:
1. **Re-derivation is FINGERPRINT-GATED.** `computeFingerprint(assets, clipCount)` hashes asset ids + *each asset's analysis_status* + clip count. Deriving the map costs a GPT-4o call over the whole bin; without the gate it either runs on every advisory request or goes stale silently — R29's recompute-the-expensive-thing trap. Including `analysis_status` in the hash is the subtle part and it is deliberate: the same asset list with one more asset finished analysing is materially different input, and a map built from a half-analysed bin must NOT survive the rest completing.
2. **An unanalysed bin produces NO map.** Inventing a project type from filenames and durations is R30 exactly — a confident answer over analysis that never ran. Guarded in `ensureMap` (skip when zero assets are `done`) AND in `deriveMap` (return null on an empty list). That doubling is intentional defence in depth; the regression verifies the PROPERTY, and confirms it fails only when both guards are removed.
3. **Failure is RECORDED, not swallowed.** A throwing or malformed derivation writes `status: 'failed'` rather than leaving the row absent, so a persistently broken map is distinguishable from a project nobody opened (R38/R40's empty-vs-broken distinction). Persistence is `upsert(..., { onConflict: 'project_id' })` — never `.update()`, which matches zero rows and reports no error, the exact mechanism that left `media_assets` empty for months.
CONTAINMENT AT NORMALISATION: `normalizeMap()` is pure and is where a plausible-but-wrong model answer stops. `project_type` outside the closed vocabulary becomes `'unknown'`; a role outside `ASSET_ROLES` is clamped to `'supporting'`; **an asset id that wasn't in the bin is DROPPED, not stored** (a hallucinated id in `asset_roles` would otherwise be handed to the Brain as fact); empty strings become null; every field degrades to a safe empty rather than `undefined`.
THE PROMPT MAKES THE MAP DO WORK (R39's lesson — a field the model is shown but told nothing about is inert). `PROJECT MAP RULES` binds each field to a behaviour: the through-line is what every suggestion must serve; roles mean never proposing that the a_roll be cut or a cutaway promoted to the spine, and reaching for footage already labelled b_roll instead of telling the user to find some; a listed gap outranks another pacing tip because no per-clip view can see it. TWO GUARDS THAT MATTER: an EMPTY gap list is explicitly "the project is adequately covered — do not manufacture a gap because the section exists", and a map that is absent or `failed` renders as "not established yet" with an instruction not to assert a project type at all. The map also yields to the user: it describes the project as ANALYSED, so if the user's request implies a different project, believe the user and flag the map as out of date.
ALSO FIXED HERE — **`binReady` was permanently `false`.** `ContextEngine._analyzeMediaBin` derived it from `mediaBin[].analysis_status`, i.e. off the CLIENT's timeline-store asset objects. Nothing in `client/src` has ever written that field (`useBrain` sends `a.analysis_status || null`; the only writer of analysis status is the server-side worker, straight to Postgres). So every project with at least one asset reported "Bin analyzed: no (still processing)" in the Brain's prompt forever, regardless of how much analysis had finished. It now derives from the server-fetched `assetIntelligence` rows, and reports `analyzedAssets`/`totalAssets` so the Brain can say "3 of 5 analysed" instead of a bare not-ready. The regression asserts a client-supplied `analysis_status` cannot fake readiness.
**THE STATUS LITERAL NOW HAS ONE HOME.** `server/brain/media/analysisStatus.js` (dependency-free, so even the pure/synchronous `ContextEngine` can import it) exports `ASSET_ANALYSIS_DONE`/`_PROCESSING`/`_FAILED`. It exists because this exact string broke two features silently in one session: `interviewRoutes` filtered profiles on `'completed'` while the pipeline writes `'done'` (would have left R43's whole profile path permanently unreachable), and the `binReady` bug above. A comparison that can never be true is indistinguishable from a feature that works — the same family as R12/R21/R37/R38. `scripts/test_organize_v2.js` §0b asserts all five consumers import the constant and that NONE has re-inlined an `analysis_status === '…'` comparison. Do not inline it again.
Regression: `node scripts/test_project_intelligence.js` (in `npm run test:regression`) — 60 checks, nearly all EXECUTING the real class against a stubbed OpenAI + Supabase (call counts, written rows, and fingerprint behaviour are not visible in source text). Verified to fail under deliberate mutation of the fingerprint inputs, both no-analysis guards, and the binReady source.
NOT YET VALIDATED END TO END: `media_assets` is still 0 rows in prod, so no map has ever been derived from real analyser output. `project_intelligence` is registered in `DataHealthProbe` as `accumulating` — if it stays empty after uploads, check `media_assets` FIRST, since a map cannot exist without at least one completed profile.

**R43 — `organize_clips` orders from the STORED asset profile first; live frame extraction is the fallback, and "no signal" must return no order.**
Sprint 4's Organize v2. `media_assets` (R21/R38) already describes every uploaded asset — scene type, framing, subject count, B-roll/screen-recording flags, lighting, stability, emotional tone, content description. Nothing read it: `/api/interview/organize-clips` re-derived visuals from scratch on every single call, and did so through a path that could not work in production at all.
THREE FAULTS, one of which made the whole feature a lie:
1. **The frame extractor was local-file only.** `extractFrame` began `if (!filePath || !fs.existsSync(filePath))` and clip sources resolved via `resolveUploadPath()`, which returns a path under `uploads/`. In GCS mode that file does not exist, so EVERY extraction returned null → `totalFrames === 0` → the ML path was skipped → the vision fallback sent `[no frame available]` for every clip. GPT then ordered on duration and transcript alone and returned a confident `orderedIds` **plus a written rationale**, which the client rendered as *"Semantically organized N clips"*. A wrong order presented as an editorial decision is worse than no order — it is R30's exact failure mode, dressed up in prose. `extractFrame` now accepts a signed `https` URL (skipping the `fs.existsSync` precondition for remote inputs) and sources resolve through the new `resolveClipSource()`, which prefers the asset's own `gcsPath` via `resolveFfmpegInputArg()` (R27's ownership guard included).
2. **Clip→file resolution was not asset-scoped.** The client sent `filePath: uploadedFilePath` — a single GLOBAL store field each upload overwrites (R21) — identically for every clip in the batch, and the route's resolution loop took the `clip.filePath` branch FIRST. So even in local mode, all N clips resolved to the same source file: clips 2..N were classified from clip 1's footage. The client now sends per-clip `assetId` + `gcsPath`, and `uploadedFilePath` survives only as a fallback for the legacy flow (`filePath: asset?.gcsPath ? null : uploadedFP`).
3. **Nothing consulted the profiles.** Fixed by `fetchAssetProfiles(assetIds, requestUserId)` — a `media_assets` read scoped by `user_id` AND id (the ids come from the request body; `brainRoutes`' equivalent lookup filters on id only, which is worth tightening) and filtered to the analyser's success status, because a `processing`/`failed` row carries no signal and must not be mistaken for one.
   THE STATUS LITERAL IS A TRAP, and this rule's own first draft fell into it. `MediaIntelligencePipeline` writes `analysis_status: 'done'` on success — NOT `'completed'`. The first version of `fetchAssetProfiles` filtered on `'completed'`, which rejects every successfully analysed asset: no error, no warning, the profile path simply never runs and the organizer falls back to frame extraction forever. It is the same shape as R12/R21/R37/R38 — a comparison that silently matches nothing is indistinguishable from a feature that works. The value now lives in one named constant (`ASSET_ANALYSIS_DONE`) and `scripts/test_organize_v2.js` §0b READS the literal out of `MediaIntelligencePipeline.js` and asserts the two agree, so a rename on either side fails a test instead of quietly disabling the feature. Do not inline the string again.
THE SIGNAL LADDER, per clip: stored profile → ML classification of sampled frames → a raw frame handed to vision → nothing. `buildOrganizeDescriptors()` is deliberately PURE and synchronous (no I/O, no model call) so the priority rules are executed by the regression rather than inferred from route source. Two properties matter most: a profile always beats live analysis (otherwise v2 pays for vision on footage already analysed), and a clip with no signal is LABELLED `NOT ANALYSED` in the prompt with an explicit instruction not to invent a role for it. ML classification now runs on unprofiled clips ONLY, and the two previously separate ordering branches (ML text-only vs. vision) collapsed into ONE call — GPT-4o when no clip needs an image, GPT-4o-mini only when one does.
THE HONESTY CONTRACT, both ends: with zero profiles and zero frames the route returns `pipeline: 'none'`, `orderedIds: []` and a `reason`, and the client short-circuits on it rather than reordering — a partial-coverage run reports how many clips were placed without analysis instead of implying all N were understood equally. `coverage: { total, profiled, framed, unanalyzed }` is returned on every response; keep it populated if you add a signal tier.
NOT YET VALIDATED END TO END: `media_assets` was still 0 rows in prod at the time of writing — R38's fix is in code but no upload has exercised it since. The profile path is therefore unproven against real analyser output; the first multi-asset upload after deploy is the test. Until then organize degrades to the (now actually working) frame path.
Regression: `node scripts/test_organize_v2.js` (in `npm run test:regression`) — 47 checks, the majority EXECUTING the real descriptor builder across profile/ML/frame/none combinations; verified to fail under deliberate mutation of the profile-priority rule, the client payload, and the status literal rather than passing vacuously.

**R42 — Timeline/Track/Clip layout constants must be responsive; a hardcoded desktop pixel value silently breaks (not just "looks bad on") mobile.**
`client/src/components/Timeline/Timeline.jsx`, `Track.jsx`, and `Clip.jsx` had ZERO awareness of `useDeviceType()`/`isMobile` despite `IDELayout.jsx` already being carefully mobile-tuned around them (explicit canvas heights per aspect ratio, a dedicated `h-36` mobile timeline container, `MobileToolbar.jsx`/`MobileAIBar.jsx`). Three concrete failures, found by tracing actual pixel math rather than eyeballing:
1. **The in-timeline toolbar (undo/redo, split, duplicate, text overlay, transition/filter/aspect-ratio/speed selects, zoom) had no `overflow-x` and no `flex-wrap`.** Its parent in `IDELayout.jsx` (the `h-36` mobile timeline wrapper) has `overflow-hidden`. On a 375-430px phone the toolbar's minimum content width is 600px+ (15 flex children at `gap-4` alone is 224px, before any button/select content) — so everything past a certain point was invisible AND unreachable, with no scrollbar and no visual indication anything was missing. Fixed: the toolbar row itself is now `overflow-x-auto` with `shrink-0` on its two child groups so nothing gets squished into illegibility; this is a no-op on desktop since content already fits there.
2. **`LABEL_W = 128` (the track-label column width) was a single hardcoded module constant, used in EIGHT places** (ruler placeholder div, playhead line position, playhead handle margin, drag-select math in three separate spots, the RAF-driven playhead-follow loop, and `Track.jsx`'s own independently-hardcoded `w-32` header). On a phone this ate ~30-34% of screen width before any clip was visible. Fixed with a computed `labelW = isMobile ? 80 : 128` inside `Timeline.jsx`, threaded through every one of those eight sites (the RAF loop reads it via a ref kept in sync every render — the loop itself mounts once with an empty dependency array, so without the ref a mid-session resize across the breakpoint would leave the playhead offset stale) and passed down to `Track.jsx` as a `labelWidth` prop so the two can never desync.
   THE ONE THAT'S EASY TO MISS: `handleTracksMouseDown`'s nested `scrollTick` (the edge-auto-scroll-while-dragging logic) also referenced the bare `LABEL_W` constant directly — grep for `LABEL_W` after any future change here to confirm nothing new reverted to the desktop-only value. This is exactly the shape of bug that survives a visual check (you'd only notice it while actively rubber-band-selecting near the left edge on a phone) and only shows up by tracing every consumer of a "layout constant" by hand.
3. **`Track.jsx`'s content-area height (`h-20`/`h-8` = 80px/32px) drove `Clip.jsx`'s rendered size directly** (`Clip` is `absolute top-0 bottom-0` inside it) with no mobile variant — on the `h-36` (144px, minus 24px ruler) mobile timeline container, one 80px video track left room for barely a single track before scrolling. Fixed with `TRACK_H_VIDEO_AUDIO_MOBILE = 52` / `TRACK_H_TEXT_MOBILE = 22` (down from 80/32), selected via a `compact` prop threaded the same way as `labelWidth`. `ClipWaveform`'s canvas `height` prop (hardcoded `32`) was reduced to `20` on mobile to match — it was already visually clipped by its `40%`-height overflow:hidden wrapper, but requesting a canvas taller than the space it renders into is wasted work and slightly softer rendering.
WHY THIS WASN'T CAUGHT SOONER: none of these three files fail to compile, fail a type check, or throw at runtime — every symptom is purely visual/geometric (wrong pixel math, invisible-but-present DOM, oversized elements), so it's invisible to every kind of automated check this codebase has except an actual rendered viewport at mobile width. There was no headless browser available in this environment to capture a before/after screenshot; verification here was done by (a) computing the Tailwind spacing-scale arithmetic by hand to confirm the toolbar's minimum width genuinely exceeds a phone viewport, and (b) parsing every touched file with esbuild's `transformSync` to catch JSX/syntax breakage, plus a manual trace of every consumer of the constants being changed. If a real device/emulator or a working headless browser is available in a future session, a visual regression check (screenshot at 375px vs. desktop width) would be strictly stronger evidence than either of those and is worth adding.
IF YOU ADD A NEW HARDCODED PIXEL CONSTANT TO `Timeline.jsx`/`Track.jsx`/`Clip.jsx`: ask whether it assumes a desktop-width viewport. If yes, it needs a mobile variant threaded the same way `labelW`/`compact` are here — a constant used in JS pixel math (not just a Tailwind class) is the dangerous case, because unlike a purely visual CSS class, a stale JS constant produces a silently WRONG position/size rather than something that merely "looks a little off."

**R32 — Caption style/position changes go through `useTimelineStore.applyCaptionUpdate()`. No caption surface calls `updateClip()` directly.**
Captions are editable from TWO places: `TextPanel.jsx` and directly on the playback canvas (`Player/TextOverlay.jsx` — drag, pinch, corner-resize). The global/individual toggle lived in TextPanel's local `useState`, so the canvas could not read it and every canvas gesture called `updateClip()` — always single-clip. Setting "Global" and dragging a caption moved exactly one segment. One setting, two behaviours depending on which surface you touched.
`captionEditScope` now lives in the store and `applyCaptionUpdate(updates, { clipId, scope, skipHistory, liveOnly })` is the single path. Its rules: global scope fans style across EVERY text track (a project can have more than one, and "global" has to mean global); `content` is ALWAYS per-segment regardless of scope, because fanning the caption's words out would overwrite every caption with the same text; one `_saveHistory()` per batch so a global change is ONE undo, not N.
`liveOnly: true` restricts a write to the edited clip even in global scope — used mid-gesture so a 30-move drag over 200 captions costs 30 writes instead of 6000. The caller MUST then commit without `liveOnly` on pointer-up; that commit is what actually propagates the final value to the other captions. Drop it and the canvas silently reverts to individual-only behaviour, which is the original bug.
`SegmentRow` (the per-segment editor) and its reset button pass `scope: 'individual'` EXPLICITLY rather than relying on the store value — that row is by definition per-segment and must stay local while the panel-wide toggle says global.
Regression: `node scripts/test_caption_scope.js` (in `npm run test:regression`) executes the scope semantics and statically asserts neither caption surface has reintroduced a direct `updateClip()` call.

**R33 — `authFetch` omits Content-Type for a `FormData` body; never override it at the call site.**
It hardcoded `application/json` for every POST/PUT/PATCH with a body, so multipart uploads were unusable: the browser must generate `multipart/form-data; boundary=…` itself and multer cannot parse the body without that boundary. Passing `headers: { 'Content-Type': undefined }` from a call site does NOT work — the key still exists and fetch serialises it to the literal string `"undefined"`. `buildHeaders()` therefore detects `body instanceof FormData` and skips the header, and strips any `undefined`/`null` header an override introduced.
This is what blocked custom LUT import. `POST /api/luts/upload` (auth, `.cube` validation, user-scoped `luts/{userId}/custom/{assetId}.cube`, `assets` insert, and export integration via `server/lut-engine/library/LUTExportIntegration.js`) was fully built and mounted the whole time — NOTHING on the client ever called it. Reported as "LUT import is broken"; it was actually "the entry point was never built". `audioEngineAPI.uploadLUT()` + the import control in `AssetPanel.jsx`'s Color tab close that gap. Check for this shape before scheduling backend work: a missing UI affordance and a missing backend look identical from the outside.

**R31 — `services/WaveformEngine.js` is the ONLY thing that extracts audio peaks. Components read; they never regenerate.**
Extraction used to live inside the `usePeaks` hook, so RENDERING A CLIP issued a network request. That coupling is the root of the whole "the waveform vanished" family of bugs, in four distinct ways: (1) an asset re-segmented by a cleanup pass becomes N clips → N hook instances raced on mount, and dedupe keyed on `assetId|proxyUrl` meant clips whose proxyUrl hydrated at different moments each opened their own extraction of the same file; (2) the only cache was a module-level Map, discarded on reload, so a refresh re-extracted everything the server had already computed; (3) retry logic was inlined in the hook and duplicated the entire fetch pipeline, so the two copies drifted; (4) nothing bounded client concurrency against a route that decodes audio through ffmpeg (R24).
Cache tiers, cheapest first: in-memory Map → `useTimelineStore.waveformsByAsset` (persisted per R29 — this is what makes a reload a cache hit) → the server's own `waveforms/{userId}/{assetId}.json` check → ffmpeg. `waveformsByAsset` is ASSET-keyed, deliberately separate from the older track-keyed `waveforms`: peaks belong to a source file, so one asset re-cut into 20 clips across 2 tracks has exactly one waveform.
The engine rejects `blob:`/`data:` URLs before they reach the server (`deriveGcsPath()` can't resolve them, so the route 400s and the attempt is wasted); treats 503 as backpressure to wait out rather than a failure that consumes an attempt (honouring `Retry-After`); never retries a 4xx (identical input can't change the answer); and stops retrying a permanently-failing asset so a broken clip doesn't re-hammer the route on every re-render — `WaveformEngine.reset(assetId)` re-enables it when something changes that could plausibly fix it (e.g. the proxy job finally completed). `getPeaks()` never throws; it returns `null` for "not available".
DELETED IN THE SAME PASS: `Clip.jsx` carried a SECOND waveform pipeline that derived a `waveform.json` URL next to the proxy, fetched it on mount, and wrote it to the track-keyed `waveforms` field via `addWaveform()`. Nothing rendered that data — its only consumer was the effect's own "already loaded?" guard, making it a self-referential loop that cost one request per clip per mount and displayed nothing. Do not reintroduce a second peaks path.
Regression: `node scripts/test_waveform_engine.js` (in `npm run test:regression`) EXECUTES the engine against a stubbed fetch — unlike the other scripts here, which are static analysis. These are timing/coordination guarantees (single request under 20 concurrent callers, bounded retry, backpressure handling) and none of them are visible in the source text.

**R30 — A command must NEVER report success over an unchanged timeline. If it changed nothing, it returns `success: false` and says why.**
This is a worse failure than a crash: a crash is reportable, a green check over an untouched video just teaches the user the product doesn't work. `scripts/test_command_registry.js` Test 7 cannot catch it — it asserts a command routes to a handler that EXISTS, not that the handler can produce a CHANGE. `scripts/test_no_silent_noop.js` (in `npm run test:regression`) covers that gap.
ROOT CAUSE PATTERN — `ContentAnalyzer.analyze()` silently degrades to `_localAnalysis()` whenever the backend call fails (401, timeout, no transcript). That fallback analyses NOTHING: it emits one placeholder segment per clip with a hardcoded `importance_score: 0.5, type: VALUE`, and a "hookCandidate" that is just the first 25 s of clip 0. It sets `localFallback: true` — every consumer MUST check it. Consumers that didn't inherited confident-sounding claims about data that was never computed.
The concrete bug: `remove_repetition` routed to `VideoEditorTools.removeRepetition()`, which filters `importance_score < 0.3`. Against `_localAnalysis()`'s hardcoded 0.5 that filter matches nothing, 100% of the time — so it returned `success: true` / "Removed 0 low-value segment(s)" over a completely untouched timeline. Meanwhile the REAL implementation (`remove_repeated_takes` → `POST /api/ai/detect-repeated-takes`, embedding similarity + GPT-4o arbitration, returns `activeSegments` and flows through `_applySegmentsToTimeline`) already existed and was unreachable — nothing routed to it. `EditPlanner.planRemoveRepetition` now emits `remove_repeated_takes`; do not route it back.
Fixed in the same pass, all the same shape — a count that could be zero, reported as success: `reorderClips` (applied the order clips were ALREADY in, and `if (!clip) continue` swallowed ids matching nothing, both still claiming "✓ Reordered N clips"), `applySmartZoom` (zero zoom events → `success: true`; and it reported `allClips.length` rather than the clips actually touched, so 2 keyframes on a 10-clip timeline claimed 10), `rhythm_zoom` (its counts come from the SERVER response, not from what landed — a stale plan whose clipIds no longer exist applied zero keyframes and still printed a full "3W / 2M / 4C" breakdown).
WHEN ADDING OR EDITING A COMMAND: count what you actually mutated, compare against the pre-state where "already correct" is possible, and never derive a success message from a plan/response rather than from the applied result. `crop_clip`, `reset_crop` and `virtual_multicam` (R14/R23-era) were already correct — the tests pin them so they stay that way.

**R29 — Anything expensive the editor computes MUST be added to all THREE persistence paths in `client/src/store/useTimelineStore.js`, or it silently recomputes on every reload.**
`saveProject()` used to persist only the timeline (tracks/duration/aspectRatio/zoomLevel/pacingSegments/beatMarkers/captions/assets/uploadedFilePath) and omit every AI result the session had produced: `transcripts` (Whisper — paid), `diarizationByAsset` (a 1–5 min job PER ASSET), `sceneAnalysisByAsset` (GPT-4o Vision per asset), `speakerMap`, `contentAnalysis`, `editHistory`, `captionsFilePath`, `waveforms`. One omission, four separate-looking bug reports: "the transcript disappeared", "it re-ran diarization", "the Brain forgot what I did", "the waveform vanished after a refresh". Persistence was never missing — it was incomplete, which is why it looked intermittent rather than broken.
THREE paths must stay in sync, and they are easy to miss because they live far apart in the file:
1. the synchronous module-scope pre-restore from `localStorage.vp_autosave` (runs BEFORE React renders, so the Revideo scene compiles with real tracks — see the comment there),
2. `saveProject()` (writes localStorage AND supplies the Supabase payload),
3. `loadProject()` (the path Supabase-loaded projects take via `EditorPage`).
Miss #1 or #3 and a locally-restored project has the transcript while a cloud-loaded one doesn't — "sometimes it remembers, sometimes it doesn't".
`loadProject()` falls back to `?? get().<field>`, NEVER a hard empty: a project saved before this change has no such key, and blanking it would wipe a transcript the user generated seconds earlier — reintroducing the exact bug. For the same reason the autosave `version` stayed `'1.2'`; the pre-restore DISCARDS any autosave whose version doesn't match (and clears `vp_project_id` with it), so bumping it would wipe every in-progress project on deploy. The added fields are purely additive and every read is guarded — do not bump.
QUOTA: these blobs are large and localStorage caps at ~5 MB/origin. The old `catch (_) {}` swallowed `QuotaExceededError`, which after this change would mean losing the TIMELINE too — strictly worse than the bug being fixed. `saveProject()` now retries against a `DROP_ORDER` (`waveforms` → `sceneAnalysisByAsset` → `diarizationByAsset` → `transcripts`), shedding cheapest-to-recompute first (waveforms come back from a local ffmpeg call; transcripts cost money), warns which fields it dropped, and `console.error`s if even the stripped payload won't fit — the one case where work is genuinely lost must not be silent. It always RETURNS the complete payload, because Supabase has no size ceiling and a localStorage overflow must not degrade the cloud copy.
`useSupabasePersistence` therefore builds its payload by CALLING `saveProject()`, not by reading `vp_autosave` back. The old round-trip handed Supabase the quota-stripped copy (capping the unlimited store at the limited one's ceiling) and snapshotted state 3 s before it wrote, dropping any edit made in that window.
DEPENDENCY: `editHistory` is what `ContextEngine`/`EditorialBrain` read (R19). Until this change it reset on every reload, so any Creator-Memory/preference-learning feature built on it would appear to work within a session and silently forget overnight. Persisting it is a prerequisite for that work, not a nice-to-have.
Regression: `node scripts/test_project_persistence.js` (wired into `npm run test:regression`) parses the real source and fails if a field exists in one of the three paths but not the others.

**R28 — DAST is a scheduled, non-blocking OWASP ZAP baseline scan against staging (`.github/workflows/dast.yml`); it is NOT a CI/deploy gate and must never become one.**
Runs on a `workflow_dispatch` (manual) trigger and a weekly cron (Monday 03:00 UTC), against `secrets.STAGING_URL`, reusing the `staging` GitHub environment (same one `deploy.yml` already deploys to — same secrets scope). "Baseline" means passive-only: ZAP spiders the app and inspects real traffic/headers/cookies/TLS, it does not fire active attack payloads at a shared environment.
Auth: a dedicated Supabase test account (`secrets.DAST_TEST_EMAIL` / `DAST_TEST_PASSWORD`, plus `STAGING_SUPABASE_URL` / `STAGING_SUPABASE_ANON_KEY`) is logged in via `POST {SUPABASE_URL}/auth/v1/token?grant_type=password` at the start of the job, and the resulting JWT is injected into every ZAP request via a `replacer` rule (`-config replacer.full_list(0)...`) that rewrites the `Authorization` header — this is what lets the scan reach the authenticated surface (`/api/projects`, `/api/ai/*`, `/api/interview/*`, etc.) instead of only `/health` and public routes. If the login step fails for any reason (secrets not yet configured, account disabled), it degrades to an unauthenticated scan rather than failing the job — `set +e` and an explicit `::warning::`, never a hard stop.
Non-blocking by design, twice over: `fail_action: false` on the ZAP action (a WARN/FAIL finding never fails the workflow) and `allow_issue_writing: false` (no auto-filed GitHub issues to triage). This mirrors the same lesson already applied to `ci.yml`'s lint step and `deploy.yml`'s regression gate in this same hardening pass — a new blocking gate that isn't backed by a track record of clean runs is how you break the platform, not protect it. Results live ONLY in the uploaded `zap-baseline-report` artifact (HTML + JSON, 30-day retention); read it after each scheduled run rather than expecting a failed check.
SETUP REQUIRED BEFORE THIS RUNS MEANINGFULLY: create the `DAST_TEST_EMAIL`/`DAST_TEST_PASSWORD` Supabase account by hand — free plan, no real projects/uploads on it, so a scan that pokes at its data can't leak or cost anything real — and add all five values (`STAGING_URL`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `DAST_TEST_EMAIL`, `DAST_TEST_PASSWORD`) as **Secrets**, not Variables, on the `staging` GitHub environment. `${{ secrets.X }}` only reads the Secrets store — a value saved under the environment's Variables tab instead resolves to an empty string with no error at all, at every reference site in this file. Until real Secrets exist, the auth step degrades gracefully per the paragraph above — check the run's `::warning::` annotations to tell which mode a given scan ran in.

BUG (found the first time this actually ran): `fail_action: false` only suppresses ZAP's *alert/findings* failure — its own `action.yml` scopes it explicitly ("The action status will be set to fail if ZAP identifies any alerts"). It does nothing for a hard scan-execution failure, which is a DIFFERENT exit path: ZAP's own exit code 3 ("any other failure"), surfaced here as `Error: failed to scan the target: Error: The process '/usr/bin/docker' failed with exit code 3`. An empty or unreachable `STAGING_URL` hits exactly that path — so the file's own "NEVER fails the run" claim was true for findings and false for a bad target. Root cause of the specific failure: `DAST_TEST_EMAIL`/`DAST_TEST_PASSWORD` had been added under the environment's Variables tab rather than Secrets — the same Secrets-vs-Variables gap described above, and `STAGING_URL` (used directly as `target:`) was similarly at risk of resolving empty. FIX: a new `Check staging target is configured and reachable` step runs between the auth step and the ZAP step — checks `STAGING_URL` is non-empty AND responds to a 15s `curl -fsS` HEAD-equivalent probe, and if either check fails, emits a `::warning::` and sets `configured=false`. The ZAP step now carries `if: steps.target.outputs.configured == 'true'`, so a missing/dead target skips the scan (and the docker exit-3) entirely instead of hard-failing the step. This is the same "degrade gracefully with a warning" pattern already used for the Supabase auth secrets in this file — extend it here if you add another required Secret/Variable to this workflow.
If you want to widen coverage later (active scan instead of baseline, or a second job against a route list from `NODE 5 · API GRAPH`), do it as a SEPARATE job/workflow rather than turning this one blocking — active scans can mutate data and are a materially different risk profile than a passive baseline.

**R26 — `_applySegmentsToTimeline` only ever closes gaps to the RIGHT of the clip it's processing; it has never closed a gap to the LEFT.**
Its "shift clips after" step (durationDiff) has always correctly moved everything past `rangeEnd` left by however much silence/filler content that step just removed. But nothing in the function ever looked at what comes BEFORE `rangeStart` — so if a gap already existed between this asset's clip and whatever precedes it on the same track (from an earlier edit, an earlier bug, or just how clips landed on upload), every subsequent cleanup run preserved that gap exactly, forever, no matter how many times it ran. In isolation this was invisible (a single asset's own cleanup has nothing to its left worth checking); it only became visibly "the timeline is scattered" once per-asset cleanup started batching N assets in one job (R25) and neighboring assets' pre-existing gaps were never revisited.
Fixed by computing `effectiveRangeStart` before laying out the kept segments: find the end of the immediately-preceding clip on the SAME track (`baseClip._trackId`), and if there's a gap larger than 0.05s and no bigger than `GAP_CLOSE_LIMIT` (30s), shift the whole new segment run left to close it. The 30s cap is deliberate — an intentionally large gap (title card, manual spacing) shouldn't be silently eaten by a command whose stated job is removing *silent gaps and pauses*, which are short by definition. Scoped to `baseClips.length === 1` only (i.e. not after `split_speakers`, where multiple video tracks must stay in lockstep per R18 — closing a leading gap per-track there risks desyncing them). `durationDiff` (used to shift everything after `rangeEnd`) is computed from `timelineEnd`, which is itself built from `effectiveRangeStart`, so the rightward shift automatically accounts for both the removed silence AND the closed leading gap in one pass — no separate compaction step needed.

**R25 — Silence AND filler-word cleanup both get transcript-aware pause intelligence (R17) followed by a frame check; neither applies raw backend cut spans anymore.**
Filler removal used to apply `result.activeSegments` from `/api/audio/filler/detect` completely raw — no `_refineCutsWithIntelligence` pass (so no dramatic-beat/thinking-pause reprieve, unlike silence removal), because the job's return value never included word-level `words`, only a flattened `transcript` string. `jobs/audioProcessor.js`'s `detectFillerWords()` already computed `words` (Whisper or a provided transcript) for its own GPT semantic-filler pass but discarded it before returning — now included in the response. `MediaExecutionEngine`'s `fillerDetect` case runs the exact same `_refineCutsWithIntelligence(segments, words)` call silence removal does before applying.
Both paths now ALSO run `_refineCutPointFrames()` — a check that a cut, chosen from transcript timing alone, doesn't land mid-blink/mid-gesture/on a motion-blurred frame (transcript timing has no idea what's on screen). Backed by a new `POST /api/interview/refine-cut-frames`: for every internal cut boundary, decodes the relevant span ONCE via `spawn` (streamed, non-blocking — deliberately not `execSync`, see R24) at 15fps/64×36 grayscale, scores each sampled frame for motion (frame-to-frame pixel diff) and blur (edge-energy proxy), and nudges the cut onto the cleanest nearby frame — always within the pause being removed, capped at ±150ms, never into kept speech. This is intentionally a local heuristic, NOT a GPT Vision call: batching 2-3 frames × 20-40 cut points through gpt-4o-mini would mean dozens of blocking `execSync` extractions (the pattern `extractVideoFrame` already uses) plus real latency/token cost for a judgment plain motion+edge scoring answers as well. Degrades like every other refinement pass here — any failure (no source file, ffmpeg error, network) returns the original segments unchanged; it never blocks the edit.
ROLLOUT FIXES: the first production run of a 5-asset batch surfaced three follow-on problems, all fixed together. (1) `refine-cut-frames` was 500ing on most calls — it read frames from the RAW upload via a signed URL, and raw phone `.MOV` files routinely have their moov atom at the end, which makes ffmpeg's `-ss` seek slow or outright fail for anything beyond a single-frame grab (unlike `extractVideoFrame`'s one-frame use elsewhere). It now prefers the asset's PROXY file (`_proxyGcsPathForAsset()` — always faststart per R7, and proxy generation never trims so timestamps carry over 1:1), captures stderr instead of discarding it, and fails in 8s instead of 25s so a miss doesn't eat a big chunk of the job's execution budget. It was also gated behind `aiGate` even though it makes no OpenAI call — split into a separate `authOnly` middleware so it doesn't burn a user's monthly AI-ops quota. (2) `/api/waveform/extract` (`routes/waveformRoutes.js`) runs ffmpeg synchronously per-request with NO concurrency cap — the one heavy ffmpeg path in this codebase that predates BullMQ and was never brought under R24's discipline. A multi-asset batch job re-triggers waveform extraction for every asset's freshly-cut clips at once, so it was spiking the same shared process R24 already flagged as memory-constrained; now gated behind a small in-process queue (`WAVEFORM_MAX_CONCURRENT = 2`) so callers wait instead of 502ing. (3) `useJobStore`'s UI-facing EXECUTING timeout (180s) is a separate tracker from the actual execution engine's budgets (`JobStateMachine`'s 420s, `ExecutionSupervisor`'s 600s) — it was firing FIRST on a multi-step per-asset batch (whose total time is the sum across all N assets, not one asset's worst case) and marking the job TIMEOUT in the UI while the real engine kept working underneath it and finished successfully seconds later. Raised to 420s to match `JobStateMachine`'s own ceiling so the mirror can't fire before the system it's mirroring would.

**R24 — `worker.js` shares a process (and memory ceiling) with the Express server; don't raise queue concurrency without checking the others.**
`index.js` does `require('./worker')` inline whenever GCS isn't configured or `WORKER_INLINE=true` — on that path, video encoding, transcription, Vision analysis, and the HTTP server are ONE Node process with ONE memory budget, not independent services. `audioWorker`'s concurrency comment already documented this: two concurrent jobs on a small Railway instance OOMs the process. That became a live bug once asset-analysis started firing IN PARALLEL with proxy encoding (R21) instead of after it — a 5-file upload could run 2 video encodes (`videoWorker`) and 2 vision/audio analyses (`assetAnalysisWorker`) at once, all doing local ffmpeg extraction on raw phone footage. The OOM crash-and-restart took the whole process down mid-request, which is what produced a 502 on one clip's `proxy.mp4` while a different clip's proxy job was still queued — and *that* job then blew past the client's flat 300s poll timeout because it was stuck behind others at reduced throughput.
Fix (no change to the parallel-analysis feature itself): `videoWorker` and `assetAnalysisWorker` concurrency both dropped 2→1 in `worker.js`. `pollJobResult()` (`client/src/utils/jobPoller.js`) gained an optional `timeoutMs` param (default unchanged at 300s for every existing caller); `client/src/services/proxyService.js`'s two proxy-polling call sites now pass `PROXY_POLL_TIMEOUT_MS = 900_000` (15 min) since proxy jobs legitimately queue behind each other in a multi-file upload at concurrency 1. This doesn't change what happens if a job truly never finishes — `IDELayout`'s null/reject fallback to the raw upload (R21) still fires — it just stops abandoning jobs that were about to succeed.
If you add a new BullMQ queue/worker (EXT4) or raise an existing worker's `concurrency`, check this rule: on the inline-worker path, its memory cost is additive with every other worker's, not isolated.

**R23 — Commands are ATOMIC and declared once in `client/src/agent/CommandRegistry.js`. Vocabulary lives there, nowhere else.**
Adding a command used to mean editing five files (EXT1), with keyword lists maintained by hand in `IntentParser` and `FallbackParser` and no way to see overlaps between them. That is how `'crop'` came to sit in the TRIM vocabulary: typing *"crop all the parts where speaker 00 is speaking to 200%"* matched trim/shorten and ran **silence removal**, reporting success for an edit the user never asked for. Root cause was two-part — a vocabulary collision AND no spatial-crop command existing at all, so the request was unrepresentable and fell to the nearest keyword.
The registry fixes both structurally:
- Every command declares `phrases` (what matches) and `negative` (what VETOES it). `crop`/`zoom`/`angle` are negatives on all cutting commands, so a framing request can never reach a destructive cut again.
- `findCollisions()` turns overlapping vocabulary into a test failure instead of a silent mis-route. `node scripts/test_command_registry.js` pins the original bug verbatim.
- Matching is ordered-token, not substring, so "remove **the** silences" works without enumerating every phrasing.
- ATOMIC BY DEFAULT: commands do one thing. Multi-stage flows are `macro: [...ids]` — sugar that expands to atomic steps, never a hidden extra behaviour. `macro_multicam` = detect_speakers → detect_scene → split_by_speaker → apply_angle, each runnable and re-runnable alone.
- `resolveCommand()` returns `ambiguous: true` when two commands score within 2 and the winner is destructive — the caller must ASK rather than execute.
MULTICAM IS NOW DECOMPOSED. The four stages are separately typeable and re-runnable:
`detect_speakers` (diarization only — no clip is touched) → `detect_scene` (Vision + angle PLAN, cached per asset in `sceneAnalysisByAsset`, still no clip touched) → `split_by_speaker` (the only destructive step) → `apply_angle` (applies the cached plan).
The cache is what makes this free: `virtual_multicam` checks `sceneAnalysisByAsset` before calling the API, and `split_speakers` now resolves diarization through `_getDiarizationForAsset` (cache → speakerMap → new job) instead of unconditionally queuing a 1–5 min job — so the chain never pays for the same analysis twice, while each step still works standalone. `apply_angle` re-runs instantly.
`detect_scene` reports real scene facts, not just angle counts: `/api/interview/virtual-multicam` returns a `layout` summary (onScreenCount, faces detected, per-frame anchors) which the command renders as "N people on camera, N voices heard". The voices-vs-faces mismatch is called out explicitly ("interviewer is off-camera") because that's the case that silently produced wrong duo framing before R14's `effectiveSolo` check. `apply_angle` delegates to the `virtual_multicam` case rather than copying it, so the split/layout rules (R14/R18) stay in ONE place. `macro_multicam` still exists as a single-shot path and its `macro: []` lists exactly these four ids.
Analysis commands are declared `destructive: false` and genuinely mutate nothing — that's what lets a user ask "who's talking?" or "what's in the shot?" without restructuring their timeline, which was impossible when both were buried inside `split_speakers`/`virtual_multicam`.

WIRING: `IntentParser.parse()` calls `tryRegistry()` FIRST — before `tryLocalFirst()` and before the GPT call — because the registry is the only layer that understands negative terms. Flow: `resolveCommand()` → if `unimplemented`, fall through to the legacy path (never route to a missing handler) → if `ambiguous`, return `needsClarification()` so EditJobManager asks instead of executing → otherwise emit `{ operation: cmd.executes || cmd.id, constraints: extractParams(cmd, prompt) }`.
`executes` lets a registry id differ from the legacy operation name (`split_by_speaker` → `split_speakers`, `apply_angle` → `virtual_multicam`), so vocabulary can be reorganised without rewriting the planner/compiler in the same change.
`extractParams()` lives in the registry (not the parser) so it's unit-testable without booting the store. It is deliberately conservative — an unparsed param falls back to its declared default rather than guessing, so a half-understood sentence can't produce a confidently wrong edit.
Test 7 in `scripts/test_command_registry.js` statically asserts every live command routes to a real planner/compiler/engine handler — that check is what makes growing the vocabulary safe.
When adding a command: one registry entry + one executor case. Do NOT re-add vocabulary to IntentParser's lists.

**R22 — There is exactly ONE assistant voice (the Editorial Brain). Never post a second hardcoded "assistant" message.**
`IDELayout`'s multi-file upload handler used to post its own `type:'assistant'` log — "I've got your N clips ready: …Want me to arrange them?" — while the Brain spoke immediately below it. Two voices, two different understandings: the local one listed 4 clips by name, the Brain called the same project "a monologue" because its prompt only ever received COUNTS (`totalAssets`), never the clip list. Fixed on both sides:
- The hardcoded message is gone. The Brain's debounced `asset_added` analysis is the only thing that speaks after an upload.
- `ContextEngine` now emits `binItems` (id/name/type/duration, capped at 25) and `EditorialBrain` renders them under MEDIA BIN → "Clips:", so it can acknowledge footage BY NAME. The prompt also instructs it to open by acknowledging what just landed on `asset_added`, to count the bin before characterising the project, and never to repeat advice already given.
- `ReasoningPanel` keeps a deliberately advice-free `type:'info'` fallback that fires ONLY when the Brain returned nothing (no API key / network failure), so it can never contradict the Brain.
If you add another surface that "talks", route it through the Brain instead of adding a parallel message.

**R21 — Media intelligence must actually be requested, persisted, and read back, or the Brain can only give generic advice.**
The chain had three breaks, all fixed together:
1. `media_assets` had NO migration (`supabase/migrations/20240004_media_assets.sql` now defines it, applied to prod — 30 columns mirroring `MediaIntelligencePipeline.analyzeAsset()`'s update payload; add a field there ⇒ add it here).
2. NOTHING called `POST /api/brain/analyze-asset`, so the `asset-analysis` BullMQ worker (`worker.js`) never ran. `IDELayout` now queues it fire-and-forget once the proxy resolves and the raw GCS path is known.
3. `/api/brain/analyze` never read the results back. It now selects the `media_assets` rows for the project's bin ids and attaches them as `context.assetIntelligence`; `ContextEngine` passes them through and `EditorialBrain` renders a "FOOTAGE IN THE BIN" section (scene type, framing, subject count, B-roll/screen-recording flags, lighting, stability, tone, description) with an instruction to reason about several videos TOGETHER. When the list is empty the prompt explicitly tells the model not to speculate about the footage.
ALSO: the `asset_added` advisory trigger is DEBOUNCED (`ReasoningPanel`) — it used to fire once per completed proxy, so uploading N videos ran N analyses against a half-filled bin and returned the same generic answer each time. The timer resets on each arrival and skips while anything is still proxying. Regression: `/tmp/test_bin_debounce.js`.
PLAYBACK: a proxy job that resolves null (SSE missed the returnvalue) or rejects used to mark the asset `ready` with NO `proxyUrl`/`sourceUrl` — the player then had nothing to load and rendered a blank dark canvas. Both paths now fall back to the raw upload (`/api/proxy/gcs-media/<rawGcsPath>`), which also restores the waveform. Per-asset `gcsPath` is stored on the asset because `uploadedFilePath` is a single global field that each upload overwrote.

**R20 — The assistant panel is ONE chronological feed; don't render logs, suggestions OR the Brain advisory as separate blocks.**
The Editorial Brain advisory was a THIRD offender beyond logs/suggestions: `<BrainPanel brainOutput={brainLastResponse}>` was a fixed JSX element rendered after the feed, fed by a single "latest response" value. So its card always sat below the whole conversation regardless of when the advice was produced, and an earlier advisory was silently overwritten by a later one instead of staying where it happened. Each new advisory is now pushed into the feed as `{ type: 'brain_advisory', data }` via `addSuggestion` (de-duped on sessionId+message so an identical re-analysis doesn't stack), and rendered in-place by the `feedItems` switch. The remaining fixed `<BrainPanel brainOutput={null} isProcessing>` exists ONLY to show the thinking state (it returns null when it has no content and isn't processing).
STALENESS: the advisory used to fire only on `project_opened` / `asset_added`, so guidance generated at upload persisted unchanged through every subsequent command ("start by removing repetitive content" long after the user had). An effect now watches `useTimelineStore.editHistory.length` and calls `analyzeProject('edit_applied')` whenever it grows — and since R19 sends that same ledger to the Brain, the new answer actually differs. Regression: `/tmp/test_advisory_flow.js`.
`ReasoningPanel` used to render `{logs.map(...)}` followed by `{suggestions.map(...)}`, so every suggestion/brain/plan card appeared BELOW the entire conversation regardless of when it was produced — a card generated before three later messages still sat under them. `useAIStore.addLog`/`addSuggestion` now stamp a monotonic `_seq` (and `_at`), and the panel merges both collections into a single `feedItems` array sorted by `_seq`. Do NOT sort on `timestamp`: that field is a locale-formatted 12-hour string ("3:45:12 PM"), not comparable. Items lacking `_seq` fall back to the old grouping so nothing crashes on restored/legacy sessions. Auto-scroll keys off `feedItems.length` (it previously watched only `logs`, so a new card could arrive off-screen). Regression: `/tmp/test_feed_order.js`.

**R19 — Next-step guidance is DERIVED from live project state; never hardcode a per-operation "next suggestion".**
`OPERATION_META` in `WorkflowController.js` used to map each operation to one fixed suggestion (`virtual_multicam` → always "Add captions"), so guidance could not react to anything the user had already done. The resolution chain is now:
1. `useTimelineStore.editHistory` — an append-only ledger written by `recordEdit(op, …)` from `WorkflowController` on every successful job. This is the project's memory; `ContextEngine.build()` has ALWAYS read `projectState.editHistory` but the client never sent it, so the Brain's prompt permanently said "Edits applied: none".
2. `client/src/agent/SuggestionEngine.js` — `deriveFacts()` computes effect COVERAGE (multicam/rhythm clips ÷ total video clips, transcript presence, speaker count, unused assets) and an ordered rule set encodes the pipeline order (transcript → cleanup → multicam → rhythm → polish → export) with real prerequisites. Rules are skipped when their effect is already covered ≥50% or their op is in the ledger, and the just-completed op is never re-proposed. Deterministic and offline-safe.
3. Editorial Brain suggestions layer on TOP via `getNextActions({ brainSuggestions })`, passed through `isAlreadySatisfied()` so the LLM (whose context can lag by one operation) can't propose finished work.
`buildProjectState()` now sends `editHistory` + an `effects` coverage block; `EditorialBrain`'s prompt renders it as "Effect coverage: …" with an explicit instruction never to recommend what's already applied. Quick chips come from the same engine (`setQuickChips`) instead of the four hardcoded strings. Regression: `/tmp/sugtest/run.js` pins the progression and the never-repeat guarantees.

**R18 — The edit commands are MULTI-TRACK and ASSET-SCOPED; `.find(t => t.type === 'video')` is a bug.**
After `split_speakers` there is one video track PER SPEAKER. Any command that reaches for a single video track silently ignores every clip on the others. Fixed in all three: `virtual_multicam` already used `.filter`; `_applySegmentsToTimeline` (silence/filler cleanup) and `rhythm_zoom` now gather clips from every video track and carry a `_trackId` so mutations land on the right track (`addTransformKeyframe` resolves the track from the clip id itself, so it was already safe).
Cleanup additionally uses ONE shared source→timeline map (`segOut`) for all tracks: each kept segment gets a single output position, and every clip is rebuilt by intersecting its own source window with that map. Packing each track from its own cursor — the previous behaviour — let parallel speaker tracks drift apart or stack at t=0. `scripts/`-style regression: `/tmp/test_multitrack_cleanup.js` pins cross-track chronological order and total kept duration.
ASSET SCOPING: diarization and the camera-angle plan are BOTH per-source-file — their timestamps only mean anything inside the file they came from. `virtual_multicam` therefore runs ONE analysis PER ASSET (`_getDiarizationForAsset` → `POST /api/interview/virtual-multicam` per asset) and tags each clip from its own asset's segments, so a duo interview and a solo talking-head on the same timeline each get their correct angle vocabulary. Diarization resolution per asset is: `store.diarizationByAsset[assetId]` cache → `speakerMap` (only for the asset `split_speakers` already ran on) → queue a fresh diarize job via `/api/interview/split-speakers` and poll it. Results are cached in `diarizationByAsset` so a second run doesn't re-pay for 1–5 min jobs. Assets that can't be analysed are left untouched and named in the result message. `_applySegmentsToTimeline` has always had per-asset targeting (`targetAssetId` → primary-asset fallback) for the same reason. Regression: `/tmp/test_multiasset_vm.js` pins that asset A's clips never receive asset B's angles.
Waveforms are per-asset: `utils/waveformPath.js`'s `deriveGcsPath()` must resolve EVERY URL shape an asset can carry — `/api/proxy/gcs-media/…`, `/uploads/…`, a raw/signed `https://storage.googleapis.com/<bucket>/<path>` URL, and a bare `raw/…`/`proxies/…` key. It previously handled only the first two, so any clip whose asset hadn't been proxied yet got a 400 and rendered no waveform — on a multi-clip timeline that looked like "only the first clip has a waveform". `node scripts/test_waveform_pipeline.js` pins all shapes.

**R17 — Silence removal has an editorial-intelligence pass; don't revert it to raw gap-cutting.**
`_refineCutsWithIntelligence()` in `MediaExecutionEngine` post-filters silence-removal segments BEFORE `_applySegmentsToTimeline`: the gaps between consecutive segments are sent to `POST /api/interview/classify-pauses` (GPT-4o-mini + transcript context) which labels each `cut` (dead air), `keep` (dramatic beat/comedic timing — pause absorbed, segments merged), or `shorten` (thinking pause before an answer — a 0.45s beat is retained). Local heuristic fallback when GPT is unavailable (mid-sentence pause <1.5s → shorten, >2.5s → cut). Word-gap segmentation defaults were also raised (min silence 0.5→0.8s, padding 0.1→0.2s) because ASR word timestamps clip trailing phonemes — 100ms padding literally cut word endings. The waveform on trimmed clips is sliced to the clip's source window in `Clip.jsx` (`clipPeaks` memo) — full-file peaks squeezed into every segment was the recurring "waveform missing" bug; `usePeaks` also auto-retries a failed extraction once after 5s.

**R16 — Chaining AI edit commands on already-edited clips has three known failure classes; two are fixed, one is a deliberate soft-block.**
Nothing in `CommandCompiler` enforces command ordering, so a user can apply `virtual_multicam` and `rhythm_zoom` to the same clips in either order, or run destructive re-segmentation (`split_speakers`, silence/filler removal) after either has already run. Three failure modes were found and addressed:
1. **Multicam crop + zoom-rhythm scale used to compound instead of compose** — the multicam crop (WebGL UV region / FFmpeg `crop` filter) and the rhythm zoom (CSS `transform: scale()` / FFmpeg `zoompan`) were fully independent, so a clip with both got over-zoomed/cropped-out in both preview and export. Fixed by composing them into ONE effective crop, anchored on the SAME point the multicam angle detected: preview via `composeCropWithZoom()` in `VideoPlayer.jsx` (a single `useEffect` keyed on `currentTime` is now the sole place crop is set — the old CSS-transform path zeroes out its scale contribution whenever `virtualCam` is present, so the zoom isn't applied twice), export via a combined `zoompan` filter in `jobs/exportProcessor.js` whose `z(t) = vc.scale × rhythm_scale(t)`, anchored at the multicam crop's center in source-frame fractions, replacing the separate `crop` + `zoompan` filters for that clip (verified against a real ffmpeg run — see `buildZoomKeyframeExpr`'s `multiplier`/`maxZoom` options).
2. **Re-splitting a clip (multicam's diarization split, or `_applySegmentsToTimeline`'s silence/filler re-segmentation) used to copy stale `keyframes.scale` verbatim onto the new, shorter fragments** — the old timestamps no longer corresponded to anything on the new duration, silently producing a wrong or dead zoom. Fixed: both split paths now clear `keyframes.scale` on re-segmented clips (the existing `virtualCam` overlap-based remap in `_applySegmentsToTimeline` was already correct and is unchanged) and surface a note in the result message/console telling the user to re-run "make it more dynamic" if they want the rhythm back on the new cuts.
3. **`split_speakers` rebuilds the video track from scratch with zero metadata carryover** — unlike the two cases above, there's no sensible per-clip remap when speaker-splitting reshuffles clips across tracks, so this is a deliberate soft-block rather than a silent wipe: `MediaExecutionEngine`'s `split_speakers` case checks the video track for existing `virtualCam`/`keyframes.scale` before doing anything, and if found, returns `success:false` with an explanatory message instead of proceeding — the SAME command run again within 2 minutes (`_pendingSplitSpeakersConfirm`, an instance field on the engine) is treated as confirmation and proceeds. `args.confirmed === true` also skips the block, for any future explicit-confirm UI.

**R15 — Zoom rhythm (`rhythm_zoom`) produces MOTION, not just static zooms; keyframes must render in BOTH preview and export.**
`POST /api/interview/rhythm-zoom` returns per-clip `{ scale, type, motion }` where `motion.kind` is `static` | `push_in` (slow zoom from 95%→100% of target across the clip, sustained statements ≥2.5s) | `punch_in` (hold ~93%, snap to target exactly on the GPT-identified emphasis word — `ew` in the model response, located in the clip's timestamped words by punct/case-insensitive match). Retention rules enforced server-side: clip 0 is never wide (hook), max 2 consecutive same shot type, no direct wide↔close jumps. The client (`MediaExecutionEngine` `rhythm_zoom` case) renders motion as `clip.keyframes.scale` entries (multi-keyframe, easeOutCubic snap); preview interpolates them in `VideoPlayer.jsx` (CSS transform, talking-head origin `50% 28%`); export renders them via an FFmpeg `zoompan` filter with a piecewise-linear `z='if(lt(it,…))'` expression built by `buildZoomKeyframeExpr()` in `jobs/exportProcessor.js` — placed AFTER `setpts` so `it` is on the keyframes' clip-local time axis, anchored `y='(ih-ih/zoom)*0.28'` to match the preview origin. Before this existed, ALL zoom keyframes were silently dropped from exports (same preview-vs-export trap as R14).

**R14 — Virtual multicam has two modes; the crop must be applied in BOTH preview and export.**
`virtual_multicam` (MediaExecutionEngine case + `POST /api/interview/virtual-multicam`) tags clips with `clip.virtualCam = { angle, cropX, cropY, cropW, cropH, … }`. Preview renders the crop via PlaybackEngine's UV sub-region sampling (`u_cropOffset`/`u_cropSize`, set by VideoPlayer's `setCrop()`). Export renders it via a per-clip FFmpeg `crop=iw*W:ih*H:iw*X:ih*Y` filter in `jobs/exportProcessor.js` — placed AFTER rotation correction, BEFORE the scale filter (coords are fractions of the upright source frame). This export half was missing for months: the effect looked fine in preview and silently exported 100% wide. If you add any new render-time clip effect, check both paths — ALL THREE now: preview (UV crop), FFmpeg (`crop`/`zoompan` filters), and the Revideo/Lambda scene (`render-lambda/revideo/src/scenes/timeline.tsx`, which simulates the crop by zooming the Video node 1/cropW and offsetting so the crop center lands at canvas center, composed multiplicatively with scale keyframes per R16 — this was the LAST path to get it; before that, cinematic exports of multicam projects came out 100% wide, the "stayed on one angle" bug).
Modes: `duo` (2 speakers — `speakerA`/`speakerB` close-ups at 2.5x, `reactionA`/`reactionB` at 1.6x) and `solo` (1 person on camera — `wide`/`mid`(1.30x)/`close`(1.75x) cycling mid→close→mid→wide at speech pauses, never jumping wide↔close directly, opening/closing on wide). The response carries `mode: 'solo'|'duo'`; the client counts angle names dynamically — don't reintroduce a fixed angle-key set.
APPLY STEP (`MediaExecutionEngine` `virtual_multicam`): when a clip spans multiple diarization segments it is split into per-angle pieces, and those pieces MUST be laid out inside the original clip's own timeline span (`pieceCursor` starts at `clip.start`; the piece durations sum to the original duration). Do NOT reintroduce the old global "pack every video track from cursor=0" re-layout — after `split_speakers` there is one video track per speaker, and packing each independently stacked both tracks at t=0; `VideoPlayer` picks the first matching clip across video tracks, so the second speaker's angles became unreachable and the timeline duration collapsed (this was the "multicam isn't applying" bug). Piece ids use ms resolution (`Math.round(srcStart*1000)`) — the old 0.1s resolution collided for segments <0.1s apart and duplicate ids overwrite each other when the entity graph is rebuilt. The case also reports `success:false` when it tags 0 clips or when every angle came back wide, instead of returning a success message over a visually unchanged video.
Word source priority is `speakerMap` → `transcripts` → `captions` (remapped timeline→source). `split_speakers` persists `speakerMap` even when it finds only ONE speaker — returning early without it left the compound "split speakers + multicam" flow with no diarization data.
Detection chain (in priority order): (1) `detectSceneLayout()` — ONE GPT-4o-mini Vision call returning per-frame face anchors `{cx,cy,h}` + on-screen person count; cameras are built from real anchors via `anchorCam()` (face at 40% crop height, clamped in-bounds), and hostSide derives from anchor positions. It also forces SOLO framing when diarization hears 2 speakers but only 1 person is on camera (voice-off interviewer). (2) legacy side-only Vision (`detectHostSideViaVision`), (3) pyannote MediaPipe (`DIARIZE_SERVICE_URL`), (4) fixed geometry (±0.28 @2.5x duo / centered solo). Speaker COUNT comes from AssemblyAI diarization (`services/AssemblyAIService.js`); the HOST is the speaker with `role: 'interviewer'` from identify-speakers (client sends `roles` from `speakerMap`; falls back to diarization label order).
NOTE: the Brain's `MediaIntelligencePipeline`/`VisualAnalyzer` persists to a `media_assets` table that has NO migration and does not exist in production — its cached analysis (subject_count/scene_type) cannot be relied on. That's why detectSceneLayout does its own vision pass instead of reading brain data. If media_assets ever gets created + populated, the route could read subject_count from there and skip a Vision call.

**R13 — The SFX library is the real "Social SFX Pack — Collection 1" (91 sounds), served as bundled static files.**
The 33 procedurally-synthesized placeholders that used to live here are GONE (deleted from `client/public/sfx-library/` and from `assets`). The library is now 91 real sounds imported from `Social SFX Pack - Collection 1/` across 8 source folders → 6 categories (`foley`, `drops`, `tech`, `impacts`, `risers`, `transitions`). Import pipeline: sources converted to 160k stereo mp3 with ffmpeg into `client/public/sfx-library/`, taxonomy derived per source folder (EditingIntent/EmotionTag values validated against `server/audio-engine/types.js` — invalid enum strings silently become useless search tags), rows upserted into `assets` + `sound_effects` by `name` via the Supabase MCP. Verified 1:1: 91 DB rows ↔ 91 files, zero rows without a file, zero files without a row, every asset has its `sound_effects` child.
6 files from the pack were dropped because they are SILENT IN THE SOURCE (`-inf` peak — verified against the originals, not a conversion fault): `Click, Open`, `Drop 1`, `Sword Draw`, `Ticking Clock Sound`, `Wind Shut`, `Winding 1`.
The 303MB raw pack is excluded from git (`.gitignore`) AND from the Docker build context via a NEW `.dockerignore` — there was none before, so `COPY . .` would have baked all 303MB into the image. That `.dockerignore` lists ONLY the pack and `.git`; do not add `client/public/**` to it or you will break the bundled fonts (R7) and this SFX library at once.
`server/audio-engine/library/generateSfxAudio.js` (the old synthesizer) is retained only as a fallback for environments with no licensed pack; it is no longer the source of the shipped library.

**R12 — `server/audio-engine/library/seeder.js` must be run manually; nothing runs it for you.**
The `assets` / `sound_effects` / `luts` / `presets` tables have zero rows until someone runs `node server/audio-engine/library/seeder.js` against the target Supabase project (needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in env). It is not called from the Dockerfile, `package.json`, or `index.js` boot — this bit us once already: the SFX/LUT/Preset tabs in the Assets panel searched fine (the `AssetSearchEngine`/`QueryParser` logic is correct) but returned "No results found" for every query, on the production DB, because the tables were simply empty. If you provision a new environment (or reset the DB), re-run the seeder before assuming asset search is broken. Also fixed in the same pass: `seeder.js` previously tagged every preset row with `type: AssetType.LUT` (copy-paste from the LUT block) instead of `AssetType.TEMPLATE` — harmless for preset-specific queries (`TaxonomyService.getPresetsByIntents` doesn't filter on `type`) but it meant presets could leak into `getLUTsByIntents()` results whenever `editing_intents` overlapped. `starterLUTs.js` also referenced a few non-existent enum keys (`EditingIntent.DARK`, `EditingIntent.NOSTALGIA`, `EmotionTag.ROMANTIC_NOSTALGIC`) that silently evaluated to `undefined` — harmless in JS but would insert the literal string `"undefined"` into a `text[]` column if ever hand-translated to SQL again; any future re-seed script should filter those out.

---

## NODE 9 · TECHNICAL DEBT

These are known issues as of 2026-07-16. File a note here when you add new debt.

**TD1 · Plan limits split between client and server.**
`client/src/lib/planLimits.js` caps creator at 10 projects; `middleware/usageGate.js` gives creator ∞. Server is authoritative. Client limit is a UX hint that's now stale. Fix: Remove `projects` from `PLAN_LIMITS` in `planLimits.js` and enforce server-side only.

**TD2 · Anonymous sessions lost on server restart.**
The in-memory Map is not persisted. If Railway restarts the server (e.g., deployment), anonymous users lose their session. The Supabase fallback table (`anonymous_sessions`) exists but is not the primary path. Fix: Make Supabase the primary store.

**TD3 · `EditPlanner` auth fix is comment-documented but fragile.**
The file header notes that `planViaAPI()` previously lacked an `Authorization` header. Fixed by using `authFetch`. If anyone adds a new fetch call inside the agent layer, it must also use `authFetch`.

**TD4 · `previewQuality` select in `SettingsPanel` reads from store via `getState()` instead of a hook.**
This works but bypasses reactivity — the dropdown won't update if another part of the app changes preview quality. Fix: Add `previewQuality` to the `useShallow` selector.

**TD5 · `ML_Dataset/` and `ML_Models/` are in the repo root.**
Training artifacts in a production repo. They are not referenced by any runtime code. Should be moved to a separate repo or excluded via `.dockerignore`.

**TD6 · `diarize-service/` Python service has no Dockerfile in the main repo.**
It's deployed separately. The integration point is undocumented — no clear API contract in source. Risk: changes to the diarize service URL require tracking down where it's called.

**TD7 · `starterLUTs.js` references a few EditingIntent/EmotionTag enum keys that don't exist.**
`EditingIntent.DARK`, `EditingIntent.NOSTALGIA`, `EmotionTag.ROMANTIC_NOSTALGIC` are all `undefined` at require-time (checked against `server/audio-engine/types.js`). They silently get filtered/ignored by the current seed path but are still wrong references in the source file. Fix: either add these as real enum values in `types.js` (if the semantic distinction is wanted) or correct the references to existing keys (`EmotionTag.DARK` exists; `EmotionTag.NOSTALGIC` exists and is probably what `ROMANTIC_NOSTALGIC` meant).

---

## NODE 10 · FUTURE EXTENSION POINTS

These are the designed seams where new features should be added.

**EXT1 · New AI command → touch 5 files.**
Any new thing the agent can do requires: `IntentParser` (new intent constant + detection), `FallbackParser` (keyword fallback), `EditPlanner` (planning logic), `CommandCompiler` (compile to commands), `VideoEditorTools` (expose as tool if needed).

**EXT2 · New caption/export font → update `FONT_SPECS` in `exportProcessor.js`.**
Add `{ file, slug, weight, subset }`. The `slug` must match the `@fontsource` npm package name. Also add the corresponding `curl` line to `Dockerfile`. Both steps required — Dockerfile for build-time, FONT_SPECS for runtime fallback.

**EXT3 · New subscription plan → update both plan limit files.**
`middleware/usageGate.js` (server enforcement) AND `client/src/lib/planLimits.js` (client UX). Also update `polarWebhook.js` if the plan key changes.

**EXT4 · New BullMQ queue → add to `queue/queues.js`.**
Pattern: `new Queue('name', { connection })`. Then create corresponding processor in `jobs/`. Register the worker in `index.js` inline boot block.

**EXT5 · New i18n namespace → add locale files + register.**
Create `client/src/locales/en/{namespace}.json` and `client/src/locales/fr/{namespace}.json`. Register in `client/src/i18n.js` namespace list. Use `useTranslation('namespace')` in components.

**EXT6 · New API route domain → create `routes/{domain}Routes.js`.**
Follow checklist: `authenticateUser` + input validation + `try/catch` + rate limiter comment. Mount in `index.js`.

**EXT7 · New Zustand store action with timeline mutations.**
Always follow: `_saveHistory()` → `beginTransaction()` → dispatches → `commitTransaction('Label')` → `set({ tracks: toLegacyTracks() })` with catch → `rollbackTransaction()`.

---

## NODE 11 · SEMANTIC TAGS

Tags for quick grep-and-find when you know what kind of thing you're looking for.

```
[AUTH]         middleware/auth.js, config/database.js, client/src/lib/supabaseClient.js
[BILLING]      routes/polarWebhook.js (webhook + checkout + cancel/reactivate/portal/status), middleware/usageGate.js, client/src/hooks/useUserPlan.js, client/src/pages/AccountPage.jsx (/account) — see R46 for canceled-vs-revoked and the payouts boundary
[QUEUE]        queue/queues.js, queue/connection.js, jobs/*.js
[EXPORT]       routes/exportRoutes.js, jobs/exportProcessor.js, client/src/services/exportService.js
[FONTS]        jobs/exportProcessor.js (FONT_SPECS), Dockerfile (curl block), client/public/fonts/
[TIMELINE]     client/src/timeline/TimelineStateManager.js, client/src/agent/useTimelineStore.js
[PLAYBACK]     client/src/engine/PlaybackEngine.js
[AI-AGENT]     client/src/agent/WorkflowController.js → EditJobManager.js → full pipeline
[AI-API]       routes/aiRoutes.js, controllers/aiAgentController.js
[CAPTIONS]     routes/captionRoutes.js, jobs/exportProcessor.js (drawtext)
[STORAGE]      services/StorageService.js, config/storage.js
[I18N]         client/src/i18n.js, client/src/locales/
[DESIGN]       Vibed Design System/, client/src/index.css (CSS vars)
[SESSION]      routes/sessionRoutes.js, client/src/agent/useSessionStore.js
[PLANS]        middleware/usageGate.js, client/src/lib/planLimits.js
[CREATIVE-ASSETS]  server/audio-engine/ (search/recommend engines + starter library + seeder.js + generateSfxAudio.js), routes/audioEngineRoutes.js, client/src/audio-engine/AudioEngineAPI.js, client/src/components/AssetPanel.jsx, client/public/sfx-library/ (placeholder SFX audio — see R13) — see R12 for the "tables are empty until you seed" gotcha
[USER-PRESETS] server/routes/presetRoutes.js (POST /api/presets/user — real, Supabase-backed), client/src/components/SaveAsPresetButton.jsx (shared save UI), client/src/components/TextPanel.jsx (caption style save), client/src/components/LUTCard.jsx (color grade save) — named, custom settings objects, private only (no public-sharing UI). Do not confuse with the dead root routes/presetRoutes.js marketplace stub (unmounted, superseded — see index.js comment).
[FAVORITES]    routes/favoritesRoutes.js (mounted at /api/favorites), supabase/migrations/20240003_favorites.sql (user_favorites table), client/src/audio-engine/AudioEngineAPI.js (getFavorites/addFavorite/removeFavorite), client/src/components/SoundCard.jsx (SFX heart toggle), client/src/components/Timeline/ClipContextMenu.jsx (Fade Out / Crossfade heart toggle) — bookmarks an EXISTING asset_id or a fixed transition_type string; no custom settings, exactly one of the two per row (DB CHECK constraint). Distinct from [USER-PRESETS] above.
[WAVEFORM]     routes/waveformRoutes.js, utils/waveformPath.js, client/src/hooks/usePeaks.js, client/src/components/ClipWaveform.jsx, client/src/components/Timeline/Clip.jsx
[PROJECT-MAP]  server/brain/ProjectIntelligence.js (derive + persist), server/brain/media/analysisStatus.js (the ONE definition of analysis_status), server/routes/brainRoutes.js (/analyze attaches it), server/brain/ContextEngine.js (passthrough + binReady), server/brain/EditorialBrain.js (PROJECT MAP section + rules), project_intelligence table — see R44.
[ORGANIZE]     routes/interviewRoutes.js (/organize-clips — fetchAssetProfiles, buildOrganizeDescriptors, resolveClipSource), client/src/agent/MediaExecutionEngine.js (organize_clips case), media_assets table — see R43. Profile-first; frame extraction is the fallback.
[MULTICAM]     routes/interviewRoutes.js (/virtual-multicam — solo + duo modes), client/src/agent/MediaExecutionEngine.js (virtual_multicam case — split/tag clips), client/src/components/Player/VideoPlayer.jsx (setCrop sync), client/src/engine/PlaybackEngine.js (UV crop uniforms), jobs/exportProcessor.js (FFmpeg crop filter) — see R14. Revideo export path does NOT support it yet.
[RHYTHM]       routes/interviewRoutes.js (/rhythm-zoom — shot types + emphasis words + motion plan), client/src/agent/MediaExecutionEngine.js (rhythm_zoom case — keyframe application), client/src/components/Player/VideoPlayer.jsx (keyframe interpolation, transform-origin), jobs/exportProcessor.js (buildZoomKeyframeExpr + zoompan) — see R15.
```

---

## NODE 12 · NAVIGATION PATHS

"Where do I go to change X?"

| Task | File(s) |
|------|---------|
| Change what the AI agent does when it parses a command | `client/src/agent/IntentParser.js` → `FallbackParser.js` |
| Add a new edit operation the agent can perform | EXT1 above (5 files) |
| Change export quality / FFmpeg flags | `jobs/exportProcessor.js` |
| Add a new caption font | `jobs/exportProcessor.js` (FONT_SPECS) + Dockerfile |
| Change plan limits | `middleware/usageGate.js` + `client/src/lib/planLimits.js` |
| Change what Polar billing plan keys map to | `routes/polarWebhook.js` |
| Change auth logic / token validation | `middleware/auth.js` |
| Add a new language | `client/src/locales/{lang}/` + register in `i18n.js` |
| Change how the timeline renders in the editor | `client/src/components/Timeline/` |
| Change playback engine behavior | `client/src/engine/PlaybackEngine.js` |
| Add a new BullMQ job type | `queue/queues.js` + `jobs/{type}Processor.js` + `index.js` worker boot |
| Change DB schema | `migrations/` (SQL file) + update Supabase + update types if any |
| Change Redis connection | `queue/connection.js` |
| Change GCS bucket or storage logic | `config/storage.js` + `services/StorageService.js` |
| Change rate limits | `middleware/usageLimits.js` |
| Fix a bug in clip waveform rendering | `client/src/hooks/usePeaks.js` (fetch/cache) → `routes/waveformRoutes.js` (extraction) → `utils/waveformPath.js` (proxyUrl parsing — see R11) → `client/src/components/ClipWaveform.jsx` (render). Run `node scripts/test_waveform_pipeline.js` after touching any proxyUrl-shape logic. |
| Fix "no results" in the SFX/Color/Presets tabs of the Assets panel | Check row counts first (`SELECT count(*) FROM assets`) before touching search code — the engine (`server/audio-engine/search/`) is correct; the tables are just empty until `node server/audio-engine/library/seeder.js` is run. See R12. |
| Change the design system tokens | `Vibed Design System/tokens/` + `client/src/index.css` |
| Add a new component following design system | Follow NODE 8 R1; use `var(--accent)`, `var(--violet)`, `var(--bg-2)`, glassmorphic surface pattern |

---

## NODE 13 · STABLE VS VOLATILE

### Stable (change rarely, high blast radius if touched)
- `queue/connection.js` — all workers share this Redis connection
- `client/src/timeline/TimelineStateManager.js` — core immutable store; breaking changes ripple everywhere
- `middleware/auth.js` — all protected routes depend on it
- `config/database.js` — supabaseAdmin is used by nearly every backend module
- `client/src/engine/PlaybackEngine.js` — WebGL2 + WebCodecs, complex threading model
- `client/src/agent/CommandCompiler.js` — must remain pure/synchronous; contract is relied on by executor
- `client/src/agent/useTimelineStore.js` — central Zustand store; action signatures are called from many places

### Volatile (changes frequently, low coupling)
- `routes/*.js` — new routes added regularly
- `client/src/components/**` — UI iteration, design system alignment
- `jobs/exportProcessor.js` — font additions, FFmpeg flag tuning
- `client/src/locales/**` — copy changes, new locale keys
- `client/src/agent/IntentParser.js` + `FallbackParser.js` — new intents added as features ship
- `client/src/pages/**` — page-level layout changes
- `Dockerfile` — dependency updates, font list changes
- `ML_Dataset/` + `ML_Models/` — training artifacts (not runtime)

---

## NODE 14 · AI CHANGE MAP

> When a future Claude session is asked to implement something, consult this map first.

### "Add a new AI video edit command (e.g., 'crop to speaker')"
1. `IntentParser.js` — add `INTENT.CROP_TO_SPEAKER` constant and detection pattern
2. `FallbackParser.js` — add keyword/regex fallback entry in NLP_MAP
3. `EditPlanner.js` — add planning case that produces ACTIONS steps
4. `CommandCompiler.js` — add compiler entry for the new action
5. `VideoEditorTools.js` — expose as a callable tool if it needs AI invocation
6. `MediaExecutionEngine.js` — implement the actual timeline operation
7. `ValidationService.js` — add post-execution validation if needed

### "Add a new caption style/font"
1. `jobs/exportProcessor.js` — add to FONT_SPECS (file, slug, weight, subset)
2. `Dockerfile` — add curl line in the font download RUN block
3. `client/src/components/Assistant/ReasoningPanel.jsx` — add to CaptionStylesCard presets if UI needed

### "Add a new billing plan tier"
1. `middleware/usageGate.js` — add to PLAN_LIMITS (ai_ops, max_duration, projects, storage_days)
2. `client/src/lib/planLimits.js` — add to PLAN_LIMITS (projects cap)
3. `routes/polarWebhook.js` — handle new plan key in webhook handler
4. `client/src/hooks/useUserPlan.js` — add UI behavior for new tier

### "Add a new page/route to the app"
1. `client/src/pages/{Name}Page.jsx` — create page component
2. `client/src/App.jsx` (or router file) — add `<Route>`
3. `client/src/locales/en/{namespace}.json` + `fr/` — add copy
4. `client/src/i18n.js` — register namespace if new

### "Fix a bug in the export pipeline"
Start at: `jobs/exportProcessor.js` → trace to `routes/exportRoutes.js` → `services/exportService.js`
Check: font resolution → FFmpeg command string → StorageService upload → job status reporting

### "Fix a bug in the AI agent"
Follow the pipeline in NODE 3A. Add `[AG_DEBUG]` prefix to console.logs (existing convention).
The most common failure points: auth missing on `authFetch` calls inside agent files, `CommandCompiler` timeout (200ms), `EditPlanner` returning null plan.

### "Add a new Zustand store action"
Follow R4 in NODE 8. Pattern: `_saveHistory()` → `beginTransaction()` → mutations → `commitTransaction()` → `set({ tracks: toLegacyTracks() })`.

### "Change the design system in a component"
Use tokens: `var(--accent)` = `#00E5FF`, `var(--violet)` = `#8A2BE2`, `var(--bg-2)`, `var(--line-strong)`, `var(--line-soft)`, `var(--fg)`, `var(--fg-2)`, `var(--fg-3)`, `var(--f-sans)` (Geist), `var(--f-mono)` (JetBrains Mono).
Glassmorphic surface: `background: rgba(255,255,255,0.04); border: 0.5px solid rgba(255,255,255,0.09)`.
Badge tint: `background: color-mix(in oklch, var(--accent) 14%, transparent); border: 0.5px solid color-mix(in oklch, var(--accent) 28%, transparent)`.
CTA button: `background: linear-gradient(135deg, var(--accent), var(--violet)); color: #fff`.
Top accent bar: `background: linear-gradient(90deg, var(--accent), var(--violet)); height: 0.5px/1px`.

### "Debug a production export failure"
1. Check Fly.io logs for `[fonts]` lines — missing fonts fall back to DejaVu
2. Check that `FONT_SPECS` has the font key the caption style uses
3. Check `drawtext` filter string in FFmpeg command — font path must be absolute
4. Check that system FFmpeg (not ffmpeg-static) is in the Docker image
5. Check GCS permissions for upload

### "Debug an anonymous session issue"
`client/src/agent/useSessionStore.js` → `routes/sessionRoutes.js` → in-memory Map → `anonymous_sessions` Supabase table. Remember: in-memory Map is lost on server restart.
