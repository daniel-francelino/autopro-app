# Plano de implementação — Painel do owner (`/admin`)

> Status: **auditoria do estado atual + plano de implementação** · Criado em 2026-11-08 · Revisado em 2026-11-08 (verificação linha a linha no código)
> **Implementação (2026-11-09):** Fases **0a, 1, 2, 3, 4 e 5 implementadas** (ver §11 e §12). Fase 0b só em `roles/*` e `users/*`
> (as demais 109 rotas de escrita dependem de decisão de produto). Fase 0c: consultas prontas em `scripts/retroactive-review.sql`,
> **execução em produção pendente** (ver [retroactive-review.md](retroactive-review.md)).
>
> **Objetivo:** o owner (dono da **plataforma**, `user_profiles.is_owner = true`) vê, em um só lugar, tudo que os planos de
> [auditoria](../audit/audit-log-plan.md), [métricas](../metrics/usage-metrics-plan.md) e [GEO](../seo/geo-audit-brasil.md)
> produzem — e **só ele** consegue ver.
>
> **Método:** leitura de `app/pages/admin`, `app/layouts/admin.vue`, `app/middleware/*`, `server/utils/*` e varredura
> automatizada dos 248 handlers de `server/api/**` (quais guards cada um chama), seguida de leitura manual dos suspeitos.
> Os achados de segurança foram **confirmados lendo o código, não explorados em execução**.

### O que mudou nesta revisão

| Antes | Agora (verificado) |
|---|---|
| "290 arquivos em `server/api`" | **248** (155 de escrita + 93 GET). 14 sem guard, 49 só com `requireAuthUser` — confirmados |
| P1: "o middleware deixa entrar quem não é owner" | **Incorreto.** `auth.global.ts:75-78` já redireciona não-owner para fora de `/admin`. O `workshop-admin` é redundante e checa a coisa errada, mas não abre a porta (rebaixado para Baixa) |
| `fiscal/zip_code/*` "sem login" | `[zip_code].get.ts` exige login; `index.get.ts` é um **arquivo vazio** (0 bytes) |
| Sem achado sobre permissões por papel | **Novo e grave:** só **24 das 155** rotas de escrita checam permissão do papel no servidor; qualquer funcionário pode, por exemplo, se dar todas as permissões (§2.2) |
| `assign-organization` = Alta | **Crítica:** um usuário recém-cadastrado (sem org) pode se vincular a **qualquer** oficina com **qualquer** papel |
| — | **Novo bug funcional:** cancelar NFS-e sempre dá 403 para as oficinas (`fiscal/nfse/[reference]/index.delete.ts` exige `requireOwner`) |
| Guard por prefixo em `/api/fiscal/company/**` | Quebraria a oficina: `sync` e `sync-status` são usados em `/app/settings/company`. Proposta nova: **mover** as rotas do owner para `/api/admin/**` |
| Linhas de evidência | Corrigidas (`admin.vue:66` e `:31`, `stats.get.ts:21-24`) |

---

## 1. Estado atual do painel

### 1.1 O que existe

| Tela | Rota | O que mostra | Fonte (API) |
|---|---|---|---|
| Dashboard | `/admin` | 4 cartões (organizações, usuários, assinaturas ativas, OS); gráfico de assinaturas (12 meses); tabela de assinaturas; gráfico e tabela de faturas | `admin/stats`, `admin/subscriptions[/chart]`, `admin/invoices[/chart]` |
| Organizações | `/admin/organizations` | Lista (razão social, CNPJ, e-mail, nº de usuários, status, criação), busca e paginação | `admin/organizations` |
| Usuários | `/admin/users` | Lista (nome, e-mail, organização, owner, status, criação) | `admin/users` |
| Fiscal empresas | `/admin/fiscal/companies` | CRUD de empresas na conta Focus NFe da plataforma | `fiscal/company` (index/[id]) |
| Fiscal logs | `/admin/fiscal/logs` | Log das chamadas à Focus NFe (`fiscal_integration_logs`) | `fiscal/config/logs` |

- Layout: `app/layouts/admin.vue`. Proteção de página: `auth.global.ts` (passo 6, exige `isOwner`) **e** `workshop-admin` em cada página (`definePageMeta`).
- `auth.global.ts:70-72`: o owner é **sempre** mandado para `/admin`; ele **não consegue abrir `/app`** (nem ver o produto como cliente).
- Os 7 handlers de `server/api/admin/**` chamam `requireOwner` — a API do painel em si está protegida.

### 1.2 Problemas do próprio painel

| # | Sev. | Achado | Evidência | Efeito / correção |
|---|---|---|---|---|
| P1 | Baixa | `workshop-admin` checa `isAdmin` (= owner **ou** papel `admin` **ou** papel de sistema), não `isOwner` | `workshop-admin.ts:4`; `users/initial-data.post.ts:49` | Hoje inofensivo porque `auth.global.ts:75-78` barra antes. Mas é enganoso: se alguém mexer no global, o admin de qualquer oficina entra. Trocar por `owner-only` |
| P2 | Baixa | Logo aponta para `/admin/dashboard` (não existe) | `admin.vue:66` | 404 ao clicar no logo → `to="/admin"` |
| P3 | Baixa | "Ajuda" leva a `/docs` (sem página) | `admin.vue:31` | 404 → remover o item ou apontar para um doc real |
| P4 | Média | `admin/stats` baixa **todas as linhas** de 4 tabelas para contar e filtra em JS | `stats.get.ts:21-24`, `:27-37` | Lento com volume → `head:true` + contagens filtradas no banco |
| P5 | Baixa | `admin/stats` conta assinatura ativa como `active` **ou `trialing`**, mas o banco só aceita `active/cancelled/suspended/trial` | `stats.get.ts:28`; migration 27 (`CHECK`) | `trialing` nunca casa; trocar por `trial` |
| P6 | Média | Listas **somente leitura** e sem página de detalhe | `organizations.vue`, `users.vue` | Não dá para investigar "o que está acontecendo com a oficina X" |
| P7 | — | **Sem** auditoria, métricas, caixa de feedbacks, erros, saúde das integrações | — | Objetivo deste plano |
| P8 | Média | Não há como suspender/reativar oficina ou usuário pela tela. `organizations.is_active` existe, mas é **controlado pelo webhook do Stripe** (`webhook.post.ts:439,502,534`) e **não é checado no servidor** (`resolveOrganizationId` só olha `user_profiles.is_active`) | `organization.ts:9-56` | Org cancelada continua chamando a API se souber as rotas. Suspensão manual exige coluna própria (§5.3) |
| P9 | Média | Como alguém vira `is_owner` não está documentado nem tem tela | migration 41 | Risco de ficar sem owner. Documentar o SQL e exigir ≥ 2 owners (§8) |
| P10 | Baixa | Owner é expulso de `/app` | `auth.global.ts:70` | Não consegue reproduzir o que o cliente vê. Ver decisão "modo suporte" (§8) |

