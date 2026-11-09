# Domínio: Perfil

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Leitura/atualização do perfil do usuário.

## Cobertura atual
- **2 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **1** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| GET | `/api/profile` | login | — | sem org no código (KF-22) |
| PUT | `/api/profile` | login | — | sem permissão (KF-09); sem org no código (KF-22) |

## Riscos e pontas soltas
- Mass-assignment: não pode alterar `organization_id`, `role_id`, `is_owner` (KF-13 corrigido em `users`).

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| PRO-01 | P0 | `PUT` ignora `is_owner`, `organization_id`, `role_id`. |
| PRO-02 | P2 | Validação de campos. |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
