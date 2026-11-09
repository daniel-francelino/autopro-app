# Domínio: Clientes

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Cadastro com importação em lote (`batch.post`). Aparece em devedores e relatórios.

## Cobertura atual
- **5 rota(s)**; **1** com teste dedicado (citadas em `tests/`); **4** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/clients/:id` | login | — | sem permissão (KF-09) |
| PUT | `/api/clients/:id` | login | — | sem permissão (KF-09) |
| POST | `/api/clients/batch` | login | — | sem permissão (KF-09) |
| GET | `/api/clients` | login | — |  |
| POST | `/api/clients` | login | ✅ | sem permissão (KF-09) |

## Riscos e pontas soltas
- CPF/CNPJ duplicado dentro da organização.
- Excluir cliente com OS/dívida.
- `batch.post` com dados inválidos ou volumosos.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| CLI-01 | P0 | Excluir cliente com dívida em aberto/OS: bloqueia ou preserva o histórico nos relatórios. |
| CLI-02 | P1 | `batch.post`: lote parcial, duplicados, tamanho máximo; rollback. |
| CLI-03 | P1 | Validação de documento (CPF/CNPJ) e e-mail. |
| CLI-04 | P2 | Busca com acento e isolamento (KF-09). |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
