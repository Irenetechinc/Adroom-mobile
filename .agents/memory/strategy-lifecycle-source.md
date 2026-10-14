---
name: Strategy lifecycle source
description: Which table is authoritative for whether a campaign is running
---

Use `strategies` with `is_active = true` and `status = 'active'` as the source of truth for currently running strategies. `strategy_memory` is supplemental campaign context and performance data; its row or active status may be absent even when the canonical strategy is active.

**Why:** Activation updates the canonical strategy row, while several legacy consumers relied only on `strategy_memory` and falsely reported no active campaign.

**How to apply:** Use canonical strategy rows for scheduler eligibility and active-strategy lists. Read `strategy_memory` only as optional enrichment, and tolerate a missing row.
