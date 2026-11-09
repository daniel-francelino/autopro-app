# Domínio: Solicitações de compra

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Fluxo de aprovação (`authorize`/`reject`).

## Cobertura atual
- **6 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **5** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/purchase-requests/:id` | login | — | sem permissão (KF-09) |
| PUT | `/api/purchase-requests/:id` | login | — | sem permissão (KF-09) |
| POST | `/api/purchase-requests/:id/authorize` | login | — | sem permissão (KF-09) |
| POST | `/api/purchase-requests/:id/reject` | login | — | sem permissão (KF-09) |
| GET | `/api/purchase-requests` | login | — |  |
| POST | `/api/purchase-requests` | login | — | sem permissão (KF-09) |

## Riscos e pontas soltas
- Quem solicita não pode autorizar a própria solicitação.
- Autorizar duas vezes / autorizar rejeitada.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| PUR-01 | P0 | `authorize`/`reject` exigem permissão própria e respeitam a máquina de estados (pendente→autorizada|rejeitada, terminal). |
| PUR-02 | P1 | Autorização gera a compra uma única vez (idempotência). |
| PUR-03 | P1 | Isolamento por organização. |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
