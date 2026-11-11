# Plano de testes automatizados

> Status: **parcialmente implementado** · Criado em 2026-11-09 · Implementação inicial em 2026-11-09.
>
> **Entregue e rodando (`pnpm test`, sem Docker):** L0 completa, L1 (motor de comissão, bonuses, recurrence, relatórios, analytics, utils do front),
> L2 (pagamento/estorno, guards, licença), "L3-lite" (handlers reais com banco em memória: matriz M1 nas 232 rotas protegidas, admin, users, roles,
> process-payment, financial/pay) e o fluxo F4. Playwright E1/E10/E11 rodando.
> **Não executado / pendente:** L3-L4 contra Postgres real, `supabase/config.toml`, F1/F5–F12, E2–E9/E12 — ver `docs/testing/known-failures.md` (KF-00).
> **Resultado:** a implementação revelou 23 itens (defeitos do produto e pendências de infraestrutura) (vários P0 de segurança e de saldo) — todos registrados lá, sem correção.
> Como rodar: `tests/README.md`.
>
> **Objetivo:** que nenhuma funcionalidade quebre sem a gente perceber. Quando este plano foi escrito o CI rodava só `lint` e `typecheck` e o repositório não tinha teste.
> **Hoje existem** a suíte Vitest (projetos `fast` e `db`), o Playwright e o CI (`static`, `api` e `e2e` em `.github/workflows/ci.yml`); estrutura e comandos reais em `tests/README.md` e `docs/architecture/tests-organization.md`.
>
> **Método:** leitura de `server/api/**` (248 handlers), `server/utils/**`, `lib/utils`, `app/middleware`, `supabase/migrations`
> e dos documentos em `docs/`. Os números abaixo são contagens do código atual.

---

## 1. Resumo da estratégia

O sistema é um Nuxt 4 em que **quase toda a regra de negócio vive nos handlers de `server/api` e conversa direto com o
Supabase usando o service role** (que ignora RLS). Consequência: a única barreira de segurança e de isolamento entre oficinas
é o código do handler. Por isso o plano pesa mais em **API + banco** do que em tela.

| Camada | O que testa | Ferramenta | Roda em | Custo |
|---|---|---|---|---|
| **L0 Estática** | Todo handler tem guard; contrato de rotas; afirmações públicas | Vitest (lê arquivos) + `check:claims` | CI, segundos | Muito baixo |
| **L1 Unidade pura** | Funções sem I/O: comissões, recorrência, datas, relatórios, status | Vitest | CI, segundos | Baixo |
| **L2 Unidade com banco falso** | Utilitários que recebem `SupabaseClient` (recalcular status, reverter recebimento) | Vitest + fake do cliente | CI, segundos | Médio |
| **L3 Endpoint (integração)** | Cada rota HTTP: auth, permissão, validação, isolamento por organização, efeito no banco | Vitest + `@nuxt/test-utils` + Supabase local | CI, minutos | Alto (setup) / médio (por teste) |
| **L4 Fluxo** | Sequências de chamadas que representam um processo de negócio | Mesmo da L3 | CI, minutos | Médio |
| **L5 E2E de navegador** | Poucos caminhos críticos de ponta a ponta na UI | Playwright | CI (noturno) / antes de release | Alto |

Regra de ouro: **testar cada coisa na camada mais barata que a pega**. Conta de comissão é L1, não E2E. Isolamento entre
oficinas é L3, não L1. Só o que depende de navegador (redirecionamento, modal) vai para L5.

---

## 2. Estado atual e riscos que o teste precisa cobrir

### 2.1 Inventário (o que existe para testar)

| Área | Quantidade | Onde |
|---|---|---|
| Handlers de API | 248 (≈ 155 escrita + 93 leitura) | `server/api/**` |
| Utilitários de servidor | 48 arquivos, ≈ 6,4 mil linhas | `server/utils/**` |
| Motor de comissão (puro, compartilhado) | 484 linhas | `lib/utils/employee-commission-engine.ts` |
| Middlewares de rota | 4 | `app/middleware/*` |
| Páginas | `app/pages/**` (app, admin, auth, checkout, onboarding) | |
| Migrations | 97 | `supabase/migrations` |
| Edge functions | `stripe-webhook`, NF-e/NFS-e | `supabase/functions` |
| Integrações externas | Supabase Auth/DB/Storage, Stripe, Focus NFe, OneSignal | |

### 2.2 Onde o risco é maior (define a prioridade)

