---
description: Assess release readiness with independent gates and a GO/NO-GO recommendation; do not deploy automatically.
---

# /ship

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
`$ARGUMENTS` — release, branch, change set, or deployment target.

## Workflow
1. Establish the exact release scope, environment, version, and rollback capability.
2. Read applicable project constraints and release procedures; verify current Git state and actual CI/test/build evidence.
3. For meaningful production changes, main session can request independent read-only assessments from `code-reviewer`, `security-analyst`, `test-engineer`, and domain auditors (financial/data) when warranted. Parallelize only independent reads.
4. Consolidate blockers and non-blockers. Check migrations, config/secrets, backwards compatibility, observability, documentation, accessibility, performance, and business acceptance only as applicable.
5. Document rollout and rollback plan, monitoring signals, owners, and remaining risks. Missing evidence is not a pass.
6. Return GO / NO-GO / CONDITIONAL GO with explicit conditions. Any deploy, push, tag, or irreversible action requires a separate explicit instruction.

## Exit gate
Release decision is justified by recorded evidence and a rollback plan.

## Output
Release scope; gate results; blockers; accepted risks; rollout/rollback; monitoring; GO/NO-GO decision.

## Execution optimization (on demand)

- Apply `.claude/skills/delegation-policy/SKILL.md` only when coordinating specialists, and `.claude/skills/output-contracts/SKILL.md` only when producing handoffs or structured findings. Do not preload them.
- Use only the applicable official Caveman skill(s): verify-and-stop. Do not preload all skills.
- Preserve original evidence and required risk gates. Prefer concise tool outputs and targeted reads; do not duplicate compression or routing logic. Caveman runtime integration is managed separately.
- Avoid redundant delegation or repository-wide scans. Stop when acceptance and required checks pass.
