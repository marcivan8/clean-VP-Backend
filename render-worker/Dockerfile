FROM node:20-slim
WORKDIR /usr/src/app

# Install system dependencies needed for canvas/sharp/tensorflow, headless
# Chrome, and (system) ffmpeg/ffprobe.
#
# R69 FOLLOW-UP — real render verified end-to-end in a sandboxed test rig,
# TWO deployment-blocking bugs found and fixed here:
#
#   1. Debian's `chromium` apt package (what this Dockerfile used to install)
#      is an OPEN-SOURCE Chromium build with NO H.264 support — no decode,
#      no encode. Confirmed directly: `canPlayType('video/mp4; codecs="avc1..."')`
#      returns "" (empty — unsupported), loading an H.264 <Video> element
#      throws MEDIA_ERR_SRC_NOT_SUPPORTED / DEMUXER_ERROR_NO_SUPPORTED_STREAMS,
#      and — the fatal one — Revideo's OWN internal muted-video output encoder
#      (`@revideo/core`'s `WasmExporter`, via `mp4-wasm`'s WebCodecs wrapper)
#      hardcodes `codec: "avc1.4d0034"` (H.264) with NO override surface in
#      Revideo 0.10.4's public API. That means EVERY render — regardless of
#      what codec the source video uses — needs a browser with real H.264
#      WebCodecs ENCODE support, or it fails with "Failed to execute 'encode'
#      on 'VideoEncoder': Cannot call 'encode' on a closed codec." This is not
#      about baseVideoUrl's format; it's the renderer's own output path.
#      FIX: install real Google Chrome (proprietary codec license) instead of
#      Debian's codec-stripped `chromium` package — same "system browser,
#      bypass puppeteer-core's version check" precedent this Dockerfile
#      already used, just pointed at a build that can actually encode.
#
#   2. `@revideo/ffmpeg`'s bundled static ffprobe binary
#      (`@ffprobe-installer/linux-x64`, a johnvansickle.com static build)
#      segfaulted when given a network URL as input in testing — a real
#      binary-compatibility risk in a locked-down container. `renderVideo()`'s
#      `settings.ffmpeg.{ffmpegPath,ffprobePath}` can point it at the SYSTEM
#      ffmpeg/ffprobe below instead (see render-worker/server.js) — the exact
#      same "trust the system binary, not a bundled static one" precedent
#      this file already established for Chromium.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    curl \
    wget \
    gnupg \
    ffmpeg \
    && wget -q -O /usr/share/keyrings/google-chrome-keyring.gpg https://dl.google.com/linux/linux_signing_key.pub \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Use system Chrome — bypasses puppeteer-core's version check entirely, AND
# (unlike Debian's `chromium` package) actually has H.264 WebCodecs decode
# AND encode, which Revideo's renderer hard-requires regardless of source
# video format (see the long comment above).
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROMIUM_FLAGS="--no-sandbox --disable-setuid-sandbox --no-zygote --disable-dev-shm-usage"

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN chown -R node:node /usr/src/app
USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD [ "node", "server.js" ]
