# Domínio: Cobrança (Stripe, lado do cliente)

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Checkout, portal, cancelamento e faturas da oficina.

## Cobertura atual
- **5 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **3** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| POST | `/api/billing/cancel` | login | — | sem permissão (KF-09) |
| POST | `/api/billing/checkout` | login | — | sem permissão (KF-09); sem org no código (KF-22) |
| GET | `/api/billing/invoices` | login | — |  |
| POST | `/api/billing/portal` | login | — | sem permissão (KF-09); sem org no código (KF-22) |
| GET | `/api/billing/status` | login | — |  |

## Riscos e pontas soltas
- Cancelar assinatura com fatura em aberto.
- `checkout` duplicado cria duas assinaturas.
- `status` desatualizado em relação ao webhook.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| BIL-01 | P0 | `checkout` quando já existe assinatura ativa: não duplica. |
| BIL-02 | P0 | `cancel`: cancela no fim do período; status reflete o webhook. |
| BIL-03 | P1 | `invoices.get`: só da organização. |
| BIL-04 | P1 | `portal`: cria cliente Stripe se não existir. |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
