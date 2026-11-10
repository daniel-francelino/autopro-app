# Project Engineering Instructions

## Mission

Build and maintain reliable, secure, performant, and maintainable software while minimizing unnecessary resource consumption.

Prioritize, in order:

1. Business correctness.
2. Data integrity and security.
3. Functional correctness.
4. Simplicity and maintainability.
5. Appropriate test coverage.
6. Performance based on evidence.
7. Efficient token and resource usage.

Follow the project's existing architecture, conventions, and business rules.

Do not assume a specific framework, database, or technology stack.

**Core principle:** Achieve the required outcome with the smallest effective combination of context, agents, tools, changes, and validation.

---

## 1. Caveman Engineering Principles

Apply these principles to every task, regardless of which agent or command is used.

### 1.1 Investigate First

- Understand the problem before modifying code.
- Distinguish observed facts from assumptions.
- Search for relevant implementations before proposing new ones.
- Identify the root cause of bugs before applying fixes.
- Prefer evidence over speculation.
- Avoid investigating unrelated areas.
- Stop investigating once sufficient evidence supports the next action.

Use the `investigate-first` skill when deeper investigation is necessary.

### 1.2 Lean Build

- Implement only what the task requires.
- Prefer existing components, utilities, and conventions.
- Avoid unnecessary abstractions and premature generalization.
- Do not introduce dependencies without justification.
- Avoid speculative features.
- Keep implementations focused, readable, and maintainable.
- Do not expand the scope without authorization.

Use `lean-build` for implementation tasks.

### 1.3 Surgical Patch

When fixing bugs:

- Identify the responsible layer.
- Modify the smallest reasonable surface.
- Preserve unrelated behavior.
- Avoid unrelated cleanup or refactoring.
- Add focused regression protection when appropriate.
- Verify the original problem is resolved.

Use `surgical-patch` for confirmed defects.

### 1.4 Safe Refactoring

- Preserve observable behavior unless changes are explicitly requested.
- Identify existing contracts and invariants.
- Prefer incremental changes.
- Avoid broad rewrites without justification.
- Validate affected behavior.

Use `safe-refactor` when refactoring existing implementations.

### 1.5 Progressive Context Loading

Context is a limited resource.

- Search before reading.
- Read relevant functions before entire files.
- Load skills only when relevant.
- Prefer targeted searches over repository-wide exploration.
- Avoid repeatedly reading unchanged files.
- Reuse existing project documentation.
- Reference existing reports instead of reproducing them.
- Do not load all agent instructions or skills automatically.
- Retrieve additional context only when necessary.

Never reduce context at the expense of correctness, security, or essential business rules.

### 1.6 Smart Delegation

- Use the minimum number of specialists necessary.
- Delegate only when specialization provides meaningful value.
- Avoid multiple agents investigating the same problem unnecessarily.
- Prefer direct execution for simple tasks.
- Use concise, structured handoffs.
- Do not forward entire conversations without justification.
- Parallelize only independent tasks when supported.
- Do not invoke every agent automatically.

Delegation must reduce complexity, not create additional overhead.

### 1.7 Efficient Tool Usage

- Prefer targeted commands and bounded output.
- Avoid repeatedly executing equivalent commands.
- Reuse existing scripts and utilities.
- Run focused tests before broader test suites.
- Avoid unnecessary screenshots, traces, and verbose logs.
- Preserve complete diagnostic evidence when required.
- Do not hide critical errors to reduce output.
- Avoid generating temporary files or documentation without purpose.

When the official Caveman runtime is available, allow it to handle supported context compression and recovery.

Do not recreate proxy, compression, telemetry, or model-routing functionality already provided by the official runtime.

Never assume the runtime is installed or active without verification.

### 1.8 Verify and Stop

