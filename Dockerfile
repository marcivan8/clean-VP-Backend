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

# Download caption fonts at build time via jsDelivr (@fontsource v4 TTF files).
# Uses individual curl calls — no bash-specific syntax (declare -A), so this
# works correctly under Debian's /bin/sh (dash). Each font is independent;
# || true ensures a single CDN miss doesn't abort the build.
RUN set -e && mkdir -p /usr/src/app/client/public/fonts && F=/usr/src/app/client/public/fonts && B=https://cdn.jsdelivr.net/npm/@fontsource && \
    curl -sfL "${B}/anton@4/files/anton-latin-400-normal.ttf"               -o "${F}/Anton-Regular.ttf"              && echo "✓ Anton"         || echo "✗ Anton (skipped)"; \
    curl -sfL "${B}/bebas-neue@4/files/bebas-neue-latin-400-normal.ttf"     -o "${F}/BebasNeue-Regular.ttf"          && echo "✓ BebasNeue"     || echo "✗ BebasNeue (skipped)"; \
    curl -sfL "${B}/montserrat@4/files/montserrat-latin-800-normal.ttf"     -o "${F}/Montserrat-Bold.ttf"            && echo "✓ Montserrat"    || echo "✗ Montserrat (skipped)"; \
    curl -sfL "${B}/oswald@4/files/oswald-latin-400-normal.ttf"             -o "${F}/Oswald-Regular.ttf"             && echo "✓ Oswald"        || echo "✗ Oswald (skipped)"; \
    curl -sfL "${B}/inter@4/files/inter-latin-400-normal.ttf"               -o "${F}/Inter-Regular.ttf"              && echo "✓ Inter"         || echo "✗ Inter (skipped)"; \
    curl -sfL "${B}/nunito@4/files/nunito-latin-400-normal.ttf"             -o "${F}/Nunito-Regular.ttf"             && echo "✓ Nunito"        || echo "✗ Nunito (skipped)"; \
    curl -sfL "${B}/playfair-display@4/files/playfair-display-latin-400-normal.ttf" -o "${F}/PlayfairDisplay-Regular.ttf"  && echo "✓ Playfair"      || echo "✗ Playfair (skipped)"; \
    curl -sfL "${B}/caveat@4/files/caveat-latin-400-normal.ttf"             -o "${F}/Caveat-Regular.ttf"             && echo "✓ Caveat"        || echo "✗ Caveat (skipped)"; \
    curl -sfL "${B}/dm-sans@4/files/dm-sans-latin-400-normal.ttf"           -o "${F}/DMSans-Regular.ttf"             && echo "✓ DM Sans"       || echo "✗ DM Sans (skipped)"; \
    curl -sfL "${B}/unbounded@4/files/unbounded-latin-400-normal.ttf"       -o "${F}/Unbounded-Regular.ttf"          && echo "✓ Unbounded"     || echo "✗ Unbounded (skipped)"; \
    curl -sfL "${B}/cormorant-garamond@4/files/cormorant-garamond-latin-400-normal.ttf" -o "${F}/CormorantGaramond-Regular.ttf" && echo "✓ Cormorant" || echo "✗ Cormorant (skipped)"; \
    true

RUN chown -R node:node /usr/src/app
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

CMD [ "node", "index.js" ]
