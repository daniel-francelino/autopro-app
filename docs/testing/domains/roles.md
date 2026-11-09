# Domínio: Papéis e permissões

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Base de segurança do multi-tenant. Fase 0a corrigiu escalonamento (KF-11..17) e KF-16.

## Cobertura atual
- **7 rota(s)**; **3** com teste dedicado (citadas em `tests/`); **0** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/roles/:id` | permissão `roles.delete` | ✅ |  |
| GET | `/api/roles/:id` | login | — |  |
| PUT | `/api/roles/:id` | permissão `roles.update` | — |  |
| GET | `/api/roles/:id/actions` | login | — |  |
| POST | `/api/roles/:id/actions` | permissão `roles.manage_permissions` | ✅ |  |
| GET | `/api/roles` | login | — |  |
| POST | `/api/roles` | permissão `roles.create` | ✅ |  |

## Riscos e pontas soltas
- KF-09: boa parte do sistema ainda não consulta permissão.
- Seed de ações (KF-21) fora das migrations.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| ROL-01 | P0 | Matriz papel × ação nas rotas de dinheiro (depois de KF-09): sem permissão → 403 em `process-payment`, `pay`, `payment.delete`… |
| ROL-02 | P0 | `actions.post`: só quem tem `roles.update`; não concede ação que o próprio não possui (decisão de produto). |
| ROL-03 | P1 | Excluir papel em uso/de sistema (KF-16 corrigido) — cobrir também `PUT` de papel de sistema. |
| ROL-04 | P2 | `actions.get`: lista só ações da organização. |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