## 2. ⚠️ Achados de segurança (resolver ANTES de ampliar o painel)

Todas as rotas usam o **service role** (`getSupabaseAdminClient`), que **ignora RLS**. Portanto a única barreira é o código do
handler. Dois tipos de falha apareceram:

- **2.1 Entre oficinas** — rota que não restringe por organização: um cliente logado age sobre **outra** oficina.
- **2.2 Dentro da oficina** — rota que restringe por organização mas não checa o **papel**: qualquer funcionário faz o que só o admin deveria.

### 2.1 Entre oficinas (e sem login)

"Usado pelo front?" = existe chamada em `app/**`. Rotas sem chamador podem ser **apagadas** — é a correção mais barata e segura.

| Sev. | Rota | O que um usuário logado qualquer consegue | Evidência | Usado pelo front? | Correção |
|---|---|---|---|---|---|
| **Crítica** | `POST users/update-fields` | Alterar `organization_id`, `role_id`, `employee_id` e `email` de **qualquer** `user_profiles` (inclusive o próprio → entra em qualquer oficina como admin) | só `requireAuthUser`; `.eq('id', user_id)` sem checar org (`:33-36`) | Sim, só para trocar `role_id` (`settings/roles/[id].vue:288`) | Aceitar **só** `role_id`; alvo precisa ser da mesma org; exigir `roles.manage_members`; papel precisa ser da mesma org. Ou trocar a chamada do front por `users/update-role` (já checa a org) e apagar esta |
| **Crítica** | `POST users/assign-organization` | Usuário **sem organização** (qualquer cadastro novo) se vincula a **qualquer** `organization_id` com **qualquer** `role_id` (inclusive admin) | IDs vêm do `body` (`:16,44`); só `requireAuthUser` | **Não** | **Apagar.** O vínculo de funcionário já é feito por `employees/[id]/grant-access` |
| **Crítica** | `fiscal/company` `index.get/post`, `[id].get/put/delete` | Listar, criar, editar e **excluir empresas na conta Focus NFe da plataforma** (CNPJs de todos os clientes), com o token da plataforma | `requireAuthUser` + `if (!user)` que **nunca** dispara (a função já lança 401) | Só a tela `/admin/fiscal/companies` | **Mover** para `/api/admin/fiscal/companies/**` com `requireOwner` |
| **Alta** | `POST fiscal/company/sync` | Cadastrar/alterar empresa na Focus NFe e gravar `fiscal_sync_status` de **qualquer** `organization_id` enviado no corpo | `organization_id` do `body` (`:17-18,79`) | Sim (`settings/company.vue:331`) | Derivar a org com `resolveOrganizationId`; ignorar o corpo; exigir `fiscal.manage` |
| **Alta** | `feedback/admin/*` (4 handlers) | Listar **todos** os feedbacks de **todas** as oficinas (com anexos, `organization_id` e vínculos) e alterar status/prioridade/vínculos | só `requireAuthUser`; `select('*')` sem filtro (`index.get.ts:24-28`) | **Não** (sem UI) | **Mover** para `/api/admin/feedbacks/**` com `requireOwner` |
| **Alta** | `GET service-orders/commission-seed-status` | Ler **todas** as OS (com itens), **todos** os clientes e **todas as linhas de funcionários** (`select('*')`, inclui CPF) de todas as oficinas | `:77-79` sem `.eq('organization_id')` | **Não** | **Apagar** (rota de diagnóstico de migração). Se ainda for útil, mover para `/api/admin` |
| **Alta** | `GET consulta` (**sem login**) | Qualquer pessoa, informando um CPF, vê nome e lançamentos financeiros (valores, datas, status, notas, OS) do funcionário | `consulta/index.get.ts` sem guard; usa service role | **Não** | **Apagar** (não há tela). Se for reativada: código enviado ao funcionário + rate limit |
| **Média** | `POST reports/export-file` (**sem login**) | Gerar PDF/CSV arbitrário no servidor (CPU, abuso) | nenhum guard | **Não** | **Apagar** (ou exigir login) |
| **Média** | `POST users/get-by-email` | Descobrir se um e-mail tem conta e obter o `id` do perfil (insumo para as rotas críticas acima) | só `requireAuthUser` | **Não** | **Apagar** |
| Baixa | `GET vehicles/lookup-plate` (**sem login**) | Gastar a cota paga da API de placas (`WDAPI_TOKEN`) | nenhum guard | Sim (`vehicles/FormModal.vue:93`) | Exigir login + org + rate limit por org |
| Baixa | `GET fiscal/business_id/[id]`, `fiscal/zip_code/[zip]`, `fiscal/municipalities/**` | Gastar cota da Focus NFe (só exige login, sem org) | só `requireAuthUser` | Sim | Exigir org (`resolveOrganizationId`); o cache de 24 h já existe no CEP |
| Baixa | `GET supabase/health` (**sem login**) | Chamar `auth.admin.listUsers` com service role e ver mensagem de erro interna | nenhum guard | Não | Responder só `{ ok }` e mover detalhes para `/api/admin/system` |
| Baixa | `routeRules['/api/**'] = { cors: true }` | CORS aberto para qualquer origem. Os cookies são `SameSite=Lax` (`auth-cookies.ts:15`), então não há CSRF direto, mas não há motivo para CORS aberto | `nuxt.config.ts` | — | Remover ou restringir ao domínio do app/Capacitor |
| — | `fiscal/zip_code/index.get.ts` | Arquivo **vazio** (0 bytes) registrado como rota | — | — | Apagar |