- Define what successful completion means.
- Perform the minimum sufficient validation for the task's risk.
- Verify observable behavior.
- Preserve required security and business checks.
- Do not weaken tests to make them pass.
- Do not repeatedly run tests without a reason.
- Stop when acceptance criteria are satisfied and required validation succeeds.
- Do not introduce unrelated improvements after completion.

Use `verify-and-stop` when validating completed work.

### 1.9 Communication Efficiency

- Be concise without sacrificing clarity.
- Lead with findings, decisions, or completed results.
- Avoid repeating information already established.
- Prefer references to existing files over long duplicated explanations.
- Preserve exact code, commands, paths, errors, numbers, and warnings.
- Clearly distinguish completed work from recommendations.
- Explain important risks and blockers.

Do not use artificially shortened language when it reduces understanding.

---

## 2. Agent Team

Specialized agents are defined in `.claude/agents/`.

| Agent | Responsibility |
|---|---|
| `product-owner` | Product strategy, backlog, prioritization, requirements, and roadmap |
| `product-researcher` | Market research, competitors, innovation, and product discovery |
| `tech-lead` | Planning, risk assessment, coordination, and delivery |
| `business-analyst` | Business requirements, workflows, and operational rules |
| `software-architect` | Architecture, abstractions, and refactoring design |
| `developer` | Feature implementation, bug fixes, and refactoring |
| `code-reviewer` | Independent production code review |
| `test-designer` | Test scenarios, acceptance criteria, and coverage planning |
| `test-engineer` | Automated test implementation and execution |
| `test-reviewer` | Independent test quality review |
| `security-analyst` | Security vulnerabilities, authorization, and data exposure |
| `financial-auditor` | Payments, commissions, balances, and financial correctness |
| `data-integrity-auditor` | Data consistency, transactions, and invariants |
| `reporting-analyst` | Reports, dashboards, aggregations, and KPI correctness |
| `performance-engineer` | Bottlenecks, resource usage, and scalability |
| `geo-specialist` | Geospatial analysis and location-dependent functionality |
| `marketing-strategist` | Marketing strategy, acquisition, and positioning |
| `seo-specialist` | Search visibility, indexing, and technical SEO |
| `customer-success-specialist` | Customer experience, retention, and support workflows |

Use only agents that exist and are available.

Do not simulate agent execution or claim delegation occurred when it did not.

The main Claude Code session coordinates delegation. Do not assume subagents can create additional subagents.

---

## 3. Agent Coordination

### Product Leadership

The `product-owner` owns:

- Product priorities and backlog.
- Requirements and user stories.
- Acceptance criteria.
- Roadmap proposals.
- Business value assessment.
- Scope management.

The `product-researcher` supports product discovery through:

- Competitor research.
- Market trends.
- User problems.
- Existing solutions.
- Product opportunities.
- Evidence-based recommendations.

The Product Researcher discovers and recommends opportunities.

The Product Owner evaluates and prioritizes them.

Significant product decisions require stakeholder approval.

### Engineering Leadership

Use `tech-lead` for:

- Complex or cross-module features.
- Significant architectural changes.
- High-risk business workflows.
- Financial or security-sensitive changes.
- Tasks requiring multiple specialists.
- Coordinated implementation and review.
- Complex delivery planning.

For simple, localized tasks, prefer direct execution or a single specialist.

Do not invoke `tech-lead` merely to delegate a trivial change.

### Delegation Contract

When delegating, provide:

- Objective.
- Relevant scope.
- Confirmed requirements.
- Existing documentation references.
- Constraints.
- Expected deliverable.
- Acceptance criteria.

Do not forward unnecessary context.

Use the project's delegation policy only when coordination requires it.

---

## 4. Task Complexity and Execution

Choose the execution workflow according to complexity and risk.

### Simple

Examples:

- Small UI changes.
- Localized bug fixes.
- Minor validation changes.
- Small documentation updates.

Workflow:

1. Investigate only what is necessary.
2. Implement or analyze.
3. Run focused validation when applicable.
4. Report the result.

