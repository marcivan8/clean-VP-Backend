# Vibed — AI Video Editing Platform

**Vibed** is a full-stack, AI-powered video editing IDE. It combines a conversational AI agent with a professional non-linear timeline editor, enabling creators to edit long-form video through natural language commands, then export directly to industry-standard NLE formats.

---

## Features

### 🤖 Conversational AI Agent
- Natural language editing commands parsed by GPT-4o (e.g. *"remove all filler words"*, *"make it cinematic"*, *"export for Final Cut"*)
- Intent parser with spaCy NLP pre-analysis for clarity scoring and duration validation
- Structured editing plan generation with user approval flow
- Session memory and context-aware multi-turn conversations

### 🎬 Professional Timeline Editor
- Multi-track video/audio/image timeline with drag-and-drop
- Frame-accurate clip trimming, splitting, speed ramping, and volume control
- WebCodecs-based low-latency playback engine
- Beat detection and silence detection for smart auto-editing

### 📤 NLE Export (Frame-Accurate)
Powered by `@chatoctopus/timeline` — no floating-point drift, rational time math:

| Target | Format | Notes |
|---|---|---|
| Final Cut Pro | FCPXML 1.8 (`.fcpxml`) | File → Import → XML |
| Adobe Premiere Pro | xmeml v5 (`.xml`) | File → Import |
| DaVinci Resolve | xmeml v5 (`.xml`) **+** OTIO (`.otio`) | Dual download; OTIO native in Resolve 18+ |
| Universal | OpenTimelineIO (`.otio`) | Works in Resolve 18, Premiere (beta), Kdenlive 20+ |

### 🎵 Audio Processing
- Noise reduction (FFT denoising via FFmpeg)
- Audio normalization to EBU R128 standard (−16 LUFS)
- Whisper-powered word-level transcription for filler word removal
- Beat detection for music-synced cuts

### 📊 Virality Analysis
- Uploads video for AI scoring across TikTok, YouTube, Instagram, YouTube Shorts
- GPT-4o analysis of hook, pacing, energy, and emotion
- Platform-fit scores, editing tips, and ML-based virality prediction
- Analysis history per user

### 🔐 Security
- Supabase JWT authentication on all API endpoints
- Helmet (14 security headers)
- Per-route rate limiting (AI: 15/min, renders: 5/min, uploads: 10/min)
- CORS origin allowlist via environment variable
- Path traversal protection on all file-serving endpoints

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 18, Express 4 |
| Auth | Supabase (JWT + Row Level Security) |
| AI | OpenAI GPT-4o, Whisper |
| NLP | spaCy (Python microservice) |
| Video processing | FFmpeg (via `fluent-ffmpeg` + `ffmpeg-static`) |
| NLE export | `@chatoctopus/timeline` (OTIO-first) |
| Rendering | `@revideo/renderer` (headless Chromium) |
| ML | TensorFlow.js (virality prediction) |
| Database | Supabase (PostgreSQL) |
| Storage | Google Cloud Storage / local fallback |
| Security | `helmet`, `express-rate-limit` |
| Frontend | React + Vite, Zustand, Three.js (@react-three/fiber), WebCodecs API |
| Deploy | Docker Compose (Unified Node.js static serving + Python FastAPI) |

---

## Project Structure

```
clean-VP-Backend/
├── index.js                  # Express server entry point
├── Dockerfile                # Production Docker image
├── .env.example              # Environment variable template
│
├── routes/                   # API route handlers
│   ├── auth.js               # User profile + usage endpoints
│   ├── analyzeRoutes.js      # Video virality analysis (upload + analyze)
│   ├── audioRoutes.js        # Denoise, normalize, transcribe, beat-detect
│   ├── exportRoutes.js       # FFmpeg render (timeline → MP4)
│   ├── revideoRenderRoutes.js# Revideo headless render
│   ├── nleExport.js          # NLE project export (FCPXML, xmeml, OTIO)
│   ├── aiRoutes.js           # AI agent: chat, intent parse, plan generate
│   ├── silenceRoutes.js      # Silence detection
│   ├── proxyRoutes.js        # Proxy video generation for low-latency editing
│   ├── presetRoutes.js       # Preset marketplace
│   └── effectsRoutes.js      # Effects engine
│
├── controllers/
│   ├── mainController.js     # Video analysis pipeline
│   └── aiAgentController.js  # GPT-4o intent parsing + plan generation
│
├── middleware/
│   ├── auth.js               # Supabase JWT verification
│   ├── usageLimits.js        # Plan-based usage enforcement
│   └── devAuth.js            # Dev-only bypass (throws in production)
│
├── services/                 # Business logic layer
├── models/                   # Supabase data models
├── analysis/                 # Audio/video analysis utilities
├── viralEngine/              # Virality scoring engine
├── spacy-service/            # Python spaCy NLP microservice
├── revideo/                  # Revideo project for headless rendering
└── client/                   # React frontend (Vite)
    └── src/
        ├── agent/            # AI editing agent (EditJobManager, IntentParser…)
        ├── components/       # UI components (Timeline, ExportModal, MixerPanel…)
        ├── services/         # Frontend service layer (aiService, nleExportService…)
        └── store/            # Zustand state (timeline, player, effects)
```