**Cadeia de ataque (por que "Crítica"):** `feedback/admin` expõe `organization_id` de todas as oficinas →
`assign-organization` ou `update-fields` vincula a conta do atacante a uma delas com papel admin → a partir daí as rotas
normais devolvem os dados daquela oficina. Nada disso exige ferramenta especial, só um navegador logado.

### 2.2 Dentro da oficina (papel não é checado no servidor)

Varredura: das **155** rotas de escrita, **131** não chamam `requireOrgPermission` nem `requireOwner`. As 24 que chamam são
de `bonuses` (9), `commissions` (7), `fiscal` (3), `product-categories` (3) e owner. Para o resto, a restrição por papel existe
**só no front** (menu/telas) — e só 1 página usa `requiredPermission`. Exemplos com impacto direto:

| Sev. | Rota | Efeito |
|---|---|---|
| **Alta** | `POST roles/[id]/actions` | Qualquer funcionário concede **qualquer permissão** a **qualquer papel** da oficina (inclusive o próprio) |
| **Alta** | `POST users/update-role`, `PUT roles/[id]`, `POST roles` | Qualquer funcionário troca o papel de colegas (inclusive o próprio, para admin) |
| **Alta** | `DELETE financial/[id]`, `service-orders/[id]` e pagamentos/parcelas | Funcionário sem permissão exclui lançamentos e OS chamando a API |
| Média | `POST organizations/complete-onboarding` | Qualquer membro sobrescreve os dados cadastrais da oficina |

**Correção:** um mapa único `rota → action code` (os códigos já existem em `app/constants/action-codes.ts` e na tabela
`actions`) aplicado em cada handler por `requireOrgPermission`. É grande (131 rotas); fazer por prioridade:
`roles/*` e `users/*` → financeiro/OS (exclusões e pagamentos) → demais escritas. O log de auditoria passa a mostrar `denied`
quando isso estiver no lugar — **hoje quase nada é negado no servidor**, o que também reduz o valor do log.

### 2.3 Bug funcional encontrado na varredura

`DELETE fiscal/nfse/[reference]` chama `requireOwner` (`index.delete.ts:14`), mas é chamado pela oficina em
`components/financial/NfseCancelModal.vue:26`. **Toda tentativa de cancelar NFS-e por um cliente recebe 403.** Correção:
`requireAuthUser` + `requireOrgPermission(user.id, 'service_invoice.delete')` + conferir que a nota pertence à org do usuário
antes de chamar a Focus NFe. É exatamente o tipo de "o sistema não funciona" que o log de auditoria vai mostrar.

### 2.4 Padrão de correção (em vez de remendar rota a rota)

1. **Tudo que é do owner mora em `/api/admin/**`.** Mover `fiscal/company` (CRUD), `fiscal/config/*` e `feedback/admin/*`
   para lá. Manter fora apenas o que a oficina usa (`fiscal/company/sync`, `sync-status`).
2. **Guard por prefixo** em `server/middleware/owner-guard.ts` (defesa em profundidade; o handler continua chamando `requireOwner`):

   ```ts
   // server/middleware/owner-guard.ts
   import { requireOwner } from '../utils/require-owner'

   export default defineEventHandler(async (event) => {
     const path = event.path.split('?')[0]
     if (path === '/api/admin' || path.startsWith('/api/admin/'))
       await requireOwner(event)
   })
   ```
   Custo: middleware de servidor roda em **toda** requisição; o `if` mantém o custo zero fora de `/api/admin`.
3. **Org nunca vem do corpo** (exceto rotas do owner): `resolveOrganizationId(event, user.id)` sempre.
4. **Apagar** as rotas sem chamador listadas em §2.1.
5. **Teste de regressão no CI** — `scripts/check-api-guards.mjs`: para cada handler, exige `requireOwner`, ou
   `requireOrgPermission`, ou estar numa lista de exceções revisada (`scripts/api-guard-exceptions.json`, com motivo por linha).
   Falha o `pnpm lint` se aparecer handler novo fora disso.

   ```js
   // scripts/check-api-guards.mjs (esboço)
   import { readFileSync } from 'node:fs'
   import { globSync } from 'node:fs' // Node 22+; senão usar fast-glob
   const exceptions = JSON.parse(readFileSync('scripts/api-guard-exceptions.json', 'utf8')) // { "server/api/auth/login.post.ts": "login público", ... }
   const files = globSync('server/api/**/*.ts')
   const bad = files.filter((f) => {
     if (exceptions[f.replaceAll('\\', '/')]) return false
     const src = readFileSync(f, 'utf8')
     return !/requireOwner\(|requireOrgPermission\(/.test(src)
   })
   if (bad.length) { console.error('Handlers sem guard:\n' + bad.join('\n')); process.exit(1) }
   ```
   Na primeira execução a lista de exceções terá as rotas de "dados do próprio usuário" (perfil, notificações, preferências),
   auth públicas, webhook e as rotas de leitura escopadas por org — cada uma com motivo. Assim o débito da §2.2 fica visível e diminui.
