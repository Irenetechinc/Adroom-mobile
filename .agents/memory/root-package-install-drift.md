---
name: Root package install drift
description: Workspace package-install behavior that can alter root manifest and lockfile metadata.
---

Package installation helpers may rewrite declared semver ranges and lockfile registry URLs even when the requested packages are already declared.

**Why:** This can create unrelated dependency drift in a project whose backend and mobile installs are intentionally managed separately.

**How to apply:** After using a root package helper, inspect `package.json` and `package-lock.json`; restore unrelated changes before delivery and prefer the backend-specific workflow for backend dependencies.