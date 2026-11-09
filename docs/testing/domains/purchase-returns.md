# Domínio: Devoluções de compra

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Devolve itens ao fornecedor; afeta estoque e, possivelmente, financeiro.

## Cobertura atual
- **4 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **3** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/purchase-returns/:id` | login | — | sem permissão (KF-09) |
| PUT | `/api/purchase-returns/:id` | login | — | sem permissão (KF-09) |
| GET | `/api/purchase-returns` | login | — |  |
| POST | `/api/purchase-returns` | login | — | sem permissão (KF-09) |

## Riscos e pontas soltas
- Devolver mais que o comprado.
- Devolução de compra já paga: crédito/estorno?
- Estoque negativo.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| PUR-01 | P0 | Quantidade devolvida ≤ comprada; estoque nunca fica negativo. |
| PUR-02 | P1 | Devolução de compra paga gera o ajuste financeiro definido pelo produto. |
| PUR-03 | P1 | Isolamento por organização e permissões (KF-09). |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