6. **Revisão retroativa** — ainda não existe log de auditoria, então usar o que há:

   ```sql
   -- Perfis alterados por alguém de OUTRA organização (sinal de update-fields / assign-organization)
   SELECT p.id, p.email, p.organization_id, p.role_id, p.updated_by, p.updated_at,
          u.organization_id AS org_de_quem_alterou
   FROM user_profiles p
   LEFT JOIN user_profiles u ON lower(u.email) = lower(p.updated_by)
   WHERE p.updated_by IS NOT NULL
     AND p.updated_by <> 'access-guard'
     AND u.organization_id IS DISTINCT FROM p.organization_id
     AND coalesce(u.is_owner, false) = false
   ORDER BY p.updated_at DESC;

   -- Chamadas à Focus NFe de cadastro/edição/exclusão de empresa feitas por quem não é owner
   SELECT l.created_at, l.user_email, l.function_name, l.request_method, l.request_path, l.response_status
   FROM fiscal_integration_logs l
   LEFT JOIN user_profiles u ON lower(u.email) = lower(l.user_email)
   WHERE l.request_path LIKE '/v2/empresas%' AND l.request_method IN ('POST','PUT','DELETE')
     AND coalesce(u.is_owner, false) = false
   ORDER BY l.created_at DESC;
   ```
   Complementar com os *API logs* do Supabase (retenção curta, conforme o plano) e, se o deploy for Vercel, os logs de função.

## 3. O que o owner precisa ver (matriz de requisitos)

| Necessidade | Origem dos dados | Existe hoje? | Entrega |
|---|---|---|---|
| Quem fez o quê, com resultado (inclusive falhas) | `audit_logs` | ❌ | Tela **Auditoria** (`/admin/audit`) |
| Uso do sistema (visitas, ativos, tempo, quando usam) | `analytics_events` | ❌ | Tela **Métricas** (`/admin/metrics`) |
| Saúde das oficinas (ativa/esfriando/parada) | `analytics_events` (+ `audit_logs`) | ❌ | Aba **Oficinas** das Métricas e ficha da oficina |
| Ficha 360° de uma oficina | org, usuários, assinatura, uso, erros, fiscal | ❌ (só lista) | `/admin/organizations/:id` |
| Tráfego de IA e crawlers (GEO) | `analytics_events` (`traffic`, `bot`, `attribution`) | ❌ | Abas Aquisição/Qualidade + `/admin/geo` |
| Resultado da bateria de perguntas GEO | `geo_probe_runs` (cadastro manual) | ❌ | `/admin/geo` |
| Caixa de feedbacks de todas as oficinas | `feedbacks` (+ `feedback_attachments`, `feedback_responses`) | ⚠️ API sem UI e sem guard | `/admin/feedbacks` + mover API |
| Receita e cobrança (MRR, churn, falhas de pagamento) | `subscriptions` (`monthly_amount`, `status`, `plan_key`), `billing_invoices` | ⚠️ listas e gráfico | `/admin/billing` |
| Eventos do Stripe (webhooks) e falhas | — (não há registro) | ❌ | Tabela `stripe_webhook_events` + aba em Cobrança |
| Fiscal: rejeições de NFS-e por oficina | `fiscal_integration_logs` | ✅ log técnico | Filtros por oficina/status + aba Fiscal da ficha |
| Erros do sistema (5xx, ações que mais falham) | `audit_logs` | ❌ | Seção **Erros e fricção** em Sistema e nas Métricas |
| Saúde das integrações (Supabase, Stripe, Focus NFe, OneSignal, placas) | checagens ativas | ⚠️ só Supabase (pública) | `/admin/system` |

## 4. Navegação proposta

```
Visão geral            /admin
Oficinas               /admin/organizations        (+ ficha /admin/organizations/:id)
Usuários               /admin/users
Cobrança               /admin/billing              (MRR, churn, faturas, webhooks)
Métricas               /admin/metrics
Auditoria              /admin/audit
Feedbacks              /admin/feedbacks
Fiscal                 /admin/fiscal/companies · /admin/fiscal/logs
SEO e GEO              /admin/geo
Sistema                /admin/system               (integrações, erros, versão)
```

Lembrete: os submenus do sidebar são ordenados alfabeticamente pelo componente (exceto o primeiro item fixo); a ordem acima é a
lógica, não necessariamente a exibida.

## 5. Telas — contratos de API e UI

Convenções para todas: endpoints em `/api/admin/**` (guard por prefixo + `requireOwner`), validação de query com `zod`
(já usado no projeto), paginação com `server/utils/supabase-pagination.ts`, tabelas com `AppDataTable`, gráficos com
`components/charts/Charts{Area,Bar,Donut,Line}.vue`, cartões com `UPageCard`.

### 5.1 Auditoria (`/admin/audit`) — depende da Fase 1 do [plano de auditoria](../audit/audit-log-plan.md)

| Endpoint | Entrada | Saída |
|---|---|---|
| `GET /api/admin/audit-logs` | `from`, `to` (ISO; padrão últimas 24 h; máx. 31 dias por consulta), `organizationId`, `actorEmail`, `resourceType`, `resourceId`, `action`, `outcome[]`, `method`, `requestId`, `page`, `pageSize ≤ 100` | `{ data: [{ id, created_at, actor_email, organization_id, organization_name, action, resource_type, resource_id, http_method, route_pattern, status_code, outcome, duration_ms }], total, page, pageSize }` — **sem** corpos na lista |
| `GET /api/admin/audit-logs/:id` | — | Linha completa (inclui `request_body`, `response_body`, `changes`, `user_agent`) + outras linhas com o mesmo `request_id` |

UI: filtros no topo, atalhos ("Falhas de hoje", "Exclusões de hoje", "Tentativas negadas", "Erros 5xx (24 h)"), cor por
`outcome`, detalhe em `USlideover` com abas Request / Response / Mudanças (diff) e link para a ficha da oficina.
Consultar o log **não** gera linha de auditoria comum (exclusão no plugin), mas a abertura de um detalhe grava
`action='audit.view'` (quem viu dados de outra oficina fica rastreável).

