---
name: Email channel requirements
description: The low-friction, server-managed boundary for connecting user mailboxes.
---

Users should connect their own mailbox through provider detection and provider OAuth or the minimum required mailbox/app password. Do not ask end users for IMAP/SMTP hosts or ports, app-owned OAuth client credentials, deployment configuration, or unrelated command-line bridge runtimes. App-owned integration credentials belong on the server; per-user mailbox credentials must stay encrypted server-side and out of client responses and AI prompts. Keep existing social account flows intact.

Lead-marketing email must be sent through the user's connected mailbox provider, not Resend or another intermediary delivery service. Only use publicly listed role-based addresses verified against the business's official domain; keep the address out of AI profile-enrichment prompts. Resend remains for app-owned transactional messages.

**Why:** The user explicitly requires connecting accounts without technical setup and does not want server configuration burden shifted to each customer.

**How to apply:** For new email-provider work, detect provider settings on the backend, keep secrets server-side, make limitations such as DNS ownership explicit, and preserve the existing platform connection paths.

Keep outbound-delivery failures separate from successful inbox polling when tracking retries. A healthy inbox poll must not erase the send-failure count or shorten its exponential backoff.

**Why:** Sending and receiving can fail independently; sharing a counter can make repeated send failures look healthy after a successful poll and prevent the circuit breaker from escalating.

**How to apply:** Track send retry state separately from polling retry state, and only clear outbound backoff after a successful send or an explicitly expired cooldown.
