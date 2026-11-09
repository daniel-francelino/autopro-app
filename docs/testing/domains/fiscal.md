# Domínio: Fiscal (NFS-e, municípios, empresa)

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Integração com provedor fiscal; arquivos de integração são o maior risco de dado cruzado entre oficinas (KF-22 mapeou rotas sem org).

## Cobertura atual
- **17 rota(s)**; **5** com teste dedicado (citadas em `tests/`); **0** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| GET | `/api/fiscal/business_id/:business_id` | login | — |  |
| GET | `/api/fiscal/company/sync-status` | login | — |  |
| POST | `/api/fiscal/company/sync` | permissão `fiscal.manage` | ✅ |  |
| GET | `/api/fiscal/municipalities/:municipality_code` | login | — |  |
| GET | `/api/fiscal/municipalities/:municipality_code/service_items/:code` | login | — |  |
| GET | `/api/fiscal/municipalities/:municipality_code/service_items` | login | — |  |
| GET | `/api/fiscal/municipalities/:municipality_code/tax_codes/:code` | login | — |  |
| GET | `/api/fiscal/municipalities/:municipality_code/tax_codes` | login | — |  |
| GET | `/api/fiscal/municipalities` | login | — |  |
| GET | `/api/fiscal/nfse/:id` | permissão `service_invoice.read` | — |  |
| POST | `/api/fiscal/nfse/:reference/email` | permissão `service_invoice.read` | ✅ |  |
| POST | `/api/fiscal/nfse/:reference/hook` | permissão `service_invoice.update` | ✅ |  |
| DELETE | `/api/fiscal/nfse/:reference` | permissão `service_invoice.delete` | ✅ |  |
| GET | `/api/fiscal/nfse/:reference` | permissão `service_invoice.read` | ✅ |  |
| GET | `/api/fiscal/nfse` | permissão `service_invoice.read` | — |  |
| POST | `/api/fiscal/nfse` | permissão `service_invoice.create` | — |  |
| GET | `/api/fiscal/zip_code/:zip_code` | login | — |  |

## Riscos e pontas soltas
- Propriedade da nota: `assertNfseBelongsToOrg` cobre `nfse/[reference]/*`; conferir `nfse/[id]` e `hook.post` (webhook).
- Falha do provedor no meio da emissão deixa a OS em estado inconsistente.
- `company/sync` altera dados fiscais da empresa.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| FIS-01 | P0 | Emitir nota duas vezes para a mesma OS: segunda recusada. |
| FIS-02 | P0 | `hook.post`: assinatura/segredo do provedor; payload de outra organização ignorado. |
| FIS-03 | P0 | `nfse/[id]` (GET): outra organização → 404. |
| FIS-04 | P1 | Cancelar nota emitida; e-mail da nota. |
| FIS-05 | P1 | Rotas de município/CEP: erro do provedor não vira 500 opaco. |
| FIS-06 | P1 | Permissão `fiscal.manage` nas escritas (migration 100 criou a ação). |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
