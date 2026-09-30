---
name: Audience report storage
description: Keep user-specific audience intelligence isolated from globally shared platform feed data.
---

Store per-user audience analyses in a dedicated table rather than adding user-owned report rows to the global platform intelligence feed. Enforce ownership in both the authenticated API query and row-level security, and make backend upserts verify that a row was returned.

**Why:** The global feed can be readable by all authenticated users and has a platform-keyed schema; mixing audience reports into it risks write failures and cross-user disclosure.

**How to apply:** For other user-owned intelligence, define a dedicated report schema, a unique key that matches the writer's upsert conflict target, service-role-only writes, and authenticated SELECT policies scoped to the owner and strategy.