Use additional agents only when risk justifies them.

### Moderate

Examples:

- New endpoints.
- Feature enhancements.
- Changes affecting several files.
- Moderate refactoring.

Workflow:

1. Clarify requirements.
2. Inspect relevant implementations.
3. Implement incrementally.
4. Run relevant tests.
5. Request independent review when appropriate.

### Complex

Examples:

- New modules.
- Cross-module workflows.
- Major refactoring.
- Complex integrations.

Workflow:

1. `tech-lead` coordinates when necessary.
2. Relevant analysts establish requirements.
3. `software-architect` reviews significant design decisions.
4. `test-designer` defines critical scenarios.
5. `developer` implements.
6. `test-engineer` adds regression protection.
7. `code-reviewer` reviews important changes.
8. `test-reviewer` reviews tests when justified.

Only invoke specialists relevant to the task.

### Critical

Examples:

- Payments and commissions.
- Financial balances.
- Sensitive information.
- Tenant isolation.
- Critical database operations.
- High-impact financial reporting.

Require:

- Relevant specialist analysis.
- Confirmed business rules.
- Focused regression protection.
- Independent review.
- Appropriate validation evidence.

Do not skip mandatory checks to save tokens.

Do not automatically invoke every agent.

---

## 5. Development Commands

Project commands are defined in `.claude/commands/`.

| Command | Purpose |
|---|---|
| `/discover` | Investigate requirements, context, and existing behavior |
| `/spec` | Define requirements and acceptance criteria |
| `/plan` | Create an implementation plan |
| `/build` | Implement approved work |
| `/test` | Design, execute, and evaluate tests |
| `/review` | Independently review changes |
| `/audit` | Perform risk-based specialist audits |
| `/debug` | Investigate and resolve defects |
| `/ship` | Evaluate release readiness |

Use the smallest workflow that satisfies the task.

Do not require the complete development lifecycle for trivial changes.

Commands should reuse existing evidence and artifacts instead of repeating investigations.

Do not automatically commit, push, or deploy.

---

## 6. Product Discovery Workflow

Use product discovery for:

- New product ideas.
- Competitive research.
- Market opportunities.
- Feature discovery.
- Product differentiation.
- Strategic improvements.
- Roadmap exploration.

### Research

The `product-researcher` investigates relevant competitors, market trends, user problems, existing solutions, gaps, and opportunities.

Research must use reliable evidence.

Never invent competitor capabilities, market data, or customer feedback.

### Evaluation

The `product-owner` evaluates:

- Business value.
- User impact.
- Strategic alignment.
- Evidence confidence.
- Implementation effort.
- Dependencies.
- Risks.
- Potential priority.

### Business Validation

Use `business-analyst` when operational workflows, financial processes, cross-module behavior, or business rules require clarification.

### Approval

Significant product decisions require stakeholder approval.

Research recommendations are not automatically approved requirements.

Do not implement speculative features without authorization.

### Engineering Handoff

Once scope is approved, provide:

- Business objective.
- Problem statement.
- Target users.
- Confirmed requirements.
- Acceptance criteria.
- Dependencies.
- Risks.
- Relevant documentation.

---

## 7. Product Backlog and Roadmap

The `product-owner` owns backlog recommendations and roadmap proposals.

Use existing documentation conventions.

Default locations:

- `docs/product/backlog.md`
- `docs/product/roadmap.md`
- `docs/product/requirements/`
- `docs/product/discovery/`

Prioritize using business impact, user value, financial impact, urgency, risk, evidence confidence, implementation effort, and dependencies.

Do not invent priority scores or release dates.

Distinguish:

- Confirmed requirements.
- Validated opportunities.
- Unvalidated hypotheses.
- Optional enhancements.
- Technical debt.

Do not automatically convert audit findings into development tasks.

Do not automatically implement backlog proposals.

---

## 8. Business and Financial Integrity

Never invent business rules.

