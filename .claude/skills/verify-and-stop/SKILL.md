---
name: verify-and-stop
description: "Validate acceptance and end work once required checks pass. Use for /test, /build, /debug or /ship. Never bypass critical gates to save tokens."
---

# Verify and stop

- Convert acceptance criteria into the smallest sufficient proof set.
- Reuse valid results only for unchanged relevant state.
- Report commands, exit codes, pass/fail/skipped/blocked and remaining risks.
- Run additional checks only when risk or evidence requires them.
- Do not change product code during validation-only tasks without authorization.
- Stop immediately once acceptance and mandatory checks are satisfied.