| # | Risco | Por quê | Referência |
|---|---|---|---|
| R1 | **Vazamento entre oficinas** (multi-tenant) | Service role ignora RLS; basta um handler esquecer `.eq('organization_id')` | `docs/admin/owner-panel-plan.md` §2.1 |
| R2 | **Permissão por papel não checada no servidor** | Só 37 handlers importam `requireOrgPermission`; o plano de segurança aponta 24 de 155 rotas de escrita protegidas | `owner-panel-plan.md` §2.2 |
| R3 | **Dinheiro**: recebimento de OS, parcelas, estorno, saldo de conta | Lógica de saldo e rollback manual repetida em handlers que não compartilham código | `docs/service-orders/payment-flow-current.md` |
| R4 | **Comissão e bônus** | Regra versionada por mês, overrides manuais, arredondamento (já houve auditoria de arredondamento) | `docs/finance/*` |
| R5 | **Assinatura / Stripe / plano** | Webhook de 555 linhas altera `organizations.is_active`, `subscriptions`, faturas; gate de plano duplicado no front e no servidor ("keep in sync") | `server/api/stripe/webhook.post.ts`, `license.ts` |
| R6 | **Fiscal (NFS-e)** | Depende de API externa; já existe bug conhecido (cancelar NFS-e dá 403 por `requireOwner`) | `owner-panel-plan.md` |
| R7 | **Auth, sessão e redirecionamento** | `requireAuthUser` tem 4 caminhos (token válido, refresh, auth fora do ar → 503, inválido → 401); o middleware tem 10 passos | `server/utils/require-auth.ts`, `auth.global.ts` |
| R8 | **Migrations** | 97 arquivos aplicados em ordem; nenhuma garantia de que um banco limpo sobe | `supabase/migrations` |
| R9 | **Duplicação "keep in sync"** | `ACTION_PLAN_REQUIREMENTS` e limites de plano existem no front (`usePlans.ts`) e no servidor | `require-org-permission.ts`, `license.ts` |

---

## 3. Ferramentas e arquitetura

### 3.1 Escolhas

| Necessidade | Escolha | Motivo |
|---|---|---|
| Runner | **Vitest** | Já é o padrão do ecossistema Nuxt/Vite, TypeScript nativo, rápido |
| Testar handlers Nitro e composables | **`@nuxt/test-utils`** (`$fetch`, `setup`, `mountSuspended`) | Sobe o app real com auto-imports (`defineEventHandler`, `createError`, `useRuntimeConfig`) |
| Componentes Vue | `@vue/test-utils` + `happy-dom` | Só para os poucos componentes com lógica (modal de pagamento, tabelas) |
| Navegador | **Playwright** | Cookies/sessão reais, mobile viewport, trace no CI |
| Banco | **Supabase local** (`supabase start`, via Docker) | O código usa recursos do Postgres (RPC `next-number`, índices únicos parciais, `CHECK`). Um banco falso esconderia justamente os bugs reais |
| Mock de HTTP externo | **MSW** (ou `vi.stubGlobal('fetch')`) | Stripe, Focus NFe, OneSignal, consulta de placa/CEP |
| Cobertura | `@vitest/coverage-v8` | Métrica de acompanhamento, não meta cega |

> **Pré-requisito que hoje não existe:** não há `supabase/config.toml` nem pasta `supabase/seeders/demo` com conteúdo
> (as duas pastas de seeders estão vazias). É preciso `supabase init`, apontar as migrations existentes e criar um seed de teste
> (§3.4). **Risco R8:** as 97 migrations nunca foram aplicadas em banco limpo de forma automatizada; a primeira execução pode
> falhar e a correção disso é parte da Fase 0.

### 3.2 Estrutura de pastas (a real; reorganizada conforme `docs/architecture/tests-organization.md`)

```
tests/
  static/                    # L0: lê o código-fonte (baselines/ = catracas)
  fast/                      # projeto Vitest `fast`: sem Docker; L1, L2, L3-lite e fluxos em memória
    access/ admin/ audit/ auth/ commissions/ financial/ reports/ service-orders/ users/   # uma pasta por domínio
    flows/                   # jornadas multi-domínio (undo-payment)
    lib/                     # utilitários sem domínio claro
  db/                        # projeto Vitest `db`: Postgres real (stack Docker)
  e2e/                       # Playwright (support/: env, world, auth-fixtures, settle; service-orders/support/: order-fixtures)
  support/                   # fake-supabase, handler-harness, h3-stub, factories, db, source-scan, env, global-setup, fast-globals
vitest.config.ts
playwright.config.ts
```

Convenção de nome: `*.test.ts` (Vitest) e `*.e2e.ts` (Playwright). Código de cenário no título do `describe` (`[P45] …`). A proposta original (msw-handlers, `auth.ts`, `api/` espelhando `server/api`) não foi adotada.

### 3.3 Scripts (`package.json`)

```jsonc
"test":          "vitest run --project fast",          // L0+L1+L2, sem Docker
"test:api":      "vitest run --project db",           // L3+L4, exige Supabase local
"test:all":      "vitest run",
"test:watch":    "vitest --project fast",
"test:coverage": "vitest run --coverage",
"test:e2e":      "playwright test"
```

Dois "projects" no Vitest separam o que precisa de Docker do que não precisa; o desenvolvedor roda `pnpm test` em segundos e
deixa o resto para o CI.

### 3.4 Dados e isolamento

- **Duas oficinas de teste, sempre** (`orgA`, `orgB`). Todo teste de API que lê ou escreve dados verifica também que `orgB` não
  vê nem altera o que é de `orgA`. É a defesa do R1.
