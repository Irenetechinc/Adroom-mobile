---
name: Public profile tool boundaries
description: Durable constraints for vendored public-profile discovery tools and their lead-enrichment worker.
---

Public-profile enrichment must run in the backend queue, never inline inside conversation discovery or a user-facing request. Vendored tools receive usernames only, run with bounded subprocess/HTTP timeouts, and fall back to credential-free web search when a runtime or upstream service is unavailable. Only sanitized public evidence may be persisted to user-visible profile records.

**Why:** The requested upstream tools have incompatible interfaces and optional runtime dependencies; some are browser extensions or credentialed services. Inline execution would block lead discovery and make an unavailable tool look like a failed lead pipeline.

**How to apply:** Preserve the queue/claim/retry path, backend-only vendor directory, pinned revision manifest, public-only input validation, output-size limits, deduplication, and sensitive-data filtering when adding or replacing discovery adapters.