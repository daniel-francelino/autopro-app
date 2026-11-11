# Domínio: Impostos

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Alíquotas aplicadas na OS (`apply_taxes`, `total_taxes_amount`), que reduzem a base de lucro da comissão.

## Cobertura atual
- **4 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **3** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/taxes/:id` | login | — | sem permissão (KF-09) |
| PUT | `/api/taxes/:id` | login | — | sem permissão (KF-09) |
| GET | `/api/taxes` | login | — |  |
| POST | `/api/taxes` | login | — | sem permissão (KF-09) |

## Riscos e pontas soltas
- Alterar alíquota não deve mudar OS antigas.
- Soma de impostos > 100%.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| TAX-01 | P1 | Alíquota inválida (negativa, >100). |
| TAX-02 | P1 | Imposto reduz a base de comissão sobre lucro (C20 + imposto). |
| TAX-03 | P2 | Isolamento (KF-09). |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/support`), como em `tests/fast/service-orders/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/db` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
