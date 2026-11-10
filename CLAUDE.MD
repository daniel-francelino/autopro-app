
# Project Engineering Instructions

## Mission

Build and maintain reliable, secure, performant, and maintainable software.

Prioritize:

1. Business correctness.
2. Data integrity and security.
3. Functional correctness.
4. Simplicity and maintainability.
5. Appropriate test coverage.
6. Performance based on evidence.
7. Efficient token usage.

Follow the project's existing architecture, conventions, and business rules.

Do not assume any specific framework, database, or technology stack.

## 1. Agent Team

Specialized agents are defined in `.claude/agents/`.

| Agent | Responsibility |
|---|---|
| `product-owner` | Product strategy, backlog, prioritization, requirements, and roadmap |
| `product-researcher` | Market research, competitors, innovation, and product discovery |
| `tech-lead` | Planning, risk assessment, agent coordination, and delivery |
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

Use only agents that actually exist and are available.

Do not simulate agent execution.

Do not invoke every agent automatically.

## 2. Agent Coordination

### Product Leadership

The `product-owner` is responsible for:

- Product priorities.
- Product backlog.
- Product requirements.
- User stories.
- Acceptance criteria.
- Product roadmap.
- Business value assessment.
- Product scope management.

The `product-researcher` supports the Product Owner by:

- Researching competitors.
- Investigating market trends.
- Identifying user problems.
- Discovering product opportunities.
- Evaluating emerging technologies.
- Proposing innovative improvements.
- Producing evidence-based research.

The Product Researcher recommends opportunities.

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

The Tech Lead selects the minimum necessary specialists.

For simple, localized tasks, prefer direct execution or a single specialist.

Do not invoke `tech-lead` merely to delegate a trivial change.

### Delegation Rules

When delegation is supported, provide:

- Clear objective.
- Relevant scope.
- Confirmed requirements.
- Existing documentation references.
- Constraints.
- Expected deliverable.
- Acceptance criteria.

Do not forward the entire conversation unnecessarily.

Do not claim an agent was executed unless delegation actually succeeded.

## 3. Product Discovery Workflow

Use this workflow for:

- New product ideas.
- Competitive research.
- Market opportunities.
- Feature discovery.
- Product differentiation.
- Strategic improvements.
- Product roadmap exploration.

### Step 1 — Research

`product-researcher` investigates:

- Relevant competitors.
- Market trends.
- User problems.
- Existing solutions.
- Product gaps.
- Innovation opportunities.

Research must use reliable evidence.

Never invent competitor capabilities, market data, or customer feedback.

### Step 2 — Product Evaluation

`product-owner` evaluates:

- Business value.
- User impact.
- Strategic alignment.
- Evidence confidence.
- Implementation effort.
- Dependencies.
- Risks.
- Potential priority.

The Product Owner determines whether an opportunity should become a backlog proposal.

### Step 3 — Business Validation

Use `business-analyst` when:

- Business rules require clarification.
- Operational workflows are affected.
- Financial processes are involved.
- Cross-module behavior must be evaluated.

### Step 4 — Approval

Significant product decisions require stakeholder approval.

Research recommendations are not automatically approved requirements.

Do not implement speculative features without authorization.

### Step 5 — Engineering Handoff

Once the scope is approved, `tech-lead` coordinates implementation when appropriate.

The handoff should include:

- Business objective.
- Problem statement.
- Target users.
- Confirmed requirements.
- Acceptance criteria.
- Dependencies.
- Risks.
- Relevant documentation.

## 4. Task Complexity

### Simple

Examples:

- Small UI changes.
- Localized bug fixes.
- Minor validation changes.
- Small documentation updates.

Workflow:

1. Implement or analyze.
2. Run focused validation when applicable.
3. Summarize results.

Use additional agents only when risk justifies them.

### Moderate

Examples:

- New endpoints.
- Feature enhancements.
- Changes affecting several files.
- Moderate refactoring.

Workflow:

1. Clarify requirements.
2. Implement.
3. Run relevant tests.
4. Request independent code review when appropriate.

### Complex

Examples:

- New modules.
- Cross-module workflows.
- Major refactoring.
- Complex integrations.

Workflow:

1. `tech-lead` coordinates.
2. Relevant analysts establish requirements.
3. `software-architect` reviews design when necessary.
4. `test-designer` defines critical scenarios.
5. `developer` implements.
6. `test-engineer` adds regression protection.
7. `code-reviewer` reviews the implementation.
8. `test-reviewer` reviews tests when justified.

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

Do not automatically invoke every agent.

## 5. Product Backlog and Roadmap

The `product-owner` owns product backlog recommendations and roadmap proposals.

Use:

- `docs/product/backlog.md`
- `docs/product/roadmap.md`
- `docs/product/requirements/`
- `docs/product/discovery/`

Prioritize using:

- Business impact.
- User value.
- Financial impact.
- Urgency.
- Risk.
- Evidence confidence.
- Implementation effort.
- Dependencies.

Do not invent priority scores or release dates.

Distinguish:

- Confirmed requirements.
- Validated opportunities.
- Unvalidated hypotheses.
- Optional enhancements.
- Technical debt.

Do not automatically convert every audit finding into a development task.

Do not automatically implement backlog proposals.

## 6. Business and Financial Integrity

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

## 7. Architecture and Implementation

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

## 8. Independent Quality Review

For important changes, separate implementation from review.

- `developer` owns implementation.
- `code-reviewer` evaluates production code.
- `test-engineer` owns dedicated test implementation.
- `test-reviewer` evaluates test effectiveness.

Blocking findings must be corrected and revalidated.

Do not treat passing tests as proof that business rules are correct.

Do not approve changes without sufficient evidence.

## 9. Token Efficiency

Token efficiency is a mandatory engineering constraint.

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
- Stop researching when sufficient evidence supports a recommendation.

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

Do not claim to automatically clear or compact the session unless that capability is available and actually used.

## 10. Testing

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

## 11. Security and Data Safety

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

## 12. Performance

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

## 13. Documentation

Use existing project documentation conventions.

When no established convention exists, use:

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

For simple tasks, avoid unnecessary reports unless explicitly required by the selected agent.

Preserve existing finding identifiers.

Research reports must distinguish verified evidence from hypotheses and include sources when external information is used.

## 14. Git and Change Safety

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

## 15. Completion and Reporting

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

## Fundamental Principle

Use the smallest effective combination of agents, tools, and changes to deliver correct, secure, maintainable software.

The Product Researcher discovers opportunities.

The Product Owner evaluates and prioritizes product value.

The Business Analyst validates operational requirements.

The Tech Lead coordinates engineering execution.

The specialists analyze, implement, and validate according to their responsibilities.

Quality must be proportional to risk.

Coordination must reduce work, not create unnecessary overhead.
