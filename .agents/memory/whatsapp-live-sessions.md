---
name: WhatsApp live sessions
description: Runtime and persistence constraints for personal WhatsApp automation through Baileys.
---

Baileys personal-account inbound messages should be captured from the live socket and buffered for the shared lead pipeline. A freshly materialized multi-file auth bundle is not a reliable historical-message API.

**Why:** The existing inbound service polls all personal providers through one interface, but WhatsApp history retrieval from a temporary auth bundle can silently return no messages. Keeping a live socket is required for inbound replies and should be combined with encrypted credential updates for restart recovery.

**How to apply:** Preserve the shared `PersonalInboundMessage` path and keep session material server-side and encrypted. Do not expose auth bundles or replace live-event handling with fabricated history results.