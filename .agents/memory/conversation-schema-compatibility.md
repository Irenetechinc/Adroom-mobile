---
name: Conversation schema compatibility
description: Lead and strategy conversation readers depend on timestamp and realtime tables that must be migrated in Supabase.
---

The conversation coordinator and mobile lead screens rely on Supabase-native run/signal tables and on `lead_dm_messages.created_at`; keep migrations aligned with the existing readers when extending lead discovery.

**Why:** The imported project had backend SQL that created `sent_at` while readers queried `created_at`, and conversation tables were referenced in code without a corresponding Supabase migration.

**How to apply:** When changing conversation persistence, check backend queries and mobile realtime subscriptions, use forward-compatible Supabase migrations, and write both `message_timestamp` and `received_at` during the mixed-schema transition.

Product context has a similar compatibility constraint: the live `product_memory` schema uses the `images` JSONB field, not a guaranteed `image_url` column. Select only canonical migrated columns and normalize optional image aliases in application code.

**Why:** A product-context query that selected the optional alias caused Conversation Agent lookup failures against the applied Supabase schema.

**How to apply:** Before adding a `product_memory` field to a narrow `.select(...)`, confirm it exists in the Supabase migrations; prefer `images` and `normalizeOfferContext()` for image compatibility.