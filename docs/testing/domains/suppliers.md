# Domínio: Fornecedores

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
CRUD e importação.

## Cobertura atual
- **5 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **4** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/suppliers/:id` | login | — | sem permissão (KF-09) |
| PUT | `/api/suppliers/:id` | login | — | sem permissão (KF-09) |
| POST | `/api/suppliers/import` | login | — | sem permissão (KF-09) |
| GET | `/api/suppliers` | login | — |  |
| POST | `/api/suppliers` | login | — | sem permissão (KF-09) |

## Riscos e pontas soltas
- Importação inválida/duplicada.
- Excluir fornecedor com compras.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| SUP-01 | P1 | `import.post` como em produtos. |
| SUP-02 | P1 | Exclusão com compras vinculadas. |
| SUP-03 | P2 | Isolamento (KF-09). |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/support`), como em `tests/fast/service-orders/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/db` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
