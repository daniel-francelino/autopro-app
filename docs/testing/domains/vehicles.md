# Domínio: Veículos

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
CRUD e consulta de placa externa (`lookup-plate`, consome token pago).

## Cobertura atual
- **5 rota(s)**; **1** com teste dedicado (citadas em `tests/`); **3** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/vehicles/:id` | login | — | sem permissão (KF-09) |
| PUT | `/api/vehicles/:id` | login | — | sem permissão (KF-09) |
| GET | `/api/vehicles` | login | — |  |
| POST | `/api/vehicles` | login | — | sem permissão (KF-09) |
| GET | `/api/vehicles/lookup-plate` | login | ✅ |  |

## Riscos e pontas soltas
- `lookup-plate` sem rate limit (custo do provedor).
- Placa duplicada na organização.
- Excluir veículo com OS.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| VEH-01 | P1 | `lookup-plate`: exige login (KF-07 corrigido), valida formato de placa, falha do provedor não derruba a tela. |
| VEH-02 | P1 | Placa única por organização (antiga e Mercosul). |
| VEH-03 | P2 | Exclusão com OS; isolamento (KF-09). |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
