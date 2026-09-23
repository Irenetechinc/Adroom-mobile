---
name: Expo push project routing
description: The delivery constraint for Expo tokens from multiple EAS projects.
---

Expo push requests must contain tokens from one EAS project only. Store the EAS project ID at registration time, group active tokens by that ID at delivery time, and retire rows without a project ID so current builds can re-register them.

**Why:** Expo rejects mixed-project batches, while sending one request per token hides the data-model problem and scales poorly.

**How to apply:** Any future push registration or delivery change must preserve project-aware storage, grouping, invalid-token cleanup, and the Supabase migration that adds `device_push_tokens.project_id`.