- **Usuários-padrão por oficina:** `owner da plataforma` (`is_owner`), `admin` da oficina, `funcionário com papel limitado`,
  `funcionário sem papel`, `usuário sem organização`, `funcionário desligado` (`termination_date`/`deleted_at`).
- **Planos:** `orgA` em `starter`, uma terceira em `pro`, outra em `fiscal`, e uma sem assinatura ativa.
- **Reset entre testes:** transação não serve (o servidor usa outra conexão); usar `TRUNCATE ... CASCADE` das tabelas de dados
  e recriar via factories. Seed estático só para tabelas de referência (`actions`, papéis de sistema, categorias padrão).
- **Nunca** apontar para o projeto Supabase real: `global-setup.ts` aborta se `SUPABASE_URL` não for `127.0.0.1`/`localhost`.
- **Tempo:** funções com data usam `vi.useFakeTimers()` / `vi.setSystemTime()` para não depender do dia da execução.

---

## 4. Camada L0 — Testes estáticos (barato e de alto valor)

São testes que **leem o código-fonte**, sem subir nada.

| Teste | O que garante | Falha quando |
|---|---|---|
| **Matriz de guards** | Todo arquivo de `server/api/**` chama um guard (`requireAuthUser`, `requireOwner`, `requireOrgPermission`, `resolveOrganizationId`) **ou** está numa allowlist explícita e justificada (login, signup, webhook, health, forgot-password) | Alguém cria rota nova sem proteção. Hoje o plano de segurança aponta 14 sem guard |
| **Rotas de escrita com permissão** | Todo `*.post/put/patch/delete.ts` fora da allowlist chama `requireOrgPermission` (ou `requireOwner`). Começa com uma **lista de exceções conhecidas** (as ≈130 que ainda faltam) que **só pode diminuir** | A lista cresce (rota nova sem permissão) |
| **Isolamento por organização** | Todo handler que usa `getSupabaseAdminClient` e acessa tabela com `organization_id` referencia `organization_id` | Query sem filtro de organização |
| **Arquivos vazios** | Nenhum handler de 0 bytes (`fiscal/zip_code/index.get.ts` hoje) | Rota fantasma |
| **Paridade front/servidor de planos** | `ACTION_PLAN_REQUIREMENTS` e limites de `EMPLOYEE_LIMITS` iguais em `usePlans.ts`, `require-org-permission.ts`, `license.ts` | Alguém altera um lado só (R9) |
| **Códigos de ação existem** | Todo código passado a `requireOrgPermission('x.y')` e usado em `app/constants/action-codes.ts` existe nas migrations/seed de `actions` | Typo no código da permissão → 403 para todos |
| **Afirmações públicas** | `pnpm check:claims` (já existe) | FAQ/preços prometem o que não existe |
| **Migrations** | Nomes em ordem estritamente crescente, sem timestamp duplicado | Conflito de merge |

> Observação: o teste "rotas de escrita com permissão" é o que **transforma o plano de segurança em trava permanente**: cada
> correção remove uma rota da lista de exceções e o CI impede regressão.

---

## 5. Camada L1 — Unidade pura

Funções sem I/O. Prioridade por impacto financeiro.

### 5.1 `lib/utils/employee-commission-engine.ts` (484 linhas) — **P0**

Compartilhado entre front e servidor. Casos mínimos:

- `toCommissionMonthStart`: data/`Date`/string ISO, fuso (dia 31 às 23h não pode virar mês seguinte), ano bissexto.
- `resolveEffectiveCommissionVersion`: sem versão, uma versão, várias versões (pega a vigente no mês), versão futura ignorada.
- `matchCommissionRule` / `getApplicableCommissionRule`: por tipo de item, por categoria, regra genérica vs. específica, nenhuma regra.
- `computeCommissionAmount`: `percentage` e `fixed_amount`; base `revenue` e `profit`; lucro negativo (comissão zero, não negativa); quantidade > 1; **arredondamento a 2 casas** (casos da auditoria `docs/finance/auditoria-arredondamento-comissoes-2026-09-10.md` viram testes de regressão).
- `computeEmployeeOrderCommission`: OS com vários itens e regras mistas; soma dos itens == total.
- `getActiveCommissionOverride` / `getActiveOverridePlanIds` / `resolveEffectiveCommissionRules`: sequência `apply` → `remove` → `apply`, override por plano, log vazio.
- `toCommissionOrderItemInput` / `getOrderItemTotal|Cost|Quantity`: campos ausentes, strings numéricas, `null`.

### 5.2 `server/utils/bonuses.ts`

`toMonthStart`, `monthDateRange`, `lastDayOfMonth` (fevereiro, bissexto), `resolveDueDate` (dia 31 em mês de 30 dias),
`resolveEffectiveVersion`, `sumAchievedAmount` para cada `CommissionBase` (`revenue`, `profit`, `revenue_minus_parts`,
`employee_net_profit`).

### 5.3 `server/utils/recurrence.ts`

`parseRRule` (FREQ/INTERVAL/COUNT/UNTIL inválidos) e `expandRecurrence` (mensal no dia 31, semanal, limite de ocorrências,
`UNTIL` antes do início). Alimenta o lançamento financeiro recorrente.

