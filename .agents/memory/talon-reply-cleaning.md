---
name: Talon reply cleaning
description: Compatibility boundary for removing quoted history and signatures from email replies.
---

Use Talon's quotation extraction path for reply cleanup; do not enable its signature-classifier path with the current scikit-learn runtime.

**Why:** The signature classifier is incompatible with the installed scikit-learn version, while quotation extraction works without it.

**How to apply:** Keep email reply cleaning on the quote-extraction path unless the classifier dependency stack is upgraded and verified with real mailbox samples.
