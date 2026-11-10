---
description: Run a risk-based, read-only audit of code, business processes, security, data, finances, reporting, or operations.
---

# /audit

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
`$ARGUMENTS` — audit target and optionally domains (`security`, `financial`, `data`, `business`, `reporting`, `performance`, `seo`, `geo`, `marketing`, `customer-success`, `full`). If no target is supplied, ask for it. `full` means broad scoping, not automatic exhaustive scans.

## Workflow
1. Define audit objective, systems in scope, period/environment (if relevant), risk tolerance, and evidence availability. Identify what is out of scope.
2. Select specialists based on domain:
   - `security-analyst`: authorization, exposure, dependencies, secrets.
   - `financial-auditor`: calculations, balances, reconciliation, payment flows.
   - `data-integrity-auditor`: invariants, relationships, migrations, concurrency.
   - `business-analyst`: process rules, cross-module consistency.
   - `reporting-analyst`: metric definitions, aggregation, reporting accuracy.
   - `performance-engineer`: profiling, budgets, bottlenecks.
   - `seo-specialist` / `geo-specialist`: search and AI-discovery readiness.
   - `marketing-strategist` / `customer-success-specialist`: funnel, retention, experience.
   - `software-architect`: architectural/systemic risks.
3. Create a risk-ranked audit checklist and inspect available evidence. Use safe, read-only commands; no destructive probes, external scans, or production access without explicit authorization.
4. Where useful, run independent read-only specialists in parallel and consolidate findings in the main session.
5. Separate **confirmed findings** from **potential risks** and **not assessed**. For every confirmed finding, provide evidence, severity, affected asset/process, impact, and remediation.
6. Produce prioritized remediation work, validation strategy, and recommended next command (`/spec`, `/plan`, `/test`, or `/review`).

## Exit gate
Scope and evidence limitations are explicit. Audit does not claim certification, full coverage, or regulatory compliance without a valid basis.

## Output
Executive summary; scope/method; risk matrix; confirmed findings with file/line or evidence; hypotheses; unassessed areas; prioritized remediation backlog; verification plan.

## Restrictions
Read-only. No fixes, mutations, commits, migrations, or deployment.

## Execution optimization (on demand)

- Apply `.claude/skills/delegation-policy/SKILL.md` only when coordinating specialists, and `.claude/skills/output-contracts/SKILL.md` only when producing handoffs or structured findings. Do not preload them.
- Use only the applicable official Caveman skill(s): investigate-first (only for unresolved findings). Do not preload all skills.
- Preserve original evidence and required risk gates. Prefer concise tool outputs and targeted reads; do not duplicate compression or routing logic. Caveman runtime integration is managed separately.
- Avoid redundant delegation or repository-wide scans. Stop when acceptance and required checks pass.