### 5.4 Relatórios

- `report-helpers.ts`: `parseDateStart/End/Range` (fuso; `to` antes de `from`), `roundMoney`, `toNumber`, `paginate`,
  `normalizeReportStatus`, `getPreviousRangeByMode` (cada modo de comparação), `calculateVariation` (anterior = 0 não pode dar `Infinity`/`NaN`), `getPurchasePaymentStatus` (vencida vs. pendente).
- `profit-report-helpers.ts`: `calculateCashFlowFromTransactions`, `calculateByOrderPeriodData`, `buildVariations`,
  `buildTopProfitableOrders`, `toPublicPeriodData` (**não pode vazar campos internos**).
- `app/utils/report-debtors.ts`, `report-sales-items.ts`, `service-orders.ts`, `calendar.ts`, `commission-rule-draft.ts`,
  `financial-category-options.ts`: tabelas de entrada/saída simples.

### 5.5 Outros puros

| Arquivo | Casos |
|---|---|
| `server/utils/license.ts` → `filterActionsByPlan` | Recursos fiscais somem fora do plano `fiscal`; recurso sem gate passa |
| `server/utils/auth-session.ts` | `resolveSessionExpiresAt` (JWT válido, malformado, expirado), `isInvalidAuthError` (400/401/403 vs. 500/rede) |
| `server/utils/auth-user.ts`, `auth-cookies.ts` | Montagem/leitura de cookie, flags `httpOnly`/`secure`/`sameSite`, cookie corrompido |
| `server/utils/employee-access.ts` | `isEmployeeAccessRevoked` (desligamento no futuro vs. passado, `deleted_at`) |
| `server/utils/service-order-number.ts`, `supabase-pagination.ts`, `search.ts` | Formatação, limites de página, escape de caractere especial na busca (evitar injeção no filtro `ilike`/`or`) |
| `server/utils/fiscal-mappers.ts` (548 linhas) | Mapeamento OS → payload NFS-e: campos obrigatórios, CPF vs. CNPJ, valores monetários, caracteres especiais; **snapshot** do payload |
| `server/utils/report-export.ts` | CSV/planilha: escape de vírgula/aspas/quebra de linha, **proteção contra fórmula** (`=`, `+`, `-`, `@` no início da célula) |
| `lib/analytics/*`, `server/utils/analytics/*` | Pseudonimização por HMAC é estável e não reversível; evento desconhecido é rejeitado |
| `app/composables/useWorkshopPermissions.ts`, `usePlans.ts`, `useReportsAccess.ts` | Matriz papel × ação × plano |

---

## 6. Camada L2 — Unidade com Supabase falso

Para utilitários que **recebem** o `SupabaseClient` por parâmetro (já são fáceis de isolar). O `fake-supabase.ts` implementa só
o encadeamento usado (`from().select().eq().is().maybeSingle()` etc.) sobre arrays em memória, e registra as escritas para
asserção.

| Função | Casos |
|---|---|
| `recalculateServiceOrderPaymentStatus` | 0 parcelas → `pending`; todas `paid` → `paid`; uma `partial` → `partial`; uma paga e outra pendente → `partial`; parcela soft-deletada é ignorada |
| `getNextInstallmentNumber` | Contagem só de ativas; reuso do número após soft delete |
| `reverseServiceOrderReceipt` | Estorna saldo e cria extrato inverso; transação já estornada não estorna de novo (idempotência) |
| `createIncomeTransaction` | Saldo antes/depois no extrato; rollback quando o extrato falha |
| `financial-transaction-deletion`, `resolve-financial-category` | Categoria inexistente cai no padrão; exclusão de transação pai com filhas |
| `resolveOrganizationId` | Sem perfil → 400; `is_active=false` → 403; funcionário desligado → 403 **e** dispara `syncEmployeeLinkedUserAccess`; ok → devolve a org |
| `requireOrgPermission` | Plano insuficiente → 403; `is_owner` passa; papel `admin` de sistema passa; papel sem a ação → 403; ação inexistente → 403; `is_granted=false` → 403 |
| `requireOwner` | Não-owner → 403; erro de banco → 500 |
| `requireAuthUser` | Token válido; token inválido + refresh válido (renova cookies); Supabase fora do ar → **503** (e não 401, para não deslogar todo mundo); sem nada → 401 |
| `enforceEmployeeLimit` | `starter` bloqueia no 3.º; `pro` no 11.º; `fiscal` sem limite; sem assinatura ativa |

---

## 7. Camada L3 — Testes de endpoint

### 7.1 Matriz-padrão (aplicada a **todo** endpoint)

Em vez de escrever à mão para 248 rotas, cria-se um helper `describeEndpoint()` que roda a matriz abaixo e cada arquivo só
acrescenta os casos específicos.

