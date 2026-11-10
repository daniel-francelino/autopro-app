---
name: investigate-first
description: "Diagnose ambiguous bugs or unexplained behavior before modifying code. Use for /discover or /debug when cause is unknown. Do not use for trivial known fixes."
---

# Investigate first

- Separate observed symptoms from hypotheses.
- Trace relevant input, state, ownership and failure evidence.
- Rank hypotheses by cheap falsification value; use targeted reads.
- Do not edit before credible mechanism identified unless user explicitly requests exploratory patching.
- Stop once cause or precise blocker is evidenced. Report proof and unresolved uncertainty.
