# diarize-service/Dockerfile
# Deploy as a SEPARATE Railway service from the Node backend.
#
# ── Build-time model pre-download ─────────────────────────────────────────────
# Pass HF_TOKEN as a Railway "Build Variable" (not Runtime Variable) so the
# pyannote models are baked into the image during build. This avoids cold-start
# download delays and auth failures at runtime.
#
# Railway: Settings → Build → Build Arguments → HF_TOKEN=hf_xxx
#
# The HuggingFace account that owns this token MUST have accepted terms at:
#   https://huggingface.co/pyannote/segmentation-3.0
#   https://huggingface.co/pyannote/speaker-diarization-3.1
#
# If HF_TOKEN is not supplied at build time, the service starts in
# transcription-only mode and still returns word timestamps — just no speaker
# labels. You can re-build later with HF_TOKEN to enable full diarization.
#
# ── GPU ───────────────────────────────────────────────────────────────────────
# For GPU: swap FROM to pytorch/pytorch:2.3.1-cuda12.1-cudnn8-runtime
# and remove +cpu suffix from torch/torchaudio in requirements.txt.

FROM python:3.11-slim

# System deps: ffmpeg (whisperX), git (install whisperX from GitHub),
# shared libs for MediaPipe/OpenCV, OpenMP for torch CPU inference.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        git \
        libglib2.0-0 \
        libsm6 \
        libxext6 \
        libxrender-dev \
        libgl1 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install torch CPU wheels first (large — separate layer for cache efficiency)
COPY requirements.txt .
RUN pip install --no-cache-dir \
        torch==2.8.0+cpu \
        torchaudio==2.8.0+cpu \
        --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

COPY app.py .

# ── Pre-download models at build time ─────────────────────────────────────────
# Models are cached in ~/.cache/huggingface/hub/ inside the image.
# At runtime no network/auth is required — the files are already there.
#
# We pre-download:
#   1. WhisperX "base" model      (always, no auth needed)
#   2. pyannote diarization 3.1   (only if HF_TOKEN is provided)
#
# If pyannote download fails (wrong token, terms not accepted), the build
# SUCCEEDS and the service runs in transcription-only mode. Fix the token/
# terms issue, then rebuild to get speaker labels.

ARG HF_TOKEN=""
RUN python - <<'PYEOF'
import os, sys

hf_token = os.environ.get("HF_TOKEN", "") or ""

# 1. WhisperX base Whisper model (always)
print("[pre-download] Downloading faster-whisper/base …", flush=True)
try:
    import whisperx
    whisperx.load_model("base", "cpu", compute_type="int8")
    print("[pre-download] ✅ WhisperX base model cached.", flush=True)
except Exception as e:
    print(f"[pre-download] ⚠️  WhisperX preload failed: {e}", file=sys.stderr, flush=True)

# 2. pyannote diarization pipeline (only with HF_TOKEN)
if not hf_token:
    print("[pre-download] HF_TOKEN not set — skipping pyannote download.", flush=True)
    print("[pre-download]   To enable speaker labels, pass HF_TOKEN as a build arg.", flush=True)
else:
    print("[pre-download] Downloading pyannote/speaker-diarization-3.1 …", flush=True)
    try:
        import whisperx
        whisperx.DiarizationPipeline(use_auth_token=hf_token, device="cpu")
        print("[pre-download] ✅ pyannote diarization pipeline cached.", flush=True)
    except Exception as e:
        err = str(e).lower()
        print(f"[pre-download] ⚠️  pyannote download failed: {e}", file=sys.stderr, flush=True)
        if "gated" in err or "403" in err or "access" in err:
            print(
                "[pre-download]    → Accept model terms at:\n"
                "[pre-download]      https://huggingface.co/pyannote/segmentation-3.0\n"
                "[pre-download]      https://huggingface.co/pyannote/speaker-diarization-3.1\n"
                "[pre-download]    Then rebuild with the same HF_TOKEN.",
                file=sys.stderr, flush=True,
            )
        elif "401" in err or "unauthorized" in err:
            print(
                "[pre-download]    → HF_TOKEN is invalid. Generate a new one at:\n"
                "[pre-download]      https://huggingface.co/settings/tokens",
                file=sys.stderr, flush=True,
            )
        print("[pre-download]   Service will start in transcription-only mode.", file=sys.stderr, flush=True)
PYEOF

ENV PORT=5001
EXPOSE 5001

CMD ["sh", "-c", "exec gunicorn app:app --bind 0.0.0.0:${PORT} --workers 1 --timeout 600 --log-level info"]
