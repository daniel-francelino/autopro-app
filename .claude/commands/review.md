---
description: Perform independent code and behavior review, prioritizing evidence-backed findings.
---

# /review

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
`$ARGUMENTS` — diff, commit, PR, or target module. Default: current working-tree diff.

## Workflow
1. Inspect exact change scope and its requirements. Check Git status without changing it.
2. Prefer `code-reviewer` as primary specialist; include `security-analyst`, `data-integrity-auditor`, `financial-auditor`, `performance-engineer`, `business-analyst`, or `test-reviewer` only for relevant risks.
3. Parallelize independent read-only reviews when valuable. Main session deduplicates findings and reconciles conflicting conclusions.
4. Focus on correctness, regressions, business invariants, security, maintainability, architecture, test adequacy, and performance where relevant.
5. For each actionable finding, provide severity, exact file/line or symbol, evidence, impact, and proposed fix. Avoid invented issues and style-only noise.
6. Summarize checks actually run; report unverified areas.

## Exit gate
Findings are prioritized and grounded. No production changes or commits.

## Output
Blocking findings; non-blocking recommendations; verified checks; open risks; verdict `APPROVED`, `CHANGES REQUIRED`, or `INSUFFICIENT EVIDENCE`.

## Execution optimization (on demand)

- Apply `.claude/skills/delegation-policy/SKILL.md` only when coordinating specialists, and `.claude/skills/output-contracts/SKILL.md` only when producing handoffs or structured findings. Do not preload them.
- Use only the applicable official Caveman skill(s): verify-and-stop. Do not preload all skills.
- Preserve original evidence and required risk gates. Prefer concise tool outputs and targeted reads; do not duplicate compression or routing logic. Caveman runtime integration is managed separately.
- Avoid redundant delegation or repository-wide scans. Stop when acceptance and required checks pass.
