---
name: context-policy
description: "On-demand Caveman-inspired context policy rules for Claude Code. Load only when relevant to the task."
---

# Context policy — read less, recover exactly

- Search symbols/paths first (`rg -n`, `rg --files`), then inspect small relevant ranges. Do not dump repository trees, lockfiles or entire large files by default.
- Reuse trustworthy, current evidence. Re-read only after a relevant file changes or evidence becomes stale.
- Load `SKILL.md` on demand; read only applicable sections of `references/original-guidance.md`. Existing original guidance remains authoritative for its topic.
- Bound stdout/stderr and tool results. For large test/log/JSON output, save full output locally, then provide a bounded summary. Include failure identifiers, counts, paths and commands to recover originals.
- Summaries are **navigation aids, not evidence replacement**. For ambiguous failures, security events, financial calculations, schema changes or audits, retrieve exact relevant original lines before conclusions.
- Avoid generating/reading screenshots, Playwright traces, HTML snapshots and verbose E2E reports unless the test failure requires them. Never suppress required artifacts; store them outside model context.
- Do not blindly truncate to `tail -20`: early errors and summary counts may be lost. Prefer the local summarizers or targeted searches.
- Never send secrets or customer data to external compression/routing services. Local scripts are opt-in and never contact the network.
- Concise response style must preserve negations, numeric values, commands, file paths, assumptions, caveats and test failures.