### 5.2 Métricas (`/admin/metrics`) — depende do [plano de métricas](../metrics/usage-metrics-plan.md)

`GET /api/admin/metrics?days=7|30|90&tab=summary|acquisition|engagement|activation|accounts|quality[&fresh=1]`, cache de
60 s por `(days, tab)`. Abas e definições no plano de métricas §6–§7.

### 5.3 Ficha da oficina (`/admin/organizations/:id`)

| Endpoint | Saída |
|---|---|
| `GET /api/admin/organizations/:id` | Cabeçalho: razão social, CNPJ, e-mail, plano (`subscriptions.plan_key`), status da assinatura, `is_active` (Stripe), `suspended_at`, criação, onboarding |
| `GET /api/admin/organizations/:id/users` | Usuários: nome, e-mail, papel, `is_active`, último acesso (de `analytics_events`, quando existir) |
| `GET /api/admin/organizations/:id/billing` | Assinatura e últimas faturas (`billing_invoices`) |
| `GET /api/admin/organizations/:id/activity` | Linha do tempo (`audit_logs`, 50 por página) |
| `GET /api/admin/organizations/:id/usage` | OS/mês (6 meses), módulos usados vs. plano, última ação (de `analytics_events`) |
| `GET /api/admin/organizations/:id/fiscal` | `fiscal_sync_status` + últimas chamadas/rejeições em `fiscal_integration_logs` |
| `POST /api/admin/organizations/:id/suspend` · `/reactivate` | Body `{ reason }` obrigatório; confirmação dupla na UI |
| `POST /api/admin/users/:id/deactivate` · `/reactivate` | Usa `user_profiles.is_active` (já respeitado por `resolveOrganizationId` e `requireOrgPermission`) |

**Suspensão de oficina** (só se aprovada em §8):
- Migration: `organizations.suspended_at timestamptz`, `suspended_reason text`, `suspended_by varchar(200)`.
  **Não** reaproveitar `is_active`: o webhook do Stripe sobrescreve esse campo a cada evento de assinatura.
- Enforçar em `resolveOrganizationId` e `requireOrgPermission`: org com `suspended_at` → 403 `Oficina suspensa`.
  (Aproveitar e decidir se `is_active=false` — assinatura cancelada — também deve bloquear a API; hoje só o front bloqueia.)
- Toda ação do owner gera linha em `audit_logs` (`actor_role='owner'`) com o motivo.

### 5.4 Feedbacks (`/admin/feedbacks`)

Reaproveita os 4 handlers de `feedback/admin/*` **movidos** para `/api/admin/feedbacks/**`. Lista com filtros (tipo, status,
prioridade, oficina, busca), detalhe com anexos (`support-attachments`), respostas (`feedback_responses`), vínculos
(`feedback_entity_links`) e mudança de status/prioridade. Adicionar `organization_id` + nome da oficina na lista
(hoje `select('*')` não junta a org). Contador de "não lidos" no menu.

### 5.5 Cobrança (`/admin/billing`)

- **MRR** = `SUM(monthly_amount)` de `subscriptions` com `status='active'` e `deleted_at IS NULL`; por plano (`plan_key`).
  Conferir se `monthly_amount` é preenchido pelo webhook; se não for, derivar do `plan_key` via `usePlans.ts` (fonte única de preço).
- **Churn do mês** = assinaturas com `cancellation_date` no mês ÷ ativas no início do mês. **Novas** no mês. Série de 12 meses.
- **Faturas falhas/pendentes** (lista acionável, de `billing_invoices`).
- **Webhooks do Stripe** — nova tabela (também dá idempotência ao webhook, que hoje não tem):

  ```sql
  CREATE TABLE public.stripe_webhook_events (
    id               text        PRIMARY KEY,          -- evt_... (Stripe) → reentrega duplicada vira no-op
    type             text        NOT NULL,
    received_at      timestamptz NOT NULL DEFAULT now(),
    processed_at     timestamptz,
    status           text        NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','ignored','failed')),
    error_message    text,
    organization_id  uuid,
    payload          jsonb       NOT NULL               -- evento completo (sem dados de cartão; o Stripe não envia PAN)
  );
  ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;   -- sem policies: só service role
  CREATE INDEX ON public.stripe_webhook_events (received_at DESC);
  CREATE INDEX ON public.stripe_webhook_events (status) WHERE status = 'failed';
  ```
  Em `stripe/webhook.post.ts`, logo após `constructEventAsync` (`:63`): `INSERT ... ON CONFLICT (id) DO NOTHING` — se não
  inseriu, responder 200 sem reprocessar. Ao fim, `UPDATE status`.
- Corrigir `admin/stats` (P4/P5).
- Unificar os dois checkouts (`billing/checkout.post.ts` e `stripe/checkout.post.ts` fazem a mesma coisa com metadados
  diferentes: `supabase_user_id` × `user_id`) — reduz casos estranhos no webhook.

### 5.6 SEO e GEO (`/admin/geo`)

Resumo de visitas por canal de IA e de crawlers (de `analytics_events`) e registro semanal da bateria de perguntas:

```sql
CREATE TABLE public.geo_probe_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date        date        NOT NULL,
  question_id     smallint    NOT NULL,            -- 1..20 (bateria fixa; ver plano GEO §10.4)
  question_text   text        NOT NULL,
  engine          text        NOT NULL,            -- chatgpt | gemini | google_ai_mode | claude | perplexity | copilot | meta_ai
  model_label     text,                            -- como o produto se identificava no dia
  search_enabled  boolean     NOT NULL,
  brand_mentioned boolean     NOT NULL,
  brand_linked    boolean     NOT NULL,
  recommended     boolean     NOT NULL,
  price_correct   boolean,                         -- NULL = não citou preço
  fiscal_correct  boolean,
  competitors     text[],
  cited_urls      text[],
  evidence_url    text,                            -- captura (Storage)
  notes           text,
  created_by      varchar(200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_date, question_id, engine, search_enabled)
);
ALTER TABLE public.geo_probe_runs ENABLE ROW LEVEL SECURITY;  -- sem policies
```

