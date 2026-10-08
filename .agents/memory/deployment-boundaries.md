---
name: Deployment boundary
description: The user's standing deployment and package-registry constraint for this project.
---

Keep this project’s backend deployment on Railway. Do not add Replit deployment dependencies, Replit runtime dependencies, Replit npm registry URLs, or new development dependencies.

**Why:** the user explicitly asked to keep Replit-specific dependencies and URLs out and not to add development dependencies because this is a production app.

**How to apply:** preserve the Railway setup, use the public npm registry, and do not add dev-only packages when implementing or verifying changes.