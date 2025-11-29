# Use Debian-based image for TensorFlow compatibility (glibc)
FROM node:20-slim

# Install dependencies for canvas and system utilities
# python3, build-essential, and pkg-config are often needed for native modules
# libcairo2-dev, libpango1.0-dev, libjpeg-dev, libgif-dev, librsvg2-dev are for canvas
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /usr/src/app

# Create a non-root user (Debian/Ubuntu usually has 'node' user, but we can create one or use 'node')
# node:20-slim comes with a 'node' user created
# We'll just ensure permissions are correct

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies and prune dev dependencies
# Note: We might need to rebuild native modules for the new architecture
RUN npm install --production

# Copy the rest of the application code
COPY . .

# Change ownership of the files to the 'node' user
RUN chown -R node:node /usr/src/app

# Switch to the non-root user
USER node

# Expose the port
EXPOSE 3000

# Add a health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 CMD [ "node", "-e", "require('http').get('http://localhost:3000', (res) => process.exit(res.statusCode == 200 ? 0 : 1))" ]

# Start the application
CMD [ "node", "index.js" ]
