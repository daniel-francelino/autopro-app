---
description: Investigate and fix a reproducible defect using root-cause analysis and regression checks.
---

# /debug

## Operating contract

- This command runs in the **main Claude Code session**. The main session coordinates specialist subagents; subagents must not spawn subagents.
- Discover only relevant repository files, conventions, and existing project documentation. Do not assume the project uses a particular framework or test runner.
- Use the existing `.claude/agents/` roles and their applicable `.claude/skills/` procedures; do not duplicate skill contents in this command.
- Delegate only when the specialist adds distinct value. For small, low-risk tasks, work directly or use a single agent.
- Keep tool output concise: targeted file reads, summarized test output, no unnecessary screenshots or full logs.
- Distinguish observed evidence, assumptions, risks, and recommendations. Never claim a test, audit, or check passed without executing it.
- Respect existing project instructions and Git state. Never overwrite unrelated work, change secrets, force-push, deploy, delete data, or create commits without explicit user authorization.
- If a required agent or skill is unavailable, report it and use the smallest safe fallback without inventing a specialist's findings.

## Inputs
`$ARGUMENTS` — bug symptoms, failing test, logs, or error. Ask for one essential reproduction detail only if needed.

## Workflow
1. Record expected vs actual behavior, reproduction steps, and environment; inspect existing errors and relevant files.
2. Reproduce safely, then isolate the smallest failing path. Use `developer` for technical diagnosis, `business-analyst` for rule mismatches, `data-integrity-auditor` for corrupt states, and `performance-engineer` for latency issues only when relevant.
3. Form and test hypotheses. Do not patch symptoms without identifying a plausible cause.
4. If authorized to fix, add a targeted regression test where practical and apply the smallest correction.
5. Run targeted checks and report actual results. If reproduction requires production data or destructive action, stop and seek authorization.

## Modes
- Default: diagnose and propose a fix; implement only when the request explicitly asks to fix.
- Read-only when the user requests investigation only.

## Exit gate
Root cause is evidenced or uncertainty explicitly reported; any fix has regression verification.

## Output
Reproduction; root-cause evidence; affected code; fix (if authorized); tests and results; residual risks; next step `/review`.
