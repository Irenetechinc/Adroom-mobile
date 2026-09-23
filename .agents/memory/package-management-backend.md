---
name: Backend dependency verification
description: Dependency-install behavior in this mixed Expo and backend workspace
---

Package installation through the workspace package manager targets the repository root, not the nested backend package. It can add backend packages and internal registry URLs to the root lockfile even when the backend already owns those dependencies.

**Why:** A verification install changed the root lockfile and initially left the backend build missing declarations, creating unrelated project drift.

**How to apply:** Prefer the backend workflow's own install command for backend dependencies. If a package-manager install is needed for verification, inspect and restore unrelated root manifest or lockfile changes before finishing.

The backend lockfile currently relies on npm's `legacy-peer-deps` resolution because Baileys declares media peers such as `sharp`; Docker builds must use the same flag as local backend installs.

**Why:** Plain `npm ci` rejects the lockfile before compilation with missing peer packages, even though the legacy-peer-deps install succeeds.

**How to apply:** Keep Dockerfile and Railway install commands aligned with the backend workflow; do not add native media packages solely to satisfy plain peer resolution unless the backend actually needs them.