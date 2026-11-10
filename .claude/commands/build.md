---
description: Implement an approved task incrementally with targeted tests and verification.
---

# /build

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
`$ARGUMENTS` — approved plan and optional task identifier. Default: one next approved task, not the entire plan.

## Workflow
1. Confirm the approved scope, current Git state, and next task. Stop if existing uncommitted work could be overwritten.
2. Main session delegates implementation to `developer` when useful; `tech-lead` advises on tradeoffs, `software-architect` on major interfaces. Apply relevant implementation skills.
3. For changed behavior, establish a regression test or characterization test where practical; implement the smallest coherent vertical slice.
4. Execute focused checks (typecheck, lint, unit/integration tests, build) using the actual repository commands. Do not bypass failures by deleting tests or suppressing diagnostics.
5. Request `test-engineer` or `code-reviewer` only when complexity/risk warrants independent verification.
6. Report changes, evidence, remaining risks, and the next task. Do not silently start another task or commit.

## Modes
- Default: implement **one** task.
- If `$ARGUMENTS` explicitly requests `all`/`auto`: require an approved plan and explicit authorization for autonomous multi-task execution; pause for high-risk/irreversible actions. Approval of implementation does not imply permission to commit, push, or deploy.

## Exit gate
Acceptance criteria for the selected task are satisfied or blockers are documented; executed checks are reported accurately.

## Output
Files changed; behavior; tests/checks and results; unresolved issues; risks; next task; recommendation `/test` or `/review`.

## Caveman-inspired optimization (local, selective)

- Load only relevant policy skills: `.claude/skills/execution-policy/SKILL.md`, `.claude/skills/delegation-policy/SKILL.md`, `.claude/skills/context-policy/SKILL.md`, `.claude/skills/verification-policy/SKILL.md`, `.claude/skills/output-contracts/SKILL.md`. Do not preload all policies.
- Apply the on-demand shared skill(s) when relevant: lean-build, surgical-patch (only for proven defects), verify-and-stop. Do not preload all skills.
- Preserve original evidence and required risk gates. Prefer concise tool outputs and targeted reads; when the official Caveman runtime is installed, let it handle supported compression and recovery. Never assume it is installed or active.
- Avoid redundant delegation or repository-wide scans. Stop when acceptance and required checks pass.
