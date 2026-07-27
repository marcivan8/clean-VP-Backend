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

# Caption fonts are now committed as real .ttf files in client/public/fonts/
# (arrived via `COPY . .` above) instead of being fetched at build time.
#
# HISTORY / WHY: this used to curl each font from jsDelivr's @fontsource npm
# package path (`/npm/@fontsource/{slug}@4/files/{slug}-{subset}-{weight}-
# normal.ttf`) at build time. That URL was fundamentally broken — @fontsource
# v4 packages only ever shipped .woff/.woff2, never .ttf — so EVERY one of
# these curl calls 404'd, on every build, in every environment, silently
# (`|| echo "... (skipped)"` let the build continue). Captions were never
# actually using a pre-baked font; they were always falling through to
# jobs/exportProcessor.js's runtime Google Fonts legacy-API fallback or, if
# that also failed, a plain system font — which is why captions kept
# rendering in the wrong font no matter what was fixed in the app code.
#
# FIX: fonts are now sourced from the npm registry (reliable, unlike a
# specific CDN — @fontsource/{slug}@4, which DOES ship real files there) and
# converted from .woff2 to .ttf with fonttools, then committed directly into
# client/public/fonts/. Zero network dependency at build time or export time.
#
# This step just verifies the build actually contains what jobs/
# exportProcessor.js's FONT_SPECS expects — if a font file is ever
# accidentally deleted or renamed, the build fails loudly here instead of
# silently producing wrong-font captions again. See CLAUDE.md EXT2: any new
# font added to FONT_SPECS / TextPanel.jsx / CaptionStylesCard must have its
# .ttf committed to client/public/fonts/ AND a line added below.
RUN set -e && F=/usr/src/app/client/public/fonts && \
    for name in Anton-Regular BebasNeue-Regular Montserrat-Bold Inter-Regular \
        BarlowCondensed-Bold PlayfairDisplay-Regular Lora-Regular Merriweather-Regular \
        DMSerifDisplay-Regular CormorantGaramond-Regular Nunito-Regular Poppins-Regular \
        Quicksand-Regular JosefinSans-Regular Raleway-Regular Rajdhani-Regular Exo2-Regular \
        Orbitron-Regular Oxanium-Regular RobotoCondensed-Regular Oswald-Regular Teko-Regular \
        BlackHanSans-Regular SairaCondensed-Regular Cabin-Regular Caveat-Regular Pacifico-Regular \
        Kalam-Regular Satisfy-Regular DancingScript-Regular Boogaloo-Regular Righteous-Regular \
        PressStart2P-Regular Audiowide-Regular DMSans-Regular Unbounded-Regular; do \
        if [ ! -s "${F}/${name}.ttf" ]; then \
            echo "✗ Missing caption font: ${F}/${name}.ttf — commit it to client/public/fonts/ (see CLAUDE.md EXT2)"; \
            exit 1; \
        fi; \
    done; \
    echo "✓ All 36 caption fonts present"

RUN chown -R node:node /usr/src/app
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

CMD [ "node", "index.js" ]
