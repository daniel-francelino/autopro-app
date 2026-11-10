---
description: Design, execute, and assess focused tests for a change without overstating coverage.
---

# /test

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
`$ARGUMENTS` — change, feature, files, or test scope.

## Workflow
1. Inspect requirements, changed code, test setup, and existing coverage. Determine what must be demonstrated.
2. Use `test-designer` to define meaningful scenarios when needed; `test-engineer` to implement/run tests; `test-reviewer` to independently evaluate assertion quality and gaps.
3. Cover success, failure, boundaries, authorization, concurrency, and business invariants only where applicable.
4. Run the narrowest meaningful test suite first, then broader regression checks if cost and scope justify it.
5. For browser/E2E tests, minimize screenshots/traces and inspect only failed or necessary evidence. Do not flood the model context with artifacts.
6. Clearly distinguish tests added, tests executed, tests skipped, and areas not verified. Do not modify production code unless separately authorized.

## Exit gate
Every stated pass has command output or another direct observation; untested risks remain visible.

## Output
Test matrix; tests created/changed; commands executed; pass/fail/skipped; coverage limitations; regressions; next step `/review` or `/debug`.
