---
name: Credential-free discovery routing
description: Rules for AgentReach discovery, selected-platform scope, and personal-channel safety.
---

Web is the credential-free discovery fallback. Social discovery sources are opt-in from the strategy's selected platforms, and discovery-only web results must never be treated as an outbound account.

**Why:** Running every social source by default creates noisy searches, can widen work beyond the user's account selection, and produces invalid web engagement tasks.

**How to apply:** Keep `web` as the only default source, add only normalized selected platforms, and require a real selected-platform recipient before routing personal-channel engagement.