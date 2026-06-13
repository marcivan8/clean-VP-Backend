# diarize-service/Dockerfile
# Deploy this as a SEPARATE Railway service from the Node backend.
# Set HF_TOKEN, WHISPERX_MODEL, and PORT in Railway's Variables dashboard.
#
# CPU build (default) — ~2-3x realtime. Suitable for background jobs.
# For GPU: swap base image to pytorch/pytorch:2.3.1-cuda12.1-cudnn8-runtime
# and remove +cpu from requirements.txt.

FROM python:3.11-slim

# ffmpeg binary  — used by whisperx at runtime
# libav*-dev + pkg-config — required to compile PyAV (av==11.*) from source,
# which faster-whisper pulls in as a dependency
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        git \
        pkg-config \
        libavformat-dev \
        libavcodec-dev \
        libavdevice-dev \
        libavutil-dev \
        libavfilter-dev \
        libswscale-dev \
        libswresample-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install torch CPU wheels first (large download — separate layer for cache efficiency)
COPY requirements.txt .
RUN pip install --no-cache-dir \
        torch==2.3.1+cpu \
        torchaudio==2.3.1+cpu \
        --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

COPY app.py .

ENV PORT=5001
EXPOSE 5001

# Use gunicorn with a single worker — model inference is not thread-safe.
# Increase timeout to 600 s for long audio files.
CMD gunicorn app:app \
        --bind 0.0.0.0:${PORT} \
        --workers 1 \
        --timeout 600 \
        --log-level info
