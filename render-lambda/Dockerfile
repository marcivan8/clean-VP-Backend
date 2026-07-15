FROM public.ecr.aws/lambda/nodejs:20

# Install dependencies required for Headless Chromium and FFmpeg
RUN dnf update -y && \
    dnf install -y \
    alsa-lib \
    atk \
    cups-libs \
    gtk3 \
    libXcomposite \
    libXcursor \
    libXdamage \
    libXext \
    libXi \
    libXrandr \
    libXScrnSaver \
    libXtst \
    pango \
    at-spi2-atk \
    libXt \
    xorg-x11-server-Xvfb \
    xorg-x11-xauth \
    dbus-glib \
    dbus-glib-devel \
    nss \
    mesa-libgbm \
    tar \
    xz \
    && dnf clean all

# Install all platform fonts so Chromium/fontconfig can resolve every
# fontFamily string used in timeline.tsx (Anton, Bebas Neue, Inter, etc.).
# Source: jsDelivr CDN of @fontsource v4 — same CDN used by exportProcessor.js.
# fontconfig reads each TTF's internal family-name metadata, so Chromium's
# CSS `font-family: "Bebas Neue"` lookup works without any code changes.
# fc-cache builds the index at build time; Chromium reads it at render time.
RUN mkdir -p /usr/share/fonts/vibed && \
    BASE="https://cdn.jsdelivr.net/npm/@fontsource" && \
    for spec in \
        "anton@4/files/anton-latin-400-normal.ttf:Anton-Regular.ttf" \
        "bebas-neue@4/files/bebas-neue-latin-400-normal.ttf:BebasNeue-Regular.ttf" \
        "montserrat@4/files/montserrat-latin-800-normal.ttf:Montserrat-Bold.ttf" \
        "inter@4/files/inter-latin-400-normal.ttf:Inter-Regular.ttf" \
        "barlow-condensed@4/files/barlow-condensed-latin-700-normal.ttf:BarlowCondensed-Bold.ttf" \
        "playfair-display@4/files/playfair-display-latin-400-normal.ttf:PlayfairDisplay-Regular.ttf" \
        "lora@4/files/lora-latin-400-normal.ttf:Lora-Regular.ttf" \
        "merriweather@4/files/merriweather-latin-400-normal.ttf:Merriweather-Regular.ttf" \
        "dm-serif-display@4/files/dm-serif-display-latin-400-normal.ttf:DMSerifDisplay-Regular.ttf" \
        "cormorant-garamond@4/files/cormorant-garamond-latin-400-normal.ttf:CormorantGaramond-Regular.ttf" \
        "nunito@4/files/nunito-latin-400-normal.ttf:Nunito-Regular.ttf" \
        "poppins@4/files/poppins-latin-400-normal.ttf:Poppins-Regular.ttf" \
        "quicksand@4/files/quicksand-latin-400-normal.ttf:Quicksand-Regular.ttf" \
        "josefin-sans@4/files/josefin-sans-latin-400-normal.ttf:JosefinSans-Regular.ttf" \
        "raleway@4/files/raleway-latin-400-normal.ttf:Raleway-Regular.ttf" \
        "rajdhani@4/files/rajdhani-latin-400-normal.ttf:Rajdhani-Regular.ttf" \
        "exo-2@4/files/exo-2-latin-400-normal.ttf:Exo2-Regular.ttf" \
        "orbitron@4/files/orbitron-latin-400-normal.ttf:Orbitron-Regular.ttf" \
        "oxanium@4/files/oxanium-latin-400-normal.ttf:Oxanium-Regular.ttf" \
        "roboto-condensed@4/files/roboto-condensed-latin-400-normal.ttf:RobotoCondensed-Regular.ttf" \
        "oswald@4/files/oswald-latin-400-normal.ttf:Oswald-Regular.ttf" \
        "teko@4/files/teko-latin-400-normal.ttf:Teko-Regular.ttf" \
        "black-han-sans@4/files/black-han-sans-latin-400-normal.ttf:BlackHanSans-Regular.ttf" \
        "saira-condensed@4/files/saira-condensed-latin-400-normal.ttf:SairaCondensed-Regular.ttf" \
        "cabin@4/files/cabin-latin-400-normal.ttf:Cabin-Regular.ttf" \
        "caveat@4/files/caveat-latin-400-normal.ttf:Caveat-Regular.ttf" \
        "pacifico@4/files/pacifico-latin-400-normal.ttf:Pacifico-Regular.ttf" \
        "kalam@4/files/kalam-latin-400-normal.ttf:Kalam-Regular.ttf" \
        "satisfy@4/files/satisfy-latin-400-normal.ttf:Satisfy-Regular.ttf" \
        "dancing-script@4/files/dancing-script-latin-400-normal.ttf:DancingScript-Regular.ttf" \
        "boogaloo@4/files/boogaloo-latin-400-normal.ttf:Boogaloo-Regular.ttf" \
        "righteous@4/files/righteous-latin-400-normal.ttf:Righteous-Regular.ttf" \
        "press-start-2p@4/files/press-start-2p-latin-400-normal.ttf:PressStart2P-Regular.ttf" \
        "audiowide@4/files/audiowide-latin-400-normal.ttf:Audiowide-Regular.ttf" \
    ; do \
        src="${spec%%:*}"; dest="${spec##*:}"; \
        curl -sfL "${BASE}/${src}" -o "/usr/share/fonts/vibed/${dest}" \
            && echo "✓ ${dest}" \
            || echo "✗ ${dest} (skipped — will fall back to sans-serif)"; \
    done && \
    fc-cache -fv /usr/share/fonts/vibed

# Install static FFmpeg
RUN curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz | tar xJ && \
    mv ffmpeg-*-static/ffmpeg /usr/local/bin/ && \
    mv ffmpeg-*-static/ffprobe /usr/local/bin/ && \
    rm -rf ffmpeg-*-static

# Copy package.json and install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy compiled source code and Revideo project files
COPY dist/index.js ./index.js
COPY revideo ./revideo

# Set the Lambda handler entrypoint
CMD [ "index.handler" ]
