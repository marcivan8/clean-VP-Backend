# CLAUDE.md — Vibed Architectural Knowledge Graph

> This file is the persistent architectural memory for this codebase.
> Future Claude sessions should read this before touching any file.
> Generated 2026-07-16. Update it when you add a new system or refactor a boundary.

---

## NODE 0 · WORKING AGREEMENTS

**Clarify before building.** Whenever the user asks for something to be *built*
(a feature, a fix that's really new work, a system, an integration — anything
beyond a pure read/audit/investigation), do not jump straight to
implementation. Instead:

1. Ask follow-up questions first, covering: the actual intent behind the
   request (what problem this solves, not just the literal ask), requirements
   the user didn't mention but the build will need (edge cases, scope
   boundaries, explicit non-goals, failure behavior, integration points, data
   dependencies), and anything ambiguous enough that guessing wrong means
   rework.
2. Only once there's a clear, confirmed understanding, break the work into
   discrete tasks (visible task list).
3. Then execute.

Does not apply to audits, investigations, "just tell me X" questions, or
requests that already come fully specified. In an unattended/scheduled
session where no one can answer follow-ups, state the most reasonable
assumptions plainly and proceed rather than blocking.

_Added 2026-08-15, per explicit user request._

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

**R56 — The "cinematic" Revideo/Lambda export is REMOVED. There is one export pipeline: `jobs/exportProcessor.js`.**
Deleted: `routes/revideoRenderRoutes.js`, `client/src/utils/revideoPoller.js`, the `/api/revideo` mount in `index.js`, `handleRevideoExport()` in `IDELayout.jsx`, and the cinematic option from `RENDER_ENGINES` in `ExportModal.jsx`. `handleExportConfirm` now always calls `handleFfmpegExport`.
WHY IT WENT: it required `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_REGION`, a manually-created Lambda, a font layer and `PUBLIC_URL` for its webhook before it rendered anything at all; it applied no colour grade (R55) and no multicam crop (R14), so its output was silently WRONG for any project using either; and it duplicated a pipeline FFmpeg already does correctly. Every one of those was a standing source of "export is broken" reports.
**`@revideo/player-react` IS STILL USED — for the editor PREVIEW.** `IDELayout` imports `Player` and `../revideo/project`, and `render-lambda/` remains on disk. Do not "finish the cleanup" by removing those: deleting the preview player breaks the editor. Only the EXPORT path is gone.
`RENDER_ENGINES` is deliberately kept as a one-element array so a second engine can be reintroduced without restructuring the modal.

**R55b — The seeded LUT library has NO `.cube` files, so `lut3d` can never apply to it.**
Production surfaced `[LUTExportIntegration] LUT … has no gcs_path (not seeded with file)`. Verified against information_schema: the `luts` table has **no `gcs_path` column at all**. Its 10 rows are PARAMETER-based — `warmth`, `contrast`, `saturation`, `highlights`, `shadows`, plus a `css_filter_preview` string. `getLUTFilterForExport()` looks for `lut.gcs_path`, so for every built-in LUT it correctly returns null and the export renders ungraded (it fails open, as designed — the export still succeeds).
So R55's wiring is right but reaches only USER-UPLOADED `.cube` files (R33's `/api/luts/upload`). For the built-in library the export needs to derive FFmpeg colour filters (`eq=contrast=…:saturation=…`, `colorbalance`/`colortemperature` for warmth, plus highlight/shadow adjustment) from the SAME parameters the CSS preview uses — which would also make preview and export agree by construction rather than by approximation. **RESOLVED** — `LUTService.buildParametricFilter(lut)` derives the chain from those same parameters, and `getLUTFilterForExport()` falls back to it whenever there is no `.cube`. It reuses the EDITOR's mapping (`1 + value/10`, matching `LUTCard.buildColorPresetSettings`) so preview and export agree by construction rather than by coincidence.
THE ONE THING THAT IS EASY TO INVERT: FFmpeg's `colortemperature` takes Kelvin, where LOWER is WARMER. Positive `warmth` must therefore LOWER the value from the 6500K neutral — writing `6500 + warmth*400` produces a grade that cools when it should warm, and looks plausible in code. The regression asserts the direction both ways and fails when it is flipped.
An all-neutral LUT returns null rather than a no-op filter — a no-op still costs a decode pass. Verified against real production rows by RUNNING ffmpeg: the chain executes in the exporter's exact shape and the pixels change.
`highlights`/`shadows` fold into a single `gamma` term, which is a coarse approximation of a tone curve; it moves in the right direction but a true match would need `curves`. Good enough that the export no longer contradicts the preview, which was the actual bug.

**R55c — Applying a LUT writes `clip.grading`, the engine's REAL grading path.**
The canvas CSS filter (R55) was not enough — the LUT still did not appear on the clips. Root cause: **nothing in the entire app had ever written `clip.grading`**, yet `VideoPlayer` reads it every frame and pushes it into the engine's `brightness`/`contrast`/`saturation`/`hueRotate` uniforms via `setGrading()`. A live, proven grading path was sitting completely unused while the LUT feature tried to grade by other means. Seventh instance of the built-but-never-wired pattern.
`handleLUTApply` now converts the LUT's stored parameters into that shape and writes it onto every video clip, so the grade is visible on the timeline immediately AND persists as ordinary clip state the user can edit per clip later. `setGrading()` takes PERCENTAGES (it divides by 100) while the `luts` columns are on a -3..+3 scale — the conversion reuses the editor's own `1 + x/10` mapping, so the canvas filter, the clip grading and the FFmpeg export filter (R55b) all agree by construction rather than by three independent approximations.
**CLEARING MUST CLEAR.** Toggling a LUT off writes `grading: null` to the same clips. Leaving the grade behind would make an applied LUT impossible to remove — the regression pins this and fails when the null branch is dropped.
`projectLUTId` is still set alongside, because that is what the EXPORT reads. The three surfaces are deliberately separate: clip grading (what you see on the timeline), the canvas CSS filter (immediate whole-frame preview), and the FFmpeg filter (what ships).
STILL TO DO: the LUT grade is applied to ALL video clips at once and is not yet editable from a per-clip colour UI. Integrating it into the Colour panel — so a user can tweak contrast/saturation on top of a LUT per clip — is the natural next step, and the data is already in the right shape for it.
Regression: §8 of `scripts/test_lut_export.js`.

**R55d — The Colour panel now edits (and protects) a LUT's per-clip grade.**
R55c's "STILL TO DO" turned out to be half-true: the Colour panel (`activeTab === 'color'` in `IDELayout.jsx`) already read and wrote `activeClip.grading` generically, so a LUT's values already showed up on the sliders — but two real gaps meant "tweak on top of a LUT per clip" didn't actually work yet.
**GAP 1 — the hueRotate slider couldn't reach where the LUT put it.** `lutToGrading`'s warmth mapping (`n(lut.warmth) * -3`) can be negative, but the slider ran `min: 0, max: 360`. A negative starting value clamped the thumb to 0 while the number beside it kept showing the true value — the first drag would jump the clip's hue instead of nudging it. Range is now `-180..180`, which also gives manual grading more headroom than a 0-only range ever did.
**GAP 2 — a project-wide LUT apply/clear silently ate every per-clip tweak.** `handleLUTApply` (`AssetPanel.jsx`) writes to every video track's every clip unconditionally. Once the Colour panel could edit a clip's grade, that meant: apply a LUT, hand-tune one clip's contrast, then re-click the SAME LUT card to toggle it off (or pick a different one) — and the hand-tuned clip got overwritten right along with every other clip. An editable-per-clip feature that a random click elsewhere can silently discard isn't really per-clip.
Fixed by marking any manually-touched clip: `handleGradingChange` and `handleSelectiveGradingChange` (`IDELayout.jsx`) now set `grading._manuallyAdjusted = true` whenever the user moves a slider. `handleLUTApply` skips (and counts) any clip carrying that flag instead of overwriting it, logging how many were left alone. `_lutId`/`_lutName` on `grading` survive a manual edit (the spread keeps them), so the Colour panel can still show a "Based on LUT: <name>" badge — with an "adjusted" tag once `_manuallyAdjusted` is set — even after the user has tweaked past the LUT's original numbers.
The full Reset button is unchanged: it writes a brand-new neutral grading object with none of `_lutId`/`_lutName`/`_manuallyAdjusted`, so "start over" still means starting completely over.
Regression: §9 of `scripts/test_lut_export.js`.

**R61 — The motion engine is now REACHABLE. Ninth instance of the pattern, closed deliberately rather than discovered later.**
R58-R60 shipped a complete engine — 26 keyframe-generating presets, 12 easings, a resolver driving preview and export, 8 caption style packs — of which a user could reach **five presets**, via the animation dropdown that already existed in `TextPanel`. The other 21, all 8 style packs, and the whole keyframe editor had no caller outside the regression suite. That is exactly the failure `CLAUDE.md` documents eight times over (R33, R37, `/api/brain/organize`, R46, R52, R55, R55c, and `DirectorIntelligence` — written to fix R52, itself unwired). This entry closes it, and **§10 of `scripts/test_motion_engine.js` asserts it stays closed**.

**1. `client/src/components/MotionPanel.jsx` + a `motion` tab.** Kind-aware preset picker (camera moves are not offered on a caption) calling `applyPresetToClip`, plus the mounted keyframe editor. **BOTH HALVES OF A TAB ARE REQUIRED** — the import AND an entry in the clickable array at `IDELayout.jsx`. This file already contains three render branches (`effects`, `interview`, `marketplace`) whose buttons were trimmed from that array and can never be selected; `effects` additionally renders a component that was never imported and would throw `ReferenceError` if it ever were. The regression checks both halves.

**2. `KeyframeEditor.jsx` is mounted for the first time, unmodified.** 372 lines of working visual keyframe timeline — draggable diamonds, per-keyframe easing — that had exactly one reference (a barrel export nothing imports) since long before the motion engine existed. It speaks the EFFECT system's shape (`{paramName: [{time,value,easing}]}`), so `motion/KeyframeBridge.js` translates instead of rewriting it. Its kebab-case easing values (`ease-in`) were already handled: `Easing.resolveEasing` accepts both vocabularies, so the documented four-of-five-silently-linear defect is fixed by construction.
**THE ONE MODELLING DECISION:** hand-authored keyframes collapse to a SINGLE animation with `presetId: null`. The engine composes multiple animations (translate adds, scale multiplies), which is right for stacking presets but has no honest representation in a flat per-parameter timeline — two animations both driving `scale` would show as one track whose values are neither. Applying a preset REPLACES the custom animation, so the user always sees what will render. Values are OFFSETS and MULTIPLIERS, not absolutes, because that is how the resolver composes them; the UI labels them that way rather than showing an absolute that silently behaves as an offset.

**3. Caption style packs went into the picker that ALREADY EXISTS, not a second one.** `CAPTION_STYLES` in `ReasoningPanel.jsx` has ten packs, live font previews and a working apply path across every text track — the 8 packs in `CaptionModel` were written without knowing it was there. Shipping a second picker would have left two competing caption-style systems with non-matching ids and disagreeing "applied" states. Instead `LEGACY_PACK_MOTION` maps the EXISTING card's ten ids to the motion half — uppercase, `animationPreset`, `wordHighlight` — and `applyStyle` now writes `captionStyle` alongside the fonts. Consequence: picking a style now also sets how captions animate and how the spoken word highlights, and every pack's `transform: 'uppercase'` (defined on all ten and applied to nothing since it was written) finally takes effect. An unmapped id degrades to a safe default rather than returning null — returning null in a style-apply path would drop the motion half silently while the fonts changed.
Regression: §9 (bridge round-trip) and §10 (reachability) of `scripts/test_motion_engine.js` — 174 checks total.

**R63 — Animated captions (motion, textShadow, uppercase, word-by-word reveal) now reach the EXPORTED video, not just the preview. Closes the exact gap the "is the caption engine fully built?" audit surfaced.**
That audit (this same project) found the honest answer was no: word timing, 26 motion presets, 8 style packs and per-word highlighting are all correctly wired into the live preview (R58/R61), but `jobs/exportProcessor.js` STEP 4 burns ONE static `drawtext` per caption clip for its whole duration, reading only `fontFamily`/`fontSize`/`color`/`stroke` — every animation, shadow, uppercase transform and reveal exported flat, silently, with no error. Building "Phase 6" (a proposed Revideo-driven `<Caption>` component with full scale/opacity/stroke/shadow/glow) was scoped down after presenting the fork plainly: Revideo isn't in the export path at all today and making it the source of truth for captions would mean retiring the DOM `TextOverlay` preview, building a server-side Revideo SSR export renderer from nothing, and proving it as reliable as the current pipeline — a large, genuinely risky rewrite. The chosen alternative brings the SAME visual capability (animated scale/opacity/stroke/shadow/glow, actually in the exported file) to the pipeline that already reaches both preview and export correctly, with no new renderer and no migration.

**THE SAME ARCHITECTURE AS THE COMPOSITOR (R59-62), APPLIED TO TEXT.** `client/src/motion/CaptionCompiler.js` (new) samples `resolveMotionAt()` — the SAME resolver `TextOverlay.jsx` uses for the live preview — into a serialisable **caption program**: per animated/shadowed/uppercased caption clip, simplified keyframe samples (x/y/scale/opacity/glow, Douglas-Peucker reduced via `Compositor.simplifySamples`, now generalised to take a `keys` param instead of a hardcoded overlay-geometry list) plus word-reveal windows, converted to OUTPUT time via the exact `buildTimeMap`/`timelineToOutputTime` the composition plan already computes — reusing `plan.base.trackId` rather than re-deriving "which track is the base video" a third time. `server/compositor/CaptionCompiler.js` (new, CommonJS) compiles that program into `drawtext` filter strings, reusing `CompositorCompiler.buildPiecewiseExpr()` — the identical nested `if(lt(t,..))` shape already proven for overlay geometry and for `buildZoomKeyframeExpr()` in `exportProcessor.js` itself. Client decides WHAT; server decides HOW to spell it in FFmpeg syntax. Same split, same reason: R14/R16/R53/R56.

**THE MECHANISM, VERIFIED AGAINST A REAL ENCODER BEFORE BEING TRUSTED.** `drawtext`'s `fontsize=` and `alpha=` options accept per-frame expressions — confirmed by rendering actual frames and measuring the text bounding box grow/shrink and mean brightness ramp across a real animation, not by reading the FFmpeg docs and assuming. Separately confirmed that `text_w`/`text_h` re-derive from the CURRENT per-frame fontsize, which is what keeps `x='(w-text_w)/2'` correctly centred as a caption scales — verified by rendering a growing caption and confirming its horizontal centre stayed at the canvas centre rather than drifting. Both are exactly the kind of "compiles, runs, silently wrong" trap this codebase keeps finding at render time on a real export instead of in review (see R60's two bugs).

