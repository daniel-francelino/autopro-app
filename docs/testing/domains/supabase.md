# Domínio: Saúde do Supabase

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
`health.get` — protegido na Fase 0a.

## Cobertura atual
- **1 rota(s)**; **1** com teste dedicado (citadas em `tests/`); **0** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| GET | `/api/supabase/health` | público | ✅ |  |

## Riscos e pontas soltas
- Não pode vazar detalhes de infraestrutura a anônimos.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| SUP-01 | P1 | Anônimo → 401/403; owner → status. |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/support`), como em `tests/fast/service-orders/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/db` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
