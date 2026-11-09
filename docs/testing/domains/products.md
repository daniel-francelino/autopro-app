# Domínio: Produtos / peças / estoque

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Produtos, importação em massa (`import.post`), próximo código. Base do custo das OS.

## Cobertura atual
- **6 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **4** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/products/:id` | login | — | sem permissão (KF-09) |
| PUT | `/api/products/:id` | login | — | sem permissão (KF-09) |
| POST | `/api/products/import` | login | — | sem permissão (KF-09) |
| GET | `/api/products` | login | — |  |
| POST | `/api/products` | login | — | sem permissão (KF-09) |
| GET | `/api/products/next-code` | login | — |  |

## Riscos e pontas soltas
- Importação: CSV malformado, duplicados, injeção de fórmula, limite de linhas.
- `next-code` sob concorrência gera código duplicado (⏳).
- Custo/preço alterado depois não deve reescrever OS antigas (snapshot no item).

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| PRO-01 | P0 | `import.post`: arquivo inválido/vazio/enorme; linha com erro não derruba o lote; idempotência por código. |
| PRO-02 | P1 | Alterar preço/custo não muda OS já criadas. |
| PRO-03 | P1 | `next-code`: sequência por organização (⏳ concorrência). |
| PRO-04 | P1 | Exclusão de produto usado em OS/compras. |
| PRO-05 | P2 | Busca com acento, paginação, isolamento (KF-09). |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
