---
name: Root package install drift
description: Workspace package-install behavior that can alter root manifest and lockfile metadata.
---

Package installation helpers may rewrite declared semver ranges and lockfile registry URLs even when the requested packages are already declared.

**Why:** This can create unrelated dependency drift in a project whose backend and mobile installs are intentionally managed separately.

**How to apply:** After using a root package helper, inspect `package.json` and `package-lock.json`; restore unrelated changes before delivery and prefer the backend-specific workflow for backend dependencies.

The environment-level npm registry can differ from the `resolved` origins embedded in `package-lock.json`; a public-only lockfile does not prove which registry a workspace install contacts.

**Why:** Environment configuration can shadow project defaults, even when the repository itself contains only public registry URLs.

**How to apply:** Compare `npm config get registry` with the lockfile's `resolved` origins when checking package provenance.