# Build the backend with compiler tooling isolated from the runtime image.
FROM node:20-bookworm-slim AS builder

WORKDIR /app
ENV NODE_ENV=development
ENV NPM_CONFIG_PRODUCTION=false

# The backend invokes the vendored public-profile CLIs in controlled
# subprocesses. Osintgraph is intentionally not installed here because it is
# credential-gated and disabled unless explicitly configured.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install the exact backend dependency graph, including build-only packages.
COPY backend/package*.json ./
RUN npm ci --legacy-peer-deps --include=dev --ignore-scripts

COPY backend/ ./

# Fail at the install/build boundary if the compiler was not installed.
RUN test -x node_modules/.bin/tsc
# Install only the credential-free public-profile CLIs from their vendored
# pyproject files. Their source revisions are pinned in tools/vendor/
# profile-tools.manifest.json.
RUN python3 -m pip install --no-cache-dir --break-system-packages \
    -e ./tools/vendor/maigret \
    -e ./tools/vendor/helix
RUN npm run build

# Production image: no TypeScript, ts-node, or @types packages.
FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# The runtime adapter launches Maigret and Helix from the controlled vendor
# directory. Keep the same runtime dependencies available after the builder
# stage is discarded.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
RUN npm ci --legacy-peer-deps --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/tools ./tools
COPY --from=builder /app/public /public

RUN python3 -m pip install --no-cache-dir --break-system-packages \
    -e ./tools/vendor/maigret \
    -e ./tools/vendor/helix

# The admin route resolves this file from the container root at runtime.
COPY admin-critic.html /admin-critic.html

EXPOSE 8000
CMD ["node", "dist/server.js"]