# Domínio: Ordens de serviço

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Coração do produto: cria/edita a OS, recebe sinal, gera plano de pagamento, paga parcelas, desfaz e cancela, e dispara a liberação de comissão. Detalhe completo em [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Cobertura atual
- **18 rota(s)**; **8** com teste dedicado (citadas em `tests/`); **13** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/service-orders/:id` | login | — | sem permissão (KF-09) |
| GET | `/api/service-orders/:id` | login | — |  |
| POST | `/api/service-orders/:id/cancel` | login | ✅ | sem permissão (KF-09) |
| POST | `/api/service-orders/:id/down-payment` | login | ✅ | sem permissão (KF-09) |
| GET | `/api/service-orders/:id/edit-data` | login | — |  |
| DELETE | `/api/service-orders/:id/financial-transactions/:transactionId` | login | — | sem permissão (KF-09) |
| POST | `/api/service-orders/:id/generate-commissions` | login | — | sem permissão (KF-09) |
| DELETE | `/api/service-orders/:id/installments/:installmentId` | login | ✅ | sem permissão (KF-09) |
| PATCH | `/api/service-orders/:id/installments/:installmentId` | login | — | sem permissão (KF-09) |
| POST | `/api/service-orders/:id/installments/:installmentId/pay` | login | ✅ | sem permissão (KF-09) |
| GET | `/api/service-orders/:id/nfse` | login | — |  |
| DELETE | `/api/service-orders/:id/payment` | login | ✅ | sem permissão (KF-09) |
| POST | `/api/service-orders/:id/process-payment` | login | ✅ | sem permissão (KF-09) |
| POST | `/api/service-orders/:id/receive-extra-payment` | login | ✅ | sem permissão (KF-09) |
| POST | `/api/service-orders/export-csv` | login | — | sem permissão (KF-09) |
| GET | `/api/service-orders` | login | — |  |
| POST | `/api/service-orders` | login | ✅ | sem permissão (KF-09) |
| GET | `/api/service-orders/next-number` | login | — |  |

## Riscos e pontas soltas
- Edição (`POST /service-orders` com `orderId`) aceita `payment_status`, `total_amount` e `status` do corpo e não reconcilia pagamento nem comissão (KF-37/38/39).
- `payment_status` é derivado das *linhas* de parcela, não dos valores (KF-31).
- Numeração por RPC `next_service_order_number`: colisão sob concorrência só se prova com Postgres real.
- Exclusão/cancelamento: cada rota reverte saldo à sua maneira (corrigido KF-02/19 com `revertStatementOnAccount`); falta cobrir `[id].delete`, `cancel` e `financial-transactions/:id` ponta a ponta.
- `export-csv` não tem teste: totais da exportação podem divergir da tela.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| SER-01 | P0 | Editar OS paga/parcial: total, itens, desconto e responsáveis reconciliam status e comissão (KF-37/38/39). |
| SER-02 | P0 | Cancelar OS com pagamento parcial: devolve saldo exato, remove comissão pendente, bloqueia se houver comissão paga. |
| SER-03 | P0 | Excluir OS (`[id].delete`) com parcelas pagas: mesmo contrato do cancelar. |
| SER-04 | P1 | Transições de status válidas/ inválidas (`open→in_progress→completed→invoiced→delivered`, `cancelled` terminal). |
| SER-05 | P1 | `PATCH installments/:id`: alterar valor/data de parcela paga é recusado; de pendente recalcula devedores. |
| SER-06 | P1 | `financial-transactions/:id` DELETE: estorno de um recebimento isolado mantém parcela e OS coerentes (já existe no util; falta o handler). |
| SER-07 | P1 | `export-csv`: mesmos filtros → mesmos totais da listagem; sem injeção de fórmula (KF-04 corrigido). |
| SER-08 | P1 | Listagem `index.get`: filtros, busca com acento, paginação, isolamento por organização. |
| SER-09 | P2 | `next-number`: sequência sem buracos após exclusão (⏳ banco real). |
| SER-10 | P2 | `edit-data` e `nfse.get`: 404 para OS de outra organização. |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/support`), como em `tests/fast/service-orders/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/db` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