Tela: formulário rápido (uma linha por pergunta × motor), tabela da semana e gráfico de taxa de menção / recomendação /
exatidão por semana. Detalhes no [plano de GEO](../seo/geo-audit-brasil.md) §10.

### 5.7 Sistema (`/admin/system`)

- Checagens ativas, executadas pelo endpoint com timeout de 3 s cada: Supabase (query simples), Stripe (`balance.retrieve`),
  Focus NFe (consulta leve já usada em `fiscal/config`), OneSignal (se habilitado), API de placas (só presença do token).
- Versão do app (commit/`package.json`), ambiente, `NUXT_PUBLIC_SITE_URL` em uso.
- **Erros e fricção**: top rotas com 5xx e com 4xx nas últimas 24 h/7 d (de `audit_logs`).
- Contas owner existentes (lista de `is_owner=true`) — alerta se houver só uma.

## 6. Regras de acesso e desempenho (valem para todas as telas)

- **Página:** `app/middleware/owner-only.ts` (checa `useWorkshopBootstrap().isOwner`) substitui `workshop-admin` nas páginas de
  `/admin`. Redireciona para `/app/forbidden` (ou `/`, já que o owner não tem org). `auth.global.ts` continua como 1ª barreira.
- **API:** tudo em `/api/admin/**` → guard por prefixo **e** `requireOwner` no handler.
- **Escrita do owner:** passa pelo log de auditoria como qualquer usuário (`actor_role='owner'`), com motivo obrigatório em ações destrutivas.
- **Dados de outras oficinas:** o owner vê tudo; consultas usam `organization_id` explícito (filtro opcional na UI, nunca implícito).
- **Contagens:** `select('id', { count: 'exact', head: true })`. Séries e rankings por **função SQL** retornando `jsonb`
  (`SECURITY DEFINER`, `REVOKE ... FROM PUBLIC, anon, authenticated`), com cache de 60 s em memória.
  Em hospedagem serverless o cache é por instância (aceitável para 60 s).
- **Exportação CSV** das listas: limite de 10 000 linhas; gera linha de auditoria (`*.export`).
- **Custo de auth:** `requireAuthUser` faz uma chamada à Supabase Auth por requisição e `requireOwner` mais uma query. Para o
  painel isso é aceitável; não usar o mesmo padrão em rotas de alto volume (ver plano de métricas §5.2).

## 7. Arquivos a criar e alterar

| Fase | Criar | Alterar | Apagar |
|---|---|---|---|
| 0 | `server/middleware/owner-guard.ts`, `scripts/check-api-guards.mjs`, `scripts/api-guard-exceptions.json`, `server/api/admin/fiscal/companies/*`, `server/api/admin/feedbacks/*`, `server/api/admin/fiscal/logs.get.ts`, `server/api/admin/fiscal/sync-integration-endpoints.post.ts` | `users/update-fields.post.ts`, `fiscal/company/sync.post.ts`, `fiscal/nfse/[reference]/index.delete.ts`, `roles/[id]/actions.post.ts`, `roles/*.ts`, `users/update-role.post.ts`, `vehicles/lookup-plate.get.ts`, `fiscal/business_id|zip_code|municipalities/**`, `supabase/health.get.ts`, `nuxt.config.ts` (cors), `pages/admin/fiscal/*.vue` (novas URLs), `package.json` (script no lint) | `users/assign-organization.post.ts`, `users/get-by-email.post.ts`, `service-orders/commission-seed-status.get.ts`, `consulta/index.get.ts`, `reports/export-file.post.ts`, `fiscal/zip_code/index.get.ts`, `fiscal/company/index.get/post` e `[id].*` (após mover), `feedback/admin/*` (após mover), `fiscal/config/*` (após mover) |
| 1 | `app/middleware/owner-only.ts` | `layouts/admin.vue` (links, menu §4), `pages/admin/*.vue` (`middleware`), `admin/stats.get.ts` | `app/middleware/workshop-admin.ts` (se não houver outro uso) |
| 2 | `pages/admin/audit.vue`, `server/api/admin/audit-logs/index.get.ts`, `[id].get.ts` | — | — |
| 3 | `pages/admin/metrics.vue`, `server/api/admin/metrics.get.ts`, `components/admin/metrics/*` | — | — |
| 4 | `pages/admin/organizations/[id].vue`, `pages/admin/feedbacks.vue`, `pages/admin/billing.vue`, endpoints §5.3–§5.5, migrations `organizations_suspension`, `stripe_webhook_events` | `pages/admin/organizations.vue` (link para a ficha), `utils/organization.ts`, `utils/require-org-permission.ts` (suspensão), `stripe/webhook.post.ts` (idempotência) | um dos dois checkouts |
| 5 | `pages/admin/geo.vue`, `pages/admin/system.vue`, migration `geo_probe_runs`, endpoints | — | — |

## 8. Fases

