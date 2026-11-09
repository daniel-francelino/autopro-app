# Domínio: Compras

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Compra de peças com pagamento (`pay`), que também movimenta caixa e estoque.

## Cobertura atual
- **5 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **4** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/purchases/:id` | login | — | sem permissão (KF-09) |
| PUT | `/api/purchases/:id` | login | — | sem permissão (KF-09) |
| POST | `/api/purchases/:id/pay` | login | — | sem permissão (KF-09) |
| GET | `/api/purchases` | login | — |  |
| POST | `/api/purchases` | login | — | sem permissão (KF-09) |

## Riscos e pontas soltas
- Estoque: compra/devolução devem manter `quantity` coerente (nenhum teste hoje).
- `pay.post` movimenta saldo por caminho próprio.
- Relatório `purchases` precisa bater com as compras e pagamentos.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| PUR-01 | P0 | `pay.post`: saldo/extrato/despesa; pagar duas vezes recusado; conta de outra org recusada. |
| PUR-02 | P0 | Criar/editar/excluir compra mantém o estoque coerente. |
| PUR-03 | P1 | Compra paga excluída estorna saldo (como OS). |
| PUR-04 | P1 | Total da compra = soma dos itens; arredondamento. |
| PUR-05 | P1 | Relatório `purchases` e `export-purchases` = listagem. |
| PUR-06 | P2 | Permissões e isolamento (KF-09). |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
