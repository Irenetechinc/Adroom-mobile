---
name: Deployment boundary
description: The user's standing deployment and package-registry constraint for this project.
---

Keep this project’s backend server on Railway and its database on Supabase. Do not add Railway-specific npm packages, runtime or deployment dependencies, SDKs, or URLs. Also keep Replit-specific dependencies and registry URLs out; use the public npm registry.

**Why:** the user explicitly requires Railway for the backend server and Supabase for the database, while prohibiting Railway-specific dependencies or URLs and Replit-specific dependencies or URLs.

**How to apply:** preserve the existing server/database arrangement; do not introduce platform-specific packages or URLs. Use public npm packages only when a dependency is necessary.