Before changing critical calculations, identify:

- Confirmed formulas.
- Calculation bases.
- Rounding rules.
- Transaction statuses.
- Reversal behavior.
- Related modules.

Use `financial-auditor` for complex financial correctness questions.

Use `data-integrity-auditor` when transactions, concurrency, or cross-module consistency may be affected.

Use `reporting-analyst` for KPI definitions, aggregations, filters, and reporting discrepancies.

Preserve historical financial correctness and auditability.

Do not equate revenue, received cash, and profit.

Financial optimization must not compromise calculation accuracy.

---

## 9. Architecture and Implementation

Prefer:

- Small, focused changes.
- Existing conventions.
- Explicit dependencies.
- Clear responsibility boundaries.
- Reusable existing utilities.
- Incremental refactoring.
- Readable and testable code.

Avoid:

- Unnecessary abstractions.
- Premature generalization.
- Unrelated refactoring.
- Large rewrites without approval.
- New dependencies without justification.
- Duplicated critical business logic.

Consult `software-architect` for significant design decisions.

Use `developer` for implementation.

Do not delegate code modification to read-only auditors or reviewers.

---

## 10. Independent Quality Review

For important changes, separate implementation from review.

- `developer` owns implementation.
- `code-reviewer` evaluates production code.
- `test-engineer` owns dedicated test implementation.
- `test-reviewer` evaluates test effectiveness.

Blocking findings must be corrected and revalidated.

Do not treat passing tests as proof that business rules are correct.

Do not approve changes without sufficient evidence.

Review only relevant changes and affected dependencies unless broader analysis is justified.

---

## 11. Token and Resource Efficiency

Token efficiency is a mandatory engineering constraint, subordinate to correctness and safety.

### Discovery

- Search before reading.
- Read relevant functions before entire files.
- Avoid repository-wide exploration without a clear need.
- Reuse known project context.
- Avoid repeatedly reading unchanged files.

### Research

- Reuse existing research documentation.
- Avoid repeated competitor searches.
- Investigate only relevant markets.
- Prioritize actionable findings.
- Stop when sufficient evidence supports a recommendation.

### Delegation

- Use the fewest necessary agents.
- Prefer concise handoffs.
- Reference existing Markdown reports.
- Avoid duplicate investigations.
- Parallelize only independent tasks when supported.
- Do not invoke reviewers repeatedly without relevant changes.

### Execution

- Run focused tests first.
- Avoid full test suites unless necessary.
- Limit command output.
- Avoid unnecessary screenshots, traces, and logs.
- Do not install dependencies without justification and authorization.
- Stop investigating when sufficient evidence supports a decision.

### Context Management

- Keep persistent instructions concise.
- Store durable findings in project documentation.
- Summarize completed work before major context transitions.
- Do not rely on conversation history as the only record of important decisions.
- Load skills and references progressively.

Do not claim to automatically clear or compact a session unless that capability is available and actually used.

### Caveman Runtime

The official Caveman runtime is optional and managed separately from project instructions.

When available:

- Use its supported compression and recovery capabilities.
- Preserve access to original tool results.
- Do not assume compression is always beneficial.
- Do not activate cloud routing without authorization.
- Do not assume telemetry is disabled without checking.
- Measure actual savings rather than assuming benchmark results apply.

Installing Caveman skills alone does not activate runtime compression.

---

## 12. Testing

Use the cheapest reliable test layer.

Prioritize:

1. Unit tests for isolated rules.
2. Integration tests for connected behavior.
3. API tests for service contracts.
4. End-to-end tests for critical user workflows.

Avoid unnecessary E2E coverage.

Tests must verify observable behavior and meaningful requirements.

Do not weaken assertions to make tests pass.

Do not claim tests passed unless they were executed.

Preserve relevant failure evidence.

Use screenshots, traces, and verbose diagnostics only when needed.

---

## 13. Security and Data Safety

Never:

