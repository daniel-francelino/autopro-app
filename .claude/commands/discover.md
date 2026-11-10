---
description: Discover an existing codebase, feature, bug, or business workflow before deciding what to change.
---

# /discover

## Operating contract

- This command runs in the **main Claude Code session**. The main session coordinates specialist subagents; subagents must not spawn subagents.
- Discover only relevant repository files, conventions, and existing project documentation. Do not assume the project uses a particular framework or test runner.
- Use the existing `.claude/agents/` roles and their applicable `.claude/skills/` procedures; do not duplicate skill contents in this command.
- Delegate only when the specialist adds distinct value. For small, low-risk tasks, work directly or use a single agent.
- Keep tool output concise: targeted file reads, summarized test output, no unnecessary screenshots or full logs.
- Distinguish observed evidence, assumptions, risks, and recommendations. Never claim a test, audit, or check passed without executing it.
- Respect existing project instructions and Git state. Never overwrite unrelated work, change secrets, force-push, deploy, delete data, or create commits without explicit user authorization.
- If a required agent or skill is unavailable, report it and use the smallest safe fallback without inventing a specialist's findings.

## Purpose
Investigate what exists and how it works, without designing a solution prematurely. This is the entry point for ambiguous requests and unfamiliar areas of an existing system.

## Inputs
`$ARGUMENTS` — area, feature, issue, business process, or question to investigate. If empty, ask for the investigation target.

## Workflow
1. Establish the exact discovery question, scope, and what is already known. Ask a focused question only if proceeding would be misleading.
2. Inspect repository structure, relevant docs, entry points, data flow, APIs, state transitions, tests, and existing conventions. Read narrowly, expanding only when evidence requires it.
3. Select specialists by topic:
   - `business-analyst`: workflows, rules, cross-module behavior.
   - `software-architect`: boundaries, components, dependencies, integrations.
   - `product-researcher`: user needs, alternatives, evidence gaps; external research only if authorized/available.
   - `data-integrity-auditor`, `financial-auditor`, `reporting-analyst`: when those domains are actually involved.
   - `security-analyst`, `performance-engineer`: only when material risks are present.
4. Produce an evidence-backed map of the current behavior and its gaps. Cite repository paths and symbols; label hypotheses.
5. Identify unknowns, constraints, risks, existing tests, and candidate next steps. **Do not implement or select a final solution.**

## Exit gate
- Current behavior and affected boundaries are documented, or explicitly marked unknown.
- Important assumptions and missing evidence are visible.
- A next step is recommended (`/spec`, `/audit`, `/debug`, or no change).

## Output
Discovery summary; current-state workflow; affected files/modules; observed rules and dependencies; evidence; unknowns/risks; recommended next command.

## Restrictions
Read-only. Do not edit code, tests, docs, or Git state.
