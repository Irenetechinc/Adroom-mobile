---
name: WhatsApp live sessions
description: Runtime and persistence constraints for personal WhatsApp automation through Baileys.
---

Baileys personal-account inbound messages should be captured from the live socket and buffered for the shared lead pipeline. A freshly materialized multi-file auth bundle is not a reliable historical-message API.

**Why:** The existing inbound service polls all personal providers through one interface, but WhatsApp history retrieval from a temporary auth bundle can silently return no messages. Keeping a live socket is required for inbound replies and should be combined with encrypted credential updates for restart recovery.

**How to apply:** Preserve the shared `PersonalInboundMessage` path and keep session material server-side and encrypted. Do not expose auth bundles or replace live-event handling with fabricated history results.

For Baileys 7 pairing-code sessions, use a canonical browser/OS tuple such as Chrome on Ubuntu, wait for the actual `creds.update` write before persisting a first-link bundle, and treat the post-link 515/restartRequired close as a reconnect path.

**Why:** Baileys rc14 can produce phone-rejected pairing codes from custom browser labels, and a successful first link normally restarts the socket before it reaches `connection: open`.

**How to apply:** Keep pairing credentials in the temporary auth directory until first-link finalization has saved them to Supabase; then rebuild the live socket from the encrypted bundle.