# Domínio: Planos de comissão (configuração)

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
CRUD de planos, versões, regras e atribuição a funcionários. O cálculo em si vive em `lib/utils/employee-commission-engine.ts` (bem coberto) e em `server/utils/service-order-commissions.ts` (ver núcleo financeiro).

## Cobertura atual
- **11 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **0** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/commissions/:id` | permissão `commissions.delete` | — |  |
| GET | `/api/commissions/:id` | permissão `commissions.read` | — |  |
| PUT | `/api/commissions/:id` | permissão `commissions.update` | — |  |
| POST | `/api/commissions/:id/assignments` | permissão `commissions.update` | — |  |
| DELETE | `/api/commissions/:id/assignments/:employeeId` | permissão `commissions.update` | — |  |
| GET | `/api/commissions/:id/impact` | permissão `commissions.read` | — |  |
| GET | `/api/commissions/:id/rules` | permissão `commissions.read` | — |  |
| POST | `/api/commissions/:id/versions` | permissão `commissions.update` | — |  |
| GET | `/api/commissions` | permissão `commissions.read` | — |  |
| POST | `/api/commissions` | permissão `commissions.create` | — |  |
| POST | `/api/commissions/preview` | permissão `commissions.read` | — |  |

## Riscos e pontas soltas
- Nova versão com `effective_from` no passado altera o histórico? (`impact.get` deveria avisar).
- Desativar/excluir plano em uso deixa funcionários sem regra → comissão some no próximo recálculo (KF-26/36).
- `preview.post` pode divergir do cálculo real (mesmo engine, entradas diferentes).

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| COM-01 | P0 | Excluir/desativar plano atribuído a funcionário com OS em aberto: bloqueia ou mostra o impacto. |
| COM-02 | P0 | `versions.post`: `effective_from` no passado/futuro; duas versões na mesma data; regra vigente na data da OS. |
| COM-03 | P1 | `assignments`: atribuir/remover; funcionário de outra organização → 404. |
| COM-04 | P1 | `preview.post` = resultado do engine para os mesmos itens (contrato). |
| COM-05 | P1 | `impact.get`: conta OS/funcionários afetados corretamente. |
| COM-06 | P2 | Permissões: todas as escritas exigem permissão de comissão (KF-09). |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
