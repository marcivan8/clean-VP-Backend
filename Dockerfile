# Use a specific Node.js version
FROM node:20-alpine

# Install dependencies for canvas
RUN apk add --no-cache build-base cairo-dev jpeg-dev pango-dev giflib-dev python3 libc6-compat

# Set the working directory
WORKDIR /usr/src/app

# Create a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies and prune dev dependencies
RUN npm install --production

# Copy the rest of the application code
COPY . .

# Change ownership of the files to the non-root user
RUN chown -R appuser:appgroup /usr/src/app

# Switch to the non-root user
USER appuser

# Expose the port
EXPOSE 3000

# Add a health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 CMD [ "node", "-e", "require('http').get('http://localhost:3000', (res) => process.exit(res.statusCode == 200 ? 0 : 1))" ]

# Start the application
CMD [ "node", "index.js" ]
