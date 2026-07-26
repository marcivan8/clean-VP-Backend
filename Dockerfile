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
#
# IMPORTANT: this list must match jobs/exportProcessor.js's FONT_SPECS exactly
# (see CLAUDE.md EXT2). Every font offered in TextPanel.jsx / CaptionStylesCard
# needs a line here — otherwise it has no pre-baked file and depends entirely on
# a live jsDelivr/Google Fonts fetch succeeding *during* the export job, which
# fails silently into the Anton fallback when it doesn't (this is exactly the
# bug that was previously making captions "always fall back to the presaved
# font" for any font outside this list).
RUN set -e && mkdir -p /usr/src/app/client/public/fonts && F=/usr/src/app/client/public/fonts && B=https://cdn.jsdelivr.net/npm/@fontsource && \
    curl -sfL "${B}/anton@4/files/anton-latin-400-normal.ttf"               -o "${F}/Anton-Regular.ttf"              && echo "✓ Anton"         || echo "✗ Anton (skipped)"; \
    curl -sfL "${B}/bebas-neue@4/files/bebas-neue-latin-400-normal.ttf"     -o "${F}/BebasNeue-Regular.ttf"          && echo "✓ BebasNeue"     || echo "✗ BebasNeue (skipped)"; \
    curl -sfL "${B}/montserrat@4/files/montserrat-latin-800-normal.ttf"     -o "${F}/Montserrat-Bold.ttf"            && echo "✓ Montserrat"    || echo "✗ Montserrat (skipped)"; \
    curl -sfL "${B}/inter@4/files/inter-latin-400-normal.ttf"               -o "${F}/Inter-Regular.ttf"              && echo "✓ Inter"         || echo "✗ Inter (skipped)"; \
    curl -sfL "${B}/barlow-condensed@4/files/barlow-condensed-latin-700-normal.ttf" -o "${F}/BarlowCondensed-Bold.ttf" && echo "✓ BarlowCondensed" || echo "✗ BarlowCondensed (skipped)"; \
    curl -sfL "${B}/playfair-display@4/files/playfair-display-latin-400-normal.ttf" -o "${F}/PlayfairDisplay-Regular.ttf"  && echo "✓ Playfair"      || echo "✗ Playfair (skipped)"; \
    curl -sfL "${B}/lora@4/files/lora-latin-400-normal.ttf"                 -o "${F}/Lora-Regular.ttf"               && echo "✓ Lora"          || echo "✗ Lora (skipped)"; \
    curl -sfL "${B}/merriweather@4/files/merriweather-latin-400-normal.ttf" -o "${F}/Merriweather-Regular.ttf"       && echo "✓ Merriweather"  || echo "✗ Merriweather (skipped)"; \
    curl -sfL "${B}/dm-serif-display@4/files/dm-serif-display-latin-400-normal.ttf" -o "${F}/DMSerifDisplay-Regular.ttf" && echo "✓ DMSerifDisplay" || echo "✗ DMSerifDisplay (skipped)"; \
    curl -sfL "${B}/cormorant-garamond@4/files/cormorant-garamond-latin-400-normal.ttf" -o "${F}/CormorantGaramond-Regular.ttf" && echo "✓ Cormorant" || echo "✗ Cormorant (skipped)"; \
    curl -sfL "${B}/nunito@4/files/nunito-latin-400-normal.ttf"             -o "${F}/Nunito-Regular.ttf"             && echo "✓ Nunito"        || echo "✗ Nunito (skipped)"; \
    curl -sfL "${B}/poppins@4/files/poppins-latin-400-normal.ttf"           -o "${F}/Poppins-Regular.ttf"            && echo "✓ Poppins"       || echo "✗ Poppins (skipped)"; \
    curl -sfL "${B}/quicksand@4/files/quicksand-latin-400-normal.ttf"       -o "${F}/Quicksand-Regular.ttf"          && echo "✓ Quicksand"     || echo "✗ Quicksand (skipped)"; \
    curl -sfL "${B}/josefin-sans@4/files/josefin-sans-latin-400-normal.ttf" -o "${F}/JosefinSans-Regular.ttf"        && echo "✓ JosefinSans"   || echo "✗ JosefinSans (skipped)"; \
    curl -sfL "${B}/raleway@4/files/raleway-latin-400-normal.ttf"           -o "${F}/Raleway-Regular.ttf"            && echo "✓ Raleway"       || echo "✗ Raleway (skipped)"; \
    curl -sfL "${B}/rajdhani@4/files/rajdhani-latin-400-normal.ttf"         -o "${F}/Rajdhani-Regular.ttf"           && echo "✓ Rajdhani"      || echo "✗ Rajdhani (skipped)"; \
    curl -sfL "${B}/exo-2@4/files/exo-2-latin-400-normal.ttf"               -o "${F}/Exo2-Regular.ttf"               && echo "✓ Exo2"          || echo "✗ Exo2 (skipped)"; \
    curl -sfL "${B}/orbitron@4/files/orbitron-latin-400-normal.ttf"         -o "${F}/Orbitron-Regular.ttf"           && echo "✓ Orbitron"      || echo "✗ Orbitron (skipped)"; \
    curl -sfL "${B}/oxanium@4/files/oxanium-latin-400-normal.ttf"           -o "${F}/Oxanium-Regular.ttf"            && echo "✓ Oxanium"       || echo "✗ Oxanium (skipped)"; \
    curl -sfL "${B}/roboto-condensed@4/files/roboto-condensed-latin-400-normal.ttf" -o "${F}/RobotoCondensed-Regular.ttf" && echo "✓ RobotoCondensed" || echo "✗ RobotoCondensed (skipped)"; \
    curl -sfL "${B}/oswald@4/files/oswald-latin-400-normal.ttf"             -o "${F}/Oswald-Regular.ttf"             && echo "✓ Oswald"        || echo "✗ Oswald (skipped)"; \
    curl -sfL "${B}/teko@4/files/teko-latin-400-normal.ttf"                 -o "${F}/Teko-Regular.ttf"               && echo "✓ Teko"          || echo "✗ Teko (skipped)"; \
    curl -sfL "${B}/black-han-sans@4/files/black-han-sans-latin-400-normal.ttf" -o "${F}/BlackHanSans-Regular.ttf"  && echo "✓ BlackHanSans"  || echo "✗ BlackHanSans (skipped)"; \
    curl -sfL "${B}/saira-condensed@4/files/saira-condensed-latin-400-normal.ttf" -o "${F}/SairaCondensed-Regular.ttf" && echo "✓ SairaCondensed" || echo "✗ SairaCondensed (skipped)"; \
    curl -sfL "${B}/cabin@4/files/cabin-latin-400-normal.ttf"               -o "${F}/Cabin-Regular.ttf"              && echo "✓ Cabin"         || echo "✗ Cabin (skipped)"; \
    curl -sfL "${B}/caveat@4/files/caveat-latin-400-normal.ttf"             -o "${F}/Caveat-Regular.ttf"             && echo "✓ Caveat"        || echo "✗ Caveat (skipped)"; \
    curl -sfL "${B}/pacifico@4/files/pacifico-latin-400-normal.ttf"         -o "${F}/Pacifico-Regular.ttf"           && echo "✓ Pacifico"      || echo "✗ Pacifico (skipped)"; \
    curl -sfL "${B}/kalam@4/files/kalam-latin-400-normal.ttf"               -o "${F}/Kalam-Regular.ttf"              && echo "✓ Kalam"         || echo "✗ Kalam (skipped)"; \
    curl -sfL "${B}/satisfy@4/files/satisfy-latin-400-normal.ttf"           -o "${F}/Satisfy-Regular.ttf"            && echo "✓ Satisfy"       || echo "✗ Satisfy (skipped)"; \
    curl -sfL "${B}/dancing-script@4/files/dancing-script-latin-400-normal.ttf" -o "${F}/DancingScript-Regular.ttf" && echo "✓ DancingScript" || echo "✗ DancingScript (skipped)"; \
    curl -sfL "${B}/boogaloo@4/files/boogaloo-latin-400-normal.ttf"         -o "${F}/Boogaloo-Regular.ttf"           && echo "✓ Boogaloo"      || echo "✗ Boogaloo (skipped)"; \
    curl -sfL "${B}/righteous@4/files/righteous-latin-400-normal.ttf"       -o "${F}/Righteous-Regular.ttf"          && echo "✓ Righteous"     || echo "✗ Righteous (skipped)"; \
    curl -sfL "${B}/press-start-2p@4/files/press-start-2p-latin-400-normal.ttf" -o "${F}/PressStart2P-Regular.ttf"  && echo "✓ PressStart2P"  || echo "✗ PressStart2P (skipped)"; \
    curl -sfL "${B}/audiowide@4/files/audiowide-latin-400-normal.ttf"       -o "${F}/Audiowide-Regular.ttf"          && echo "✓ Audiowide"     || echo "✗ Audiowide (skipped)"; \
    curl -sfL "${B}/dm-sans@4/files/dm-sans-latin-400-normal.ttf"           -o "${F}/DMSans-Regular.ttf"             && echo "✓ DM Sans"       || echo "✗ DM Sans (skipped)"; \
    curl -sfL "${B}/unbounded@4/files/unbounded-latin-400-normal.ttf"       -o "${F}/Unbounded-Regular.ttf"          && echo "✓ Unbounded"     || echo "✗ Unbounded (skipped)"; \
    true

RUN chown -R node:node /usr/src/app
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

CMD [ "node", "index.js" ]
