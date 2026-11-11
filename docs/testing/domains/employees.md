# Domínio: Funcionários

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Cadastro, acesso ao sistema (`grant-access`) e visões de comissão/bônus do funcionário.

## Cobertura atual
- **10 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **5** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/employees/:id` | login | — | sem permissão (KF-09) |
| PUT | `/api/employees/:id` | login | — | sem permissão (KF-09) |
| GET | `/api/employees/:id/bonuses` | permissão `bonuses.read` | — |  |
| GET | `/api/employees/:id/commission-plans` | permissão `commissions.read` | — |  |
| GET | `/api/employees/:id/commission-rules` | login | — |  |
| GET | `/api/employees/:id/commissions` | login | — |  |
| POST | `/api/employees/:id/export-commissions` | login | — | sem permissão (KF-09) |
| POST | `/api/employees/:id/grant-access` | login | — | sem permissão (KF-09) |
| GET | `/api/employees` | login | — |  |
| POST | `/api/employees` | login | — | sem permissão (KF-09) |

## Riscos e pontas soltas
- `grant-access` cria usuário e vínculo de papel — conferir limite de plano (KF-03 corrigido) e escalonamento de privilégio.
- `[id]/commissions.get` deve bater com `reports/commissions` para o mesmo funcionário (hoje podem divergir — KF-32).
- Desligar funcionário (`termination_date`) deve interromper novas comissões.
- `export-commissions` sem teste.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| EMP-01 | P0 | `grant-access`: respeita limite do plano; não cria papel acima do de quem concede; e-mail já existente. |
| EMP-02 | P0 | `[id]/commissions.get` = relatório de comissões filtrado pelo funcionário. |
| EMP-03 | P1 | Funcionário desligado/excluído não recebe comissão nova nem aparece em seleções. |
| EMP-04 | P1 | `DELETE` com comissões pendentes/pagas. |
| EMP-05 | P1 | `commission-plans|commission-rules|bonuses`: leitura coerente com os planos atribuídos. |
| EMP-06 | P2 | Permissões e isolamento (KF-09). |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/support`), como em `tests/fast/service-orders/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/db` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
