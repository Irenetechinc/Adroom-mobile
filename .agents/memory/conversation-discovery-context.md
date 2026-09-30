---
name: Conversation discovery context
description: Discovery must be anchored to the strategy's actual product, brand, or service identity and demand language.
---

Conversation discovery must resolve the promoted offer from the strategy's product data, then search for public demand signals such as requests, recommendations, prices, availability, and buying questions. Merge the database record with any embedded strategy snapshot, preferring the fullest non-empty identity fields; a truncated database value must not replace a complete product name. A strategy title is campaign metadata, not product identity.

**Why:** Title-based searches produce generic campaign-related results, and incomplete snapshots can reduce a product name to one character and produce inaccurate searches.

**How to apply:** Keep product lookup and search-query construction separate from strategy naming. Merge database and embedded offer context before query construction. If no real product, brand, category, or service context exists, skip discovery explicitly instead of substituting the title.