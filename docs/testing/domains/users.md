# Domínio: Usuários

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Dados iniciais da sessão, troca de papel e campos. Fase 0a fechou KF-11..15.

## Cobertura atual
- **5 rota(s)**; **2** com teste dedicado (citadas em `tests/`); **5** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| POST | `/api/users/employee-auth-status` | login | — | sem permissão (KF-09) |
| POST | `/api/users/initial-data` | login | — | sem permissão (KF-09) |
| POST | `/api/users/list-organization` | login | — | sem permissão (KF-09) |
| POST | `/api/users/update-fields` | login | ✅ | sem permissão (KF-09) |
| POST | `/api/users/update-role` | login | ✅ | sem permissão (KF-09) |

## Riscos e pontas soltas
- `initial-data` é chamado em toda sessão: erros viram tela em branco.
- `list-organization` expõe e-mails: só da própria organização.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| USE-01 | P0 | `initial-data`: usuário sem organização, organização suspensa, assinatura vencida. |
| USE-02 | P1 | `list-organization`: só da organização do solicitante. |
| USE-03 | P1 | `employee-auth-status`: não vaza existência de e-mail de outra organização. |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/support`), como em `tests/fast/service-orders/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/db` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