| Fase | Entrega | Esforço | Pronto quando |
|---|---|---|---|
| **0a — Segurança urgente** (fazer já, antes de qualquer tela) | Apagar as 6 rotas sem chamador; corrigir `update-fields` e `sync`; mover rotas do owner para `/api/admin/**`; guard por prefixo; corrigir cancelamento de NFS-e | 1–2 dias | Usuário de outra oficina recebe 403/404 em todas as rotas de §2.1; cancelamento de NFS-e funciona para a oficina |
| **0b — Papéis no servidor** | `requireOrgPermission` em `roles/*`, `users/*`, exclusões e pagamentos de financeiro/OS; depois o restante das 131 | 2–4 dias (incremental) | Funcionário sem permissão recebe 403 ao chamar a API diretamente; script de guards no CI |
| **0c — Revisão retroativa** | Rodar os SQLs da §2.4; registrar o resultado | ½ dia | Relatório arquivado (sem achados ou com ação tomada) |
| **1 — Base do painel** | `owner-only`; P2–P5; layout com a navegação do §4 | 1 dia | Sem links quebrados; contagens com `head:true` |
| **2 — Auditoria** | `/admin/audit` (§5.1) | 2 dias | Filtrar por usuário e ver falha com request/response sem SQL |
| **3 — Métricas** | `/admin/metrics` (abas na ordem das fases do plano de métricas) | 3–5 dias | Números batem com SQL manual |
| **4 — Oficina, feedback, cobrança** | Ficha; `/admin/feedbacks`; `/admin/billing` com MRR/churn; `stripe_webhook_events`; suspender/reativar (se aprovado) | 4–6 dias | Owner investiga uma reclamação de ponta a ponta sem sair do painel |
| **5 — GEO e sistema** | `/admin/geo`, `geo_probe_runs`, `/admin/system` | 2–3 dias | Bateria semanal registrada e comparável; integrações com status |

Dependências: Fase 2 depende da Fase 1 do plano de auditoria; Fase 3 depende das Fases 1–2 do plano de métricas; a aba GEO
depende da Fase 1 do plano de métricas (atribuição de IA). A Fase 0 **não depende de nada** e deve ir primeiro.

## 9. Decisões a confirmar (com recomendação)

| # | Pergunta | Recomendação |
|---|---|---|
| 1 | Quem é owner e como se concede `is_owner`? | Documentar o SQL (`UPDATE user_profiles SET is_owner = true WHERE email = ...`), manter **2 owners** (evita trancar a plataforma) e listar os owners em `/admin/system` |
| 2 | Suspender oficina/usuário pelo painel entra no escopo? | Sim para **usuário** (barato: `is_active` já é respeitado). Oficina só com a coluna `suspended_at` da §5.3 |
| 3 | Org com assinatura cancelada (`is_active=false`) deve ser bloqueada **na API**? | Sim, com período de carência para exportar dados (ex.: só leitura por 30 dias) |
| 4 | O owner pode ver o conteúdo detalhado de outras oficinas (corpos de request/response) ou só metadados? | Ver tudo, mas cada detalhe aberto gera `audit.view` |
| 5 | "Modo suporte": o owner precisa ver o `/app` como uma oficina? | Fora do escopo agora; se vier, só leitura, com banner e auditoria por sessão |
| 6 | Retenção do `audit.view` | 6 meses, como o restante do log |

## 10. Testes de aceitação

**Fase 0**
- [ ] Usuário comum de outra oficina recebe 403 (ou 404 por rota inexistente) em: `users/update-fields` (alvo de outra org), `users/assign-organization`, `/api/admin/fiscal/companies/**`, `/api/admin/feedbacks/**`, `commission-seed-status`, `consulta`, `reports/export-file`, `users/get-by-email`.
- [ ] `update-fields` ignora `organization_id`, `employee_id` e `email`; aceita só `role_id` de um papel da mesma org, com `roles.manage_members`.
- [ ] `fiscal/company/sync` grava `fiscal_sync_status` só da org do usuário, mesmo enviando outro `organization_id`.
- [ ] Oficina no plano Fiscal consegue **cancelar** uma NFS-e própria; não consegue cancelar a de outra oficina.
- [ ] Funcionário sem `roles.manage_permissions` recebe 403 em `POST roles/[id]/actions`.
- [ ] `vehicles/lookup-plate` sem login → 401.
- [ ] `pnpm lint` falha ao adicionar um handler sem guard fora da lista de exceções.

**Fases 1–5**
- [ ] Administrador de oficina (não owner) é redirecionado ao abrir `/admin` e recebe 403 em `/api/admin/**`.
- [ ] Nenhum link do menu `/admin` leva a 404.
- [ ] `admin/stats` usa `head:true` e conta `trial` corretamente.
- [ ] `/admin/audit` filtra por usuário, oficina, `outcome` e `request_id`; o detalhe mostra request/response/diff; abrir o detalhe gera `audit.view`.
- [ ] `/admin/metrics` carrega em < 1 s com 90 dias; segunda chamada em < 60 s vem do cache e `fresh=1` recalcula.
- [ ] Ficha da oficina mostra usuários, assinatura, atividade, uso e fiscal; suspender exige motivo e confirmação, gera `audit_logs` e faz a API da oficina responder 403.
- [ ] Reenviar o mesmo evento do Stripe (`stripe events resend`) não duplica efeitos; o evento aparece uma vez em `stripe_webhook_events`.
- [ ] `/admin/system` mostra o status das integrações e alerta com um único owner.

## 11. Estado da implementação (2026-11-09)

**Feito**

