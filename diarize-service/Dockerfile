# diarize-service/Dockerfile
# Deploy this as a SEPARATE Railway service from the Node backend.
#
# REQUIRED Railway Variables:
#   HF_TOKEN        — HuggingFace access token for pyannote gated models.
#                     Without this, diarization will NOT run (transcription still works).
#                     You must also accept terms at:
#                       https://huggingface.co/pyannote/speaker-diarization-3.1
#                       https://huggingface.co/pyannote/segmentation-3.0
#
# OPTIONAL Railway Variables:
#   WHISPERX_MODEL  — "tiny" | "base" | "small" (default) | "medium" | "large-v2"
#                     IMPORTANT: "base" has poor word alignment, which causes many words
#                     to get no speaker label. Use "small" (default) or "medium" for
#                     reliable speaker diarization. "medium" is recommended for accuracy.
#   PORT            — Server port (default: 5001, set automatically by Railway)
#
# CPU build (default) — ~2-3x realtime. Suitable for background jobs.
# For GPU: swap base image to pytorch/pytorch:2.3.1-cuda12.1-cudnn8-runtime
# and remove +cpu from requirements.txt.

FROM python:3.11-slim

# ffmpeg binary — used by whisperx at runtime
# git — needed to install whisperX directly from GitHub
# (libav*-dev build headers removed: faster-whisper>=1.1.0 uses av>=12
#  which ships pre-built manylinux wheels, so no source compilation needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install torch CPU wheels first (large download — separate layer for cache efficiency)
COPY requirements.txt .
RUN pip install --no-cache-dir \
        torch==2.8.0+cpu \
        torchaudio==2.8.0+cpu \
        torchvision==0.23.0+cpu \
        --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

COPY app.py .

ENV PORT=5001
EXPOSE 5001

# JSON exec form — gunicorn receives OS signals (SIGTERM) directly.
# sh -c is required to expand the ${PORT} shell variable at runtime.
CMD ["sh", "-c", "exec gunicorn app:app --bind 0.0.0.0:${PORT} --workers 1 --timeout 600 --log-level info"]