**WORD-BY-WORD REVEAL, WITHOUT FONT METRICS.** Rather than positioning each word individually (which would need per-word pixel widths — real font metrics this pipeline doesn't have), reveal compiles to N `drawtext` layers, each showing an increasing PREFIX of the caption text, gated with `enable=between(t,from,to)` to the window where that prefix count is current. All layers share one position/size/opacity expression set; only the visible substring and time window differ. Verified against real ffmpeg: the on-screen bright-pixel count late in a 4-word reveal is meaningfully higher than early, proving the prefix actually grows rather than the whole string appearing at once (or never).

**A REAL BUG FOUND WHILE TESTING, NOT WHILE WRITING.** The first cut gated word-reveal on `clip.words` being present AT ALL. That's wrong: `TextOverlay.jsx` only switches to per-word rendering (`needsWordRender`) when a genuine reveal-type animation is active or word-highlight colouring is on — real word TIMESTAMPS alone render as one flat static string in the live preview, same as always. The original code would have made EXPORT more animated than PREVIEW for any caption with real transcription timing and no explicit animation — the mirror image of the bug this whole module exists to fix, and just as much a divergence. Caught by §9 of the regression (which initially failed because a test clip with only `words` produced no program entry at all — the test's premise, not the code's gate, turned out to be checked against the wrong assumption first). Fixed by gating strictly on a `reveal`-type keyframe animation (e.g. the `word-reveal` preset) being present; real word timings are still preferred over the sampled fallback WHEN a reveal animation makes them relevant, exactly matching what `revealedWordCount()` already does for the preview.

**SCOPE, STATED PLAINLY RATHER THAN DISCOVERED LATER.**
- **textShadow**: only the entry with the LARGEST blur radius is rendered (one offset `drawtext` duplicate underneath). Multi-shadow "fake stroke" tricks (four offset copies — used by packs that ALSO set a real `clip.stroke`, which already renders via `borderw`) are intentionally not replicated; the real stroke covers that case.
- **Glow**: approximated as two extra outline-only `drawtext` passes (wide+faint, narrow+brighter) in the text's own colour — matching `MotionResolver.resolvedToCSS`'s `currentColor` convention — not a true Gaussian blur, which `drawtext` cannot do. Reads as a soft halo at caption sizes; stated as an approximation, not sold as pixel-parity with the DOM preview's `box-shadow` blur.
- **NOT shipped: per-word HIGHLIGHT colour** (the "currently-spoken word turns a different colour" effect). That needs per-word PIXEL positions within the line, which needs font metrics this pipeline has never had. Left for a follow-up rather than approximated badly — a caption using word-highlight still exports correctly, just without the colour change, exactly as it did before this entry.
- **Rotation is not animated** — `drawtext` has none. Same call R60's compositor made for overlays, for the identical reason.
- Two captions on DIFFERENT tracks that overlap in time, where one is static and the other animated, now draw in a different relative order than the old per-track/per-clip interleaving (animated always on top) — a narrow edge case, stated inline at the splice point in `exportProcessor.js` rather than left silent.

**THE NON-BREAKING GUARANTEE, MADE CHECKABLE.** A caption clip with no animation, no `textShadow`, and no uppercase transform produces NO program entry — `captionProgramIsNoOp()` mirrors `planIsNoOp()` exactly. Every project today has only plain captions (none of R58's animation surface was reachable before R61), so every existing project's captions take the EXACT untouched static-`drawtext` code path, byte-for-byte, same as before this entry. §2 of the regression is that guarantee. **FAILS OPEN** like the compositor and the LUT lookup (R55): a program that fails to build client-side, fails server-side validation, or throws during compilation results in `programClipIds` staying empty — every caption falls back to the plain static path rather than the export failing. `CAPTION_PROGRAM_DISABLED=1` is a deploy-free kill switch, matching `COMPOSITOR_DISABLED`.

**PLACEMENT: inside STEP 4, not a new step.** Covered clips are skipped by the existing per-clip static loop (`if (programClipIds.has(clip.id)) continue`) and the compiled program's filters are appended to the SAME `textFilters` array that loop already builds — one `-vf` chain, one `drawtext` invocation, exactly the mechanism STEP 4 already uses. No new ffmpeg pass, no new pipeline stage.

Regression: `scripts/test_caption_program.js` — 48 checks, most against a real ffmpeg binary (§7-10 decode actual rendered frames rather than matching filter strings), plus §11 confirming the wiring into `exportProcessor.js`/`IDELayout.jsx` the same way `test_compositor_export.js` §7 does for the compositor.

**R67 — Object Intelligence Integration: SAM2 speaker/background separation, and target-aware motion ("zoom/track/animate speaker", "blur background").**

Requested as "After SAM2: separate speaker → Speaker Layer + Background Layer → motion can target Speaker Only / Background Only", with four named examples (blur background, animate speaker, zoom speaker, track speaker). Audited before writing anything (dispatched research, presented as a fork, "Full SAM2 via Replicate, real masks" chosen): this codebase has zero GPU and no Python inference runtime in its DEPLOYED image (the real Dockerfile installs ffmpeg and fonts only — confirmed directly, not assumed), and zero masking/alpha-compositing primitive anywhere in either render path (`PlaybackEngine.js`'s WebGL shader is a single texture sampler — crop + colour-grade only; `jobs/exportProcessor.js` had never combined two video inputs). ADR-001 had already flagged SAM2 as Phase 8, "genuinely greenfield." A real SAM2 call therefore has to be a hosted API (Replicate) — there was no existing vendor relationship to piggyback on; `virtual_multicam`'s own face detection is local MediaPipe in `diarize-service`, not a paid vision API.

**THE ONE INSIGHT THAT SHAPED THE WHOLE BUILD: three of the four examples are camera-framing, and this codebase already has a complete, tested, preview+export framing pipeline for exactly that.** "Zoom speaker", "animate speaker", and "track speaker" all reduce to "move/scale the crop window" — and `clip.virtualCam = {cropX, cropY, cropW, cropH}` (R14/R16/R18) already renders correctly in the WebGL preview (`VideoPlayer.jsx`'s `setCrop` effect), the FFmpeg export (`exportProcessor.js`'s crop/zoompan block), AND the Revideo/Lambda scene. `client/src/motion/ObjectLayers.js` (new, pure, zero React/DOM/store deps — same discipline as every file in this directory) turns a SAM2-derived per-frame bounding-box track into `virtualCam`-shaped crop descriptors: `deriveSpeakerCrop` (one median-centered, padded static crop — "zoom"/"animate" speaker) and `deriveTrackingSegments` (splits the clip into re-centering pieces wherever the subject's bbox center drifts past a threshold, each with its own static crop — "track" speaker, the SAME piece-splitting shape `virtual_multicam` already uses for per-turn angle changes, chosen over a continuously-ANIMATED crop for the identical reason R64 ruled that out for camera-whip/shake: teaching zoompan's `x=`/`y=` pan window a per-frame expression is materially higher risk than reusing the existing static-crop-per-piece path). Net result: those three examples needed **zero new render code in either preview or export** — `useTimelineStore.js`'s new `zoomToSpeaker`/`trackSpeaker` actions just WRITE `clip.virtualCam`, and every existing consumer picks it up unchanged.

**"BLUR BACKGROUND" IS THE ONE GENUINELY NEW PRIMITIVE, AND IT'S SCOPED SEPARATELY.** Unlike the three framing cases, this needs real per-pixel alpha compositing — a SAM2 "highlighted" mask video's LUMA, not a bounding box. Two new, isolated code paths, chosen specifically NOT to touch the single highest-traffic shared code in either render pipeline:
- **Export** (`jobs/exportProcessor.js`'s new `renderBackgroundBlurSegment`): a genuinely separate two-input FFmpeg `complexFilter` (`boxblur` on the base + `alphamerge` with the mask + `overlay`), invoked as an alternate branch for exactly the clips with `layerTarget: 'background'` — every other clip's existing filter-chain code is byte-for-byte unchanged. Fails OPEN on error (falls through to the unblurred clip rather than aborting the whole export), matching this project's `compositorWarning`/`captionProgramWarning` precedent.
- **Preview** (`client/src/components/Player/ObjectLayerOverlay.jsx`, new): a plain Canvas2D overlay mounted as an ADDITIVE sibling of `VideoPlayer.jsx`'s WebGL `<canvas>`, not a change to `PlaybackEngine.js`'s shader. Since a decoded video frame has no real alpha channel, the luma-matte cutout needs actual pixel manipulation (`getImageData`/`putImageData` — write the source frame's RGB with the mask frame's luma as alpha), not a `destination-in` composite trick. Runs at half resolution (`PROCESS_SCALE`), CSS-scaled up — same "good enough live, exact at export" split this project already uses for waveforms/proxies.

**SCOPE, STATED PLAINLY.** Blur-background does not compose with `virtualCam` crop or zoom-rhythm keyframes on the same clip — `layerTarget` is currently a mutually-exclusive choice in the store (`zoomToSpeaker`/`setLayerTarget` both set it), so this hasn't come up; if it needs to, `ObjectLayerOverlay.jsx`/`renderBackgroundBlurSegment` are the two places to extend. `services/ReplicateSAM2Service.js`'s exact Replicate input param names (`REPLICATE_SAM2_MODEL`, default `zsxkib/sam2-video`) are the ONE place a model-specific assumption lives — stated in its own header as something to verify against the model's current schema before first real use, since this could not be verified against a live token in this session.

**THE PIPELINE.** `POST /api/vision/separate-speaker` (new `routes/objectIntelligenceRoutes.js`, same IDOR-checked `pathOwnedBy`/`resolveRequestUserId` pattern `interviewRoutes.js` uses) enqueues a BullMQ job on a new `object-segmentation` queue (`queue/queues.js`, `worker.js` — concurrency 2, I/O-bound like `analysisQueue`, not CPU-bound like `videoQueue`/`exportQueue`). `jobs/objectSegmentationProcessor.js` resolves a signed GCS URL for the source (Replicate needs a public URL — this hard-requires GCS, stated as an explicit error in local-storage dev mode), calls `services/ReplicateSAM2Service.js`, downloads the resulting mask video, and — rather than write any custom pixel-scanning code — runs FFmpeg's own `bbox` filter over it and parses the per-frame bounding boxes straight from its stderr output into the fraction-of-frame bboxTrack `ObjectLayers.js` consumes. `MediaExecutionEngine.js` gained four cases (`separate_speaker`/`zoom_speaker`/`track_speaker`/`blur_background`) in the same flat switch every other tool action lives in, plus a small `_findClipAndTrack` helper the four share. `layerMask`/`layerTarget` are two more optional clip fields — same persistence-contract discipline as `groupId` (R66) before them: present in BOTH `toLegacyTracks()`/`fromLegacyTracks()` in `TimelineStateManager.js`, or a separation silently vanishes on reload.

Regression: `scripts/test_object_layers.js` — 53 checks: `deriveSpeakerCrop`/`deriveTrackingSegments` against a synthetic bbox track (padding, bounds-clamping, threshold-based re-centering, short-segment merging), the persistence contract, and a wiring section per layer (backend service/job/route/queue/worker, store actions, the AI-tool switch, the export branch, the preview overlay mount) confirming every piece actually references what it should. Runs alongside the full existing suite — zero regressions across all eight motion-engine/export test files. NOT independently verifiable end-to-end in this pass: no live `REPLICATE_API_TOKEN` was available to exercise a real Replicate call — the backend integration is real, working code, gated behind a clear "not configured" error rather than a silent no-op, awaiting a token to test against actual SAM2 output.

**R68 — AI Animation Intelligence: `AnimationKnowledgeGraph.js`. "Brain chooses animations. Users don't."**

Requested with two example mappings (`reveal → [scaleReveal, blurReveal, cameraPush] + [riser, impact]`; `punchline → [captionPop, cameraShake]`) and one explicit design principle: the brain decides, not the user. Audited before writing anything, same discipline as R65/R67 — dispatched research, presented two forks via `AskUserQuestion`, both resolved to their recommended option: detection is **heuristic against existing signals, not an LLM call** (transcript wording, audio peaks, pacing/silence gaps — no new inference cost, no new latency); and the feature runs on an **explicit command, autonomously** ("animate this automatically" detects AND applies, zero further clicks, as ONE undoable action) — not automatic on every upload with no request, which would apply animations a user never asked for.

**THE AUDIT MATTERED: almost every piece this needed already existed, just never connected.** `server/audio-engine/types.js` already declared `TimelineEventType.REVEAL`/`PUNCHLINE_DETECTED`/`EMPHASIS_MOMENT`/`EMOTIONAL_BEAT` — four semantic events with real constants and zero emitters anywhere in the codebase. `server/audio-engine/search/TaxonomyService.js` already had `getSFXByIntents()`/`getSFXByEvent()`, live Supabase-backed SFX retrieval, unused by anything that could hand it a real event. `client/src/motion/ClipAdapter.js`'s `applyPresetToClip()` — the exact function the manual Motion tab already calls — was ready to apply any preset to any clip. What was missing, precisely, was the graph tying a semantic event to a real preset id and a real SFX intent, and the detector logic to ever emit one of the four events in the first place. This entry is those two things, nothing else.

**THE GRAPH — `server/audio-engine/timeline/AnimationKnowledgeGraph.js` (new, backend, pure data + 3 lookup functions).** Deliberately backend-owned rather than duplicated client-side: SFX resolution is Supabase-backed and can only run server-side, and putting the ONE mapping table in one place, in one language, means there is no risk of the client and server graphs silently drifting apart the way two independent implementations of one rule always eventually do in this codebase (R14/R16/R53/R56's root cause, cited again because it is the same shape of mistake). The request's illustrative camelCase ids (`scaleReveal`, `cameraPush`, `captionPop`, `cameraShake`) are translated to the REAL kebab-case `MotionPresets.js` ids (`scale-reveal`, `camera-push`, `camera-shake`) — `captionPop` maps to the plain `'pop'` text preset, applied specifically to a caption/text-kind clip rather than being its own preset. Each of the 4 entries carries two animation lists, `text` and `video`, because a "reveal" on a caption and a "reveal" on the base video clip are different preset FAMILIES (`MotionPresets.js`'s `PRESET_GROUPS` never share ids across kinds) even though they're the same semantic event — and real `EditingIntent` values (not the request's free-text `"riser"/"impact"` terms, which are preserved as `sfxTerms` for documentation/parity with `taxonomyMaps.js`'s NL-search vocabulary, but `TaxonomyService.getSFXByIntents()` needs the real enum).

**THE DETECTOR — 4 new heuristic emitters added to the existing `TimelineEventDetector.js`, not a new file.** Every heuristic runs against signals that detector already computes or that already exist on a clip — no LLM call, per the confirmed scope:
- **PUNCHLINE_DETECTED** — an audio peak landing within 1.2s after a `SILENCE_END` (the setup/pause/payoff shape of a joke), loud enough (`db ≥ -8`).
- **EMPHASIS_MOMENT** — a standalone loud peak (`db ≥ -4`) not already claimed by the punchline check above; the two never double-fire on the same peak.
- **REVEAL** — caption/text wording matching a reveal-keyword pattern ("here's", "introducing", "check this out", "unveil", etc.), OR a push-in bigger than the existing `ZOOM_IN` threshold (`zoom ≥ 1.3` vs `ZOOM_IN`'s `1.05`) — additive to the existing structural `ZOOM_IN` event, not a replacement for it.
- **EMOTIONAL_BEAT** — a real pause (`≥ 1.0s`, via the existing `SILENCE_START` gap) with nearby caption wording matching emotionally-coded keywords ("miss you", "thank you", "goodbye", "proud", etc.) — a pause alone, or wording alone, is not enough; both together is what reads as a beat rather than an ordinary edit gap.

All four thresholds live as named constants at the top of the file, next to the pre-existing `HARD_CUT_GAP_MS`/`SOFT_CUT_DURATION_MS`, and are stated as heuristics, not claimed as ground truth — a false negative here just means one fewer moment gets animated, never a wrong edit.

**THE ROUTE — `POST /api/audio/animate-automatically` (new, `server/routes/audioEngineRoutes.js`, mounted on the pre-existing `/api/audio` prefix, `authenticateUser`-gated like `/recommend`).** Detects, filters to the 4 semantic types, resolves each through the graph (picking the top-priority preset id for the clip's actual layer kind), and resolves SFX via `TaxonomyService.getSFXByIntents()` (memoised per event type within one request — several reveals in one project shouldn't requery Supabase identically). It DETECTS and RESOLVES only; it never writes to the timeline — matching this codebase's rule that every timeline mutation goes through the store's own history/undo path, not a server response applied blindly.

**THE APPLICATION — `animate_automatically`, one new case in `MediaExecutionEngine.js`'s flat switch, plus a new `client/src/agent/CommandRegistry.js` entry so it is reachable by name ("animate this automatically" / "auto animate" / etc.), following that registry's own documented 3-step process for adding a command.** Posts the current `store.tracks` as `projectState`, then applies the returned plan as ONE undoable action: `_saveHistory()` once up front, every `applyPresetToClip()` + `updateClip()` call and every SFX `addClip()` call passes `{skipHistory: true}` — the SAME fan-out shape `updateClip`'s `$ALL_CLIPS` branches and R65's `addMotionComponent` already use. SFX clips land on a found-or-created `'SFX'` audio track, ordinary clips through the ordinary `addClip` path — no new clip fields, no persistence-contract changes, because nothing here introduces a field `toLegacyTracks()`/`fromLegacyTracks()` don't already carry (`animations` since R58, plain audio-clip fields since day one).

**SCOPE, STATED PLAINLY.** Detection thresholds are heuristic constants tuned by inspection, not against a labelled dataset — they're conservative on purpose (a missed moment costs nothing; a wrong one costs an unwanted animation the user then has to undo). Only the TOP-ranked preset and TOP-ranked SFX result are applied per event — this is autonomous execution, not a picker, matching the confirmed "zero further clicks" scope; a future entry could resurface the graph's full ranked lists in a review UI without changing anything here. `addTrack()` has no skip-history option of its own (same pre-existing limitation R65's `addMotionComponent` already accepted) — the very first SFX event in a project with no prior `'SFX'` track costs 2 undo steps instead of 1; every event after that, in the same run, is free.

Regression: `scripts/test_animation_knowledge_graph.js` — 40 checks: the graph's shape and every preset id cross-checked against the REAL `MotionPresets.js` registry (§7 — a stale or typo'd id in the graph fails loudly instead of silently no-op'ing at runtime), all 4 heuristic emitters against synthetic tracks (fires when it should, stays silent on the near-miss cases — quiet peak, plain wording, modest zoom, too-short pause), and a wiring section for the route and the AI-tool switch. `scripts/test_command_registry.js` re-run clean (28 commands, zero vocabulary collisions) after adding the new entry. Runs alongside the full existing suite on the real device (not just this session's partial mirror) — zero regressions across every other test file; one pre-existing, unrelated failure (`test_caption_scope.js`, a direct-`updateClip` call in `TextOverlay.jsx` predating this entry) left untouched, out of scope. NOT independently build-verified: `npx vite build` could not run in this pass (the device-bridge sandbox's `node_modules` is missing `esbuild` with no network access to install it) — verified instead via `node --check` on every touched file (real syntax validation) and a real `require()` of the new route (resolves every new import path; the only error is the expected missing `SUPABASE_URL` at runtime, not a module-resolution failure).

**R69 — Render architecture split: FFmpeg owns cuts/audio/encoding/muxing/compression AND camera motion; the self-hosted (non-Lambda) Revideo `render-worker/` now actually draws captions/motion-graphics/stickers/lower-thirds onto the exported file, not just the live preview. Lambda kept dormant on purpose, as the future high-concurrency scaling path.**

Requested as a permanent split ("FFmpeg: cuts/audio/encoding/muxing/compression only. Revideo: captions/motion graphics/text/stickers/animations/lower thirds/graphics only."). Audited before writing anything: the split did NOT match reality. `jobs/exportProcessor.js` did everything itself — trim/concat/zoompan camera motion/colour grade/virtualCam crop (STEP 1-2), audio mix (STEP 3), drawtext captions (STEP 4) and the R59/R60 compositor for overlays (STEP 2.5) — while Revideo (`client/src/revideo/project.tsx`) was preview-only, never invoked during export. Two prior decisions explain the gap: R56 removed a "cinematic" Revideo/Lambda export path entirely; R63 explicitly chose to teach FFmpeg's own `drawtext` program animated captions rather than route through Revideo, for reliability and scope reasons. Also confirmed, contrary to an assumption worth stating because it changed the shape of the build: Revideo does not require AWS Lambda — it already shells out to FFmpeg internally for audio muxing onto its WebCodecs-rendered muted video, and Lambda is one of several deployment options for its *parallelized* renderer, not a hard dependency of `renderVideo()` itself.

**THE AUDIT FOUND A SERVICE THAT ALREADY EXISTED AND WAS NEVER WIRED IN — the same "built but never wired" shape as R61/R64.** `render-worker/` is a real, already-deployed (Fly.io, `vibed-render-worker`, `fly.toml`) self-hosted Express service that calls `@revideo/renderer`'s `renderVideo()` directly — no Lambda involved. It was running a STALE scene (`revideo/src/scenes/timeline.tsx`, old flat `clip.keyframes` format, no caption/sticker/lower-third support at all) and was not called from `jobs/exportProcessor.js` anywhere. A THIRD fork, `render-lambda/` (Lambda handler, GCS upload, base64 font-embedding via `FontInstaller`, removed from the live flow by R56) also still exists as dead code, plus a fourth independent scene fork at top-level `revideo/`. Confirming this required checking the real device directly, not the cloud mirror — mirror-only search reported `render-lambda/` didn't exist at all, which was wrong.

**THE CONFIRMED SPLIT, RESOLVED VIA ONE FOCUSED QUESTION (camera motion was the one genuine ambiguity): camera-motion presets (push/pull/zoom/shake, R64) STAY IN FFMPEG's existing zoompan path.** Revideo receives exactly ONE pre-cut, pre-graded, fully-audio-mixed `baseVideoUrl` — the literal output of `exportProcessor.js`'s existing STEP 1-3, completely unchanged — and draws ONLY 'text' tracks (captions/titles) and 'overlay' tracks (stickers/logos/lower-thirds/motion-graphic composites, image-sourced only — same scope limit R62 already accepted) on top of it, using the SAME pure `resolveMotionAt()` engine that already drives the DOM preview and R63's FFmpeg caption program.

**PORTED, NOT IMPORTED — a real build-context constraint, not a style choice.** `render-worker/Dockerfile` builds from `render-worker/` only (`COPY . .`); `client/src/motion/` is unreachable at that build root. `Easing.js`/`MotionSchema.js`/`MotionResolver.js`/`MotionPresets.js`/`CaptionModel.js` are duplicated verbatim (byte-identical below a documented sync-header) into `render-worker/revideo/src/motion/`, plus one new file, `RevideoLayerAdapter.js` — a trimmed port of `ClipAdapter.js`'s READ-side resolution logic only (`clipToLayer`/`inferKind`, the animation-source priority: `clip.animations` → legacy `clip.animation` string via `LEGACY_ANIMATION_MAP` → `captionStyle.animationPreset` → none). The rewritten `render-worker/revideo/src/scenes/timeline.tsx` renders exactly one `<Video>` node for `baseVideoUrl` (fails visibly, a red "NO BASE VIDEO" `<Txt>`, if the contract is ever violated), then per text/overlay clip drives a `<Txt>`/`<Img>` node's position/scale/rotation/opacity off `resolveMotionAt()` and word-timed caption reveal off `revealedWordCount()` — removing each node via `nodeRef().remove()` once its clip's duration ends (a real bug caught and fixed while writing the scene: without this, every past caption/sticker would stack on screen for the rest of the render instead of disappearing on schedule).

**OPT-IN, FAILS OPEN — the same shape as `COMPOSITOR_DISABLED`/R55's LUT fallback.** `REVIDEO_RENDER_ENABLED=1` + a configured `RENDER_WORKER_URL` + at least one real text/overlay track are all required before any of this runs; unset/0 is byte-identical to the pre-existing export, unconditionally. When active, STEP 2.5 (compositor) and STEP 4 (drawtext captions) are BOTH skipped — burning captions/overlays twice was the one failure mode to design out from the start — and a new STEP 3.5 uploads/serves the current `finalVideoPath` as `baseVideoUrl`, POSTs it plus the text/overlay tracks to the worker's `/render`, and on success replaces `finalVideoPath` with the result. On ANY failure (worker down, timeout, bad response) the whole call is caught, `revideoWarning` is surfaced on the job result exactly like `compositorWarning`/`captionWarning`/`captionProgramWarning` before it, and the export ships WITHOUT captions/graphics rather than falling back to STEP 4 — a deliberate choice, since a partial Revideo failure plus a STEP 4 retry risks the same double-burn the opt-in was designed to prevent.

**`render-lambda/` DELIBERATELY NOT TOUCHED — the user's own framing, not an oversight.** Requested explicitly as "keep the lambda one for when there will be a lot of users that want to export at the same moment" — the real tradeoff being fixed self-hosted capacity (8-10GB RAM/job, per Revideo's own docs) vs. Lambda's elastic auto-scaling, which this codebase already solves for FFmpeg via BullMQ concurrency caps and would apply the same way to a self-hosted Revideo step under load. `render-lambda/`'s scene and handler were NOT brought to parity with the new `render-worker` scene in this pass — they still reflect the pre-R69 format. Bringing them to parity is real future work, explicitly deferred until Lambda is actually activated for scale, not started speculatively here.

**SCOPE, STATED PLAINLY.** No per-word colour highlight of the actively-spoken word in the worker path yet (captions reveal word-by-word with real timing, but render as one flat colour — `CAPTION_STYLE_PACKS.wordHighlight` isn't applied here). No custom font embedding in the worker scene (unlike `render-lambda`'s base64 `FontInstaller`, this relies on the render container's system/browser font fallback for a named `fontFamily`). NOT independently verifiable end-to-end: this sandbox has no network/npm access to install `@revideo/renderer` + Puppeteer + Chromium and actually render a frame, so no real Revideo render was executed in this pass — every piece was verified statically instead (see regression below), and the `.tsx` scene file was not run through `tsc`.

Regression: `scripts/test_revideo_render_path.js` — 45 checks (50 after the follow-up below): the 5 ported motion files byte-match `client/src/motion/*.js` verbatim below their sync header (drift detection), `RevideoLayerAdapter`'s animation-source resolution priority via a CJS-strip-eval harness, the new scene's structure (single `<Video>` node, text/overlay handling only, no video/audio/virtualCam handling — camera motion stays in FFmpeg, node cleanup, percent→pixel conversion, word-timed reveal), `render-worker/server.js`'s updated `baseVideoUrl`-required contract, and `jobs/exportProcessor.js`'s opt-in wiring (STEP 2.5/STEP 4 mutual exclusion with Revideo, fails-open try/catch, `revideoWarning` surfaced, base-video upload/local-serve branches). Runs alongside the full existing suite on the real device — zero regressions; the one pre-existing `test_caption_scope.js` failure (predates this entry, see R68) is untouched. All touched `.js` files pass `node --check` on the real device.

**R69 FOLLOW-UP — the "not independently verifiable end-to-end" gap was closed, and it found two real deployment-blocking bugs before they hit production.** Asked directly to verify the one unverified piece. This sandbox turned out to have outbound network access after all (npm registry reachable), so rather than re-state the limitation, the actual render pipeline was built and run for real: `render-worker/`'s dependencies installed at their pinned `^0.10.4` versions, a synthetic base video generated with real ffmpeg, served over a local HTTP static server, and `renderVideo()` invoked directly (bypassing only `server.js`'s Express wrapper, not the renderer itself) with real text/overlay tracks through the actual ported scene.

**BUG 1 — `render-worker/server.js` passed `puppeteerLaunchArgs` (a top-level array), but `renderVideo()`'s real API (confirmed against `@revideo/renderer`'s own `.d.ts`, and by the array being silently ignored in a live run) takes `settings.puppeteer` (a real `PuppeteerLaunchOptions` object).** Every launch flag, including `--no-sandbox`, was never actually being applied to the browser Puppeteer launched — present since the file was first written, not introduced by this session's earlier changes to it. Fixed: `settings: { puppeteer: { executablePath, args } }`.

**BUG 2 — THE ONE THAT WOULD HAVE MADE EVERY REVIDEO RENDER FAIL IN PRODUCTION, REGARDLESS OF INPUT.** Debian's `chromium` apt package (what `render-worker/Dockerfile` installed) is an open-source Chromium build with NO H.264 support at all — confirmed directly: `canPlayType('video/mp4; codecs="avc1..."')` returns `""`, an H.264 `<Video>` element throws `MEDIA_ERR_SRC_NOT_SUPPORTED`/`DEMUXER_ERROR_NO_SUPPORTED_STREAMS`, and — the actual blocker, found only by pushing a render all the way through — Revideo's OWN internal muted-video output encoder (`@revideo/core`'s `WasmExporter`, via `mp4-wasm`'s WebCodecs wrapper) hardcodes `codec: "avc1.4d0034"` (H.264) with NO override surface anywhere in Revideo 0.10.4's public settings. That means EVERY render needs a browser with real H.264 WebCodecs ENCODE support for its OWN output — independent of `baseVideoUrl`'s format, so switching the base video to WebM/VP9 (tried first, and got further — proved the fallback ffmpeg-side frame-decode path exists and needs `decoder="ffmpeg"` set explicitly to pre-download, another real quirk found along the way) still hit the same wall at the output-encode stage: `"Failed to execute 'encode' on 'VideoEncoder': Cannot call 'encode' on a closed codec."` Fixed by installing real Google Chrome (proprietary codec license) in the Dockerfile instead of Debian's codec-stripped `chromium` package — same "trust the system binary, bypass puppeteer-core's version check" precedent the Dockerfile already used for Chromium, just pointed at a build that can actually encode. Also pinned `@revideo/ffmpeg`'s bundled static ffprobe (`@ffprobe-installer`, a johnvansickle.com static build) to the Dockerfile's system `ffmpeg`/`ffprobe` instead — the bundled one segfaulted on a network-URL input during testing, a real crash risk independent of the codec issue.

**WHAT WAS AND WASN'T PROVEN.** Proven, with a real render pushed through the actual pipeline in this sandbox: dependency install at pinned versions, the scene's imports/structure, the ffmpeg-decoder pre-download bridge, the vite/HMR bridge between the renderer and the scene, and — critically — that the ONLY remaining blocker was the browser's codec support, isolated precisely to the output `VideoEncoder.encode()` call. NOT provable in this sandbox: that Google Chrome, once installed, actually succeeds (this sandbox's network egress to `dl.google.com` is blocked, matching the earlier PostHog-telemetry block — both are expected artifacts of an allowlisted sandbox, not evidence about Fly.io's environment, which has ordinary internet access). The fix is the standard, widely-documented pattern for headless-Chrome codec support (the reason browser-automation images almost always install Chrome, not Chromium, when video is involved) — high confidence, not empirical proof. **Recommended before relying on this in production: one real render against the redeployed Fly.io worker**, which this session could not trigger (no Fly.io deploy access).

Regression additions: `scripts/test_revideo_render_path.js` §4/§4b — 5 new checks confirming `server.js` uses the real `settings.puppeteer`/`settings.ffmpeg` shape (not the old silently-ignored key) and `Dockerfile` installs `google-chrome-stable` (not `chromium`) with `PUPPETEER_EXECUTABLE_PATH` pointed at it. 50/50 passing; full existing suite re-run on the real device with zero new regressions (same one pre-existing, unrelated `test_caption_fonts.js`-in-the-partial-mirror artifact as before — not present on the real device).

**R70 — The Brain no longer gives a generic "standard" advisory while a proxy is still generating; the upload-status card explains WHY it's processing; `organize` is now where on-demand real analysis actually runs and is waited on.**

Reported directly: instead of a standard insight while files are proxying, the assistant should say what's actually happening (generating a proxy for smooth timeline editing/playback), then give a real insight once ready. Separately: real per-asset analysis should be something `organize` triggers and waits on, not just something read passively if it happens to already be done.

**AUDITED BEFORE BUILDING, per this codebase's own discipline — and the audit changed the plan.** Traced the real upload → advisory → organize path end to end: `IDELayout.jsx` already queues the heavy analysis (`POST /api/brain/analyze-asset` → BullMQ → `MediaIntelligencePipeline`: `AudioClassifier`+`VisualAnalyzer`+`ContentClassifier`, 10-30s GPT-vision work) the moment a file lands on GCS, in parallel with proxy encoding — confirmed this is genuinely the "real analysis." Two design questions went to the user via `AskUserQuestion` before writing code, since the first answer given was self-contradictory and worth re-asking cleanly rather than guessing: (1) should analysis stay triggered at upload as today, or move to organize-only — **answer: stays at upload, unchanged**; (2) should organize wait for the real pipeline on unprofiled clips, or keep its existing lighter fallback — **answer: run the real analysis, wait for it**. So this entry does NOT move the analysis trigger (upload keeps queuing it exactly as before) — it fixes WHEN the Brain talks about it, and makes organize genuinely consume the real pipeline for whatever it doesn't already have, rather than the two acting as separate systems that happened to overlap.

**THE ACTUAL BUG BEHIND "STANDARD INSIGHT WHILE PROXYING": `project_opened` doesn't know about uploads in flight.** `ReasoningPanel.jsx` fires two independent Brain triggers: `project_opened` (once per project, unconditionally, the instant `projectId` is set) and `asset_added` (correctly debounced to wait until every proxying asset has settled). If the user's first action after opening the editor is dropping a file, `project_opened` fires immediately — before the upload can possibly have landed — while the upload-status card is *already* showing a proxy in progress. Two contradictory signals in the same feed, one of them stale on arrival; this is what read as a "standard/generic insight" during proxying. Fix: `project_opened` now checks `assets.some(a => a.isProxying)` at fire time — if true, it still marks the ref (so `asset_added`'s gate, which requires `project_opened` to have run once, still opens) but skips the actual `analyzeProject()` call, deferring the project's first real advisory to `asset_added`, which was already correctly waiting. A project reopened with already-settled clips (nothing proxying) is unaffected — this only defers the truly-mid-upload case. `EditorialBrain.js`'s prompt itself was NOT changed: it already had the right instructions ("acknowledge what just landed... say what you'd do with them") and already receives `binReady`/`analyzedAssets` from `ContextEngine.js` (a prior R44 fix) — the bug was purely about *when* it got asked, not what it says once asked with real state.

**THE PROXY-PHASE MESSAGE ITSELF.** `UploadStatusCard` already showed a 3-step tracker (Uploading/Processing/Ready), just with opaque generic labels. Kept the short step-bar labels as-is (a longer string there breaks the compact 3-column layout), and added one explanatory line — `uploadProcessingDetail`, shown only while `uploadPhase === 'processing'` — stating plainly what's happening: generating a proxy so edits and timeline playback stay smooth. Added in both shipped locales (`en`, `fr`), matching this codebase's i18n convention (NODE 14: "Add a new page/route" pattern — copy always lands in both).

**ORGANIZE: the real pipeline, triggered and WAITED ON, not a second lighter system running in parallel.** `routes/interviewRoutes.js`'s `organize-clips` already preferred a stored profile and fell back to its own live ffmpeg-frame-extraction + inline vision-classify for anything unprofiled (R43) — a second, cruder analysis path that duplicated part of what `MediaIntelligencePipeline` already does. New step 1b: for any clip reaching organize with an `assetId` and a `gcsPath` but no completed profile, read its current `analysis_status` first (an asset already `'processing'` from the upload-time trigger is WAITED ON via polling, never re-triggered — re-calling `analyzeAsset()` on a row mid-analysis would race two writers against the same row), trigger the SAME `mediaIntel.analyzeAsset()` upload uses for anything not already in flight, then poll (1.5s interval, 45s bounded deadline) until every pending asset settles. Profiles are re-fetched and merged before the frame-extraction fallback runs, so anything that just got analysed this way skips ffmpeg/vision entirely — the fallback is now reserved for clips with no `assetId`/`gcsPath` at all, or where real analysis genuinely failed. The whole step is wrapped in one outer try/catch and fails open exactly like the fallback it sits in front of. Required threading `projectId` through from the client (`MediaExecutionEngine.js`'s `organize_clips` case) to the request body — it wasn't sent before, since nothing server-side needed it until now.

**SCOPE, STATED PLAINLY.** This makes `organize` noticeably slower the first time it hits unprofiled footage (real GPT-vision analysis, not a quick frame classify — up to the 45s poll ceiling per batch), by explicit design choice, not an oversight. `analyzeAsset()`'s own internal transcription step still only runs when `hasSpokenWord` is detected, unchanged. Not touched: the upload-time trigger itself, `EditorialBrain.js`'s prompt content, or the `edit_applied` advisory trigger — none of those needed to change once the actual bug (timing) was isolated.

Regression: `scripts/test_upload_insight_and_organize_analysis.js` — 18 checks: `project_opened`'s proxying guard and its still-marks-the-ref behavior, the processing-phase detail line's conditional render, both locales' new copy, `projectId` threaded through the client request, and the full organize-clips wiring (status-check-before-trigger, per-asset fails-open `.catch`, the bounded poll, profile re-fetch/merge, the outer fails-open try/catch). Runs alongside the full existing suite — zero new regressions (same two pre-existing, cloud-mirror-only artifacts as every prior entry: `test_caption_fonts.js`/`test_lut_export.js`, both confirmed absent on the real device).

**R74 — Answered "can the platform repurpose long videos, and can the brain tell `organize` how to organize based on story intelligence?" by fixing the three real gaps the audit found, instead of leaving them as findings.**

Follow-up to an audit-only investigation (explicit "no modification to do") that answered both questions with evidence: `organize` never consulted `StoryIntelligence` (confirmed by grep — it's only reachable from the advisory `/api/brain/analyze` route), and the long-form repurposing pipeline had two silent gaps — the step meant to extract standalone clips was analysis-only and discarded its own output, and the one animation step it scheduled compiled to nothing. All three are closed here.

**GAP 1 — `apply_smart_zoom` was scheduled by every long-form edit mode and executed by none of them.** `LongFormEditPlanner.js` emits an `apply_smart_zoom` step in `_cleanEditSteps`, `_youtubeOptimizedSteps`, and `_fullBuildSteps` alike, but `CommandCompiler.js`'s `COMMAND_MAP` had no entry for it — every occurrence fell through to `compileFallback` ("Unknown action: apply_smart_zoom"), a `VALIDATION_ERROR` that didn't stop the rest of the plan from compiling and executing, so the job still reported "✓ Long-form edit complete" with the one animation step silently missing. `MediaExecutionEngine.js` already had a real handler for this exact command (delegates to `VideoEditorTools.applySmartZoom()` → `ZoomAnalyzer.generateZoomEvents()`, both fully working) — the compiler just never emitted the command that would reach it. Fixed with a `compileApplySmartZoom` entry mirroring the existing `rhythm_zoom` pattern: a thin `ENGINE.STORE` descriptor, all the real async work stays in the execution engine where it already lived.

**GAP 2 — `identify_quotable_moments` identified moments and then threw them away.** Compiled as `skip(...)` — analysis-only, depositing a `quotable_moments_config` computed value that nothing downstream ever read (confirmed: no other reference to that key anywhere in the repo before this entry). The plan's own approval message promised "the best standalone clips for repurposing"; the pipeline never produced them. New `VideoEditorTools.identifyQuotableMoments()` is the actual consumer: re-derives the same candidate segments from `ContentAnalyzer`'s cached analysis (filtered by the planner's own `min_duration`/`max_duration`/`min_importance`/`max_results` thresholds, ranked by importance), finds each segment's covering base clip by source-time offset (the same convention `ZoomAnalyzer` already relies on for post-silence-removal timelines, since timeline position drifts from source position after edits), and lands each one on a new dedicated "Highlights" video track — independently movable, trimmable, and exportable — leaving the main edited timeline untouched. `CommandCompiler.compileIdentifyQuotableMoments` now emits a real `ENGINE.STORE` command (kept the computed-value stash too, for any future reader) instead of only `skip(...)`; `MediaExecutionEngine` delegates `identify_quotable_moments` alongside `apply_smart_zoom` in the same long-form-semantic-actions block; `VideoEditorTools.execute()`'s direct-dispatch switch gained the matching case.

**GAP 3 — Story Intelligence's findings never reached `organize`, even though `DirectorIntelligence` already had a proposal that named the right command.** `StoryIntelligence` (R51) fingerprints the assembled CUT and can only run on a sequence that already exists with real transcripts — structurally, it cannot be the input to organize's FIRST ordering pass on a raw, unordered bin. But `DirectorIntelligence.buildProposals()`'s `hook_buried` proposal pointed at `reorder_for_hook` — a command that has never existed, permanently demoting the single most valuable story finding to advice-only (see the module's own R52 rule: no proposal may claim `applicable: true` without a real command behind it). Rewired `hook_buried` to the real `organize_clips` command instead — it already does full semantic reordering, it just needed the hook location as a hint instead of running the same context-free pass twice. `through_line_buried` (already pointed at `organize_clips`) now carries its sag windows and through-line note the same way. Threaded `params.storyHints` through `CommandCompiler.compileOrganizeClips` → the emitted `organize_clips` command's `args` → `MediaExecutionEngine`'s `organize_clips` case → the `/api/interview/organize-clips` request body, so a caller that does construct a step with `storyHints` gets it carried through unmodified end to end (covered directly by the regression, not left as an assumption).

**BUT the click-to-accept UI path doesn't construct that step today — so the real delivery mechanism is server-side, not client-side.** `BrainPanel.jsx`'s `handleAcceptProposal` only ever resubmits `proposal.title` as plain chat text (`onSendCommand(title)`), which re-enters `IntentParser` from scratch and drops `proposal.params` entirely — a pre-existing gap in `BrainPanel`, not something introduced here, and out of scope to fix properly (would mean bypassing or extending the `WorkflowController` xstate pipeline, which only accepts a raw prompt string, no structured-intent injection point exists today). Rather than ship `params.storyHints` as something that looks wired but isn't reachable from the UI, `POST /api/interview/organize-clips` now reads the SAME stored `story_intelligence` row directly by `projectId` (`StoryIntelligence.getMap()` — already existed, a cheap indexed read, no GPT call) whenever the request doesn't supply `storyHints` explicitly. That means ANY call to organize — typed, clicked via "Accept" (still just resubmitting the title today), or a future direct-invoke caller — automatically benefits from the latest story reading without requiring new client plumbing, and an explicit `storyHints` in the request body still overrides it when a caller does supply one. When a stored map has a real finding (buried/weak hook, high-severity sags, or a through-line miss), its hook location, sag windows, and through-line note are folded into the existing GPT-4o ordering prompt as a new "STORY GUIDANCE" section; the response now also reports `storyGuidanceApplied` so this is externally observable rather than a silent internal branch. Never blocks or fails the organize call itself — the lookup is wrapped in its own try/catch and fails open exactly like the fallback paths around it.

**WHY NOT PROPERLY WIRE THE CLICK PATH TOO.** Considered making `handleAcceptProposal` compile-and-execute `proposal.command`+`params` directly (mirroring the `CommandCompiler.compile()` → `mediaExecutionEngine.execute()` pattern `VideoEditorTools.longFormEdit()` already uses), but that bypasses `WorkflowController`'s job-state tracking, progress UI, and history entries that every other command execution in this app goes through — a UI button silently taking a second, ungoverned execution path is a worse outcome than the server picking up the same data on its own. Left as a known, named gap rather than a rushed bypass.

Regression: `scripts/test_repurposing_and_story_organize.js` — 26 checks, run through real dynamic `import()` of `CommandCompiler.js` and `DirectorIntelligence.js` (both pure/synchronous ESM with no browser-only imports — `CommandCompiler.js` documents "NO imports of useTimelineStore" in its own header) rather than regex-matching source, so a change that silently breaks the compiled output fails this test instead of passing it. Covers: `apply_smart_zoom` registers and compiles to a real `STORE` command; a full CLEAN_EDIT-shaped plan (all six planner steps) compiles with zero errors; `identify_quotable_moments` emits a real command carrying the planner's thresholds through, not just a `skip`; existing compiler guards (empty plan, LOW-confidence gate) are untouched; `hook_buried` now resolves to `organize_clips` and is `applicable: true` where it was permanently advisory before; `isExecutable` independently confirms `reorder_for_hook` still doesn't exist (why the proposal had to change) and `organize_clips` does; both story-driven proposals carry their finding in `params.storyHints`; and that `storyHints` survives a full `compile()` pass unmodified when spread onto a step. Ran alongside the full existing suite on the real device (`test_intelligence_wiring_and_completeness.js` 35/35, `test_agent_fetch_lint_rule.js` 7/7) — zero regressions.

**R75 — LUTs are now a real AI-executable command (typed AND proactive Brain suggestion), not just a manual Colour-panel action. Closed three independent breaks in the same layer, matching the R74 "gap" pattern exactly.**

Follow-up to "are LUTs in the commands the AI can execute, or should they stay manual?" The answer required building the layer, not just describing it — `apply a lut` was reachable by NOTHING: not in `CommandRegistry` (the vocabulary's single source of truth), and even routed through `CommandCompiler` by hand it compiled to `ENGINE.STORE` action `'setProjectLUT'`, which `MediaExecutionEngine` had zero handling for anywhere — a silent no-op, discovered by grep returning nothing, not by a user bug report.

**GAP 1 — vocabulary collision + missing registration.** `'apply a lut'` lived inside `color_grade`'s phrases, so typing it ran the generic brightness/contrast/saturation adjuster instead of the real LUT library — the exact class of bug this registry exists to catch (see the original "crop" → "silence removal" regression `scripts/test_command_registry.js` pins). Removed it from `color_grade`, added three new commands: `apply_lut` (query + target params), `clear_lut` (target param), `recommend_luts` (limit param).

**GAP 2 — the compiled action didn't exist.** Both `compileApplyLUT`/`compileClearLUT` emitted `'setProjectLUT'`. Consolidated both to emit `'apply_lut'`/`'clear_lut'` — the actions `VideoEditorTools.execute()`'s switch and `MediaExecutionEngine`'s delegation block already handled for the MANUAL Colour-panel path — so there is now exactly one real implementation reachable from both the manual UI and the AI command path, instead of two that could silently drift apart. `VideoEditorTools.applyLUT({lutId, query, applyToAll})` now also resolves a bare mood/style query via `audioEngineAPI.searchLUTs()` when no `lutId` is given (a typed request only ever has a text description at compile time — `CommandCompiler` is pure/synchronous, so resolution has to happen at execution time, not compile time). `client/src/utils/lutGrading.js` extracts the `lutToGrading()` formula that used to live inline in `AssetPanel.jsx` into a shared util, imported by both the manual panel and `VideoEditorTools`, so the two paths use the identical warmth/contrast/saturation → CSS-filter/grading-object math.

**GAP 3 — even correctly wired, `extractParams` silently dropped the one thing that makes a LUT request useful.** Its `text`-type params (`query`, `style`) only ever read quoted text — `"apply a warm lut"` (no quotes, how anyone actually types) resolved to the right command with `query: undefined`, since nothing fell back to the unquoted words. Added a fallback: strip the matched command's own trigger words plus a stopword list from the prompt, use what's left. `"apply a warm cinematic lut"` → `query: "warm cinematic"`; `"apply a lut to all the clips"` → `target: "all"` with no query noise. This is a generic `extractParams` fix, not LUT-specific — `add_sfx`'s and `color_grade`'s `query`/`style` params get the same benefit.

**Per-clip manually-adjusted guard, honored by design, not bolted on.** Both `applyLUT`/`clearLUT` skip any clip whose `grading._manuallyAdjusted` is set unless `applyToAll` is explicitly requested — this flag and this exact convention already existed for the manual Colour panel; the AI path reuses it rather than inventing a second guard that could disagree with the first.

**CONTENT-AWARE RECOMMENDATIONS, per explicit answer ("upgrade to content-aware," not "keep format-only").** `RecommendationEngine.recommendLUTs()` previously only reasoned about platform/captions/aspect-ratio/duration/clip-count — two projects with identical format and opposite footage got identical suggestions. Now accepts `opts.tone` (ProjectIntelligence's derived project-level tone) and `opts.moodWords`, folds them into the query text alongside the existing intent words, and parses the result through `QueryParser`'s `LUT_KEYWORD_MAP` — the same mechanism the manual "moody lut" search box already uses. When that resolves a warmth/contrast hint, `getLUTsByProfile()` (an existing RPC that was never actually called from `recommendLUTs` before this) runs alongside the old intent-only `getLUTsByIntents()` lookup, deduplicated, with profile matches leading the ranking since they reflect what the footage IS rather than just its format. `POST /api/luts/recommend` now accepts `projectId` and, when present, fetches the project's stored `tone` via `ProjectIntelligence.getMap()` — mirroring R74's `storyHints` auto-fetch-by-`projectId` pattern exactly. This also fixed a second silent break found along the way: `compileRecommendLUTs`'s payload only ever contained `{ limit }` — no `projectState`, no `projectId` — so the route's `projectState is required` check meant every AI-triggered "recommend a lut" would 400. `MediaExecutionEngine.executeApiCall` now injects `store.projectId` specifically for the `/api/luts/recommend` endpoint, and the route accepts `projectId` alone (degrading gracefully to format-only signal when a full `projectState` isn't sent).

**THE ACCEPT-MECHANISM DESIGN, per explicit answer ("store the recommendation server-side, resubmit a phrase").** `DirectorIntelligence.buildProposals()` gained a `lut_suggestion` proposal: when `projectMap.tone` is set, it maps the tone (ProjectIntelligence's closed vocabulary — "educational"/"conversational"/"promotional"/"personal"/"dramatic" — none of which are literal `LUT_KEYWORD_MAP` keys) through a small `TONE_TO_LUT_MOOD` table to real keyword vocabulary ("clean corporate", "moody dark", etc.) and embeds those words DIRECTLY in the proposal's title (`"Apply a moody dark LUT"`), command `apply_lut`, `params.query` set to the same mood words. This is deliberately NOT a stored-LUT-id-plus-resolve-endpoint design: `BrainPanel.jsx`'s `handleAcceptProposal` (a pre-existing gap documented in R74, not fixed here — would mean bypassing `WorkflowController`'s job tracking) only ever resubmits `proposal.title` as plain text and drops `params` entirely. Since the mood words live IN the title, Accept re-enters through the exact same `CommandRegistry` → `apply_lut` → `searchLUTs` → `QueryParser` path a typed request would use, and resolves the same way every time (no separate stored-id-resolution mechanism to go stale against the LUT library). Verified directly: resubmitting `lutProp.title` through `resolveCommand()`/`extractParams()` reproduces `lutProp.params.query` exactly. No tone, or a future tone value not yet in `TONE_TO_LUT_MOOD`, produces no proposal — fail-open, not a garbage query.

**THE SYNC GOTCHA THAT ALMOST SHIPPED A DEAD FEATURE.** The LUT-parity work described above (Gaps 1–2, the manual/AI path consolidation) was implemented in a prior session segment and the summary going into this one described it as complete — but re-verifying against the live device before writing this entry found `CommandCompiler.js` still had the OLD `setProjectLUT`-emitting version, `VideoEditorTools.js` still had the OLD `applyLUT({lutId})`-only signature, and `client/src/utils/lutGrading.js` didn't exist on disk at all. The edits were real, on the cloud mirror — they had simply never been synced back via `device_commit_files`. Caught by re-running the regression suite against the device BEFORE writing this entry, not after: `test_lut_ai_commands.js` failed with the exact "requires lut_id" (old) error message instead of the new one, which is what surfaced the drift. Standing lesson, restated because it recurred: a prior turn's tool-success message describing a sync is not the same fact as the file being on disk — verify by reading the live device, not by trusting the last thing that was said about it.

Regression: `scripts/test_lut_ai_commands.js` — new, 44 checks, run through real dynamic `import()` of `CommandRegistry.js`, `CommandCompiler.js`, and `DirectorIntelligence.js` (staged into one temp dir so `DirectorIntelligence`'s relative import resolves) plus static source checks for `EditPlanner`/`MediaExecutionEngine`/`RecommendationEngine`/`lutRoutes` wiring that can't be exercised directly (browser-only `useTimelineStore` import, or a live Supabase connection this environment doesn't have). Pins all three original breaks as regressions: the `color_grade` collision, the dead `setProjectLUT` action, and the quoted-text-only `extractParams` gap. Covers resolution + param extraction (including the "all clips" selector words not leaking into the query), a full `CommandCompiler.compile()` pass for all three new commands, `EditPlanner` switch-case-to-field-name agreement with the compiler, `MediaExecutionEngine`'s handlers and the dead case's absence, the `lut_suggestion` proposal's full accept-flow round-trip, and static confirmation that `RecommendationEngine`/`lutRoutes` contain the content-aware code paths. Ran alongside `test_command_registry.js` (31 commands, 0 collisions) and `test_repurposing_and_story_organize.js` (26/26) on the real device — zero regressions.

**R73 — TD3 closed: a raw `fetch()` in `client/src/agent/` is now a lint error, not a hope. Follow-up decisions on the rest of the tech-debt list (TD2 skipped as dead code, TD5 kept as-is, TD6 left undecided).**

Follow-up to R72's tech-debt audit. Three decisions came back: anonymous sessions are dead code (new users always create an account before reaching the editor, so TD2's fix — while correct and left in place, since an unused empty table costs nothing — has no live bug behind it anymore), the ML virality model should stay wired for a future social-media integration (TD5 left untouched on purpose), and TD3 ("what difference would it make?") got explained and then greenlit.

**THE RULE, ENFORCED NOT DOCUMENTED.** `client/src/agent/EditPlanner.js`, `IntentParser.js`, and `AgentOrchestrator.js` each carry a "FIX: was fetch(...) without auth — 401 in production" comment — the same mistake, three separate times, because "always use `authFetch()`" was a convention enforced by nothing except someone remembering to grep for it. Added a `no-restricted-syntax` rule to `client/eslint.config.js`, scoped to `files: ['src/agent/**/*.{js,jsx}']`, flagging both bare `fetch(...)` and `window.fetch(...)`/`globalThis.fetch(...)`. The error message names `authFetch()` and points at the three files this already broke, so a developer hitting the lint error gets the fix, not just a prohibition.

Verified against the REAL rule, not the config source: tested with actual fixture files run through `npx eslint` on the live machine (confirmed the rule fires on bare `fetch()` and `window.fetch()`, does not fire on `authFetch()`, and does not fire on a raw `fetch()` outside `src/agent/`) before writing the permanent regression. First test attempt against the device silently passed with zero output — turned out to be testing the STALE on-device config, since editing the cloud mirror doesn't touch the real file until synced back; a reminder that "edited" and "verified" are different claims when working across the device bridge.

Regression: `scripts/test_agent_fetch_lint_rule.js` — 7 checks, run through ESLint's own Node API (`client`'s local `eslint` package, loading `client/eslint.config.js` exactly as `npx eslint` would) rather than regex-matching the config source, specifically so a config typo that silently no-ops the rule fails this test instead of passing it. Covers: bare `fetch()` rejected with an `authFetch()`-pointing message, `window.fetch()` also rejected, `authFetch()` itself never flagged, a raw `fetch()` outside `src/agent/` is untouched (scope is intentional, not accidental), and — the check that matters most for "does this actually protect anything" — every file currently shipped in `src/agent/` passes the rule today, so turning it on doesn't newly break the build.

TD5/TD6 not touched this entry: TD5 stays as-is per explicit instruction (the model will be wired when the social-media integration lands); TD6 (centralizing `DIARIZE_SERVICE_URL` access through `DiarizeService.js`) remains open, not yet authorized.


**R72 — Verified a stale tech-debt list item by item against the actual code before touching anything, then closed TD2: `anonymous_sessions` now genuinely persists across Railway restarts, not just in code that assumed a table which was never migrated.**

Handed a 7-item tech-debt list (TD1–TD7) and asked to check what was already fixed before changing anything. Checked each against the live repo rather than trusting the list's own descriptions, which mattered — several were already resolved, one was worse than described, and one (TD2) had application code that looked complete but was silently inert:

- **TD1 (client/server plan-limit mismatch) — already fixed.** `planLimits.js`'s `creator: Infinity` matches `usageGate.js`'s `creator: -1`.
- **TD2 (anonymous sessions lost on restart) — code existed, infrastructure didn't.** `sessionRoutes.js` already had Supabase-primary logic (`dbAvailable()` gates every read/write), but no migration for `anonymous_sessions` existed anywhere in the repo. On a real deployment, `dbAvailable()`'s probe query fails (relation does not exist), caches to `false` for the life of the process, and the code silently runs memory-only forever — the exact bug the ticket described, just one layer deeper than "the Supabase path isn't primary": the Supabase path was never reachable at all.
- **TD3 (fragile `authFetch` convention) — the specific bug is fixed, the fragility is real.** No raw `fetch()` remains in `client/src/agent/`, but nothing enforces it stays that way.
- **TD4 (`previewQuality` reactivity) — already fixed.** Already in the `useShallow` selector in `SettingsPanel.jsx`.
- **TD5 (ML training artifacts in repo) — partially fixed, and the ticket's own premise was wrong.** `.dockerignore` now excludes `ML_Dataset/`/`ML_Models/`, but `services/ViralityModelService.js` DOES load `ML_Models/virality_predictor/model.json` at runtime (fails open — `predict()` returns `null` if missing — but the dockerignore fix means it will now always be missing in a deployed container). Flagged, not touched — this needs a product decision (keep the model or wire it into the deploy), not a code fix.
- **TD6 (undocumented diarize-service integration) — documentation fixed, centralization isn't.** A `Dockerfile` and a full API-contract `README.md` now exist for `diarize-service/`, and `services/DiarizeService.js` is a well-commented client — but `services/ClipAnalysisService.js` and a block in `routes/interviewRoutes.js` (~line 1813) both read `DIARIZE_SERVICE_URL` directly and build their own calls, independent of `DiarizeService.js`. A URL change still touches three files.
- **TD7 (bad enum references in `starterLUTs.js`) — already fixed.** Checked every `EditingIntent.*`/`EmotionTag.*` reference against `server/audio-engine/types.js`; all resolve to real keys now (`EmotionTag.DARK`, `EmotionTag.NOSTALGIC`, `EditingIntent.ROMANCE`).

**TD2 CLOSED END TO END.** Added `supabase/migrations/20240008_anonymous_sessions.sql` (table + `expires_at` index + `ENABLE ROW LEVEL SECURITY` with zero policies — this table has no authenticated owner at row-creation time, since a session predates the account it may later attach to, so there's no `user_id = auth.uid()` policy to write; the backend talks to it exclusively via `supabaseAdmin`/service_role, same pattern as `20240002_asset_engine.sql`'s backend-only tables). Rewrote `sessionRoutes.js`'s header, which previously embedded the `CREATE TABLE` inline as something to "run once" — a second copy of a schema the migration now owns, the exact drift hazard `20240004_media_assets.sql`'s own header warns about — to point at the migration file instead and describe storage accurately (Supabase primary, in-memory fallback only when the table isn't reachable).

Applied the migration to the live Supabase project via the Supabase MCP connection (user chose "Viral Pilot Database" — confirmed correct by cross-checking its existing migration history against this repo's `supabase/migrations/*_media_assets.sql`/`*_project_intelligence.sql`/etc., which matched by name). Verified end-to-end, not just "the migration ran without error": ran `SELECT id FROM anonymous_sessions LIMIT 1` directly against the live database — the exact query `dbAvailable()` runs — and confirmed it succeeds with no error, meaning the Supabase-primary path is now genuinely live, not just theoretically correct.

Regression: `scripts/test_anonymous_sessions_persistence.js` — 16 checks: the migration's table shape (columns, `NOT NULL` on `expires_at`, `ON DELETE SET NULL` on `user_id`), the index, RLS enabled with no policies, `sessionRoutes.js`'s schema now living in exactly one place, and confirmation the Supabase-primary application code (`dbAvailable()`/`sessionGet()`/`sessionCreate()`/`sessionMigrate()`) is unchanged and intact — this entry only supplied the missing infrastructure, it did not touch the logic that was already correct.

TD1/TD3/TD4/TD5/TD6/TD7 not modified this entry — reported, not yet authorized to fix (TD5 and TD6 in particular need a scope decision, not just a patch).


**R71 — Audited the rest of the "intelligence" stack (`ProjectIntelligence`, `StoryIntelligence`, `DirectorIntelligence`, `Orchestrator`, `UserProfileEngine`, `PatternLearner`, `PipelineAdapter`, `Session`, `PlatformKnowledge`) and re-audited `MediaIntelligencePipeline` for completeness. Fixed what was found: DirectorIntelligence's proposals are now actually wired to the UI, and the media pipeline's three gaps (truncated sampling, all-or-nothing bin gate, no crash recovery) are closed.**

Asked directly: "what about the other intelligences created?" — extending R70's media-completeness audit to everything else under `server/brain/` plus the client-side `DirectorIntelligence.js`.

**THE HEADLINE FINDING: `ProjectIntelligence` and `StoryIntelligence` computed real answers that nothing ever read.** `brainRoutes.js`'s `/api/brain/analyze` route derives `projectMap` (one GPT-4o call) and `storyMap` (a second GPT-4o call) on every advisory trigger where the fingerprint has changed — real cost, correctly gated, well-designed (both files clamp to closed vocabularies, drop hallucinated ids, record failures rather than swallowing them; no completeness bugs found in either). But the route only ever returned `{ response, nextSuggestions }` to the client — the two maps were computed, fed into the Brain's own prose via `ContextEngine`/`EditorialBrain`, and then discarded. `DirectorIntelligence.js` (`client/src/agent/DirectorIntelligence.js`) exists specifically to turn those two maps into ranked, verified-executable proposals — every proposal is checked against `CommandRegistry` before it's allowed to claim `applicable: true`, demoting anything without a real handler to an observation instead (the docblock cites the *specific* prior failure this guards against: the pre-existing `CreativeDirector.js` emitted 14 operations, 12 of which resolved to nothing). It was never imported anywhere. The repo's own comment in `MotionPanel.jsx` already named this — "DirectorIntelligence — the module written to fix R52, itself unwired" — so the gap was tracked, just not closed.

**FIX — wired end to end.** `/api/brain/analyze` now returns `projectMap`/`storyMap` alongside `response`/`nextSuggestions`. Fixing this exposed a second, previously undetected bug in the same code path: `useBrain.js`'s `analyzeProject()` — the only caller of that route — was rebuilding `lastResponse.response` from just `data.response?.message` and `data.nextSuggestions`, silently dropping `data.response.insight` and `data.response.warnings` on every single advisory call (`project_opened`/`asset_added`/`edit_applied` all go through it). `BrainPanel.jsx`'s `InsightCard` and `WarningBanner` therefore never had anything to render regardless of what the Brain actually returned. Fixed by spreading the full `data.response` through instead of hand-picking two fields, and adding `projectMap`/`storyMap` alongside it. `ReasoningPanel.jsx` now calls `buildProposals({ storyMap, projectMap })` — pure, synchronous, no extra model call — when pushing the Brain's advisory card, and attaches the result as `directorProposals`. `BrainPanel.jsx` renders an "Editorial findings" section ahead of the existing suggestion chips: applicable proposals behave like a suggestion chip (tap resubmits the human-readable title through the standard pipeline — same "prefer text over machine keys" reasoning the existing chips already used); advisory ones render the same card but non-clickable, with an explicit "Observation — not an applicable action" label, honoring the exact distinction `buildProposals()` computes. Proposal ids are folded into the existing de-dupe key so a re-analysis that only changes the maps (not the message text) still surfaces as a fresh card, and a stable per-finding id is why proposal feedback is *not* piped into `PatternLearner`'s `permanently_hidden` — ids like `sag_42` are one-off, not a stable type worth accumulating.

**MEDIA PIPELINE — the three gaps from the R70 completeness audit, closed.** (1) `VisualAnalyzer.analyze()` always received `duration = null` from `MediaIntelligencePipeline`, so `extractFrames()`'s fallback (`duration || 10`) sampled every clip at the same ~1s/5s/9s regardless of real length — a 10-minute interview and a 10-second clip got identical frames. `VisualAnalyzer` now probes the real duration via `fluent-ffmpeg`'s `ffprobe` (same `@ffprobe-installer/ffprobe` pattern already used in `AudioExportService.js`/`exportProcessor.js`) when the caller doesn't have one, falling back to the old fixed window only if ffprobe itself fails. (2) `ContentClassifier`'s bin classification required `assets.every(status === DONE)` — one asset stuck at `'processing'` forever (a crashed worker) silently blocked classification for the *entire project*, with no way out. Gate changed to "nothing still in flight, and at least one asset actually succeeded" (`DONE` or `FAILED` both count as resolved), and the check is now also run from `analyzeAsset()`'s failure paths (previously only called after a *successful* analysis, so a project whose last unresolved asset ended in failure never got re-checked at all). (3) Nothing recovered a row stuck at `'processing'` if the whole worker process died mid-job — `getAssetAnalysisQueue()` has no `defaultJobOptions` (confirmed in R70), so there was zero automatic retry, and the classification gate above depended on `'processing'` eventually resolving. Added a periodic stale-processing sweep (`server/brain/media/MediaIntelligencePipeline.js`, module-level, `setInterval(...).unref()` — same shape as `Session.js`'s existing TTL sweep) that flips any asset stuck at `'processing'` past 15 minutes to `'failed'` (recorded, not dropped — the R38/R40 empty-vs-broken distinction again) and re-checks the classification gate for every project it touches. Required `_updateAssetStatus()` to actually start writing `updated_at` — the column existed (`20240004_media_assets.sql`) but nothing had ever written it on an `.update()`, only Postgres's insert-time `DEFAULT now()`, so there was no signal to measure staleness against.

**PIPELINE ADAPTER — a smaller, honesty-only-plus-context fix, scoped deliberately narrow.** `PipelineAdapter.js`'s header claimed "this adapter uses the backend's chatAgentHandler logic directly" and destructured `{ chatAgentHandler: _unused, ...controller }` from `controllers/aiAgentController` — but `controller` was never referenced again anywhere in the file. It runs its own independent GPT-4o call against a hardcoded, separately-maintained 18-action system prompt, with no compile-time link to the real controller's action list — a real drift hazard if that list changes. A full refactor to route through the actual controller is a larger, riskier change and was explicitly left out of scope; what was fixed: removed the dead import, corrected the header to describe what the file actually does, and enriched the context sent to its fallback model — it previously sent only `timeline`/`duration`/`platform`/`clipCount`, so this fallback path (used whenever a resolved command needs the existing pipeline) had no idea whether captions or a music track already existed or what had already been done to the project, and could re-propose or duplicate completed work. Now also sends `hasCaptions`, `hasMusicTrack`, a trimmed `mediaBin`, and the last 15 `editHistory` entries — all fields the caller (`Orchestrator._executeViaExistingPipeline`) already had on `projectContext`, just never read.

**EVERYTHING ELSE AUDITED, NO ISSUES FOUND.** `Orchestrator.js` — single minor dead-code item (`this.mediaIntel = new MediaIntelligencePipeline()` instantiated, never used elsewhere in the file); left as-is, not selected for this pass. `UserProfileEngine.js`/`PatternLearner.js` — fail-open throughout, no completeness gates since these are heuristic/DB-log-based rather than analysis pipelines. `Session.js` — clean in-memory TTL store; its sweep pattern is what R71's media-pipeline sweep above copies. `PlatformKnowledge.js` — static data plus pure evaluation functions.

Regression: `scripts/test_intelligence_wiring_and_completeness.js` — 35 checks across all seven touched files (the `/analyze` response shape, `useBrain.js`'s preserved `insight`/`warnings` and carried maps, `ReasoningPanel.jsx`'s `buildProposals()` call and de-dupe key, `BrainPanel.jsx`'s applicable/advisory rendering split, `VisualAnalyzer.js`'s ffprobe duration probe, `MediaIntelligencePipeline.js`'s `updated_at` writes / sweep / loosened gate / re-check call sites, `PipelineAdapter.js`'s dead-import removal and enriched context). Runs alongside `scripts/test_upload_insight_and_organize_analysis.js` (R70) — 18/18 still passing, zero regressions from the `MediaIntelligencePipeline`/`interviewRoutes.js` overlap between the two.


**R66 — Real clip grouping. Closes R65's explicitly stated scope limit: a LowerThird's background bar now actually moves with its text.**

Requested directly, right after R65 shipped with a documented gap: 4 of the 9 Motion Graphics Components (LowerThird/Callout/QuoteCard/CTAWidget) are a background graphic plus text, added as independent clips because this codebase had no clip-grouping model at all — confirmed by that entry's own pre-build audit (`useTimelineStore.js` had `addClip`/`addOverlayClip`, nothing that moves/deletes/duplicates two clips as one unit).

**THE MODEL: `groupId` is one more optional clip field, not a new entity.** `client/src/motion/ClipGrouping.js` (new, pure — same discipline as every other file in this directory) defines a group as nothing but N clips, possibly on different tracks, sharing the same `clip.groupId` string. Deliberately NOT a new top-level "group" entity — for the identical reason `MotionLayer` is a VIEW over a clip rather than its own entity type (`ClipAdapter.js`'s header): a new entity bucket needs every track/clip consumer in the app repointed before it does anything, this codebase's most-repeated failure mode (eight-plus prior instances). `groupId` rides along exactly like `animations`/`words`/`captionStyle` before it (R58) — including the SAME persistence-contract obligation: it now appears in BOTH `toLegacyTracks()` and `fromLegacyTracks()` in `TimelineStateManager.js`, or a group would silently fall apart into independent clips on the very next project reload. (Confirmed this bug pattern is real, not theoretical, by writing §6 of the regression BEFORE fixing a bug in the regression's own text-search logic — see below.)

**FOUR PURE FUNCTIONS, ONE THIN STORE INTEGRATION.** `clipsInGroup(tracks, groupId)` flattens across every track. `computeGroupMoveUpdates(tracks, groupId, {deltaStart, deltaX, deltaY})` — every member moves by the SAME delta FROM ITS OWN current position (not from a shared assumed baseline), so a bar at `y:88` and a title at `y:87` both shift correctly without either drifting relative to the other. `computeGroupDuplicateSpecs` preserves every member's relative start offset and stamps a brand-new groupId on the copies — a duplicated group is a real, independent group; dragging the copy must never move the original. `useTimelineStore.js` gained three thin actions (`moveClipGroup`/`duplicateClipGroup`/`removeClipGroup`) that call these and dispatch the results, exactly mirroring how `addMotionComponent` already wraps `ComponentLibrary` — client computes WHAT, store executes it. `ComponentLibrary.buildComponent()` now runs every result through `assignGroupId()` before returning: any component whose placements exceed one clip is a real group from the moment it's created; the 5 single-clip components are untouched (`assignGroupId` is a no-op below 2 placements).

**A REAL BUG, AVOIDED BY READING BEFORE WRITING.** `removeClipGroup` deliberately does NOT loop the store's existing `removeClip()` — that method has its own fan-out: passing a clipId that happens to be inside the user's CURRENT multi-selection deletes every selected clip, not just the one passed. Looping it per group member could have silently swept in whatever else was selected at the time. Found by reading `removeClip`'s body before reusing it (this codebase's own `vibed-codegen` skill's Zustand checklist prompted the read), not by writing the bug and catching it later — `removeClipGroup` dispatches the same underlying `TimelineActions.removePlacement` primitive directly instead, replicating the "clean up now-empty tracks" step so a group delete behaves exactly like an ordinary delete, just for N clips at once.

**ON-CANVAS DRAG: SYMMETRIC, BUT TEXT'S HALF IS ADDITIVE-ONLY.** `GraphicOverlay.jsx` (renders the 'overlay' track — a LowerThird's bar) and `TextOverlay.jsx` (renders the 'text' track — its title) each snapshot every group member's OWN starting x/y once at gesture-start (the same "capture initial, then add delta" shape the existing single-clip drag already used, immune to the same stale-closure trap), then apply the identical percent delta to every member as the pointer moves. `TextOverlay.jsx` needed more care: text clips already drive their position through `applyCaptionUpdate` (a caption-specific global/individual scope fan-out with a `liveOnly` mid-gesture optimization, committed once on pointer-up) — completely UNCHANGED for the dragged clip itself. Grouped siblings (the bar) are moved by an ADDITIONAL, separate `updateClip` call, since a bar is not a caption and has no scope of its own. Pinch-to-scale deliberately does not fan out to the group — stated, not silently narrower than it looks: scaling a bar+text pair together isn't a single well-defined operation the way "move together" is.

Regression: `scripts/test_clip_grouping.js` — 45 checks across the 4 pure functions, `ComponentLibrary` integration (composite components are real groups, single-clip ones aren't, two separate component calls never collide on a groupId), the `toLegacyTracks`/`fromLegacyTracks` persistence contract, and wiring into the store/AI-tool switch/both drag components. Two real bugs found and fixed WHILE WRITING the regression, not after: an assertion that assumed both group members started at the same `y` (they didn't, by the test's own deliberately-different setup — the delta was correct, the assertion's expected value wasn't), and a substring-search bug in the persistence-contract check itself (an unrelated EARLIER comment in `TimelineStateManager.js` happens to say "fromLegacyTracks()" by name, so slicing from index 0 truncated the search window before it ever reached the real method). Runs alongside the full existing suite — 483 checks total across all seven motion-engine test files, zero regressions, zero server-side changes (this entire feature is client-only).

**R65 — Motion Graphics Components: 9 named, preset-driven building blocks (AnimatedText/Image/Sticker/Emoji/Arrow, LowerThird, Callout, QuoteCard, CTAWidget), wired all the way to a callable AI-tool action.**

Requested as a component library meant to become AI-tool-callable — the exact example given was `{"component": "CTAWidget", "preset": "subscribe"}`. Audited what existed before writing any code (see the fork presented to and confirmed by the user beforehand): no formal AI tool-schema registry exists (`MediaExecutionEngine.executeStoreAction` is a flat `switch(action)` over ~25 inline cases plus 9 delegated to a `VideoEditorTools.js` this local checkout doesn't contain); no built-in icon/shape/emoji asset library exists anywhere (`DraggableAsset.jsx`'s "add as overlay" button is gated to `asset.type === 'image'` specifically because only user uploads have ever been composited); no background-box-behind-text primitive exists (the only "box" in `CaptionModel.js` is a per-WORD karaoke highlight chip, not a bar behind a whole text block); no clip-grouping model exists at all (`useTimelineStore.js` has `addClip`/`addOverlayClip`, nothing that moves/deletes two clips as one unit); and `LAYER_KINDS.SHAPE` has been a stub with zero renderer since R58.

**THE FORK, AND WHY "PAIRED CLIPS" WON.** 4 of the 9 components (LowerThird/Callout/QuoteCard/CTAWidget) are actually a background graphic PLUS text — sometimes plus a second text line. With no grouping model, three options existed: ship them as two ordinary, INDEPENDENT clips added together (fast, zero new data model, but not a single draggable/movable unit); build real clip-grouping first (`groupId` across the store/`ClipAdapter`/`GraphicOverlay`/`Compositor`/export — correct long-term, substantially more surface); or defer the 4 composites to a follow-up and ship only the 5 simple components now. Presented plainly via the same fork-before-building pattern this project has used for every large-scope decision (R62's track-type scope, R63's Revideo-vs-additive-pipeline scope) — "ship as paired clips" was chosen. **Consequence, stated where the code lives, not left implicit:** moving a LowerThird's background bar does not move its title with it yet. Real grouping is future work this entry does not attempt.

**HOW THE GRAPHICS GOT MADE WITHOUT A NEW RENDERER.** Rather than build the missing SVG/canvas shape system, or a new asset-upload code path, this generates 5 small PNGs (`scripts/gen_motion_assets.py`, via Pillow: an arrow, two translucent bars, a quotation-mark glyph, a subscribe badge) and commits them to `client/public/motion-assets/`, referenced by ordinary relative URL. This is the SAME "commit real files, serve them statically" precedent this codebase already uses for its 44 bundled font TTFs (ADR-001 Phase 5) — not a new pattern. They flow through the *already-shipped* R62 sticker/overlay pipeline completely unchanged: same `GraphicOverlay.jsx` DOM preview, same `Compositor.js` plan, same `exportProcessor.js` STEP 2.5 compositing. **PNG, not SVG, on purpose** — SVG decoding needs a librsvg-enabled ffmpeg build, which the deployed binary is not guaranteed to have; PNG has zero such dependency, and §5 of the regression proves a real ffmpeg binary actually decodes and composites one rather than assuming any image format "just works." `AnimatedArrow` needed only ONE graphic (drawn pointing right) because direction reuses the ALREADY-ANIMATABLE `rotation` property instead of four pre-rotated assets — up/down/left/right are 270/90/180/0 degrees on the same file.

**THE ENGINE ITSELF NEEDED ZERO NEW CODE.** `client/src/motion/ComponentLibrary.js` (new, pure — no React/DOM/store deps, same discipline as every other file in this directory) is a thin catalogue: each component's preset resolves to a real `MotionPresets.js` id, animated via `applyPresetToClip` — the literal same function `MotionPanel`'s UI already calls. A component is not a new animation system; it is a named bundle of (graphic or text content) + (an existing preset) + (a visual style knob like bar colour). `buildComponent(componentId, presetId, params)` returns PLACEMENT DESCRIPTORS, never touching the store — same client-decides-WHAT split as `Compositor.js`/`CaptionCompiler.js`, for the same reason: pure functions are unit-testable without a store or a DOM.

**THE AI-TOOL WIRING.** `useTimelineStore.addMotionComponent(componentId, presetId, params)` is the (small, separate) integration layer: it finds-or-creates the needed track(s) at most once per call (memoised, not re-queried per placement), calls the existing `addClip` for each placement, and wraps the whole thing in ONE history entry in the common case — `_saveHistory()` once up front, every `addClip` call passes `skipHistory: true`, the exact fan-out shape `updateClip`'s `$ALL_CLIPS` case and `applyColorGrade` already use. (`addTrack()` has no skip-history option of its own and always saves one — a component whose track doesn't exist yet costs 2 undo steps the first time, not a new compromise, the same one `addOverlayClip`'s own comment already accepts.) `MediaExecutionEngine.executeStoreAction` gained exactly ONE new case — `addMotionComponent` — in the SAME flat switch every other tool action lives in, taking `{component, preset, params}` directly off `args`, matching the feature's own requested shape (`component`/`preset` reserved and top-level so they can never collide with a component's own content fields, which all live under `params`).

**SCOPE, STATED PLAINLY.** AnimatedImage/AnimatedSticker require a caller-supplied `params.url` — there is still no built-in photo/sticker library, only the graphics this entry shipped for the other 7. AnimatedEmoji needed no new asset work at all: an emoji is just a glyph, so it renders as an ordinary big TEXT clip and rides the system/browser emoji font, exactly like any other text content. Composite components are paired, ungrouped clips (see above). Each component's `preset` catalogue is intentionally small (2-4 named looks) rather than exhaustively parameterised — matching the feature's own example (`preset: "subscribe"`, a curated look, not free-form styling).

Regression: `scripts/test_motion_components.js` — 61 checks: all 9 components' placement shapes and required-param error cases, the 5 shipped PNGs are real/decodable/non-trivial and every preset's `graphicKey` resolves to a real shipped file, a real-ffmpeg decode+composite+pixel-diff proof (§5), and a wiring section confirming the store action and the AI-tool switch case. Runs alongside the full existing suite (438 checks total across all six motion-engine test files) with zero regressions.

**R64 — Camera motion presets, applied to a clip on the BASE video/image track, now actually move something. Tenth instance of the "built but never wired" pattern, found by directly auditing whether the motion engine and its presets were "fully built."**

Asked point-blank whether the animation system and motion presets were fully built. They were reachable — `MotionPanel.jsx` (R61) resolves the active clip from ANY track, including the base video track, and offers the `'camera'` preset group (`camera-push`/`camera-pull`/`camera-zoom`/`camera-whip`/`camera-shake` — `MotionPresets.js`) whenever a plain `type: 'video'` clip is selected. Applying one writes `clip.animations` via `applyPresetToClip`, same as every other kind. But nothing downstream ever read that field for a base-track clip: `client/src/revideo/project.tsx` (the live preview) evaluates video/image transforms off `clip.keyframes` via its own local `evaluateKF`, a completely separate system from `clip.animations`/`resolveMotionAt`; and `grep -n "clip.animations" jobs/exportProcessor.js` returned zero matches — STEP 2's concat/zoom path only ever read `clip.keyframes.scale`. A camera preset applied to the main footage had zero visible effect anywhere, silently — confirmed by reading both render paths directly rather than assuming from the UI being present.

**PREVIEW: `resolveMotionAt` now drives `project.tsx`'s video AND image branches, additively.** A `motionLayer` (`clipToMotionLayer(clip, track)`) is only built when `clip.animations` is non-empty — every other clip takes the exact `evaluateKF` path unchanged, zero added cost. The one real wrinkle: `MotionSchema`'s `x`/`y` default to 50 (percent-of-frame, the convention every OTHER layer kind — text, captions, overlays — already uses) while `project.tsx`'s own `clip.x`/`clip.y` default to 0 (pixels, canvas-centred) — a base-value mismatch that predates this entry and is out of scope to fully reconcile here. Rather than assume which convention a given clip's base position is actually in, `motionOffsets()` measures only the DELTA an animation contributed (`resolved.x - motionLayer.x`), converts that delta to pixels (`/100 * canvasWidth`), and adds it on top of whatever pixel position the clip already had. Scale/rotation/opacity have no such mismatch (their bases already agree with `clip.scale`/`clip.rotation`/`clip.opacity`) and resolve directly.

**EXPORT: reuses the existing zoompan path instead of teaching the server a second scale-animation format.** `jobs/exportProcessor.js` already knows how to animate a piecewise `z=` zoompan expression from `clip.keyframes.scale` (`buildZoomKeyframeExpr` — the same mechanism a hand-authored zoom rhythm from `KeyframeEditor` already uses). The new `client/src/motion/CameraMotionCompiler.js` samples `resolveMotionAt` across a clip's own local duration (0..duration, matching zoompan's clip-local `it` variable exactly — NOT the output-time mapping `CaptionCompiler.js` uses, since that's a different axis), reduces the curve via the existing `Compositor.simplifySamples`, and derives an EQUIVALENT `keyframes.scale` array. `IDELayout.jsx`'s `handleFfmpegExport` calls `applyCameraMotionToBaseTrack(tracks, plan?.base?.trackId)` — reusing the SAME base-track id the composition plan already selected, not re-deriving it a third time — and ships the derived (cloned, never mutated) tracks array in place of the raw store tracks. A clip that already has its own hand-authored `clip.keyframes.scale` is left completely alone; the derivation only fills a gap that had nothing.

**SCOPE, STATED PLAINLY.** Scale-type presets only (`camera-push`/`camera-pull`/`camera-zoom`). Translate-type presets (`camera-whip`, `camera-shake`) animate correctly in the live preview but do NOT reach the export — teaching zoompan's `x=`/`y=` pan window a matching expression is a materially bigger, higher-risk change (zoompan's pan coordinates already caused the R16 multicam-crop bug), and these are short (≤0.6s) preview-grade "juice" rather than something users are likely to expect burned into the file. Stated in `CameraMotionCompiler.js`'s header rather than left silent.

**VERIFIED WITH REAL FFMPEG, AND A REAL BUG IN THE VERIFICATION ITSELF.** The first cut rendered the derived zoompan expression over a flat `color=` source and diffed two frames — which passed even when it was fed a deliberately broken no-op expression, because a solid colour looks pixel-identical no matter how tight the crop. Switched to `smptebars` (spatially textured but NOT time-varying, unlike `testsrc`, which would have passed even for a permanently-static `z=1` expression by animating on its own) — isolates exactly the one variable under test: does the crop window change over time. Same verification discipline as R60's/R63's ffmpeg checks: proven by decoding actual frames, not by matching filter-graph strings.

Regression: `scripts/test_camera_motion.js` — 34 checks: derivation edge cases (no animation / translate-only / zero-duration / pre-existing hand-authored rhythm all correctly produce nothing), a real `camera-push` curve's shape and point-count reduction, `applyCameraMotionToBaseTrack`'s by-reference pass-through for every non-base track, two real-ffmpeg sections (§6-7), and a wiring section (§8) mirroring `test_caption_program.js` §11's pattern — but against `IDELayout.jsx` and `project.tsx`, not any server file: this entry touches no server code at all, by design (see "reuses the existing zoompan path" above).

**R62 — The 'overlay' graphics track: stickers/logos now have a real track type, a real UI entry point, and a real export path. Closes R60's "sticker/shape still have a model and no source" limit for image-based overlays.**
Prompted by a request to add "Motion / Caption / Graphics / Overlay" tracks per a 4-track proposal. Scoped down to ONE new track type after auditing what the 4-track version would actually cost: `track.type` is hardcoded to `'video' | 'audio' | 'text'` in ~15 call sites across `useTimelineStore.js`, and captions already live inside `'text'` tracks via `LAYER_KINDS.CAPTION` (R58) — splitting them into a real `'caption'` track would mean migrating every saved project's timeline JSON for a distinction the engine already makes at the CLIP level. "Motion" is even less a track's worth of content: `clip.animations` already works on any existing video/text clip today. Only the graphics case (stickers, logos, lower thirds, arrows, emojis, shapes) had **no home at all** — `ClipAdapter.inferKind()` has anticipated `'sticker'`/`'shape'` clip types since R58 and never had a track to put them on. That gap is what this entry closes.

**HOW MUCH OF THIS ALREADY EXISTED.** Turned out to be most of it. `TimelineStateManager`'s `toLegacyTracks()`/`fromLegacyTracks()` project `clip.type`/`x`/`y`/`scale`/`animations` generically — an `'overlay'` track needed ZERO changes there. `addTrack(type)` already takes an arbitrary type string. `Compositor.js`'s plan-building already treats "any additional visual track beyond the base" as an overlay. The actual gaps were narrow: no track TYPE existed, no UI could create one, and the compositor's `VISUAL_TRACK_TYPES` set didn't include it.

**A REAL BUG FOUND WHILE WIRING IT: base-track selection by array position.** `Compositor.js` picked the base track as `visual[0]` after sorting by `track.order`. But `addTrack()` assigns `order` PER TYPE — "lowest order among tracks of my own type" — so the first video track and the first overlay track can both land on `order: 0`. Sorting by `order` alone would then pick the base based on which track happened to iterate first out of the entities object, which is exactly the kind of silent, data-dependent bug this module was built to eliminate (see R59/R60's own citation of R14/R16/R53/R56). Fixed two ways, deliberately redundant: (1) `sortedVisualTracks()` now sorts by a `VISUAL_TYPE_PRIORITY` (video/image=0, overlay=1) before `order`, so overlay tracks always sort after every video/image track regardless of numeric ties; (2) `buildCompositionPlan()` no longer takes `visual[0]` as the base — it does `visual.find(t => t.type === 'video' || t.type === 'image')`, so the base is chosen by TYPE, not position, even if (1) were ever weakened by a future edit. §8 of `scripts/test_compositor.js` pins both the collision case and that swapping the two tracks' array order doesn't change which one becomes base.

**THE THREE WIRES:**
1. **Data model.** `useTimelineStore.addOverlayClip(asset, opts)` — finds or creates the (singular) `'overlay'` track and adds a clip via the existing generic `addTrack`/`addClip`, no bespoke persistence path. Default position is upper-right-third (`x:78, y:18`), matching where most editors default a freshly-dropped watermark/logo rather than dead centre over the subject. `TimelineSchema.getSortedLayers`'s `TYPE_ORDER` gained an explicit `'overlay': 2` bucket (between video and audio) — leaving it unlisted would have dropped it into the shared "unknown type" bucket (99), sorted arbitrarily against anything else that lands there. `ClipAdapter.inferKind()` gained an explicit `'overlay' → LAYER_KINDS.IMAGE` fallback for a clip that doesn't set its own `clip.type`, so it can't be misread as TEXT (which would run caption/word-highlight logic against a sticker).
2. **UI entry point.** `DraggableAsset.jsx` — image assets get a second hover button (top-left, next to the existing top-right delete button) calling `addOverlayClip(asset)`. Gated to `asset.type === 'image'` because that's exactly what the compositor can actually source (see limits below) — offering it for video/audio assets would create clips the export path can't composite.
3. **Preview.** `client/src/components/Player/GraphicOverlay.jsx` (new) — modeled directly on `TextOverlay.jsx`: reads active clips off `'overlay'` tracks, resolves position/scale/rotation/opacity/blur through the SAME `resolveMotionAt()` every other layer type uses, renders an `<img>`, supports drag-to-move and pinch/handle-to-scale via `updateClip`. Mounted in `IDELayout.jsx` alongside `<TextOverlay />`. `'overlay'` tracks are excluded from the Revideo player's `playerVariables` for the identical reason `'text'` tracks already are — documented inline at the exact filter line — otherwise a sticker triple-renders (Revideo canvas + `GraphicOverlay` DOM + compositor export pass) and every drag reloads the Revideo scene.
4. **Export.** `Compositor.js`'s `VISUAL_TRACK_TYPES` gained `'overlay'`; `handleFfmpegExport` in `IDELayout.jsx` already passes the FULL unfiltered `tracks` array into `buildCompositionPlan()` (confirmed by reading it — this call was never scoped to `nonTextTracks`), so overlay clips flow into the existing R60 FFmpeg overlay pass with no export-path changes at all. This is the part R59/R60 already solved that the caption engine, per the immediately preceding conversation turn, has NOT: stickers/logos added this way genuinely reach the exported MP4, because they go through the compositor rather than a separate static burn-in pass that ignores motion fields.

**KNOWN LIMITS, STATED PLAINLY RATHER THAN DISCOVERED LATER.**
- **Only image-sourced graphics work end-to-end** (stickers, logos, photos used as watermarks) — anything with a real file URL. Lower thirds, arrows, and emoji-as-vector-shape do NOT work yet: `CompositorCompiler.js` requires `clip.proxyUrl || clip.url || clip.sourceUrl` to build an FFmpeg input, and there is no rasterizer that turns a shape/vector definition into an image file. `LAYER_KINDS.SHAPE` still has a model (from R58) and no renderer, same as R60 left it. Building that renderer (client-side canvas/SVG → PNG, or a server-side draw pass) is the natural next increment, not a silent gap.
- **One overlay track only**, by convention of `addOverlayClip` (finds-or-creates a single `'overlay'` track) — the compositor itself supports multiple visual tracks and would z-order additional overlay tracks correctly if the UI ever created more than one; nothing blocks that later.
- **No drag-and-drop onto the timeline for overlays** — only the DraggableAsset button. The existing dnd-kit drop-target logic (which infers target track from `asset.type`) was deliberately left untouched rather than extended, to avoid risking the video/audio drop paths it already handles correctly.
Regression: §8 of `scripts/test_compositor.js` (7 checks: base-track-by-type, order-collision safety, order-independence, overlay-only edge case) and §11 of `scripts/test_motion_engine.js` (12 checks: every wire above has a real caller, not just source that compiles). 186 + 58 = 244 checks total across the two files, up from 174 + 51.

**R60 — The compositor, part 2: overlays now reach the exported MP4. Added ALONGSIDE the existing pipeline, not in place of it.**
`server/compositor/CompositorCompiler.js` (pure string-builder, CommonJS) turns a composition plan into a `filter_complex`; STEP 2.5 of `jobs/exportProcessor.js` executes it. Layered graphics — stickers, logos, lower thirds, picture-in-picture — now composite in the export for the first time.

**THREE GUARDS, ALL OF WHICH MUST PASS BEFORE ONE FILTER RUNS.** (1) the client sent a `compositionPlan`; (2) it validates server-side; (3) it has ≥1 overlay. A project with a single video track — i.e. every project that renders correctly today — produces `planIsNoOp() === true`, the client sends `null`, and STEP 2.5 is skipped entirely: the export is byte-for-byte what it was before. `COMPOSITOR_DISABLED=1` is a deploy-free kill switch. **FAILS OPEN** like the LUT lookup (R55): any error leaves `finalVideoPath` at the un-composited video and the export continues, with `compositorWarning` returned so a video missing its graphics is never silently shipped as correct. An overlay whose source can't be fetched is DROPPED, not fatal — one dead sticker URL must not cost the whole export.

**PLAN GEOMETRY IS NORMALISED (0..1), NOT PIXELS.** Changed from R59's pixel geometry once the client turned out not to know the export resolution — the platform/resolution preset tables live in `exportProcessor.js`. The options were to mirror those tables client-side (a second list to keep in sync — the exact shape of R57's font bug) or make the plan resolution-independent. The compiler multiplies by the render size in ONE place, so a single plan exports correctly at 720p and 4K. Aspect still matters (a height fraction is derived from a width fraction using the authoring aspect), so the worker refuses an aspect mismatch while accepting any resolution.

**PLACEMENT: after concat (STEP 2), before the audio mix (STEP 3).** Earlier would composite per-segment; later would clobber the mixed audio, since the overlay pass re-encodes video and copies audio. The regression asserts that ordering.

**TWO BUGS THE TESTS CAUGHT THAT REVIEW WOULD NOT HAVE.**
1. **The sample simplifier flattened every animation.** The naive form — drop a sample sitting on the line between its two neighbours — is wrong for a smooth curve: every point of a finely-sampled arc is nearly collinear with its immediate neighbours, so they are discarded one after another and the curve collapses to its endpoints. A "float" or "pop" would have exported perfectly STATIC while the preview animated correctly — the exact preview/export divergence this module exists to prevent, reintroduced by an off-by-one in a helper. Replaced with Douglas–Peucker (deviation measured from the chord between RETAINED anchors). Pinned by an amplitude assertion, not a sample count.
2. **The gating test's assertion was wrong, not the code.** Byte-comparing whole PNG frames to ask "is the overlay gone?" fails because the composited video is re-encoded and inter-frame history diverges after the overlay appears. The pixels were provably correct (grey → red → grey); the bytes were not equal. Now samples the average colour of the region the plan says the overlay occupies — derived from the plan, so it follows the geometry maths instead of silently testing empty space.

**VERIFIED BY RUNNING FFMPEG, not by matching strings** — `enable=`, `setpts` time-shifting, `scale=eval=frame` for animated size, and alpha `fade` were each confirmed against a real encoder before being used. §5 decodes real frames to prove the overlay is ABSENT outside its window; an overlay that renders but never disappears looks fine in a thumbnail and is wrong everywhere else.
KNOWN LIMITS: rotation is static (v1) — `rotate` resizes its own output box and would fight the plan's geometry. Overlays are video/image only; `sticker`/`shape` still have a model and no source. The compositor adds one full video re-encode. [UPDATE — R62: `sticker` now has a real source, track, and UI entry point for IMAGE-based overlays. `shape` still has a model and no renderer/source — see R62's own KNOWN LIMITS.]
Regression: `scripts/test_compositor_export.js` — 51 checks (compile + real FFmpeg), alongside `scripts/test_compositor.js` — 51 checks (plan model).

**R59 — The compositor, part 1: the composition PLAN (`client/src/motion/Compositor.js`). Model only — the FFmpeg overlay pass is NOT built yet.**
`jobs/exportProcessor.js` flattens every clip from every video track into one array sorted by start time, so two clips overlapping in time on different tracks are **serialised, not layered**, and an image clip becomes its own full-frame segment instead of an overlay. That — not a missing layer *type* — is why stickers, logos, lower thirds and PiP are impossible. Adding `"sticker"` to an enum moves nothing until something can draw two things at once.

**THE ARCHITECTURE: the plan is computed ONCE, on the client, and shipped to the worker.** `buildCompositionPlan(tracks, {width,height,fps})` returns a versioned, JSON-serialisable description of what is drawn, where, in what z-order, and at what OUTPUT time. It travels in the export settings exactly as `projectLUTId` does (R55). The worker EXECUTES the plan; it does not re-derive it. This is deliberate and is the whole point: the alternative — client composites for preview, worker composites independently for export — is the precise shape of R14 (crop in one path only), R16 (two zooms needing multiplicative combination in both places), R53 (preview fit vs export fit) and R56 (an entire second renderer that silently disagreed). Four incidents, one root cause: two implementations of one visual rule. A plan computed once cannot disagree with itself.

**THE NON-BREAKING GUARANTEE, MADE CHECKABLE.** The FIRST video track is the BASE and is segmented/concatenated exactly as today — untouched. Only *additional* video/image tracks become overlays. So a single-video-track project yields `overlays: []`, `planIsNoOp()` returns true, and the export runs byte-for-byte as before; a multi-video-track project was already rendering wrongly, so there is no correct behaviour being changed. §1 of the regression is that guarantee — if it ever goes red, this stopped being additive.

**OUTPUT TIME IS NOT TIMELINE TIME — the trap.** The output concatenates base segments back-to-back with gaps removed and speed applied, so a graphic at timeline 11s may belong at output 5s. `exportProcessor` already has `vibedToOutputTime()` for captions for exactly this reason; overlays need the same remap, and `buildTimeMap()`/`timelineToOutputTime()` own it so a second, drifting copy never appears. Get this wrong and it fails the worst possible way: everything renders, nothing errors, and every graphic is silently on the wrong shot. §3 pins it.
Coordinates: `x`/`y` are PERCENT naming the element's CENTRE (the TextOverlay convention), converted to a TOP-LEFT pixel coordinate here because that is what FFmpeg's `overlay` wants. Dropping that centring term is what once pushed captions off the frame edge. Static overlays collapse to ONE geometry sample (compiles to a plain `overlay=x=N:y=M`); animated ones emit piecewise-linear samples, matching the existing `buildZoomKeyframeExpr()` pattern rather than inventing a new one.

**STILL TO DO — this is half the compositor.** The worker side does not exist: `exportProcessor.js` neither receives nor executes a plan, so overlays still do not reach an exported file. Remaining: (1) the client sends the plan in export settings; (2) `exportProcessor` builds a `filter_complex` from it — one input per overlay, `scale`/`format`/`rotate` per layer, then a chain of `overlay=...:enable='between(t,start,end)'` in zIndex order, applied after concat and before/with the caption pass; (3) it must **fail open** — `validateCompositionPlan()` failing should render WITHOUT overlays rather than failing the export, the same rule the LUT lookup uses. Until (1)-(3) land, `Compositor.js` is model-only and nothing composites in an exported MP4.
Regression: `scripts/test_compositor.js` — 47 checks.

**R58 — The Motion Graphics engine (`client/src/motion/`). Built as an ADAPTER over the existing timeline, deliberately not a replacement for it.**
A unified layer + animation + caption model: `MotionSchema` (layer/animation/keyframe types), `Easing` (12 functions), `MotionResolver` (the pure evaluator), `MotionPresets` (26 keyframe-generating presets), `CaptionModel` (word-level captions + 8 named style packs), `ClipAdapter` (the bridge). ~1,400 lines, zero React/DOM/store/cross-module imports — the purity is asserted by the regression, not just intended.

**THE CENTRAL DESIGN DECISION: a MotionLayer is a VIEW over a clip, not a new entity.**
The obvious implementation — a `motionLayers` bucket in the normalized entity store — would have rendered *nothing*. The normalized store is write-only in practice: every mutation dispatches into it, but every component reads `toLegacyTracks()` output, and a grep for `entities.` outside `client/src/timeline/` returns zero hits. A new entity type would therefore have been complete, correct, and invisible — the ninth instance of this codebase's defining failure (R33, R37, `/api/brain/organize`, R46, R52, R55, R55c, and `DirectorIntelligence`, which was written to fix R52 and is itself unwired). `ClipAdapter.clipToMotionLayer()` reads an ordinary clip; `motionLayerToClipUpdates()` writes ordinary clip fields back through `updateClip`. The engine is live the moment one component calls it, and nothing that already read clips changed.

**WHAT IS ACTUALLY WIRED** (the point of §7 of the regression):
1. `groupWordsIntoCaptions` (`MediaExecutionEngine.js`) now delegates to `CaptionModel.groupWordsIntoSegments`, which returns the same `{text,start,end}` **plus** `words`. That one function was the single place per-word timings died — three providers produce them (AssemblyAI, Whisper `verbose_json`, WhisperX), they survive into `state.captions`, and then the old body did `group.map(x => x.word).join(' ')` and dropped the array. Per-word highlighting never needed "adding word-level timing"; it needed to stop throwing it away.
2. `addCaptionClips` carries `cap.words` onto each caption clip.
3. `TextOverlay.jsx` — the ONLY mounted text renderer — resolves position/scale/rotation/opacity/blur/glow through `resolveMotionAt()` and renders per-word highlight from real timings.

**ANIMATION IS NOW A FUNCTION OF TIME, NOT A CSS EVENT.** The old path injected `@keyframes vibed-fade-in|slide-up|pop` and fired them on mount, which is why the element needed a `key={id-animation}` remount hack to replay at all. CSS animations run on WALL CLOCK from mount: scrub to the middle of a 0.35s entrance and you saw it finished, not half-played. The resolver is driven by timeline time, so scrubbing shows the true state — the only correct model for an editor. Those keyframes and `getAnimationStyle()` were DELETED, not left dormant; two systems both claiming to animate one element is worse than either alone. `LEGACY_ANIMATION_MAP` maps the five old `clip.animation` strings onto presets so pre-R58 projects keep animating with no migration.

**PERSISTENCE — AND A PRE-EXISTING BUG FOUND WHILE DOING IT.** `animations`, `words` and `captionStyle` were added to BOTH `toLegacyTracks()` and `fromLegacyTracks()`. Those two hand-maintained field lists are the real schema of this app; a field in one but not the other silently vanishes on reload. **`animation` was in exactly that broken state** — projected out, never read back — so every text animation has been resetting to `undefined` on every project reload, invisibly. Fixed here. The regression asserts round-tripping for all four.

**WHAT IS DELIBERATELY NOT DONE.** The export still burns static `drawtext`: no animation, no per-word highlight, no reveal. So motion is PREVIEW-ONLY today, which is the same preview/export divergence R14/R16/R53 document — the difference is that the resolver is a pure function both sides can call, so closing it is a matter of calling it rather than reimplementing it. `sticker` and `shape` layer kinds have a model and no renderer (the export flattens all video-track clips into one array and serialises them — there is no compositor yet, which is the real blocker for stickers/logos/lower-thirds). Phases 6/8/10 of the proposal — Revideo server rendering, SAM2, the permanent FFmpeg/Revideo split — are NOT started and conflict with R56; see `ADR-001` in the project docs.
Regression: `scripts/test_motion_engine.js` — 149 checks, incl. §7 "is it actually wired" and §8 "nothing that worked was changed".

**R57 — Caption fonts never rendered in the browser. All 36 `.ttf` files sat right there and NOTHING ever declared an `@font-face` for them.**
User-reported: captions always render in the browser's default font, regardless of which of the 36 fonts is picked in `TextPanel.jsx`. Root cause was NOT a missing asset — `client/public/fonts/` has had all 36 files (plus 3 more) since the font-bundling fix that produced `FONT_SPECS`/`verify-fonts.js`/the Dockerfile's `fc-cache` step. It was that `client/src/index.css` only ever declared `@font-face` for the app's OWN UI chrome — Geist, Instrument Serif, JetBrains Mono — never for any caption font. So `fontFamily: FONT_MAP[clip.fontFamily]` (`TextOverlay.jsx:323`, e.g. `'"Anton", sans-serif'`) and `fontFamily={clip.fontFamily}` (the Revideo scene that's actually mounted, `client/src/revideo/project.tsx:272`) both asked the browser for a family it had never loaded, and silently fell through to the CSS fallback — every caption, every font, every time, in both places text is drawn on screen.
**THE EXPORT WAS NEVER BROKEN.** `jobs/exportProcessor.js`'s `drawtext` reads these same `.ttf` files directly by filesystem path via `FONT_SPECS` — no `@font-face`, no browser involved. This was a preview-only bug. But the preview is the only place a user ever judges whether a font looks right, so it read as "captions fonts are broken," full stop.
Fixed by adding one `@font-face` per `FONT_SPECS` entry to `client/src/index.css`, pointing at the exact same `/fonts/*.ttf` paths the export already resolves. Weights mirror `FONT_SPECS` exactly (`Montserrat` is @800 — it only ships as `Montserrat-Bold.ttf` — and `Barlow Condensed` is @700; every other family is @400) — **keep both in sync**, the same warning `render-lambda/fonts/fontRegistry.ts` already carries about the same list. `font-style: normal` throughout; none of the 36 files has a separate italic/bold cut besides those two, so a caption's bold/italic toggles fall back to the browser's synthesized faux-bold/faux-italic, same as before this fix.
NOT FIXED, LEFT ALONE: `FONT_MAP` (`TextOverlay.jsx`) has five extra alias keys — `Playfair`/`Handwriting` correctly point at families that DO have a face now (`Playfair Display`/`Dancing Script`); `Roboto`/`Lato`/`Outfit` do not and still have none. None of the 10 `CAPTION_STYLES` packs (`ReasoningPanel.jsx:503-563`) or the 36-font `TextPanel.jsx` picker ever sets `fontFamily` to any of those three, so they're unreachable through any current UI path — not part of the reported bug. `Roboto-Regular.ttf` does exist on disk if that one is ever wired up; `Lato`/`Outfit` would need new font files sourced first.
Regression: `scripts/test_caption_fonts.js` — parses `FONT_SPECS` out of `exportProcessor.js` and asserts every entry has a matching `@font-face` in `index.css`, with the same file and the same weight. Fails the way R57 failed if the two lists ever drift apart again.

**R55 — The LUT reaches the EXPORT now. `LUTExportIntegration` was built and called by nothing — the sixth instance of that pattern.**
`projectLUTId` was written to the timeline store and read by no render path, so selecting a colour grade changed no pixel anywhere. The reason was not missing capability: `server/lut-engine/library/LUTExportIntegration.js` has always known how to fetch a `.cube` from storage and return the `lut3d` filter string, and `LUTService.buildFFmpegFilter()` has always emitted it. Nothing called either. Sixth dead-entry-point after R33's LUT import, R37's UserStylePage, `POST /api/brain/organize`, R46's `/account`, and R52's CreativeDirector — and notably the SECOND time the LUT feature specifically has turned out to be "fully built, no caller".
TWO WIRES, both of which had to exist for a single pixel to change:
1. `IDELayout.handleFfmpegExport` now reads `projectLUTId` from the store and sends it in `settings`. Without this the worker never learns a grade was chosen.
2. `exportProcessor` resolves it ONCE per job (it downloads a file; the grade is project-level, not per-clip) and pushes the filter into each clip's chain.
**APPLIED LAST, DELIBERATELY.** The filter is appended after rotation correction, crop, zoompan and scale/pad. Grading before the scale would tint the letterbox bars `buildScaleFilter` adds — the bars are generated content, not footage. The regression asserts the push sits immediately before `cmd.videoFilters(...)` and fails when the order is changed.
**IT FAILS OPEN.** `getLUTFilterForExport()` already returned null on every error path (LUT not found, no `gcs_path`, download failure); the call site wraps it again and logs "exporting ungraded". An export must never die because a colour grade could not be fetched — an ungraded video is a far better outcome than no video.
VERIFIED BY RUNNING FFMPEG, unusually for this codebase: the regression builds the exact chain the exporter produces, runs it against a real binary, and asserts both that it executes AND that the pixels actually change. A filter that runs cleanly and grades nothing would be indistinguishable from the bug being fixed. The ffmpeg sections skip gracefully when no binary is present so the wiring checks still run in CI.
**THE PREVIEW USES THE CSS FILTER, BY DESIGN.** `useAudioEngine.applyLUT` has always stored `projectLUTFilter` next to the id, and its own comment says "CSS filter is used in the editor (immediate); FFmpeg lut3d used at export" — the two-path design was intended from the start. Nothing ever applied the filter, so the canvas rendered ungraded: the id changed, the store changed, and the picture did not. The canvas style now carries `filter: projectLUTFilter || 'none'`, subscribed (not read via `getState`) so applying a LUT repaints immediately.
A CSS filter is an APPROXIMATION of the .cube, not a match — that is the accepted trade-off for real-time preview, and it means preview and export agree in look but not pixel-for-pixel. A true match needs the .cube uploaded as a WebGL2 `sampler3D` and sampled in the fragment shader; worth doing, but it is not what was broken.
RESOLVED DIFFERENTLY: the Revideo/Lambda export path was removed entirely (R56). Note R55b — the built-in LUT library has no .cube files, so lut3d applies only to user-uploaded LUTs.
Regression: `node scripts/test_lut_export.js` (in `npm run test:regression`) — 15 checks; verified to fail when the filter push is removed and when the LUT is moved before the scale filter.

**R54 — A renewal is a CHARGE, not a tier change. `order.created` is the only event that tells you one happened.**
Paying customers were billed every month and heard from us exactly once — at signup. Polar emits `order.created` for every successful charge including each recurring renewal, and nothing was listening. Now handled: `sendRenewalReceipt()` mails a receipt with the REAL amount from the order (`totalAmount`/`currency`, never a hardcoded price list — plans change, and a receipt showing the wrong number is worse than none) and the REAL next billing date from the subscription (computing "one month from now" locally drifts from the actual date, which is the sort of small lie a billing email must not tell).
**ONLY RENEWALS ARE ANNOUNCED.** The first charge is already covered by the plan-confirmation email `setPlan()` sends, so announcing every `order.created` would double-mail every new subscriber. The handler checks `billingReason` for a cycle/renewal/recurring marker and SKIPS anything it can't positively identify as a renewal, rather than guessing.
**IT NEVER TOUCHES `plan`.** A renewal is a charge; a tier transition is a different thing. Conflating them is the same class of mistake as R46's canceled/revoked collapse. The regression asserts `sendRenewalReceipt` contains no `setPlan(` at all.
**A FAILED EMAIL MUST NOT FAIL THE WEBHOOK.** Everything is wrapped and non-blocking: returning non-2xx makes Polar retry the entire billing event, so a cosmetic failure must never propagate.
STILL MISSING — the BEFORE-renewal reminder. Polar has no "will renew in N days" webhook, so a pre-charge heads-up cannot be event-driven: it needs a scheduled job querying subscriptions whose `current_period_end` is approaching. That is real infrastructure (cron + a sent-reminders ledger so a retry can't mail twice) and is deliberately NOT stubbed here — a half-built reminder that fires unpredictably is worse than none.
Regression: §7 of `scripts/test_subscription_cancel.js`. NOTE its `caseBody()` strips comments first: the comment explaining this branch legitimately mentions `setPlan()`, and a naive grep reported the explanation as the violation — the third time that exact trap has bitten in this file.

**R54b — `handleAddSFX` silently did nothing on most projects.**
`const audioTrack = state.tracks?.find(t => t.type === 'audio'); if (!audioTrack) return;` — projects do not start with an audio track, so clicking a sound effect was a no-op with no error and no feedback, which is why the whole asset panel read as a mockup. It now CREATES the track via `addTrack('audio')` (which returns the new id) and verifies it exists before adding the clip. Two smaller lies fixed alongside: `duration: 2` was hardcoded, so a 0.3s whoosh and a 6s riser both became 2s on the timeline and never matched the audio the user had just previewed — the real `assets.duration` is used now; and `src` fell back to `sfx.id`, which is not a URL, producing a clip pointing at nothing — a sound with no playable URL is now refused with a warning instead.

**R53 — The preview canvas is the PROJECT FRAME, and the source is CONTAIN-fitted into it. Preview and export must agree by construction.**
Reported as "changing 9:16 → 16:9 zooms in and destroys the quality", with screenshots showing the subject upscaled roughly 3× and cropped at top and bottom. Two independent causes, both in the preview path only:
1. **The vertex shader had no aspect correction at all.** `gl_Position = vec4(a_position, 0.0, 1.0)` is a FIXED full-screen quad, so the source texture was always stretched to fill the whole buffer regardless of either shape.
2. **The canvas buffer was sized from the ACTIVE CLIP** (`nativeVideoDimRef`), not the project frame — so the preview surface was whatever shape the current video happened to be, not the shape being exported.
EXPORT WAS ALWAYS CORRECT: `buildScaleFilter` uses `scale=…:force_original_aspect_ratio=decrease,pad=…`, i.e. contain-plus-bars. The two disagreed because they never shared this logic — the same "check every render path" lesson as R14 (preview UV crop / FFmpeg crop / Revideo scene), now applying to the frame itself.
THE FIX: `computeContainFit()` (exported, pure) returns NDC scale factors, at most one below 1, shrinking the quad on the over-long axis so the source keeps its aspect and the remainder becomes letterbox/pillarbox. `u_fitScale` applies it in the shader. The buffer is derived from the project aspect ratio × the source's LONGEST EDGE, so a portrait project keeps portrait resolution and nothing is ever upscaled past what the footage actually has.
THREE THINGS THAT ARE EASY TO GET WRONG HERE:
- **The crop changes the visible aspect.** `setCrop()` must recompute the fit, or an R14 multicam angle gets letterboxed for its UNCROPPED shape.
- **The user transform composes, never replaces.** `u_userScale`/`u_userOffset` multiply on top of the fit (`a_position * u_fitScale * u_userScale + u_userOffset`), so a manual resize starts from the fitted size — the same compose-don't-stack rule as R16.
- **A ResizeObserver does NOT fire when the aspect ratio changes**, only when the observed element's box does. The ratio effect calls the resize handler directly through `resizeHandlerRef`; without that the new frame shape would not appear until the window was resized. `frameAspectRef` exists for the same reason as R42's `labelWRef` — the handler lives in an empty-dep effect and would otherwise capture the mount-time ratio forever.
DEGRADES TO IDENTITY on any unknown input (no source aspect, no frame dims, NaN), which is exactly the old fill behaviour — an unmeasured source can never collapse or blank the frame.
NOT VISUALLY VERIFIED: there is no browser in the environment this was written in. The geometry is pinned by 32 executed assertions including "no combination of source and frame ever scales above 1", and both failure modes were reproduced by mutation (restoring the fixed quad, and flipping contain to cover). The rendered result still needs a human to look at it — load a 9:16 clip in a 16:9 project and confirm it is pillarboxed at native scale, matching the export.
PARTIALLY RESOLVED: the LUT now reaches the EXPORT (R55). The PREVIEW still has no LUT sampling in PlaybackEngine, so a graded export will not match the editor — the same divergence this rule is about. See R55.
Regression: `node scripts/test_aspect_fit.js` (in `npm run test:regression`) — 32 checks executing the real `computeContainFit`; verified to fail when the fit is removed from the shader and when contain is flipped to cover.

**R52 — A proposal may only advertise itself as APPLICABLE if it resolves to a real command. `client/src/agent/DirectorIntelligence.js` is the only place proposals are built.**
Sprint 7, the top of the stack: media_assets (what is each clip) → project_intelligence (what is this project, R44) → story_intelligence (does the cut tell it, R51) → **this (so what do we DO about it)**.
THE FINDING THAT SHAPED THE WHOLE SPRINT: `CreativeDirector.js` — fully built, never imported, and the fifth dead-entry-point in this file's history (LUT import R33, UserStylePage R37, `POST /api/brain/organize`, `/account` R46) — emits `action.operation` for 14 operations of which **TWELVE do not exist in CommandRegistry**: `add_background_music`, `add_hook_text`, `add_ken_burns`, `add_zoom_punch`, `apply_color_grade`, `extend_key_clips`, `generate_captions`, `reorder_for_hook`, `split_long_clips`, `suggest_transition_points`, `trim_opening`, `vary_clip_durations`. Only `add_sfx` and `add_transition` resolve. Wiring it up — the obvious reading of "Sprint 7: Director Intelligence" — would have shipped a panel of Apply buttons routing to handlers that do not exist: R23 requires every command to reach a real handler, R30 requires a command that changed nothing to report failure. Twelve confident proposals that silently do nothing is the worst version of both. It now carries a SUPERSEDED banner naming the twelve, and the regression asserts nothing imports it.
**THE GATE.** `proposal()` never trusts its caller: `applicable` is computed as `isExecutable(command)` against `COMMAND_BY_ID`, and when that fails the command is set to **null** rather than passed through — so a UI keying its Apply button off `command` cannot render a dead one. The regression's central check is that no proposal is `applicable` without a registry entry, and it is verified to fail when the verification is replaced with a truthiness test.
**DEMOTED, NOT DROPPED.** A finding naming a nonexistent command keeps its place as ADVICE. "Your hook lands at 41s — move it to the front" is the single most valuable thing the system can say, and there is no `reorder_for_hook` command; deleting it because we cannot automate it would be worse than saying it. `advisoryReason` states explicitly why there is no button.
**RANKED BY IMPACT, NOT BY WHAT WE CAN DO.** The sort is priority-then-declaration-order and deliberately does NOT float applicable items up. A critical advisory finding must outrank a low-priority applicable tweak; sorting by actionability is a UI convenience that quietly misleads the user about what matters. The regression pins this and fails when applicable-first sorting is introduced.
DETERMINISTIC BY DESIGN: no model call. The maps were derived by a model; re-interpreting them with a second one reintroduces the double-interpretation problem R37 removed, and a proposal that disagreed with the map it cites would be indefensible. Every proposal carries `why` (verbatim from the stored finding) and `source` ('story' | 'project'), so it is traceable to a row the user can inspect. Unreadable or `insufficient_data` maps produce ZERO proposals, never guesses.
The Brain prompt gained a matching capability section listing what it can genuinely offer and naming the two things it must raise as advice only (reordering for a hook, trimming the opening).
Regression: `node scripts/test_director_intelligence.js` (in `npm run test:regression`) — 41 checks EXECUTING the real module against the real registry; verified to fail when the executability gate or the impact-first ranking is removed.
IF YOU IMPLEMENT ONE OF THE TWELVE: do it properly first (EXT1's five files plus execution and validation), and only then let a proposal name it. The gate will pick it up automatically — `isExecutable` reads the registry, so no change is needed here.

**R51 — `story_intelligence` reads the ASSEMBLED CUT, not the bin. Fingerprinted on the SEQUENCE, and it refuses to invent beats.**
Sprint 6, and the level above R44:
```
media_assets         → what is each clip?              (R21/R38)
project_intelligence → what is this PROJECT?           (R44)
story_intelligence   → does the CUT tell that story?   (this)
```
Everything before this reasoned about the BIN — what footage exists. This reasons about what the user actually assembled: where the hook lands (`hook_at_sec`), where the cut sags (`sag_windows`), whether the clip ORDER delivers the through-line the project map identified (`delivers_through_line`). Those are properties of the SEQUENCE, invisible to any per-clip or per-bin view — which is what makes it a genuinely new capability rather than more of the same. "Your hook is at 41s" is actionable; "add a hook" is wrong when one already exists in the wrong place.
**THE FINGERPRINT DOES NOT SORT — that is the entire difference from R44's.** `ProjectIntelligence.computeFingerprint()` sorts, because a bin is a SET. `StoryIntelligence.computeCutFingerprint()` must NOT, because a cut is a SEQUENCE: reordering the same clips is a different cut and has to re-derive. It hashes position + clip id + duration (100ms resolution) + transcript presence. Sharing the project map's fingerprint would leave the story map stale after every reorder; recomputing on every edit is R29's trap. Transcript presence is in the hash because a map derived before the transcript landed was derived without meaning and must not survive it arriving.
**NO TRANSCRIPT ⇒ NO STORY MAP, and fewer than 2 clips is not a sequence.** Beats are a claim about MEANING; inferring them from durations alone is R30 exactly — a confident narrative read of content nobody looked at. `_insufficientReason()` is pure and returns the reason, which is written to the row as `status: 'insufficient_data'` with the explanation, rather than leaving the row absent (R38/R40's empty-vs-broken distinction). The Brain renders that state as "not enough to read" and is explicitly told not to describe a story that isn't there yet.
CONTAINMENT AT NORMALISATION, same as R44: a beat outside the closed vocabulary is DROPPED; a clip id not in the cut is dropped (a hallucinated id would otherwise be shown to the user as fact); **a timestamp past the end of the cut becomes null**, because a finding at 9999s in a 38s video is not a finding; an invalid severity clamps to `medium`; a non-boolean `deliversThroughLine` becomes null rather than coercing to false.
THE PROMPT RULES MAKE IT ACTIONABLE (R39): every issue must cite a TIME so the user can go look at it; a sag is a fact about the cut, never a judgement of the footage; a clip with no transcript may be described by position and duration but NOT by what it says or shows; an empty issues list is a valid answer for a cut that works. If `delivers_through_line` is false that outranks everything else in the prompt — the cut contains every piece and still buries the point, which is the single most useful thing the Brain can say.
Migration `supabase/migrations/20240007_story_intelligence.sql`, applied and verified. Registered in `DataHealthProbe` as `accumulating` — an unassembled project correctly produces no row, so check the TIMELINE before suspecting the writer.
Regression: `node scripts/test_story_intelligence.js` (in `npm run test:regression`) — 52 checks, nearly all EXECUTING the real class against a stubbed OpenAI + Supabase; verified to fail when the transcript guard is removed. NOTE: removing the explicit position index from the fingerprint does NOT fail, because array order already encodes it — the absence of `.sort()` is the real mechanism, and that is what a future refactor must not "tidy up".

**R50 — The GCS client needs a BOUNDED keep-alive pool. Unbounded concurrency against GCS presents as "socket hang up" on every call type at once, and starves ffmpeg of CPU.**
A 5-file upload burst produced simultaneous `socket hang up` failures on `getMetadata`, range reads, whole-object reads AND uploads, within the same two seconds — plus `ffmpeg decode timed out after 90s` at `speed=0.18x` (15.7 s of audio in 90 s). Those look like three separate bugs and are one: `config/storage.js` constructed `new Storage(opts)` with **no agent and no retry config**, so the SDK used Node's default HTTPS pool. Two consequences: (a) a pooled keep-alive socket that GCS had already closed gets picked for a new request and the write fails as "socket hang up"; (b) nothing bounds total concurrency, so one burst (≈8 waveform extracts + ≈6 proxy range reads + waveform-JSON reads/writes + thumbnail upload + diarize downloads) opens as many sockets as there are in-flight requests and leaves no CPU for the ffmpeg those same requests are waiting on.
FIX: an explicit `https.Agent` with `keepAlive: true` and `maxSockets` (default 25, `GCS_MAX_SOCKETS`), plus the SDK's own `retryOptions.autoRetry` with a `retryableErrorFn` that covers ECONNRESET/EPIPE/ETIMEDOUT/"socket hang up"/429/5xx. `maxSockets` is the right lever for BOTH problems: it is real backpressure (requests queue instead of piling on) and it keeps the pool small enough to stay warm rather than going stale. R47's per-request retries remain the last line of defence.
IF YOU ADD ANOTHER HEAVY GCS CONSUMER: it inherits this pool automatically — do not construct a second `Storage` client, and do not raise `maxSockets` to "fix" a slowness that is actually CPU contention.

**R50b — `optionalAuth` does not fail on a missing token; it silently yields an anonymous request.**
`WaveformEngine._fetchPeaks` used bare `fetch`, so no `Authorization` header reached `POST /api/waveform/extract`. The route runs on `optionalAuth`, which does not reject — it just leaves `req.user` undefined, and `req.user?.id || 'anonymous'` then wrote EVERY user's peaks to a shared `waveforms/anonymous/` prefix. Asset ids from different accounts collide in one namespace, and the path diverges from R41's `waveforms/{userId}/{assetId}.json` contract. Exactly the trap TD3 names: any new fetch in the client layer must use `authFetch`. The tell in logs is a storage path containing `/anonymous/` while other routes in the same request burst log `Auth: Present`.

**R50c — Whisper rejects >25 MB; compress before uploading, never after a 413.**
`MediaIntelligencePipeline._transcribe` streamed the file straight in with no size check and failed outright: `413: Maximum content size limit (26214400) exceeded (26368000 bytes read)` — 26.3 MB, barely over. `jobs/audioProcessor.js` has always had a `WHISPER_LIMIT` guard; the Brain's own transcription path never did, so asset-analysis transcription failed on any clip whose extracted audio exceeded the limit. Now re-encodes to mono 16 kHz 64 kbps MP3 first (what Whisper wants anyway), measured at ~0.48 MB/min — so 25 MB covers ~52 minutes of audio. `-vn` is load-bearing: decoding video to obtain audio is the R36 waste all over again. A file still over the limit after compression is SKIPPED with a log line rather than sent to fail.
Regression for all three: the `transcription respects the Whisper size limit` and `waveform extraction is called with credentials` sections of `scripts/test_creator_memory.js`.

**R49 — A PostgREST query builder is THENABLE, not a Promise. `.catch()` on one throws synchronously and the query never runs.**
`supabaseAdmin.from(x).update(y).eq(z).catch(fn)` looks like ordinary promise handling and is not: the builder implements `.then()` and nothing else, so `.catch` is `undefined` and calling it throws `TypeError: supabaseAdmin.from(...).update(...).eq(...).catch is not a function` BEFORE any request is sent. Both writes in `runBinClassification()` were written that way, so bin classification had never once persisted anything. The surrounding try/catch reduced it to a single log line that read like a failure *inside* the query rather than a query that never happened — the tell is that the message names `.catch` itself.
CORRECT SHAPE, used everywhere else in that file: `const { error } = await supabaseAdmin…; if (error) …`. Await the builder, inspect `error`.
**AND THE COLUMNS DID NOT EXIST EITHER.** `content_class`, `suggested_track`, `related_to`, `confidence` on `media_assets`, and `detected_project_type`, `bin_classification` on `projects` — all six missing (verified via information_schema). So even with the `.catch()` fixed, every update would have failed on an unknown column. Two independent reasons for the same silence, the same doubling as R38. Migration `supabase/migrations/20240006_bin_classification.sql`, applied and verified.
The route now logs `persisted for N/M asset(s)` rather than an unconditional success, because a count is the only proof the write landed (R38).
Regression: the `supabase writes never use .catch() on the builder` section of `scripts/test_creator_memory.js` greps the four main Supabase writers for the shape and executes-by-inspection that bin classification checks `error` instead. NOTE it strips comments first — the comment explaining this bug contains the offending pattern verbatim, and a naive grep flags the warning as the crime.

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
[FRAME-FIT]    client/src/engine/PlaybackEngine.js (computeContainFit + u_fitScale/u_userScale shader), client/src/components/Player/VideoPlayer.jsx (buffer = project frame, frameAspectRef, resizeHandlerRef), jobs/exportProcessor.js (buildScaleFilter — the reference behaviour) — see R53.
[DIRECTOR]     client/src/agent/DirectorIntelligence.js (findings → verified proposals), client/src/agent/CommandRegistry.js (COMMAND_BY_ID is the gate), client/src/agent/CreativeDirector.js (SUPERSEDED — 12 of its 14 operations do not exist) — see R52.
[STORY-MAP]    server/brain/StoryIntelligence.js (derive + persist), server/routes/brainRoutes.js (/analyze attaches it), server/brain/EditorialBrain.js (THE CUT AS ASSEMBLED + rules), client/src/hooks/useBrain.js (sends projectState.cut in play order), story_intelligence table — see R51.
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
