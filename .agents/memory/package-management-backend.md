---
name: Backend dependency verification
description: Dependency-install behavior in this mixed Expo and backend workspace
---

Package installation through the workspace package manager targets the repository root, not the nested backend package. It can add backend packages and internal registry URLs to the root lockfile even when the backend already owns those dependencies; the package-manager sandbox may also not populate the shell's root node_modules.

**Why:** A verification install changed the root lockfile and initially left the backend build missing declarations, creating unrelated project drift; a later clean shell install was needed for root Expo/Jest checks.

**How to apply:** Prefer the backend workflow's own install command for backend dependencies. If a package-manager install is needed for verification, inspect and restore unrelated root manifest or lockfile changes before finishing.

The backend lockfile currently relies on npm's `legacy-peer-deps` resolution because Baileys declares media peers such as `sharp`; Docker builds must use the same flag as local backend installs.

**Why:** Plain `npm ci` rejects the lockfile before compilation with missing peer packages, even though the legacy-peer-deps install succeeds.

**How to apply:** Keep Dockerfile and Railway install commands aligned with the backend workflow; do not add native media packages solely to satisfy plain peer resolution unless the backend actually needs them.

When compiling the backend in a production environment, explicitly include development dependencies during the install step (`--include=dev`) so build tools such as TypeScript are available before pruning runtime dependencies.

**Why:** `NODE_ENV=production` causes npm to omit development packages by default, which can make `npm run build` fail with `tsc: not found`.

**How to apply:** Use the dev-inclusive install for the build stage, then prune only after compilation in a multi-stage or production image workflow.

The production backend image uses separate builder and runtime stages; TypeScript, ts-node, and type packages belong only in the builder install, while the runtime uses `npm ci --omit=dev`.

**Why:** A single-stage production build intermittently omitted the compiler under Railway's production environment and also kept build tooling in the runtime image.

**How to apply:** Keep build-only packages in `devDependencies`, compile in the builder stage, and copy only compiled output plus production dependencies into the final image.