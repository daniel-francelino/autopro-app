# Domínio: Contas bancárias

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
CRUD de contas. O saldo (`current_balance`) é alterado por vários fluxos de pagamento; aqui está o dono da invariante I1.

## Cobertura atual
- **4 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **3** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/bank-accounts/:id` | login | — | sem permissão (KF-09) |
| PUT | `/api/bank-accounts/:id` | login | — | sem permissão (KF-09) |
| GET | `/api/bank-accounts` | login | — |  |
| POST | `/api/bank-accounts` | login | — | sem permissão (KF-09) |

## Riscos e pontas soltas
- Editar `current_balance` direto via `PUT` quebra a conciliação com o extrato.
- Excluir conta com extrato/lançamentos vinculados.
- Moeda/precisão: saldo em ponto flutuante (KF-30).

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| BAN-01 | P0 | `PUT` não permite alterar `current_balance` (ou gera ajuste com extrato). |
| BAN-02 | P0 | Excluir conta com movimentos: bloqueia ou arquiva sem perder histórico. |
| BAN-03 | P1 | Saldo inicial na criação gera extrato de abertura. |
| BAN-04 | P1 | Isolamento por organização em GET/PUT/DELETE. |
| BAN-05 | P2 | Permissões nas escritas (KF-09). |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
