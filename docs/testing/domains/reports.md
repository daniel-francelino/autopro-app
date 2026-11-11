# Domínio: Relatórios

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Leituras independentes, cada uma refaz a conta. A reclamação "não bate" nasce da mistura de regimes (caixa × competência) ou de dados inconsistentes na origem. Tabela de regimes e invariantes em [financial-core-test-analysis.md](../financial-core-test-analysis.md) §3.

## Cobertura atual
- **19 rota(s)**; **6** com teste dedicado (citadas em `tests/`); **6** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| GET | `/api/reports/commissions` | login | ✅ |  |
| DELETE | `/api/reports/commissions/:id` | login | — | sem permissão (KF-09) |
| GET | `/api/reports/commissions/:id` | login | — |  |
| POST | `/api/reports/commissions/:id/pay` | login | — | sem permissão (KF-09) |
| GET | `/api/reports/costs-profit` | login | — |  |
| GET | `/api/reports/customers` | login | — |  |
| GET | `/api/reports/dashboard-stats` | login | ✅ |  |
| GET | `/api/reports/debtors` | login | ✅ |  |
| GET | `/api/reports/employees` | login | — |  |
| POST | `/api/reports/export-commissions` | login | — | sem permissão (KF-09) |
| POST | `/api/reports/export-employees` | login | — | sem permissão (KF-09) |
| POST | `/api/reports/export-purchases` | login | — | sem permissão (KF-09) |
| POST | `/api/reports/export-sales-items` | login | — | sem permissão (KF-09) |
| GET | `/api/reports/overview` | login | ✅ |  |
| GET | `/api/reports/profit-by-order` | login | ✅ |  |
| GET | `/api/reports/profit-cash-flow` | login | ✅ |  |
| GET | `/api/reports/purchases` | login | — |  |
| GET | `/api/reports/sales-items` | login | — |  |
| GET | `/api/reports/suppliers` | login | — |  |

## Riscos e pontas soltas
- Cada relatório reimplementa filtros de status/data; mudança em um não chega aos outros.
- Comissão de OS excluída some do relatório (KF-32); gráfico por funcionário conta cancelada como pendente (KF-33); devedores ignora sinal (KF-34).
- `fetchAllOrganizationRows` pagina em memória: acima de ~1000 linhas o fake não pagina (⏳).
- Fuso horário: datas `YYYY-MM-DD` viram `Date` local; virada de mês próxima da meia-noite não está testada.
- Relatórios restritos por plano (`debtors`, `customers`, `costs`, `sales-items`) — cobertura de 403 só em `debtors`.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| REP-01 | P0 | Golden dataset: um mês fixo com todos os totais conferidos à mão (overview, caixa, devedores, comissões) — protege contra regressão silenciosa. |
| REP-02 | P0 | `costs-profit`: despesas + OS no mesmo período; comissão paga não é somada duas vezes. |
| REP-03 | P0 | Exportações (`export-commissions|employees|purchases|sales-items`) = tela com os mesmos filtros. |
| REP-04 | P1 | `sales-items`, `customers`, `suppliers`, `purchases`: invariantes I4–I6 (excluídas, outra org, gráfico diário). |
| REP-05 | P1 | `employees.get` e `reports/commissions/:id` GET/DELETE/pay: pagar comissão gera despesa Salários e movimenta saldo; pagar 2x é recusado. |
| REP-06 | P1 | Plano Starter/sem assinatura → 403 em todos os relatórios restritos. |
| REP-07 | P1 | Meia-noite / fuso: OS de 31/03 23:59 não entra em abril. |
| REP-08 | P2 | Ordenação estável e paginação sem repetir/perder linhas em todos os relatórios paginados. |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/support`), como em `tests/fast/service-orders/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/db` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
