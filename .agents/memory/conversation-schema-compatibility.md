---
name: Conversation schema compatibility
description: Lead and strategy conversation readers depend on timestamp and realtime tables that must be migrated in Supabase.
---

The conversation coordinator and mobile lead screens rely on Supabase-native run/signal tables and on `lead_dm_messages.created_at`; keep migrations aligned with the existing readers when extending lead discovery.

**Why:** The imported project had backend SQL that created `sent_at` while readers queried `created_at`, and conversation tables were referenced in code without a corresponding Supabase migration.

**How to apply:** When changing conversation persistence, check both the Railway backend queries and mobile realtime subscriptions, then add a forward-compatible Supabase migration rather than replacing the Railway/Supabase architecture.