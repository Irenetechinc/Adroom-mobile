---
name: Conversation discovery and shared research fallback
description: Public discovery and research must retain useful provider output when snippets omit query terms or AI collection is unavailable.
---

Conversation discovery should treat strict identity-plus-demand matching as a ranking preference, not a hard gate. Search titles and snippets can omit the exact query terms even when the query was offer-anchored, so bounded relaxed results must be retained and logged with the matching mode.

**Why:** A live AgentReach sweep previously returned results while the conversation pipeline persisted zero signals, which prevented lead visibility and downstream enrichment.

**How to apply:** Prefer strict matches, then single-criterion matches, then a bounded non-empty fallback. For shared research, use the credential-free AgentReach web route when AI collection returns no evidence, persist sanitized verified evidence beside the active strategy context, and let downstream agents reuse it.