| # | Caso | Esperado |
|---|---|---|
| M1 | Sem cookie de sessão | 401 |
| M2 | Sessão válida, **usuário sem organização** | 400/403 |
| M3 | Usuário com `is_active=false` ou funcionário desligado | 403 |
| M4 | Papel **sem** a permissão da ação (rotas de escrita e leituras sensíveis) | 403 |
| M5 | Plano abaixo do exigido (rotas `fiscal`/`pro`) | 403 com mensagem do plano |
| M6 | Caminho feliz com papel correto | 2xx + corpo no formato esperado |
| M7 | **Isolamento:** usuário da `orgB` tenta ler/alterar/excluir `id` da `orgA` | 404 (ou 403); registro da `orgA` intacto |
| M8 | **Corpo malicioso:** `organization_id`, `created_by`, `is_owner`, `role_id` enviados no corpo são ignorados | Gravado com a org da sessão |
| M9 | Campos obrigatórios ausentes / tipo errado | 400 com mensagem |
| M10 | `id` inexistente ou já excluído (soft delete) | 404 |
| M11 | Listagem: paginação, ordenação, busca e filtro respeitam a org | Só dados da org |

M7 e M8 são o núcleo do R1. Para as rotas com `[id]`, M7 é obrigatório.

### 7.2 Cobertura por domínio

Prioridade: **P0** = antes de qualquer refatoração/lançamento · **P1** = logo em seguida · **P2** = quando sobrar tempo.

| Domínio | Rotas | Casos específicos além da matriz | Prio. |
|---|---|---|---|
| **auth** | signup, login, logout, me, profile, password, forgot/reset-password(+tokens), set-session, account.delete, avatar | Signup cria usuário + perfil e não cria org; e-mail duplicado; senha fraca; login errado não diferencia "usuário inexistente" de "senha errada"; `logout` limpa cookies; troca de senha exige a atual; `account.delete` apaga/anonimiza dados; upload de avatar rejeita tipo/tamanho inválido | P0 |
| **users** | assign-organization, update-fields, update-role, get-by-email, list-organization, initial-data, employee-auth-status | **Regressão de segurança:** `update-fields` não troca `organization_id`/`role_id` de outra org nem do próprio usuário; `assign-organization` (se ainda existir) recusa; `update-role` só aceita papel da mesma org; `initial-data` devolve `isOwner/isAdmin/organizationId/onboarding` corretos | **P0** |
| **organizations** | get/put, logo, complete-onboarding | Só admin edita; logo valida tipo; onboarding é idempotente | P1 |
| **roles** | CRUD, actions get/post | Papel de sistema não pode ser editado/excluído; papel em uso não é excluído; **funcionário não consegue se dar permissões** (R2); papel da `orgB` invisível | **P0** |
| **employees** | CRUD, grant-access, comissões/bônus por funcionário, export-commissions | Limite de funcionários por plano (R9); `grant-access` cria usuário vinculado com papel; desligar funcionário revoga acesso na próxima chamada; CPF não vaza em listas sem permissão | **P0** |
| **clients / vehicles / appointments** | CRUD, batch, lookup-plate | Placa/CPF duplicados; cliente com OS não pode ser excluído (ou vira soft delete); `lookup-plate` com serviço externo falhando (MSW) → erro tratado | P1 |
| **products / parts / master-products / product-categories / suppliers / taxes** | CRUD, import, next-code | `next-code` sequencial sem buraco nem repetição em chamadas concorrentes; importação CSV: linha inválida não aborta o lote inteiro; categoria em uso não exclui | P1 |
| **purchases / purchase-requests / purchase-returns** | CRUD, pay, authorize, reject | Pagar compra gera saída financeira e baixa saldo; autorizar/rejeitar só uma vez e só por quem pode; devolução não excede a quantidade comprada | P1 |
| **service-orders** | CRUD, next-number, cancel, down-payment, process-payment, receive-extra-payment, installments, payment.delete, generate-commissions, edit-data, nfse, export-csv | **Ver fluxos F2–F4.** `next-number` único sob concorrência (RPC `next-number`, corrigido em `docs/service-orders/next-number-rpc-fix.md`); transições de status inválidas → 409; não excluir OS paga | **P0** |
| **financial** | CRUD, pay, pay-entries-bulk, pay-commissions-bulk, update-recurring, extend-recurrence, categories (+migrate), summary, export | Pagar duas vezes → 409; pagamento em lote é **atômico** ou reporta parcial de forma explícita; `update-recurring` com escopo "só esta / esta e futuras / todas"; `summary` bate com a soma dos lançamentos; migrar categoria move todos os lançamentos | **P0** |
| **bank-accounts / payment-terminals** | CRUD | Não excluir conta com lançamentos; saldo só muda por lançamento (não por PUT direto) | P0 |
| **commissions** | CRUD, versions, assignments, rules, impact, preview | Nova versão vale a partir do mês; `preview` não grava nada; `impact` lista funcionários afetados; remover atribuição não apaga comissões já geradas | **P0** |
| **bonuses** | CRUD, assignments, value-versions, generate, progress, generations, financial-records | `generate` do mesmo mês duas vezes não duplica; desfazer geração remove o lançamento financeiro; progresso por base de cálculo | P1 |
| **reports** | commissions, costs-profit, customers, debtors, employees, overview, profit-by-order, profit-cash-flow, purchases, sales-items, suppliers, dashboard-stats, export-* | **Números conferidos contra um dataset fixo** (golden): valores esperados escritos à mão; período vazio devolve zeros; relatórios `pro` bloqueados no `starter`; exportação não inclui dado de outra org; paginação com total correto | P1 (números) / **P0** (isolamento) |
| **billing / stripe** | checkout, portal, cancel, status, invoices, cancel-subscription, webhook | Ver fluxo F1. Webhook: assinatura inválida → 400; evento repetido (mesmo `event.id`) é idempotente; cada tipo de evento tratado; evento desconhecido → 200 sem efeito | **P0** |
| **fiscal** | company, sync, sync-status, nfse (CRUD, email, hook), municipalities, service_items, tax_codes, zip_code, config | Focus NFe sempre mockada (MSW); `hook.post` valida origem/segredo; emissão exige plano `fiscal`; erro da API externa vira mensagem tratada e entra em `fiscal_integration_logs`; **regressão:** cancelar NFS-e pela oficina funciona (hoje 403) | P1 |
| **feedback / notifications / settings / profile / metrics** | CRUD, upload, read-all, preferences, device | Feedback de uma org não aparece em outra; `read-all` só marca as do usuário; `metrics/track` rejeita payload fora do contrato e nunca grava dado pessoal em claro | P2 (exceto isolamento: P0) |
| **admin** | stats, metrics, organizations, users, subscriptions, invoices (+chart) | **Todo** handler recusa não-owner (403) e deslogado (401); contagens de `stats` corretas | **P0** |
| **supabase/health, consulta** | health, consulta | `health` não expõe segredos; `consulta` (sem login, expõe dados por CPF) — teste de regressão que exige **404/401** depois da correção | **P0** |

