---
name: Email channel requirements
description: The low-friction, server-managed boundary for connecting user mailboxes.
---

Users should connect their own mailbox through provider detection and provider OAuth or the minimum required mailbox/app password. Do not ask end users for IMAP/SMTP hosts or ports, app-owned OAuth client credentials, deployment configuration, or unrelated command-line bridge runtimes. App-owned integration credentials belong on the server; per-user mailbox credentials must stay encrypted server-side and out of client responses and AI prompts. Keep existing social account flows intact.

**Why:** The user explicitly requires connecting accounts without technical setup and does not want server configuration burden shifted to each customer.

**How to apply:** For new email-provider work, detect provider settings on the backend, keep secrets server-side, make limitations such as DNS ownership explicit, and preserve the existing platform connection paths.