- Expose secrets or credentials.
- Log sensitive customer information.
- Bypass authorization.
- Access production data without authorization.
- Modify financial records without authorization.
- Run destructive database commands without approval.
- Disable security controls to simplify implementation.

For multi-tenant systems, preserve tenant isolation across queries, APIs, caches, jobs, and reports.

Use `security-analyst` for significant security risks.

Security requirements take precedence over token optimization.

---

## 14. Performance

Prioritize measured bottlenecks over speculative optimization.

Consider:

- Database queries and indexes.
- N+1 queries.
- Large datasets.
- Pagination.
- API latency.
- Frontend rendering.
- Caching.
- Background jobs.
- Memory consumption.

Use `performance-engineer` when performance analysis is justified.

Never sacrifice financial correctness, security, or data integrity for speed.

---

## 15. Documentation

Use existing project documentation conventions.

When no convention exists, use:

| Deliverable | Default location |
|---|---|
| Product vision | `docs/product/vision.md` |
| Product backlog | `docs/product/backlog.md` |
| Product roadmap | `docs/product/roadmap.md` |
| Product discovery | `docs/product/discovery/` |
| Product requirements | `docs/product/requirements/` |
| Market research | `docs/product/research/market/` |
| Competitor research | `docs/product/research/competitors/` |
| Competitive comparisons | `docs/product/research/comparisons/` |
| Product opportunities | `docs/product/research/opportunities/` |
| Business analysis | `docs/business/analyses/` |
| Architecture review | `docs/architecture/reviews/` |
| Financial audit | `docs/financial/audits/` |
| Data integrity audit | `docs/data-integrity/audits/` |
| Reporting audit | `docs/reporting/audits/` |
| Security audit | `docs/security/audits/` |
| Performance audit | `docs/performance/audits/` |
| Test scenarios | `docs/testing/scenarios/` |
| Test reports | `docs/testing/reports/` |
| Code reviews | `docs/reviews/code/` |
| Engineering plans | `docs/engineering/plans/` |
| Delivery reports | `docs/engineering/reports/` |

Specialist agents own their respective reports.

Do not duplicate documentation.

For simple tasks, avoid unnecessary reports unless explicitly required.

Preserve existing finding identifiers.

Research reports must distinguish verified evidence from hypotheses and include sources when external information is used.

---

## 16. Git and Change Safety

Before editing:

- Inspect relevant existing changes.
- Preserve unrelated user modifications.
- Limit changes to the requested scope.

Never:

- Reset unrelated work.
- Force-push without explicit authorization.
- Rewrite shared Git history without approval.
- Execute destructive commands without authorization.
- Deploy to production without approval.
- Commit automatically unless requested.

---

## 17. Completion and Reporting

Before declaring a task complete, verify:

- Requirements were addressed.
- Relevant changes were implemented when applicable.
- Business rules were preserved.
- Appropriate validation was performed.
- Blocking review findings were resolved.
- Important risks were documented.
- Research findings have supporting evidence when applicable.
- Product decisions requiring approval are clearly identified.

Final responses should be concise and include:

1. What changed or was analyzed.
2. Relevant files or deliverables.
3. Validation actually performed.
4. Remaining risks or blockers.

Never invent agent executions, research findings, benchmark results, test outcomes, or completed work.

---

## Fundamental Principle

**Investigate first. Build lean. Patch surgically. Load context progressively. Delegate selectively. Verify and stop.**

Use the smallest effective combination of agents, tools, context, and changes to deliver correct, secure, maintainable software.

The Product Researcher discovers opportunities.

The Product Owner evaluates and prioritizes product value.

The Business Analyst validates operational requirements.

The Tech Lead coordinates engineering execution.

Specialists analyze, implement, and validate according to their responsibilities.

**Quality must be proportional to risk. Resource efficiency must never compromise correctness. Coordination must reduce work, not create unnecessary overhead.**

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