---

## 8. Camada L4 — Testes de fluxo

Cada fluxo é **um arquivo** em `tests/fast/flows/`, executando as chamadas reais em sequência e conferindo o **estado do banco** no
fim (saldo, status, lançamentos, extrato), não só o status HTTP.

### F1 — Cadastro → assinatura → uso (a porta de entrada)
1. `signup` → perfil criado, sem organização. 2. `middleware`: vai para `/subscription`.
3. `stripe/checkout` (Stripe mockado) → 4. `stripe/webhook` `checkout.session.completed` cria organização, assinatura e
fatura, marca o usuário como `is_owner` da org (conferir o que o código faz de fato). 5. `initial-data` → `onboarding` incompleto.
6. `complete-onboarding` → vai para `/app`. 7. Webhook `invoice.payment_failed` / `customer.subscription.deleted` → org
`is_active=false`, assinatura `cancelled`. 8. **Replay do mesmo evento não duplica nada.**

### F2 — OS à vista: orçamento → conclusão → recebimento → comissão
Criar cliente, veículo, funcionário com plano de comissão e conta bancária → `service-orders` POST (número sequencial) → concluir →
`process-payment` à vista → conferir: OS `paid`, **1 transação `income`**, `current_balance` +total, **1 linha de extrato** com antes/depois,
comissões geradas com o valor do motor (L1). Repetir `process-payment` → 409 e **saldo não muda**.

### F3 — OS parcelada: entrada + parcelas + pagamento parcela a parcela
`process-payment` com 3 parcelas (a 1.ª `paid`) → OS `partial` → `installments/:id/pay` na 2.ª → ainda `partial` → na 3.ª → `paid`.
Variações: soma das parcelas ≠ total (rejeitar **no servidor**, hoje só o front valida); parcela com conta diferente; `down-payment`;
`receive-extra-payment`; `PATCH` de parcela; exclusão de parcela paga (`docs/service-orders/delete-paid-installment.md`) estorna saldo;
número da parcela reaproveitado após exclusão.

### F4 — Desfazer e cancelar
`payment.delete` em OS paga → saldo volta ao valor inicial, extrato registra o estorno, transações marcadas, comissões voltam a
"pendente"/são removidas, OS volta a `pending`. `cancel` da OS com pagamento. `delete` da OS paga é recusado. **Invariante de
fim de teste:** `soma(extrato) == saldo da conta` e `soma(transações pagas) == saldo da conta`.

### F5 — Comissão: do plano ao pagamento
Criar plano → atribuir a funcionário → nova **versão** para o mês seguinte → gerar OS em cada mês e conferir regra vigente →
**override manual** (apply/remove) → `generate-commissions` → `pay-commissions-bulk` gera saída financeira e baixa saldo →
relatório `commissions` bate com o que foi pago → pagar de novo → 409.

### F6 — Bônus por meta
Bônus com base `revenue`, atribuir a 2 funcionários, gerar OS suficientes, `progress` mostra % → `generate` (mês fechado) cria
lançamento → segundo `generate` não duplica → `generations/:employeeId` DELETE remove lançamento.

