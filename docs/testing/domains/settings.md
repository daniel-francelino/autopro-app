# Domínio: Configurações / notificações

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Preferências e dispositivos de notificação push.

## Cobertura atual
- **5 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **3** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| GET | `/api/settings/notifications` | login | — | sem org no código (KF-22) |
| PUT | `/api/settings/notifications` | login | — | sem permissão (KF-09); sem org no código (KF-22) |
| POST | `/api/settings/notifications/device` | login | — | sem permissão (KF-09) |
| GET | `/api/settings/preferences` | login | — | sem org no código (KF-22) |
| PUT | `/api/settings/preferences` | login | — | sem permissão (KF-09); sem org no código (KF-22) |

## Riscos e pontas soltas
- `device.post` aceita token de qualquer usuário; duplicidade de dispositivo.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| SET-01 | P1 | Registro idempotente de dispositivo; token por usuário. |
| SET-02 | P2 | Preferências inválidas. |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/support`), como em `tests/fast/service-orders/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/db` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
