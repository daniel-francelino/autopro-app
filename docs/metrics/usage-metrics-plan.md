# Plano de implementação — Métricas de uso do sistema (analytics próprio)

> Status: **plano (nada implementado ainda)** · Criado em 2026-11-08 · Revisado em 2026-11-08 (verificado no código)
> Decisão: **sem PostHog**. Telemetria própria, gravada no Supabase, no mesmo modelo do painel `/moderation/metrics` da
> **Kult** (`../kult`). Este documento mapeia o que a Kult faz, o que portar como está e o que muda por o AutoPro ser um SaaS
> **B2B** (a unidade que importa é a **oficina**, não a pessoa).
>
> Relacionados: [auditoria](../audit/audit-log-plan.md) (mesmo plugin Nitro e mesmo `event.context`) ·
> [painel do owner](../admin/owner-panel-plan.md) (tela `/admin/metrics`) · [GEO](../seo/geo-audit-brasil.md) (atribuição de IA).

### O que mudou nesta revisão

| Antes | Agora (verificado) |
|---|---|
| "11 chamadas `capture()`" | **7 pontos de chamada** em 5 arquivos; PostHog presente em **11 arquivos** (lista exata em §9) |
| Painel com middleware `workshop-admin` | `owner-only` (ver [painel §6](../admin/owner-panel-plan.md#6-regras-de-acesso-e-desempenho-valem-para-todas-as-telas)) |
| `service_order_created` ← `POST /service-orders` | Essa rota **cria e edita** (`body.orderId`). Sem regra extra, toda edição contaria como OS nova (§5.3) |
| Mapa de áreas incompleto | Áreas conferidas com `app/pages/**`; incluídas Fiscal, Assinatura, Onboarding, Checkout (§5.1) |
| Identidade via `requireAuthUser` a cada evento | `requireAuthUser` faz uma chamada de rede à Supabase Auth **por requisição**. Coleta passa a ser em **lote** + cache curto de token (§5.2) |
| `user_hash = sha256('autopro-anon:'+id)` | **HMAC** com segredo do servidor (sem segredo, qualquer um com a lista de IDs reverte o hash) |
| `geoip-country` obrigatório | Se o deploy for Vercel, usar o header `x-vercel-ip-country` (sem dependência nem base local) |
| Eventos do webhook "pelo hook" | O webhook do Stripe **não tem sessão**: `org_created`/`subscription_started` são gravados explicitamente no handler |

---

## 1. O que a Kult tem (e vamos replicar)

Lido em `kult/Project/kult/api/rotas/analytics.js`, `api/util/traffic.js`, `api/util/geo.js`, `database.js`,
`kult/soukult/src/{lib/analytics.ts, lib/analyticsActions.ts, lib/attribution.ts, hooks/useAnalytics.ts, routes/moderation/metrics.tsx}`
e nas docs `kult/Project/docs/AUDITORIA_ATIVACAO.md` e `AUDITORIA_UTM.md`.

| Peça da Kult | Como funciona | Observação |
|---|---|---|
| **Tabela única de eventos** (`analyticsEvent`) | Uma linha por evento: `anonId`, `sessionId`, `event`, `path` (área), `platform`, `country`, `traffic`, `bot`, `botPurpose`, `durationMs`, `step`, `attribution`, `createdAt` | **Sem tabela de sessões**; a sessão é reconstruída agrupando por `sessionId` |
| **`POST /analytics/track`** | Lista fechada de eventos (`ALLOWED`); `path` só se for área conhecida; plataforma `ios\|android\|web`; duração limitada a 1 h (`3 600 000` ms); rate limit em memória de **240 eventos/min** por conta ou IP (excesso descartado em silêncio) | Nada de texto livre vindo do cliente |
| **Pseudonimização** | `anonId = sha256("kult-anon:"+userId)` (24 hex). Visitante = `'visitor'` | O servidor faz o hash |
| **Classificação de tráfego** (`util/traffic.js`) | Lê o User-Agent só para classificar e **nunca grava**. ~60 robôs → `kind` (`human, ai_crawler, search_bot, social_preview, headless, script, other_bot`), nome canônico e finalidade (`ai_training, ai_search, ai_user, search_index, seo_tool, preview, testing, script, unknown`) | Bot disfarçado cai em "pessoa" |
| **Sessão "suspeita"** | Sem conta + nunca ficou visível > 1 s (sem `active_time`) + nenhuma ação | Estimativa; o painel avisa |
| **País** (`util/geo.js`) | `geoip-country` (base **local**) sobre o 1º IP do `X-Forwarded-For`; grava só o ISO | IP nunca é gravado |
| **Atribuição UTM** (`lib/attribution.ts`) | Só `utm_source/medium/campaign/content/term`, saneados (≤ 100 chars, rejeita `@` e `://`); **first touch** e **last touch** por 90 dias no `localStorage`; remove `utm_*` da URL; canal de IA pelo referrer (ChatGPT, Claude, Perplexity, Copilot, Gemini). Só em `session_start` e conversões | "Não prova indicação" |
| **Hook de uso** (`hooks/useAnalytics.ts`) | `page_view` a cada rota; `session_start` uma vez; `active_time` só com a aba visível, descarregado a cada 60 s, em `visibilitychange` e `pagehide` | `fetch` com `keepalive` |
| **Áreas "coarse"** (`lib/analytics.ts`) | Regex agrupa a rota em área para **nunca** gravar qual registro foi aberto | Mesma ideia para OS, Financeiro… |
| **Ações concluídas** (`lib/analyticsActions.ts`) | Derivadas de `método + rota` de chamadas à API **bem-sucedidas** | Aqui vão para o servidor (§5.3) |
| **Painel** (`routes/moderation/metrics.tsx`) | Abas Resumo, Aquisição, Engajamento, Kai, Qualidade; 7/30/90 dias; KPIs ▲▼ contra o período anterior; "Em destaque" por regras; cache de 60 s (`?fresh=1`); dias sem evento com zero | Referência visual |
| **Funil de ativação** | Coorte = cadastrados no período; 1ª ação (qual, mediana de tempo); ativação 24 h / 7 d **só sobre quem teve a janela inteira**; "só exploraram"; onboarding por passo; retorno 1/3/7/14/30 d; coortes semanais | Ação só conta se **depois** do cadastro |
| **Qualidade dos dados** | % de eventos com tráfego, plataforma, país e origem; evento mais antigo; retenção | Onde cada recorte é confiável |
| **Retenção** | 365 dias (mínimo 180 para comparar 90×90) | TTL no banco |

**Limitação herdada:** robôs que não executam JavaScript nem chamam `/track` não aparecem. Como `/` e `/pricing` são
pré-renderizadas, em CDN o pedido do robô pode nem chegar ao Nitro — crawler de verdade só pelos logs da hospedagem
(ver [GEO §10.1](../seo/geo-audit-brasil.md#101-crawlers)).

## 2. Estado atual do AutoPro

| Item | Situação (verificado) |
|---|---|
| PostHog | `posthog-js` integrado, ligado só em produção com chave (`nuxt.config.ts`). **Vai ser removido** (§9) |
| Eventos | **7** chamadas a `capture()`: `AppHeader.vue:7`, `BillingPricingPlans.vue:53,61,104`, `index.vue:162` (helper usado pelos CTAs), `login.vue:68`, `signup.vue:67`. **Nada dentro de `/app/**`** |
| `app/types/analytics.ts` | Enum `PostHogEvent` com eventos de marketing válidos + dezenas de `habit_*`/`blog_*` de **outro projeto** |
| `/admin` | Existe, só `is_owner` (barrado por `auth.global.ts`), 4 totais + gráfico de assinaturas |
| `admin/stats.get.ts` | Baixa **todas as linhas** para contar (`head: false`) |
| Último acesso | Não existe coluna em `user_profiles` (nenhum `last_seen`/`last_sign_in` no schema) |
| Plataforma | Web + Capacitor (iOS/Android, `@capacitor/core` 8); nada distingue nos dados |
| Identidade no servidor | Cookies `sb-access-token`/`sb-refresh-token` (`httpOnly`, `SameSite=Lax`) + `sb-user` (**não** `httpOnly` — o cliente pode forjar; nunca confiar nele) |
| Onboarding | Página `/onboarding` e tour com `driver.js` |
| Deploy | Não fixado; ícone da Vercel em `content/2.pricing.yml` sugere Vercel |

> **"Owner" neste projeto** (`is_owner` / `requireOwner`) é o **dono da plataforma**, que vê todas as organizações em `/admin`.
> O painel de métricas é para esse perfil.

## 3. Diferenças B2B em relação à Kult

| Kult (B2C) | AutoPro (B2B) |
|---|---|
| Unidade = pessoa (`anonId`) | Unidade principal = **oficina** (`organization_id`), depois o usuário |
| Tudo pseudonimizado | `organization_id` **em claro** (necessário para "oficina esfriando"); usuário continua em hash |
| Ativação = 1ª reação/salvar/publicar | Ativação = **1ª OS criada** (e 1º pagamento recebido). A confirmar (§10) |
| Aba Kai (assistente) | Substituída por **Oficinas** ("saúde das contas") |
| Cadastro = conta criada | 3 marcos: **conta** (signup), **assinatura** (Stripe) e **oficina criada** (webhook `checkout.session.completed`) |
| Ações detectadas no cliente | Detectadas no **servidor** (§5.3): mais confiável e vale para web e app |
| Um evento por requisição | **Lote** de eventos por requisição (o custo de identificar o usuário aqui é uma chamada de rede) |

## 4. Modelo de dados (Supabase)

Migration: `supabase/migrations/20240101000098_create_analytics_events.sql` (a 097 é a da auditoria).

```sql
CREATE TABLE public.analytics_events (
  id               uuid         NOT NULL DEFAULT gen_random_uuid(),
  created_at       timestamptz  NOT NULL DEFAULT now(),

  user_hash        text         NOT NULL DEFAULT 'visitor',   -- hmac_sha256(ANALYTICS_HASH_SECRET, user_id)[0:24] ou 'visitor'
  organization_id  uuid,                                      -- NULL para visitantes; sem FK
  session_id       text         NOT NULL,                     -- uuid gerado no cliente (sessionStorage)
  event            text         NOT NULL,                     -- lista fechada validada no servidor
  area             text,                                      -- rótulo da lista fechada (§5.1), nunca a rota crua
  platform         text,                                      -- ios | android | web
  country          char(2),                                   -- ISO-3166; nunca o IP

  traffic          text,                                      -- human | ai_crawler | search_bot | social_preview | headless | script | other_bot
  bot              text,                                      -- nome canônico (lista fechada)
  bot_purpose      text,

  duration_ms      integer,                                   -- só em active_time (0..3 600 000)
  step             smallint,                                  -- só em onboarding_* (0..20)
  attribution      jsonb,                                     -- UTM first/last, referrer_host, canal, método — sem índice

  CONSTRAINT analytics_events_pkey PRIMARY KEY (id),
  CONSTRAINT analytics_events_platform_chk CHECK (platform IS NULL OR platform IN ('ios','android','web')),
  CONSTRAINT analytics_events_duration_chk CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 3600000)
);

CREATE INDEX analytics_events_created_event_idx ON public.analytics_events (created_at, event);
CREATE INDEX analytics_events_session_idx       ON public.analytics_events (session_id);
CREATE INDEX analytics_events_user_idx          ON public.analytics_events (user_hash, created_at);
CREATE INDEX analytics_events_org_idx           ON public.analytics_events (organization_id, created_at) WHERE organization_id IS NOT NULL;

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;      -- sem policy: só service role
REVOKE ALL ON public.analytics_events FROM anon, authenticated;
```

- **Sem FKs** e **sem tabela de sessões**: o coletor nunca falha por integridade.
- **Consultas:** `supabase-js` não agrega; o painel chama **funções SQL** que retornam `jsonb`
  (`SECURITY DEFINER`, `SET search_path = public`, `REVOKE ... FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE ... TO service_role`),
  como a Kult fez em `0002_analytics_summary.sql`. Funções: `analytics_summary(p_days)`, `analytics_traffic(p_days)`,
  `analytics_acquisition(p_days)`, `analytics_engagement(p_days)`, `analytics_funnel(p_days)`, `analytics_accounts_health()`,
  `analytics_coverage()` — todas com `AT TIME ZONE 'America/Sao_Paulo'` e dias vazios preenchidos com `generate_series`.
- **Exclusões padrão** em todas as funções: eventos de usuários `is_owner` e de organizações internas/demo (§10.4).
- **Classificação de sessão na consulta**: agrupar por `session_id`; se algum evento tem `traffic` de bot declarado → esse `kind`;
  senão `suspect` se `user_hash='visitor'` **e** sem `active_time` **e** sem ação; senão `human`; sem `traffic` → `unknown` (conta como pessoa).
- **Retenção:** 365 dias. Job diário (`pg_cron`, o mesmo do plano de auditoria) com `DELETE` em lotes de 10 000 linhas. Se o volume
  crescer (> ~5 milhões de linhas), migrar para partição mensal e descartar por `DROP`, como na auditoria.

Esboço de uma função, para fixar o padrão:

```sql
CREATE OR REPLACE FUNCTION public.analytics_summary(p_days int)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH bounds AS (
    SELECT (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - make_interval(days => p_days - 1)) AS d0
  ),
  ev AS (
    SELECT e.*, (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia
    FROM analytics_events e, bounds b
    WHERE e.created_at >= (b.d0 AT TIME ZONE 'America/Sao_Paulo')
  ),
  days AS (
    SELECT generate_series((SELECT d0 FROM bounds)::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date, '1 day')::date AS dia
  )
  SELECT jsonb_build_object(
    'active_orgs',  (SELECT count(DISTINCT organization_id) FROM ev WHERE event = ANY (public.analytics_action_events())),
    'active_users', (SELECT count(DISTINCT user_hash) FROM ev WHERE user_hash <> 'visitor'),
    'by_day', (SELECT jsonb_agg(jsonb_build_object('day', d.dia,
                 'orgs', (SELECT count(DISTINCT organization_id) FROM ev WHERE ev.dia = d.dia AND event = ANY (public.analytics_action_events()))
               ) ORDER BY d.dia) FROM days d)
  );
$$;
-- analytics_action_events(): função IMMUTABLE que devolve o array de eventos de ação (§5.3), fonte única no banco.
```

## 5. Coleta

### 5.1 Cliente (Nuxt) — porta de `useAnalytics.ts` + `analytics.ts` + `attribution.ts`

| Kult | AutoPro | Mudança |
|---|---|---|
| `src/lib/analytics.ts` (`track`, `analyticsArea`) | `app/utils/analytics.ts` | `track()` **enfileira**; a fila é enviada em lote para `POST /api/metrics/track` a cada 10 s, em `visibilitychange`/`pagehide` (com `fetch(..., { keepalive: true })`) e ao atingir 20 eventos. O cookie de sessão vai junto; não há header `Authorization` |
| `src/hooks/useAnalytics.ts` | `app/composables/useAnalytics.ts` + `app/plugins/analytics.client.ts` | `router.afterEach` no lugar de `useEffect([pathname])`; mesmo controle de tempo ativo; no app nativo, `App.addListener('appStateChange')` do `@capacitor/app` (já instalado) |
| `src/lib/attribution.ts` | `app/utils/attribution.ts` | **Copiar quase literal**. Chave `autopro.attribution`; lista de domínios próprios (domínio de produção + `localhost`) |
| `Capacitor.getPlatform()` | igual | — |
| `sessionStorage` + `crypto.randomUUID()` | igual | Sem cookie, sem ID persistente de visitante |
| — | `$fetch` global envia `X-Analytics-Session` e `X-Client-Platform` | Liga as ações do servidor (§5.3) à visita; o mesmo header de plataforma é usado na auditoria |

Áreas (lista **fechada**; a 1ª regra que casar vence; o servidor troca qualquer rótulo desconhecido por "Outras"):

| Rota | Área |
|---|---|
| `/` | Site |
| `/pricing` | Planos |
| `/login`, `/signup`, `/forgot-password`, `/reset-password` | Entrar |
| `/subscription`, `/checkout/**`, `/app/subscribe`, `/app/billing/**`, `/app/settings/subscription` | Assinatura |
| `/onboarding` | Onboarding |
| `/app` (exata) | Painel |
| `/app/service-orders` | Ordens de serviço |
| `/app/financial/service-invoices`, `/app/financial/taxes` | Fiscal |
| `/app/financial/commissions/**`, `/app/financial/bonuses/**` | Comissões e bônus |
| `/app/financial/**` (resto: index, accounts, categories, machines) | Financeiro |
| `/app/products/**` | Estoque e compras |
| `/app/customers`, `/app/vehicles` | Clientes e veículos |
| `/app/appointments` | Agenda |
| `/app/reports/**` | Relatórios |
| `/app/settings/employees/**`, `/app/settings/roles/**` | Equipe e acesso |
| `/app/settings/**` (resto) | Configurações |
| `/app/support`, `/app/feedback`, `/app/consulting` | Suporte |
| `/admin/**` | Admin (excluído dos números por padrão) |
| `/403`, `/app/forbidden` | Sem acesso |
| demais | Outras |

"Sem acesso" com volume alto é sinal de permissão mal configurada — vale um destaque no painel.

### 5.2 Servidor — `POST /api/metrics/track`

Corpo: `{ sessionId, platform, events: [{ event, area?, durationMs?, step?, attribution?, at? }] }` (máx. 25 eventos).

1. **Valida** com `zod` (já no projeto, v4). `event` ∈ `ALLOWED_CLIENT_EVENTS`; `area` ∈ lista do §5.1 (senão "Outras");
   `durationMs` 0..3 600 000; `step` 0..20; `at` no máximo 5 min no passado (senão usa `now()`).
2. **Rate limit** em memória: 240 eventos/min por `user_hash` ou IP; excedente → `{ ok: true, dropped: n }`.
   Em serverless o limite é por instância — aceitável (o objetivo é conter abuso grosseiro, não contabilidade exata).
3. **Identidade** (opcional — visitantes são aceitos): lê o `sb-access-token` e resolve o usuário com **cache em memória de 5 min
   por token** (evita uma chamada à Supabase Auth por lote); com o usuário, `organization_id` via `user_profiles` (mesmo cache).
   **Nunca** usar o cookie `sb-user` (é legível e editável pelo cliente). Sem token válido → `visitor`, sem erro.
4. `user_hash = hmac_sha256(ANALYTICS_HASH_SECRET, user_id).slice(0, 24)`; `organization_id` em claro.
5. `classify(userAgent)` → `traffic`, `bot`, `bot_purpose` (porta de `api/util/traffic.js`; **o UA nunca é gravado**).
6. **País**: se Vercel, `x-vercel-ip-country`; senão `geoip-country` (dependência nova) sobre o IP confiável do proxy
   (definir qual header antes de ligar o card de países, §10.6). IP privado/sem país → `NULL`. O IP nunca é gravado.
7. `attribution` saneado (chaves permitidas, ≤ 100 chars, rejeita `@`/`://`, `channel` e `method` contra listas fechadas) e
   **só aceito** em `session_start` e `pricing_checkout_started` (os demais eventos de conversão vêm do servidor, §5.3).
8. Ignora usuários `is_owner` (não suja os números) — ou grava com `area='Admin'` se §10.4 decidir manter.
9. `INSERT` em lote em `analytics_events`. Erros nunca chegam ao usuário (`{ ok: true }` sempre que o corpo for válido).

Rota pública: excluída do log de auditoria e da lista de exigência de guard (`scripts/api-guard-exceptions.json`, motivo "coletor público").

### 5.3 Ações de negócio — emitidas pelo **servidor**

No hook `afterResponse` (o mesmo plugin/contexto da [auditoria](../audit/audit-log-plan.md#51-fluxo-e-hooks-nitropack-213--h3-115)),
quando a resposta é **2xx**, um mapa `método + padrão de rota (+ predicado opcional)` → nome do evento. Nunca grava IDs, corpo
nem texto. `session_id` vem do header `X-Analytics-Session`; `user_hash`/`organization_id` do contexto já resolvido pelo handler
(sem nova chamada de auth). Arquivo único: `server/utils/analytics/actions.ts`.

| Grupo | Evento ← rota (`/api/...`) |
|---|---|
| Operação | `service_order_created` ← `POST service-orders` **sem** `body.orderId` · `service_order_updated` ← `POST service-orders` **com** `orderId` · `service_order_cancelled` ← `POST service-orders/:id/cancel` · `appointment_created` ← `POST appointments` · `client_created` ← `POST clients` · `vehicle_created` ← `POST vehicles` |
| Financeiro | `financial_entry_created` ← `POST financial` · `financial_entry_paid` ← `POST financial/:id/pay`, `financial/pay-entries-bulk` · `installment_paid` ← `POST service-orders/:id/installments/:installmentId/pay` · `payment_processed` ← `POST service-orders/:id/process-payment`, `down-payment`, `receive-extra-payment` · `commission_paid` ← `POST reports/commissions/:id/pay`, `financial/pay-commissions-bulk` · `bonus_created` ← `POST bonuses` · `commission_plan_created` ← `POST commissions` |
| Estoque e compras | `product_created` ← `POST products` · `purchase_created` ← `POST purchases` · `purchase_request_created` ← `POST purchase-requests` · `purchase_return_created` ← `POST purchase-returns` · `catalog_imported` ← `POST products/import`, `suppliers/import` |
| Fiscal | `nfse_issued` ← `POST fiscal/nfse` · `fiscal_company_synced` ← `POST fiscal/company/sync` |
| Gestão | `employee_created` ← `POST employees` · `access_granted` ← `POST employees/:id/grant-access` · `role_changed` ← `POST roles`, `PUT roles/:id`, `POST roles/:id/actions`, `POST users/update-role` · `report_exported` ← `POST **/export*` |
| Conversão | `signup_completed` ← `POST auth/signup` · `login_completed` ← `POST auth/login` · `onboarding_completed` ← `POST organizations/complete-onboarding` |
| Assinatura (no **webhook**, gravado explicitamente) | `org_created`, `subscription_started` ← `checkout.session.completed` · `subscription_cancelled` ← `customer.subscription.deleted` · `payment_failed` ← `invoice.payment_failed`. O webhook não tem sessão: gravar com `user_hash` do usuário dos metadados, `organization_id` criado e `session_id='server'` |

Atribuição no cadastro: o cliente envia o `attribution` atual dentro do corpo de `POST auth/signup` (campo opcional, ignorado
pelo handler); o hook o saneia e anexa ao `signup_completed`. No checkout, o `pricing_checkout_started` (cliente) já carrega a atribuição.

Eventos **só do cliente** (lista fechada `ALLOWED_CLIENT_EVENTS`, aceitos também de visitantes):
`page_view`, `session_start`, `active_time`, `onboarding_step`, `onboarding_skip`, `onboarding_complete` (com `step`),
`tour_started`, `tour_completed` (driver.js), `cta_hero_click`, `cta_final_click`, `cta_footer_click`, `nav_click`,
`pricing_interval_changed`, `pricing_checkout_started`, `pricing_login_redirected`.

> **Separação de responsabilidades:** **auditoria** = detalhada (corpo, resposta, 6 meses, para suporte);
> **analytics** = leve, sem payload (só nomes de evento, 365 dias, para entender uso). Compartilham o plugin e o contexto,
> mas uma tabela não depende da outra.

## 6. O painel — `/admin/metrics`

Página no layout `admin` com middleware `owner-only`. Endpoint `GET /api/admin/metrics?days=7|30|90&tab=...[&fresh=1]`
(guard por prefixo + `requireOwner`), **cache de 60 s** em memória por `(days, tab)` que também junta pedidos simultâneos,
retorno já agregado. Gráficos com os componentes existentes (`components/charts/Charts{Area,Bar,Donut,Line}.vue`; `apexcharts` e
`@unovis` já estão no projeto); componentes `MetricsKpi` (▲▼ contra o período anterior de mesmo tamanho), `MetricsSection`,
`MetricsNote` em `components/admin/metrics/`. Dias sem evento aparecem com **zero**.

| Aba | Conteúdo |
|---|---|
| **Resumo** | KPIs: Visitas de pessoas · **Oficinas ativas** · Usuários ativos · Cadastros novos · Tempo médio por visita (só pessoas) · Assinaturas ativas. **Em destaque** (regras): % de visitas que parecem robôs; alta/queda de visitas e cadastros vs. período anterior; % de cadastrados com ≥ 1 ação; **oficinas que pararam**; pico de uso (dia e hora). Gráficos: visitas/dia (pessoas × robôs), oficinas/usuários ativos por dia, cadastros por dia, **funil** (visitas → cadastros → assinatura → oficina criada → onboarding concluído → 1ª OS → 1º pagamento → voltou) |
| **Aquisição** | Origens (direto, buscadores, outros sites, **IAs**), campanhas UTM (first touch, 20 linhas + "outras", sempre como texto), países (visitas, robôs, pessoas com conta, cadastros). Nota: *"Direto / sem origem" junta quem digitou o endereço e apps que escondem a origem.* |
| **Engajamento** | "O que as oficinas fazem" por grupo do §5.3; onde passam o tempo (por área); quanto ficam (< 2 min / 2–10 / > 10); **quando usam** (hora × dia da semana em `America/Sao_Paulo`, pico destacado); plataforma (web/iOS/Android) |
| **Ativação** | Para cadastrados no período: agiram em 24 h / 7 d (só quem teve a janela inteira; "janela em aberto" no resto), mediana até a 1ª ação, **primeira ação de quem ativou**, "só exploraram", onboarding por passo (viram/concluíram/pularam e onde), retorno 1/3/7/14/30 d, coortes semanais. Nota fixa: *"A ação só conta se veio depois do cadastro."* |
| **Oficinas** | Tabela de **saúde das contas**: oficina, plano, dias desde a última ação, ações e OS na semana, usuários ativos (7 d), selo **ativa / esfriando (sem ação há 7 d) / parada (14 d) / nunca ativou**; link para a ficha (`/admin/organizations/:id`). Ordenação padrão: "esfriando" primeiro |
| **Qualidade** | Pessoas × robôs (rosca), quais robôs e o que querem (nome, finalidade, áreas vistas), **qualidade dos dados** (% com tráfego/plataforma/país/origem, evento mais antigo, retenção) |

## 7. Definições (glossário)

| Termo | Definição |
|---|---|
| Visita | Um `session_id` (por aba/visita), classificado por sessão |
| Pessoa | Visita `human` ou `unknown`; exclui robôs declarados e `suspect` |
| Suspeita | Sem login, nunca ficou visível > 1 s e sem ação. **Estimativa** |
| Usuário ativo | `user_hash` distinto com qualquer evento no período (DAU/WAU/MAU) |
| **Oficina ativa** | `organization_id` com ≥ 1 **evento de ação** (§5.3, não navegação) no período |
| Cadastro | `signup_completed` |
| **Ativação** | 1ª ação de negócio (padrão: `service_order_created`) **depois** do cadastro, em 24 h / 7 d |
| Esfriando / parada | Sem ação há 7 / 14 dias, para oficinas que já tinham agido |
| Nunca ativou | Oficina criada há > 7 dias sem nenhum evento de ação |
| Retorno N dias | Voltou em ≤ N dias do cadastro, só entre quem já teve o prazo inteiro |
| Último acesso (usuário) | `max(created_at)` do `user_hash` — calculado, sem coluna nova em `user_profiles` |

## 8. Fases de entrega

| Fase | Entrega | Esforço | Pronto quando |
|---|---|---|---|
| **0 — Decisões e spike** | Fechar §10; confirmar deploy/IP/país, `pg_cron`; gerar `ANALYTICS_HASH_SECRET` | ½ dia | Decisões registradas neste documento |
| **1 — Coleta e base** | Migration 098; `POST /api/metrics/track` (lote, cache de token, HMAC, `classify`, país); plugin + composable do cliente; atribuição UTM; **remoção do PostHog (§9)** | 2–3 dias | Navegar na landing e no app gera linhas; robôs separados; UTM chega no `session_start` |
| **2 — Painel básico** | Funções `analytics_summary`/`traffic`/`acquisition`/`coverage`; `GET /api/admin/metrics` (cache 60 s); abas **Resumo, Aquisição, Qualidade**; KPIs ▲▼; "Em destaque" | 2–3 dias | Números batem com SQL manual; 7/30/90 e comparação funcionam |
| **3 — Ações de negócio** | Mapa do §5.3 no hook; headers `X-Analytics-Session`/`X-Client-Platform`; eventos do webhook; aba **Engajamento** | 1–2 dias | Criar uma OS aparece em "Operação" e marca a oficina como ativa; **editar** uma OS não conta como criação |
| **4 — Ativação e oficinas** | Eventos de onboarding/tour; `analytics_funnel`, `analytics_accounts_health`; abas **Ativação** e **Oficinas** | 2–3 dias | Owner vê quais oficinas esfriaram e quando foi a última ação |
| **5 — Operação** | Retenção via `pg_cron`; exclusão de contas internas; resumo semanal ao owner (OneSignal, já integrado); "último acesso" na ficha da oficina | 1–2 dias | Painel < 1 s em 90 dias; resumo semanal chega |

A Fase 1 pode andar junto com a Fase 1 do plano de auditoria (mesmo plugin, mesmo `event.context`, mesmo header de plataforma).

## 9. Remoção do PostHog

| Onde | O que fazer |
|---|---|
| `app/composables/usePostHog.ts`, `app/plugins/posthog.client.ts` | Apagar; substituídos por `useAnalytics.ts` e `analytics.client.ts` |
| `app/types/analytics.ts` | Reescrever com os eventos do §5 (remover `habit_*`, `blog_*`, `$pageview`, `navigation_transition`, newsletter) |
| `AppHeader.vue:7`, `BillingPricingPlans.vue:53,61,104`, `index.vue:162`, `login.vue:68`, `signup.vue:67` | Trocar `capture()` por `track()` com nomes da lista fechada (`public_navigation_clicked` → `nav_click`, `public_hero_cta_clicked` → `cta_hero_click`, `pricing_billing_interval_changed` → `pricing_interval_changed`, `pricing_checkout_started` igual, `pricing_login_redirected` igual). `auth_login_submitted`/`auth_signup_submitted` somem (o servidor grava `login_completed`/`signup_completed` só no sucesso) |
| `nuxt.config.ts` (`posthogEnabled`, `posthogHost`, `posthogKey`) | Remover; incluir `analyticsEnabled` (público, `NUXT_PUBLIC_ANALYTICS_ENABLED`, desligado em dev) e `analyticsHashSecret` (privado) |
| `.env.example` (`NUXT_PUBLIC_POSTHOG_*`), `package.json` (`posthog-js`) | Remover; adicionar `NUXT_PUBLIC_ANALYTICS_ENABLED` e `ANALYTICS_HASH_SECRET` |
| Histórico no PostHog | **Exportar antes de cancelar a conta**; os números antigos não migram |

## 10. Decisões a confirmar (com recomendação)

| # | Pergunta | Recomendação |
|---|---|---|
| 1 | Retenção de 365 dias? | Sim (mínimo 180 para comparar 90×90) |
| 2 | `organization_id` em claro com usuário em hash? | Sim — sem isso não há "saúde das contas" |
| 3 | Ativação = "1ª OS" ou "1º pagamento"? Janela? | 1ª OS em 7 dias como principal; 1º pagamento como segundo marco do funil |
| 4 | Contas internas/demo e owner | Coluna `organizations.is_internal boolean DEFAULT false` + excluir `is_owner`; filtro "incluir internas" no painel |
| 5 | `org_created` nasce só no webhook do Stripe? | Verificado: as inserções em `organizations` estão no `stripe/webhook.post.ts`. Confirmar que não haverá criação manual pelo owner |
| 6 | Deploy / IP real / país | Se Vercel: `x-vercel-ip-country` e `waitUntil`. Se Node atrás de proxy: definir o header confiável |
| 7 | Quem vê | Só o owner da plataforma, em `/admin/metrics` |
| 8 | Consentimento de cookies/telemetria | Não há cookie nem ID persistente de visitante (só `sessionStorage` e `localStorage` de UTM); documentar na política de privacidade quando ela existir (plano GEO/SEO) |

## 11. Testes de aceitação

- [ ] Abrir `/` e `/pricing` anônimo → `session_start` com área, plataforma, país e atribuição; sem IP e sem User-Agent gravados.
- [ ] `?utm_source=x&utm_medium=y` → os `utm_*` saem da URL e a campanha chega no `session_start` e no `signup_completed`.
- [ ] Vindo de `chatgpt.com` → canal "IA/chatgpt" em Aquisição; `chatgpt.com.exemplo.com` **não** é IA.
- [ ] Logado, navegar → `user_hash` e `organization_id` preenchidos **pelo servidor**, mesmo que o cliente envie outros ou altere o cookie `sb-user`.
- [ ] Um lote de 20 eventos faz no máximo **uma** chamada à Supabase Auth (cache de token).
- [ ] Aba em segundo plano 5 min → `active_time` não cresce; fechar a aba → último lote chega (`keepalive`).
- [ ] User-Agent `Googlebot` / `PetalBot` / `HeadlessChrome` / `OAI-SearchBot` → `traffic`/`bot` corretos e fora de "Visitas de pessoas".
- [ ] `event` fora da lista, `area` desconhecida, duração > 1 h, `step` > 20, lote > 25 → rejeitado ou normalizado, sem 500.
- [ ] > 240 eventos/min → descartados silenciosamente (`dropped`).
- [ ] Criar uma OS → `service_order_created` e a oficina vira "ativa"; **editar** a mesma OS → `service_order_updated`; resposta 4xx/5xx → nenhum evento.
- [ ] Checkout concluído (Stripe CLI) → `org_created` e `subscription_started` com `organization_id`.
- [ ] Oficina sem ação por 8 dias → "esfriando"; 15 → "parada"; criada há 10 dias sem ação → "nunca ativou".
- [ ] Coorte com < 7 dias mostra "janela em aberto", não 0 %.
- [ ] Eventos do owner não entram nos números.
- [ ] Não-owner recebe 403 em `GET /api/admin/metrics`; segunda chamada em < 60 s vem do cache e `fresh=1` recalcula.
- [ ] Horários e dias em `America/Sao_Paulo`; dias sem evento aparecem com zero.
- [ ] Depois da Fase 1, `grep -ri posthog app server nuxt.config.ts package.json .env.example` não retorna nada.
