# Use official Node.js image
FROM node:18-bookworm-slim

# Required by the deterministic uploaded-video editing pipeline.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ffmpeg python3 python3-pip \
	&& rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDeps needed for tsc)
RUN npm install --registry=https://registry.npmjs.org/ --legacy-peer-deps

# Copy source code
COPY src ./src
COPY bin ./bin
COPY vendor ./vendor

# Runtime dependencies for the backend-only public-profile discovery adapters.
# Osintgraph is intentionally excluded because it requires configured
# Instagram/Neo4j credentials and remains disabled unless explicitly enabled.
RUN python3 -m pip install --no-cache-dir --break-system-packages \
    -e ./vendor/maigret \
    -e ./vendor/helix

# Runtime dependencies for the vendored deterministic beat-sync pipeline.
RUN python3 -m pip install --no-cache-dir --break-system-packages -r vendor/video-tools/beat-synced-edit/requirements.txt

# Build TypeScript code
RUN npm run build

# Remove devDependencies to reduce image size
RUN npm prune --production

# Expose the port the app runs on
EXPOSE 8000

# Start the server
CMD ["node", "dist/server.js"]
