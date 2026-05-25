FROM node:20-slim
WORKDIR /usr/src/app

# Install system dependencies needed for canvas/sharp/tensorflow and headless chrome
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

RUN chown -R node:node /usr/src/app
USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD [ "node", "server.js" ]