### F7 — Financeiro recorrente
Criar despesa mensal recorrente → ocorrências geradas → `pay` de uma → `update-recurring` escopo "esta e futuras" → `extend-recurrence`
→ excluir só uma → `summary` por período confere.

### F8 — Compras e estoque
Solicitação de compra → autorizar → compra → pagar (saída financeira + saldo) → devolução parcial → estoque/valores finais.

### F9 — Funcionário e acesso
Criar funcionário → `grant-access` (cria usuário) → login dele → só enxerga o que o papel permite → admin muda o papel →
próxima chamada reflete → funcionário **desligado** (`termination_date` passado) → 403 e `user_profiles.is_active` vira `false`.

### F10 — Isolamento total entre oficinas (teste "mestre" do R1)
Cria `orgA` com **uma linha em cada tabela** (via factories). Para cada rota GET/PUT/DELETE com `[id]` e cada GET de listagem,
autentica como usuário da `orgB` e verifica que nada da `orgA` aparece/muda. Gerado a partir da lista de rotas, então rota nova é
coberta automaticamente.

### F11 — Fiscal
Configurar empresa (`sync`) → emitir NFS-e a partir da OS (Focus NFe mockada: sucesso, rejeição, timeout) → webhook `hook` muda
status → enviar por e-mail → cancelar. Cada resposta externa gera linha em `fiscal_integration_logs`.

### F12 — Plano e limites
`starter` com 2 funcionários: o 3.º é recusado; upgrade via webhook → passa. Relatórios `pro` e rotas `fiscal` bloqueados e depois
liberados na troca de plano.

---

## 9. Camada L5 — E2E com Playwright

> **Os cenários E2E vivem em [`docs/testing/e2e-scenarios.md`](./e2e-scenarios.md)** (139 cenários, 16 jornadas). A tabela abaixo é o recorte original e fica só como referência histórica; os E2E atuais cobrem mais "a tela abre" do que o caminho do usuário, e o catálogo novo corrige isso.

Poucos testes (≈ 12–15), só o que **só o navegador prova**. Cada um usa um usuário criado por API (rápido) e `storageState`.

| # | Cenário | Prova |
|---|---|---|
| E1 | Visitante em `/app` → vai para `/login`; logado em `/login` → vai para o destino certo | `auth.global.ts` (10 passos) |
| E2 | Usuário sem org → `/subscription`; org sem onboarding → `/onboarding`; onboarding concluído → `/app` | redirecionamentos |
| E3 | Owner da plataforma só vê `/admin`; admin de oficina tentando `/admin` é barrado | R1/R2 na UI |
| E4 | Login / logout / recuperação de senha | formulário + cookies |
| E5 | Criar cliente + veículo + OS pela tela | formulários e validação |
| E6 | **Receber pagamento da OS** (à vista e parcelado) pelo modal | `PaymentModal.vue`; conferir saldo na tela de contas |
| E7 | Funcionário com papel limitado: botões ocultos **e** URL direta redireciona para `/app/forbidden` | `useWorkshopPermissions`, `workshop-permission` |
| E8 | Relatório com filtro de período, exportação baixa arquivo | relatórios e export |
| E9 | Pricing/FAQ: nenhuma promessa fora da lista verificada | complementa `check:claims` |
| E10 | Mobile (viewport 390 px): navegação inferior e modal de pagamento usáveis | `MobileBottomNav.vue` |
| E11 | Páginas públicas (`/`, `/pricing`, `/perguntas-frequentes`, `/<slug>`) respondem 200, têm `<title>`, `canonical` e entram no sitemap | SEO (docs/seo) |
| E12 | Checkout Stripe em modo teste até `success` (nightly, opcional) | integração real |

Capacitor (iOS/Android) fica **fora** do escopo automatizado; é teste manual de release (push OneSignal, status bar, teclado).

---

## 10. CI/CD

### 10.1 Pipeline proposto (`.github/workflows/ci.yml`)

| Job | Quando | Conteúdo | Tempo-alvo |
|---|---|---|---|
| `static` | todo push | `lint`, `typecheck`, `test` (L0+L1+L2) | < 2 min |
| `api` | todo push/PR | `supabase start` → aplica migrations + seed → `test:api` (L3+L4) | < 10 min |
| `e2e` | PR para `main` e noturno | `nuxt build` → Playwright (Chromium) | < 15 min |

- Falha de qualquer job **bloqueia o merge** em `main` (branch protection).
- Playwright guarda `trace`/`video` só quando falha; Vitest publica o relatório de cobertura como artefato.
- Segredos de teste são fixos e locais (chaves do Supabase local); **nenhum segredo de produção entra no CI de teste**.

### 10.2 Metas de cobertura (acompanhar, não perseguir às cegas)

| Escopo | Meta inicial (fim da Fase 3) | Meta final |
|---|---|---|
| `lib/utils` (motor de comissão) | 95 % | 95 % |
| `server/utils` | 70 % | 85 % |
| `server/api` (linhas) | 40 % | 70 % |
| Rotas com a matriz M1–M11 aplicada | todas as P0 | todas |
| Fluxos F1–F12 | F1–F5 | todos |

