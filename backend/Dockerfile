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
COPY tools/vendor ./tools/vendor

# Runtime dependencies for the backend-only public-profile discovery adapters.
RUN python3 -m pip install --no-cache-dir --break-system-packages \
    -e ./tools/vendor/maigret \
    -e ./tools/vendor/helix
# Fail the image build instead of deploying with a vendored tool that cannot
# be imported or started by the backend worker.
RUN python3 -c "import maigret; print('Maigret runtime ready')" \
    && cd ./tools/vendor/helix \
    && python3 helix.py --help >/dev/null \
    && echo "Helix runtime ready"

# Osintgraph has a larger, pinned dependency set. Keep it isolated from the
# Maigret/Helix runtime and point PROFILE_BUILDER_OSINTGRAPH_PYTHON at it only
# when its own Instagram/Neo4j credentials have been configured.
RUN python3 -m venv /opt/osintgraph-venv \
    && /opt/osintgraph-venv/bin/pip install --no-cache-dir -e ./tools/vendor/osintgraph
ENV PROFILE_BUILDER_OSINTGRAPH_PYTHON=/opt/osintgraph-venv/bin/python

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
