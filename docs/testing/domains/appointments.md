# Domínio: Agendamentos

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Agenda; pode nascer junto da OS (`appointmentData`).

## Cobertura atual
- **4 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **3** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/appointments/:id` | login | — | sem permissão (KF-09) |
| PUT | `/api/appointments/:id` | login | — | sem permissão (KF-09) |
| GET | `/api/appointments` | login | — |  |
| POST | `/api/appointments` | login | — | sem permissão (KF-09) |

## Riscos e pontas soltas
- Conflito de horário.
- Fuso horário/DST.
- Agendamento vinculado a OS excluída.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| APP-01 | P1 | Criar OS com agendamento cria os dois ou nenhum (rollback). |
| APP-02 | P1 | Data/hora e fuso: agendamento de hoje aparece no painel (`dashboard-stats`). |
| APP-03 | P2 | Isolamento e permissões (KF-09). |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/support`), como em `tests/fast/service-orders/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/db` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
