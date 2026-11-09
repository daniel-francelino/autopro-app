# Domínio: Autenticação

> Gerado em 2026-11-09. O inventário abaixo é automático (código-fonte + `tests/`); a análise é manual.
> Núcleo financeiro (OS, pagamentos, comissões, relatórios): ver também [financial-core-test-analysis.md](../financial-core-test-analysis.md).

## Resumo
Login, cadastro, recuperação de senha, sessão e exclusão de conta. Públicas por desenho.

## Cobertura atual
- **13 rota(s)**; **8** com teste dedicado (citadas em `tests/`); **4** escrita(s) sem checagem de permissão (KF-09).
- Cobertas por **todos** os domínios: matriz M1 (sem sessão → 401) em `guard-matrix.test.ts` e catracas estáticas (`tests/static`).

| Método | Rota | Guard | Teste dedicado | Observações |
|---|---|---|---|---|
| DELETE | `/api/auth/account` | login | — | sem permissão (KF-09); sem org no código (KF-22) |
| POST | `/api/auth/avatar` | login | — | sem permissão (KF-09); sem org no código (KF-22) |
| POST | `/api/auth/forgot-password` | público | ✅ |  |
| POST | `/api/auth/login` | público | ✅ |  |
| POST | `/api/auth/logout` | público | ✅ |  |
| GET | `/api/auth/me` | público | ✅ |  |
| PUT | `/api/auth/password` | login | — | sem permissão (KF-09); sem org no código (KF-22) |
| GET | `/api/auth/profile` | login | — |  |
| PUT | `/api/auth/profile` | login | — | sem permissão (KF-09); sem org no código (KF-22) |
| POST | `/api/auth/reset-password-with-tokens` | público | ✅ |  |
| POST | `/api/auth/reset-password` | público | ✅ |  |
| POST | `/api/auth/set-session` | público | ✅ |  |
| POST | `/api/auth/signup` | público | ✅ |  |

## Riscos e pontas soltas
- Sem rate limit em login/forgot-password.
- `account.delete`: apaga dados da oficina? Confirmar o que acontece com a organização e a assinatura.
- `signup`: cria organização + assinatura; falha no meio deixa lixo.

## Cenários a criar

| ID | Prioridade | Cenário |
|---|---|---|
| AUT-01 | P0 | `signup` atômico: falha na criação da organização não deixa usuário órfão (e vice-versa). |
| AUT-02 | P0 | `account.delete`: bloqueia se for o único admin com funcionários; limpa sessão e Stripe. |
| AUT-03 | P1 | `login`: credencial inválida não distingue e-mail inexistente; cookies `HttpOnly`/`Secure`. |
| AUT-04 | P1 | `reset-password*`: token expirado/reutilizado. |
| AUT-05 | P1 | `set-session`: tokens forjados recusados. |
| AUT-06 | P2 | `avatar.post`: tipo/tamanho; `password.put` exige senha atual. |

## Padrão para escrever os testes
- Handler real + `createFakeSupabase` (`tests/helpers`), como em `tests/unit/handlers/money-flows.test.ts`.
- Sempre incluir: **sem sessão (401)**, **outra organização (404 e nada muda)**, **corpo inválido (400)** e **repetição (idempotência)**.
- O que depende de RPC, gatilho, índice único ou concorrência vai para `tests/api` (Supabase local).
- Bug descoberto: escrever o teste do comportamento correto com `it.fails`, registrar `KF-nn` em `known-failures.md`.