---

## Local Development

### Prerequisites
- Node.js ≥ 18
- FFmpeg (bundled via `ffmpeg-static` — no system install needed)
- Python 3.x + spaCy (for the NLP microservice, optional)

### Setup

```bash
# 1. Clone and install
git clone https://github.com/marcivan8/clean-VP-Backend.git
cd clean-VP-Backend
npm install

# 2. Set up environment variables
cp .env.example .env
# Fill in your keys in .env (see Environment Variables below)

# 3. Start the backend
npm run dev          # nodemon — auto-restarts on changes

# 4. Start the frontend (separate terminal)
cd client
npm install
npm run dev          # Vite dev server on http://localhost:5173

# 5. (Optional) Start the spaCy NLP service
cd spacy-service
pip install -r requirements.txt
python app.py
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values. **Never commit `.env` to version control.**

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | ✅ | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key (keep secret — admin access) |
| `SUPABASE_ANON_KEY` | ✅ | Supabase anon/public key |
| `OPENAI_API_KEY` | ✅ | OpenAI API key (GPT-4o + Whisper) |
| `ALLOWED_ORIGINS` | ✅ (prod) | Comma-separated list of allowed CORS origins |
| `NODE_ENV` | ✅ (prod) | Set to `production` in production |
| `PORT` | ➖ | Server port (default: `3000`) |
| `DEV_USER_ID` | dev only | UUID for devAuth bypass in development |
| `DEV_USER_EMAIL` | dev only | Email for devAuth bypass in development |

> ⚠️ In production, inject all secrets via your platform's secret manager (Railway environment variables, AWS Secrets Manager, etc.) — never write them to a file on the server.

---

## API Reference

### Authentication
All endpoints (except `GET /health`, `GET /api/presets/marketplace`) require a `Bearer` token:
```
Authorization: Bearer <supabase-jwt>
```

### Core Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/api/auth/profile` | Create user profile (requires JWT) |
| `GET` | `/api/auth/usage` | Get current plan usage |
| `GET` | `/api/auth/history` | Get analysis history |
| `POST` | `/api/analyze` | Upload + analyze video for virality |
| `POST` | `/api/ai/chat` | AI agent chat command |
| `POST` | `/api/ai/parse-intent` | Parse NL editing command → structured intent |
| `POST` | `/api/ai/generate-plan` | Generate executable editing plan |
| `POST` | `/api/ai/analyze-content` | Long-form content intelligence |
| `POST` | `/api/render` | Render timeline → MP4 (FFmpeg) |
| `POST` | `/api/revideo/render` | Render timeline → MP4 (Revideo) |
| `POST` | `/api/export/nle` | Export timeline → FCPXML / xmeml / OTIO |
| `POST` | `/api/audio/denoise` | Apply noise reduction |
| `POST` | `/api/audio/normalize` | Normalize loudness (EBU R128) |
| `POST` | `/api/audio/transcribe` | Whisper word-level transcription |
| `POST` | `/api/audio/beat-detect` | BPM + beat timestamp detection |
| `POST` | `/api/silence/detect` | Detect silence segments |
| `POST` | `/api/proxy/upload` | Upload video + generate proxy |
| `GET` | `/api/presets/marketplace` | Get curated preset list |

### NLE Export — `POST /api/export/nle`

```json
{
  "target": "fcpx | premiere | resolve | otio",
  "tracks": [...],
  "fps": 30,
  "aspectRatio": "16:9",
  "projectName": "My Project"
}
```

**DaVinci Resolve** returns a JSON envelope with two files (`.xml` + `.otio`). All other targets stream a single file download.

---

## Deployment

The project is fully unified and containerized for deployment using `docker-compose`. 

```bash
# Spin up the entire platform (Node.js React server + Python NLP parser)
docker-compose up --build -d
```

**Architecture details:**
1. The `Dockerfile` uses a multi-stage build. It first compiles the React client, then copies `client/dist` into the Express backend.
2. `index.js` statically serves the React app, meaning you only need one domain/URL.
3. The `spacy` service runs in a separate lightweight container and is only accessible internally via port `8001`.
4. Ensure `NODE_ENV=production` is set so the server enforces JWT Authentication, CORS rules, and rate limits.

---

## Security Notes

- `devAuth` middleware **throws at startup** if `NODE_ENV=production` — it cannot accidentally run in production
- All file-serving endpoints enforce a strict `/uploads` directory boundary (path traversal protection)
- Rate limiting is applied per-route — AI endpoints are capped at 15 req/min, render at 5 req/min
- All API secrets are validated at startup — the server refuses to start if any required env var is missing

---

## License

MIT
