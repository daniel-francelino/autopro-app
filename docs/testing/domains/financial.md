# Domínio: Financeiro (lançamentos, categorias, contas a pagar/receber)

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Lançamentos manuais e recorrentes, pagamento em lote e categorias. Mexe em saldo e extrato: é onde o dinheiro "some" quando há bug.

## Cobertura atual
- **17 rota(s)**; **1** com teste dedicado (citadas em `tests/`); **13** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/financial/:id` | login | — | sem permissão (KF-09) |
| GET | `/api/financial/:id` | login | — |  |
| PUT | `/api/financial/:id` | login | — | sem permissão (KF-09) |
| POST | `/api/financial/:id/extend-recurrence` | login | — | sem permissão (KF-09) |
| POST | `/api/financial/:id/pay` | login | ✅ | sem permissão (KF-09) |
| DELETE | `/api/financial/categories/:id` | login | — | sem permissão (KF-09) |
| PUT | `/api/financial/categories/:id` | login | — | sem permissão (KF-09) |
| POST | `/api/financial/categories/:id/migrate` | login | — | sem permissão (KF-09) |
| GET | `/api/financial/categories` | login | — |  |
| POST | `/api/financial/categories` | login | — | sem permissão (KF-09) |
| POST | `/api/financial/export` | login | — | sem permissão (KF-09) |
| GET | `/api/financial` | login | — |  |
| POST | `/api/financial` | login | — | sem permissão (KF-09) |
| POST | `/api/financial/pay-commissions-bulk` | login | — | sem permissão (KF-09) |
| POST | `/api/financial/pay-entries-bulk` | login | — | sem permissão (KF-09) |
| GET | `/api/financial/summary` | login | — |  |
| POST | `/api/financial/update-recurring` | login | — | sem permissão (KF-09) |

## Riscos e pontas soltas
- Três caminhos de pagamento (`:id/pay`, `pay-entries-bulk`, `pay-commissions-bulk`) com lógica de saldo repetida (corrigido KF-18 no `:id/pay`).
- Recorrência mensal no dia 29–31 (KF-01 corrigido) — falta teste de `extend-recurrence` e `update-recurring` ponta a ponta (há dois erros de TS pré-existentes em `update-recurring`).
- `categories/:id/migrate` move lançamentos entre categorias: risco de perder vínculo.
- Sem permissão em quase todas as escritas (KF-09).

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| FIN-01 | P0 | `pay-entries-bulk`: lote misto (pago/pendente/outra org/sem conta) — saldo = soma exata; falha parcial faz rollback do que gravou. |
| FIN-02 | P0 | `pay-commissions-bulk`: comissões pagas viram despesa Salários e baixam o saldo; pagar duas vezes é recusado. |
| FIN-03 | P0 | Invariante I1 depois de qualquer sequência de pagar/estornar (teste de propriedade com sequência aleatória). |
| FIN-04 | P1 | `update-recurring` e `extend-recurrence`: gerar N ocorrências sem duplicar nem pular meses. |
| FIN-05 | P1 | `categories`: excluir categoria em uso; `migrate` preserva totais. |
| FIN-06 | P1 | `summary.get`: receitas/despesas = relatório de caixa (mesmo período). |
| FIN-07 | P1 | `export.post`: totais e injeção de fórmula. |
| FIN-08 | P2 | Filtros e busca de `index.get`. |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
