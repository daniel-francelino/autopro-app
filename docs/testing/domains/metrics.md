# Domínio: Métricas de uso

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
`track.post` pública por desenho (telemetria de uso).

## Cobertura atual
- **1 rota(s)**; **1** com teste dedicado (citadas em `tests/`); **0** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| POST | `/api/metrics/track` | público | ✅ |  |

## Riscos e pontas soltas
- Sem limite de taxa: pode encher a tabela.
- Payload grande/ malicioso.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| MET-01 | P1 | Validação e tamanho máximo do payload; evento inválido ignorado. |
| MET-02 | P2 | Limite de taxa por IP/usuário. |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/support`), como em `tests/fast/service-orders/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/db` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
