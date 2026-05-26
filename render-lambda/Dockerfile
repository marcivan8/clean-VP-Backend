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
