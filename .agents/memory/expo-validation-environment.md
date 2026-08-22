---
name: Expo validation environment
description: Local dependency-install behavior that affects Expo and TypeScript validation.
---

The workspace exports `NODE_ENV=production`, which causes npm installs here to omit development dependencies such as TypeScript and Jest even when they are declared in `package.json`.

**Why:** This can make local typecheck/test commands fail with missing binaries even though the Expo dependency graph is valid and an external EAS builder installs dev dependencies normally.

**How to apply:** For Expo build validation, prioritize `expo-doctor`, `npm ci --dry-run`, lockfile registry checks, and referenced-asset checks. Treat missing local dev binaries as an environment setup issue, not as evidence of an Expo SDK mismatch.