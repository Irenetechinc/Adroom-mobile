# Build the backend with compiler tooling isolated from the runtime image.
FROM node:20-bookworm-slim AS builder

WORKDIR /app
ENV NODE_ENV=development
ENV NPM_CONFIG_PRODUCTION=false

# Install the exact backend dependency graph, including build-only packages.
COPY backend/package*.json ./
RUN npm ci --legacy-peer-deps --include=dev --ignore-scripts

COPY backend/ ./

# Fail at the install/build boundary if the compiler was not installed.
RUN test -x node_modules/.bin/tsc
RUN npm run build

# Production image: no TypeScript, ts-node, or @types packages.
FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY backend/package*.json ./
RUN npm ci --legacy-peer-deps --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public /public

# The admin route resolves this file from the container root at runtime.
COPY admin-critic.html /admin-critic.html

EXPOSE 8000
CMD ["node", "dist/server.js"]