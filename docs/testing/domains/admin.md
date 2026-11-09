# Domínio: Painel do owner (`/api/admin/**`)

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Protegido por `owner-guard` (middleware) + `requireOwner`. Fases 0a, 1, 3–5 implementadas e testadas (`owner-panel-security`, `admin-panel`, `admin-audit-logs`, `admin-panel-utils`, `tests/api/admin-panel`).

## Cobertura atual
- **39 rota(s)**; **25** com teste dedicado (citadas em `tests/`); **0** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| GET | `/api/admin/audit-logs/:id` | owner | ✅ |  |
| GET | `/api/admin/audit-logs` | owner | ✅ |  |
| GET | `/api/admin/billing/summary` | owner | ✅ |  |
| GET | `/api/admin/billing/webhooks` | owner | ✅ |  |
| GET | `/api/admin/feedbacks/:id` | owner | ✅ |  |
| DELETE | `/api/admin/feedbacks/:id.link` | owner | — |  |
| POST | `/api/admin/feedbacks/:id.link` | owner | — |  |
| PUT | `/api/admin/feedbacks/:id` | owner | — |  |
| POST | `/api/admin/feedbacks/:id/respond` | owner | ✅ |  |
| GET | `/api/admin/feedbacks` | owner | ✅ |  |
| DELETE | `/api/admin/fiscal/companies/:id` | owner | — |  |
| GET | `/api/admin/fiscal/companies/:id` | owner | — |  |
| PUT | `/api/admin/fiscal/companies/:id` | owner | — |  |
| GET | `/api/admin/fiscal/companies` | owner | ✅ |  |
| POST | `/api/admin/fiscal/companies` | owner | ✅ |  |
| GET | `/api/admin/fiscal/logs` | owner | ✅ |  |
| POST | `/api/admin/fiscal/sync-integration-endpoints` | owner | — |  |
| GET | `/api/admin/geo/runs` | owner | ✅ |  |
| POST | `/api/admin/geo/runs` | owner | ✅ |  |
| GET | `/api/admin/geo/summary` | owner | ✅ |  |
| GET | `/api/admin/invoices/chart` | owner | — |  |
| GET | `/api/admin/invoices` | owner | — |  |
| GET | `/api/admin/metrics` | owner | — |  |
| GET | `/api/admin/organizations/:id` | owner | ✅ |  |
| GET | `/api/admin/organizations/:id/activity` | owner | ✅ |  |
| GET | `/api/admin/organizations/:id/billing` | owner | ✅ |  |
| GET | `/api/admin/organizations/:id/fiscal` | owner | ✅ |  |
| POST | `/api/admin/organizations/:id/reactivate` | owner | ✅ |  |
| POST | `/api/admin/organizations/:id/suspend` | owner | ✅ |  |
| GET | `/api/admin/organizations/:id/usage` | owner | ✅ |  |
| GET | `/api/admin/organizations/:id/users` | owner | ✅ |  |
| GET | `/api/admin/organizations` | owner | — |  |
| GET | `/api/admin/stats` | owner | ✅ |  |
| GET | `/api/admin/subscriptions/chart` | owner | — |  |
| GET | `/api/admin/subscriptions` | owner | — |  |
| GET | `/api/admin/system` | owner | ✅ |  |
| POST | `/api/admin/users/:id/deactivate` | owner | ✅ |  |
| POST | `/api/admin/users/:id/reactivate` | owner | ✅ |  |
| GET | `/api/admin/users` | owner | — |  |

## Riscos e pontas soltas
- Qualquer rota nova em `server/api/admin` sem `requireOwner` é barrada só pelo middleware — manter o teste M1/owner da matriz.
- Métricas de MRR/churn dependem de `monthly_amount` e de datas de cancelamento.
- GEO usa bateria fixa de 20 perguntas e provedor externo (custo).

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| ADM-01 | P0 | Toda rota nova em `admin/` entra automaticamente na matriz owner (já automático). |
| ADM-02 | P1 | `metrics.get`/`stats.get`: números = consultas diretas (golden dataset). |
| ADM-03 | P1 | Suspender/reativar organização reflete em `resolveOrganizationId` e no login (⏳ banco real). |
| ADM-04 | P1 | `audit-logs`: filtros e paginação com volume (⏳ Postgres, já há `audit-logs.sql.test`). |
| ADM-05 | P2 | `invoices`/`subscriptions` charts: períodos vazios. |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