Regra: **todo bug corrigido ganha um teste que falha antes da correção** (regressão), e todo PR que mexe em handler de dinheiro
ou permissão inclui teste.

---

## 11. Fases de execução

Cada fase termina com algo útil sozinho (o CI já protege parte do sistema).

| Fase | Entrega | Depende de | Esforço* |
|---|---|---|---|
| **0 — Fundação** | Vitest + `@nuxt/test-utils` configurados; `supabase init` + `config.toml`; **migrations sobem em banco limpo** (corrigir o que quebrar); seed de referência; `tests/support` (factories, `loginAs`, reset); job `static` no CI com 1 teste de exemplo | — | 2–3 dias |
| **1 — Rede de segurança barata** | L0 inteira (matriz de guards, paridade de planos, arquivos vazios); L1 do **motor de comissão**, `bonuses`, `recurrence`, `report-helpers` | Fase 0 | 3–4 dias |
| **2 — Segurança e isolamento** | Helper `describeEndpoint()` (M1–M11); testes P0 de `users`, `roles`, `admin`, `auth`, `consulta`; **F10** (isolamento mestre). Os que expõem falhas reais já nascem como `it.fails`/`todo` ligados ao item do plano de segurança e viram verdes conforme as correções entram | Fase 0 | 4–5 dias |
| **3 — Dinheiro** | L2 de pagamento/estorno; L3 de `service-orders`, `financial`, `bank-accounts`, `commissions`; fluxos **F2–F5** e invariantes de saldo | Fases 0–2 | 5–7 dias |
| **4 — Assinatura e plano** | `stripe/webhook` completo (MSW + payloads de exemplo), `billing`, **F1** e **F12**, limite de funcionários | Fase 0 | 3–4 dias |
| **5 — Demais domínios** | Cadastros (clients, vehicles, products, suppliers…), compras, bônus (F6–F8), relatórios com dataset golden, fiscal (F11) | Fases 2–3 | 6–8 dias |
| **6 — E2E e mobile** | Playwright E1–E11; job `e2e` no CI; checklist manual de release do Capacitor | Fases 0–4 | 3–4 dias |
| **7 — Manutenção contínua** | Cobertura no PR; regra "bug → teste"; revisão trimestral da allowlist de guards | — | contínuo |

\* Estimativa de 1 pessoa dedicada; sem contar correções de produto que os testes revelarem.

**Ordem prática se o tempo for curto:** Fase 0 → Fase 1 → F10 + `users`/`roles`/`admin` (Fase 2) → F2–F4 (Fase 3) → F1 (Fase 4).
Isso cobre os riscos R1, R2, R3, R4 e R5 com cerca de 3 semanas.

---

## 12. Riscos do próprio plano e decisões em aberto

| # | Risco / decisão | Proposta |
|---|---|---|
| D1 | **Migrations podem não subir em banco limpo** (R8) — `supabase/config.toml` não existe, seeders vazios | Primeira tarefa da Fase 0; se houver migrations dependentes de dados de produção, criar um `baseline` |
| D2 | **Lógica de saldo duplicada** em 4+ handlers de pagamento (rollback manual, sem transação de banco) | Testes de invariante (F4) vão achar divergências. Refatorar para uma função/RPC transacional **depois** de ter os testes, não antes |
| D3 | Testes que dependem do Docker são lentos para o desenvolvedor | `pnpm test` (sem Docker) no dia a dia; `test:api` só no CI e sob demanda |
| D4 | Testes de segurança vão **falhar** hoje (as falhas são reais, ver `owner-panel-plan.md` §2) | Marcar como `it.fails` com link para o item; remover a marca quando a correção entrar. Assim o CI fica verde e a regressão fica travada |
| D5 | Edge functions (`supabase/functions/*`, Deno) não rodam no Vitest/Node | `stripe-webhook` existe duas vezes (Nitro e edge): confirmar qual está em uso; testar só a ativa e remover a outra |
| D6 | Fusos e datas (`from/to`, vencimento, mês de referência) | Fixar `TZ=America/Sao_Paulo` no Vitest e testar também em UTC os utilitários de data |
| D7 | Dados reais em testes | Proibido. Usar factories; CPF/CNPJ de teste válidos gerados por função |
| D8 | Nome de cobertura vs. qualidade | Medir também **mutation testing** (Stryker) só no motor de comissão, onde um `<` trocado por `<=` custa dinheiro |

---

## 13. Checklist para escrever um teste novo

1. Qual é a **camada mais barata** que pega esse bug? (§1)
2. O teste cria seus próprios dados por factory e **não depende de ordem** de execução?
3. Para rota nova: aplicou `describeEndpoint()` (M1–M11) e adicionou à allowlist de L0 só se for realmente pública?
4. Para dinheiro: conferiu **estado final no banco** (saldo, extrato, transações), não só o HTTP?
5. Para dado de data: usou `vi.setSystemTime`?
6. Serviço externo está mockado (Stripe, Focus NFe, OneSignal)?
7. O nome diz **o comportamento**: `recusa pagar OS já paga` e não `test process-payment 2`.
