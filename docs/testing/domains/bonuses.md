# Domínio: Bônus

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Metas por funcionário/mês com geração de registros financeiros (`record_type=bonus`). Motor puro bem coberto (`bonuses.test.ts`); faltam os handlers.

## Cobertura atual
- **13 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **0** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/bonuses/:id` | permissão `bonuses.delete` | — |  |
| GET | `/api/bonuses/:id` | permissão `bonuses.read` | — |  |
| PUT | `/api/bonuses/:id` | permissão `bonuses.update` | — |  |
| POST | `/api/bonuses/:id/assignments` | permissão `bonuses.update` | — |  |
| DELETE | `/api/bonuses/:id/assignments/:employeeId` | permissão `bonuses.update` | — |  |
| GET | `/api/bonuses/:id/financial-records` | permissão `bonuses.read` | — |  |
| DELETE | `/api/bonuses/:id/financial-records/:recordId` | permissão `bonuses.delete` | — |  |
| POST | `/api/bonuses/:id/generate` | permissão `bonuses.update` | — |  |
| DELETE | `/api/bonuses/:id/generations/:employeeId` | permissão `bonuses.update` | — |  |
| GET | `/api/bonuses/:id/progress` | permissão `bonuses.read` | — |  |
| POST | `/api/bonuses/:id/value-versions` | permissão `bonuses.update` | — |  |
| GET | `/api/bonuses` | permissão `bonuses.read` | — |  |
| POST | `/api/bonuses` | permissão `bonuses.create` | — |  |

## Riscos e pontas soltas
- `generate.post` duas vezes no mesmo mês duplica o bônus?
- `financial-records/:recordId` DELETE usa o mesmo estorno de saldo (corrigido) — falta teste do handler.
- Bônus não pode entrar no total de comissões (já tratado no relatório, falta contrato).

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| BON-01 | P0 | `generate.post` é idempotente por funcionário/mês; `generations/:employeeId` DELETE remove só o gerado. |
| BON-02 | P0 | Excluir registro de bônus pago devolve o saldo exato (usa `revertStatementOnAccount`). |
| BON-03 | P1 | `value-versions.post`: vigência por mês; mudança retroativa não reescreve mês fechado. |
| BON-04 | P1 | `progress.get` = `sumAchievedAmount` do util para os mesmos dados. |
| BON-05 | P1 | `assignments`: atribuir/remover; outra org → 404. |
| BON-06 | P2 | Permissões (KF-09). |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
