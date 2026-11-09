# Domínio: Feedback do usuário

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Envio, anexos e respostas; o painel do owner lê e responde.

## Cobertura atual
- **7 rota(s)**; **0** com teste dedicado (citadas em `tests/`); **4** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/feedback/:id` | login | — | sem permissão (KF-09); sem org no código (KF-22) |
| GET | `/api/feedback/:id` | login | — | sem org no código (KF-22) |
| GET | `/api/feedback/:id.responses` | login | — | sem org no código (KF-22) |
| POST | `/api/feedback/:id.responses` | login | — | sem permissão (KF-09); sem org no código (KF-22) |
| GET | `/api/feedback` | login | — | sem org no código (KF-22) |
| POST | `/api/feedback` | login | — | sem permissão (KF-09); sem org no código (KF-22) |
| POST | `/api/feedback/upload` | login | — | sem permissão (KF-09); sem org no código (KF-22) |

## Riscos e pontas soltas
- Upload de anexo (tipo/tamanho).
- Feedback é global: 31 handlers sem `organization_id` (KF-22) — usuário só pode ver o próprio.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| FEE-01 | P0 | Usuário A não lê feedback do usuário B (GET/DELETE/responses). |
| FEE-02 | P1 | `upload.post`: tipo/tamanho; nome de arquivo malicioso. |
| FEE-03 | P1 | Resposta do owner notifica o autor. |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
