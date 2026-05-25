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

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    curl \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# Use system Chromium — bypasses puppeteer-core version check entirely
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROMIUM_FLAGS="--no-sandbox --disable-setuid-sandbox --no-zygote --disable-dev-shm-usage"

COPY package*.json ./
RUN npm ci --only=production

COPY . .
COPY --from=frontend-build /app/client/dist ./client/dist

RUN chown -R node:node /usr/src/app
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

CMD [ "node", "index.js" ]
