---
name: Public data Railway runtime
description: Runtime placement and external-service configuration for public profile discovery and legacy inbound schemas.
---

The backend must resolve vendored public-profile tools from both backend-root and repository-root Railway layouts; Deepkrak3n and J.A.R.V.I.S remain separate external services and must not be faked with the AdRoom backend URL.

**Why:** Railway can run compiled output from different working directories, while the public adapters need real tool files and honest health status. Legacy Supabase installations may also retain a NOT NULL `received_at` column during timestamp migration.

**How to apply:** Keep bounded health/process timeouts and web fallback behavior. Set `DEEPKRAK3N_BASE_URL` and `JARVIS_BASE_URL` to their actual service URLs, and apply the legacy timestamp repair migration before relying on mixed-schema inbound writes.