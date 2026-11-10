---
name: surgical-patch
description: "Fix a known regression with a focused change. Use for /debug or /build when root cause is evidenced. Do not use for feature redesign."
---

# Surgical patch

- Capture reproduction or strongest available failure evidence.
- Change the narrowest layer that owns the defect.
- Preserve unrelated behavior, user edits and existing contracts.
- Add targeted regression proof where practical.
- Verify affected paths; stop without unrelated cleanup.
