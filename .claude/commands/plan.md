---
description: Plan a verified, dependency-ordered implementation without changing application code.
---

# /plan

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
`$ARGUMENTS` — approved specification, feature, or change request.

## Workflow
1. Inspect the approved spec and existing implementation. If requirements are unclear, return to `/spec`; do not invent them.
2. Main session consults `tech-lead` for execution strategy and `software-architect` for boundaries and tradeoffs; include `business-analyst` for cross-module rules, `test-designer` for test strategy, and domain auditors only when relevant.
3. Build a dependency graph. Split work into small, vertically testable tasks, each with files likely affected, acceptance criteria, verification, risks, and rollback considerations.
4. Identify tasks that can run independently versus those that must be sequential. Never assign simultaneous writes to the same files.
5. Select appropriate quality gates based on repository scripts and existing tests; avoid arbitrary coverage targets.
6. Present the plan and request approval before starting `/build`. Save only on request or into a confirmed project convention; never overwrite incomplete plans.

## Exit gate
Every task has a clear completion check, dependencies, and an identified validation method. Implementation has not started.

## Output
Architecture decisions; task graph; ordered tasks; specialist involvement; quality gates; checkpoints; risks; open questions; approval request; next step `/build`.

## Caveman-inspired optimization (local, selective)

- Load only relevant policy skills: `.claude/skills/execution-policy/SKILL.md`, `.claude/skills/delegation-policy/SKILL.md`, `.claude/skills/output-contracts/SKILL.md`. Do not preload all policies.
- Preserve original evidence and required risk gates. Prefer concise tool outputs and targeted reads; when the official Caveman runtime is installed, let it handle supported compression and recovery. Never assume it is installed or active.
- Avoid redundant delegation or repository-wide scans. Stop when acceptance and required checks pass.