| Fase | Item | Onde |
|---|---|---|
| 0a | Apagadas 6 rotas sem chamador: `users/assign-organization`, `users/get-by-email`, `service-orders/commission-seed-status`, `consulta`, `reports/export-file`, `fiscal/zip_code/index.get.ts` | `server/api/**` |
| 0a | `users/update-fields` aceita só `role_id`; `users/update-role` e `update-fields` exigem `roles.manage_members`, alvo da mesma oficina e papel da oficina | `server/utils/user-role.ts` |
| 0a | `roles` (criar/editar/excluir/permissões) exigem `roles.create/update/delete/manage_permissions` | `server/api/roles/**` |
| 0a | `fiscal/company/sync` deriva a oficina da sessão e exige `fiscal.manage` | `fiscal/company/sync.post.ts` |
| 0a | Cancelar NFS-e funciona para a oficina (`service_invoice.delete` + NFS-e da própria oficina); `hook`, `email` e `GET [reference]` também checam a oficina (devolvem 404 para NFS-e alheia) | `server/utils/nfse-ownership.ts` |
| 0a | CRUD de empresas Focus NFe, logs e sync de endpoints → `/api/admin/fiscal/**`; feedbacks → `/api/admin/feedbacks/**` (todos com `requireOwner`) | `server/api/admin/**`, `app/pages/admin/fiscal/*` |
| 0a | `vehicles/lookup-plate` exige login e oficina; `supabase/health` não vaza detalhes do erro | handlers |
| 0a | Guard por prefixo `/api/admin/**` | `server/middleware/owner-guard.ts` |
| 0a | Migration que semeia `roles.*` e `fiscal.manage` (nunca existiram em `actions`) | `20240101000100_seed_roles_and_fiscal_manage_actions.sql` |
| 1 | `owner-only` substitui `workshop-admin` (removido); logo aponta para `/admin`; item "Ajuda" removido; `admin/stats` com `head: true` e `trial` | `app/middleware/owner-only.ts`, `layouts/admin.vue`, `admin/stats.get.ts` |
| 2 | `/admin/audit` | ver [plano de auditoria](../audit/audit-log-plan.md) §14 |

**Pendente**
- **Fase 0b (resto):** 109 rotas de escrita ainda sem `requireOrgPermission` (catraca em `tests/static/baselines/write-routes-without-permission.json`). **Decisão de produto antes de aplicar:** hoje 84 códigos base (`customers.*`, `orders.*`, `financial.*`...) não estão em nenhuma migration; em produção devem existir (semeados à mão), mas um funcionário cujo papel não tenha o grant passará a levar 403 em ações que hoje funcionam. Exige um inventário dos papéis em produção e um mapa rota → código aprovado.
- **0c** (SQLs de revisão retroativa em produção), o script `check-api-guards` no `lint` (a catraca de `tests/static` já cumpre o papel no `pnpm test`).
- **CORS aberto** em `/api/**` (`nuxt.config.ts`): mantido porque o app Capacitor pode depender; restringir exige confirmar as origens.
- **Rate limit** em `lookup-plate`; `organizations/complete-onboarding` sem checagem de papel.
- **Fase 1:** `to="/docs"` removido, mas falta a navegação completa do §4 (depende das telas das Fases 3–5).

## 12. Fases 3–5 e 0c (2026-11-09)

| Fase | Entrega | Onde |
|---|---|---|
| 3 | Métricas (`/admin/metrics`) — já existia (plano de métricas, fases 1–4) | `app/pages/admin/metrics.vue`, `server/api/admin/metrics.get.ts` |
| 4 | Ficha da oficina com abas Usuários / Cobrança / Atividade / Uso / Fiscal; suspender e reativar oficina (motivo obrigatório); desativar e reativar usuário | `app/pages/admin/organizations/[id].vue`, `server/api/admin/organizations/[id]/*`, `server/api/admin/users/[id]/*` |
| 4 | Suspensão **enforçada na API** (`resolveOrganizationId` e `requireOrgPermission` → 403 "Oficina suspensa"); colunas próprias | migration `...101`, `server/utils/organization.ts` |
| 4 | `/admin/feedbacks`: lista com autor e oficina, filtros, detalhe com anexos/vínculos, status, prioridade e resposta | `app/pages/admin/feedbacks.vue`, `server/api/admin/feedbacks/*` |
| 4 | `/admin/billing`: MRR (total e por plano), novas × canceladas e churn (12 meses), faturas que pedem ação, eventos do Stripe | `server/api/admin/billing/*`, `server/utils/billing-metrics.ts` |
| 4 | Webhook do Stripe **idempotente** (`stripe_webhook_events`): reentrega de evento processado vira no-op; falha é reprocessada | migration `...102`, `server/utils/stripe-webhook-events.ts` |
| 5 | `/admin/geo`: bateria fixa de 20 perguntas, registro por motor/busca, taxas semanais, por motor; o texto da pergunta vem do servidor | migration `...103`, `lib/geo/questions.ts`, `server/api/admin/geo/*` |
| 5 | `/admin/system`: Supabase, Stripe, segredo do webhook, Focus NFe (taxa de sucesso 24 h), OneSignal, placas, partição padrão do `audit_logs`; versão; rotas que mais falham; owners com alerta de owner único | `server/api/admin/system.get.ts`, `server/utils/system-checks.ts` |
| 0c | SQLs de revisão retroativa e guia | `scripts/retroactive-review.sql`, [retroactive-review.md](retroactive-review.md) |

**Testes:** `tests/unit/handlers/admin-panel.test.ts` (52: toda rota nova é 401 sem sessão e 403 para usuário de oficina; suspensão, usuários, GEO),
`tests/unit/server-utils/admin-panel-utils.test.ts` (16), e `tests/api/admin-panel.test.ts` contra **Postgres real** (10: embed `organizations(suspended_at)` do PostgREST,
idempotência do Stripe, `UNIQUE` e `CHECK` do GEO, tabelas novas ilegíveis para `anon`).

**Limites conhecidos**
- Telas validadas por lint e pelos handlers que elas chamam; **não foram abertas no navegador** (sem E2E autenticado, KF-00).
- MRR usa `subscriptions.monthly_amount`; assinaturas ativas sem valor aparecem em aviso e subestimam o número (o webhook pode não preencher o campo).
- "Último acesso" do usuário vem do `audit_logs` (31 dias); sem a migration 097 o campo fica vazio.
- Focus NFe no `/admin/system` não faz chamada externa: usa o resultado das últimas 24 h de `fiscal_integration_logs`.
- A suspensão acrescenta um embed ao `select` de `resolveOrganizationId`/`requireOrgPermission` (sem query extra); o front não tem tela dedicada para "oficina suspensa": o usuário vê o 403 com a mensagem.
