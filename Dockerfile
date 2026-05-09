# --- Stage 1: Build the React Frontend ---
FROM node:20-slim AS frontend-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
# Build the Vite project (outputs to /app/client/dist)
RUN npm run build

# --- Stage 2: Setup the Backend ---
FROM node:20-slim
WORKDIR /usr/src/app

# Install native module dependencies + curl for health check
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install backend dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy backend source
COPY . .

# Copy built frontend from Stage 1 into the backend's client directory
COPY --from=frontend-build /app/client/dist ./client/dist

# Ensure permissions
RUN chown -R node:node /usr/src/app

USER node
EXPOSE 3000

# Railway injects PORT dynamically — use shell form so $PORT is expanded at runtime
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

CMD [ "node", "index.js" ]
