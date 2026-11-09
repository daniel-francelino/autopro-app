# Domínio: Stripe (webhook e checkout)

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Webhook assinado, idempotente (tabela `stripe_webhook_events`).

## Cobertura atual
- **3 rota(s)**; **1** com teste dedicado (citadas em `tests/`); **2** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| POST | `/api/stripe/cancel-subscription` | login | — | sem permissão (KF-09) |
| POST | `/api/stripe/checkout` | login | — | sem permissão (KF-09) |
| POST | `/api/stripe/webhook` | público | ✅ |  |

## Riscos e pontas soltas
- Assinatura inválida deve ser 400 sem efeitos.
- Eventos fora de ordem / repetidos.
- `monthly_amount` ausente subestima o MRR do painel.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| STR-01 | P0 | Evento repetido (mesmo `id`) é processado uma vez. |
| STR-02 | P0 | Eventos fora de ordem: `subscription.deleted` antes de `updated`. |
| STR-03 | P0 | `invoice.payment_failed` → status e suspensão conforme regra. |
| STR-04 | P1 | Assinatura sem organização conhecida: erro registrado, 200 ao Stripe. |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
