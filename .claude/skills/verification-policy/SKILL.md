---
name: verification-policy
description: "On-demand Caveman-inspired verification policy rules for Claude Code. Load only when relevant to the task."
---

# Verification policy — verify and stop

1. Derive the smallest sufficient evidence set from acceptance criteria and risk.
2. Run focused checks before broad suites; broader regression gates when integration or risk warrants them.
3. Preserve exact exit status, executed command, environment constraints, test counts and error excerpts. Do not turn partial output into a claim that all tests passed.
4. Distinguish **passed**, **failed**, **skipped**, **not run** and **blocked**. A summarizer's output does not substitute for a process exit code.
5. Test changes affecting auth, finance, migrations, permissions, concurrency or irreversible data flows at the appropriate depth regardless of token cost.
6. Avoid repeatedly running identical checks on unchanged code unless flaky behavior or independent confirmation requires it.
7. Do not edit production code during read-only review/audit/test commands unless separately authorized.
8. When acceptance and required gates pass, stop; no opportunistic refactor or extra specialists.
