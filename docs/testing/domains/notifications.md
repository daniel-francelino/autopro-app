# Domínio: Notificações

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Lista e marca como lida.

## Cobertura atual
- **3 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **2** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| GET | `/api/notifications` | login | — | sem org no código (KF-22) |
| POST | `/api/notifications/read-all` | login | — | sem permissão (KF-09); sem org no código (KF-22) |
| POST | `/api/notifications/read` | login | — | sem permissão (KF-09); sem org no código (KF-22) |

## Riscos e pontas soltas
- `read`/`read-all` não pode tocar notificações de outro usuário/organização.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| NOT-01 | P0 | `read-all` só afeta as do usuário/organização. |
| NOT-02 | P2 | Paginação e ordenação. |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
