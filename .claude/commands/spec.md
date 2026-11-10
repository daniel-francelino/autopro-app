---
description: Define requirements and acceptance criteria for a feature using evidence from discovery.
---

# /spec

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
`$ARGUMENTS` — feature/request and optional discovery report. Do not treat unverified assumptions as confirmed requirements.

## Workflow
1. Read existing discovery notes, issue details, project rules, and related code. For unfamiliar or ambiguous current behavior, run the `/discover` workflow first (or request it).
2. Use `product-owner` for outcomes, priorities, scope, and acceptance criteria; `business-analyst` for business rules; `product-researcher` only when research is required; `customer-success-specialist` when onboarding/support/adoption is affected.
3. Invite `software-architect` or `security-analyst` only to surface feasibility, constraints, and non-functional requirements, not to prematurely implement.
4. Define goals, users, in-scope/out-of-scope, scenarios, invariants, dependencies, non-functional requirements, risks, and measurable acceptance criteria.
5. Identify unresolved decisions and ask for confirmation when they materially change the specification.
6. Present a proposed spec. Save it to a user-approved path only if asked; never overwrite an existing specification without confirmation.

## Exit gate
Requirements are testable, scope boundaries explicit, and unresolved decisions clearly labeled. No code changes.

## Output
Problem; objective; current-state evidence; user stories/scenarios; functional and non-functional requirements; exclusions; acceptance criteria; dependencies; risks; open questions; next step `/plan`.

## Caveman-inspired optimization (local, selective)

- Load only relevant policy skills: `.claude/skills/context-policy/SKILL.md`, `.claude/skills/output-contracts/SKILL.md`. Do not preload all policies.
- Preserve original evidence and required risk gates. Prefer concise tool outputs and targeted reads; when the official Caveman runtime is installed, let it handle supported compression and recovery. Never assume it is installed or active.
- Avoid redundant delegation or repository-wide scans. Stop when acceptance and required checks pass.
