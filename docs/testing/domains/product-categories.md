# Domínio: Categorias de produto

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Categorias usadas nas regras de comissão por categoria.

## Cobertura atual
- **4 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **0** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/product-categories/:id` | permissão `product_categories.delete` | — |  |
| PUT | `/api/product-categories/:id` | permissão `product_categories.update` | — |  |
| GET | `/api/product-categories` | login | — |  |
| POST | `/api/product-categories` | permissão `product_categories.create` | — |  |

## Riscos e pontas soltas
- Excluir categoria usada em regra de comissão muda o cálculo silenciosamente (C23).

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| PRO-01 | P0 | Excluir categoria referenciada por regra de comissão: bloqueia ou avisa o impacto. |
| PRO-02 | P2 | Isolamento e permissões (KF-09). |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/support`), como em `tests/fast/service-orders/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/db` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
