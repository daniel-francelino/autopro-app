# Domínio: Maquininhas

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Terminais e taxas, usados em `terminal_fee_amount` das OS.

## Cobertura atual
- **4 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **3** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/payment-terminals/:id` | login | — | sem permissão (KF-09) |
| PUT | `/api/payment-terminals/:id` | login | — | sem permissão (KF-09) |
| GET | `/api/payment-terminals` | login | — |  |
| POST | `/api/payment-terminals` | login | — | sem permissão (KF-09) |

## Riscos e pontas soltas
- Taxa percentual vs. fixa; alterar taxa não pode reescrever recebimentos antigos.
- Excluir terminal usado em parcelas.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| PAY-01 | P0 | Taxa da maquininha reflete (ou não) no saldo/relatório conforme definido; documentar a regra e testar. |
| PAY-02 | P1 | Excluir terminal com parcelas vinculadas. |
| PAY-03 | P2 | Isolamento e permissões (KF-09). |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
