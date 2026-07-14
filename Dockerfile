# --- Stage 1: Build the React Frontend ---
FROM node:20-slim AS frontend-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build

# --- Stage 2: Setup the Backend ---
FROM node:20-slim
WORKDIR /usr/src/app

# Install system dependencies needed for canvas/sharp/tensorflow
# ffmpeg is installed here (not just ffmpeg-static) because the static npm build
# omits libfreetype, which is required by the drawtext filter used for caption export.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    curl \
    ffmpeg \
    fonts-liberation \
    fonts-dejavu-core \
    fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --only=production

COPY . .
COPY --from=frontend-build /app/client/dist ./client/dist

# Download caption fonts for FFmpeg drawtext at build time.
# Uses the legacy CSS1 endpoint with an old UA to get TTF (not woff2) URLs.
# If the download fails (e.g. network restricted build env), the worker will
# attempt to download them on first export instead (see exportProcessor.js).
RUN for family in "Anton" "Bebas+Neue" "Oswald" "Montserrat:700"; do \
      cssUrl="https://fonts.googleapis.com/css?family=${family}"; \
      ttfUrl=$(curl -sf -A "Mozilla/4.0 (compatible; MSIE 6.0)" "$cssUrl" \
               | grep -oP 'url\(\K[^)]+\.ttf(?=\))' | head -1); \
      [ -n "$ttfUrl" ] && \
        name=$(echo "$family" | sed 's/:.*//;s/+/ /g' | tr -d ' ') && \
        curl -sfL "$ttfUrl" -o "/usr/src/app/client/public/fonts/${name}-Regular.ttf" && \
        echo "Downloaded $name font" || echo "Skipped $family (network unavailable)"; \
    done

RUN chown -R node:node /usr/src/app
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

CMD [ "node", "index.js" ]
