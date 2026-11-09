# Plano de implementação — Auditoria e log de ações do usuário

> Status: **implementado (Fases 0–3)** em 2026-11-09, **pendente de validação em Postgres real** (ver §14) · Criado em 2026-11-08 · Revisado em 2026-11-08 (verificado no código)
> Objetivo: gravar no banco **quem fez o quê, quando, com qual resultado** em todos os endpoints, para investigar
> reclamações do tipo "o sistema não funciona" e separar *bug do sistema* de *erro de uso*.
>
> Relacionados: [painel do owner](../admin/owner-panel-plan.md) (tela `/admin/audit` e achados de segurança) ·
> [métricas](../metrics/usage-metrics-plan.md) (usa o mesmo plugin Nitro e o mesmo `event.context`).

## Decisões já tomadas (2026-11-08)

| Tema | Decisão | Onde |
|---|---|---|
| Armazenamento | Tabela nova no próprio Supabase (`audit_logs`) | §4 |
| Retenção | **6 meses** | Partição mensal + rotina de descarte (§4.3) |
| Acesso | **Somente o owner da plataforma** (`is_owner = true`), em `/admin/audit` | §4.2, §9 |
| LGPD / aviso de privacidade | Fora de escopo por enquanto | Só proteções técnicas (sanitização, acesso restrito) |
| Rotas GET | **Só GETs de detalhe** (registro único, com a resposta) e **GETs que falham**; listas e relatórios com sucesso não são registrados | §5.2 |

### O que mudou nesta revisão

| Antes | Agora (verificado) |
|---|---|
| Policy de RLS "`organization_id = current_user_organization_id()` **e** `is_owner`" (contradizia a nota sobre owner da plataforma) | Owner = dono da **plataforma**, lê **todas** as orgs. Leitura **só pela API** (service role); RLS ligado **sem nenhuma policy** (§4.2) |
| Tela em `app/pages/app/` | O owner é **redirecionado para fora de `/app`** (`auth.global.ts:70`). Tela em **`/admin/audit`**, endpoint em `/api/admin/audit-logs` |
| `fiscal/nfse/[reference]/hook` tratado como webhook | É um **"reenviar hook" acionado pelo usuário** (exige login e `service_invoice.update`). O único webhook de entrada é `stripe/webhook` |
| `POST /api/service-orders` → `service_order.create` | O mesmo handler **cria e edita** (`body.orderId` presente = edição). Precisa de override (§5.6) |
| "Gravar o papel em `require-org-permission.ts`" | A função recebe `(userId, actionCode)`, **sem `event`**. Exige novo parâmetro opcional e ajuste nas 37 chamadas (§5.5) |
| Hooks do Nitro genéricos | Versões fixadas: **nitropack 2.13.1 / h3 1.15.5**. Hooks `request`, `beforeResponse`, `afterResponse`, `error` (§5.1) |
| Fase 0 citava "§10.6" (inexistente) | Corrigido para §10 |
| Partições "criadas pelo job" | Supabase dá `GRANT` padrão a `anon`/`authenticated` em tabelas novas do `public`: cada partição precisa de RLS + `REVOKE` (§4.3) |
| — | **Achado que reduz o valor do `denied`:** só 24 das 155 rotas de escrita checam papel no servidor; quase nada é negado hoje ([painel §2.2](../admin/owner-panel-plan.md#22-dentro-da-oficina-papel-não-é-checado-no-servidor)) |

---

## 1. Por que isso resolve o problema

A reclamação "não está funcionando" cai em um de quatro casos. O log precisa permitir distingui-los:

| Caso | Como aparece no log |
|---|---|
| Usuário tentou, o sistema recusou (validação, permissão, regra de negócio) | `status_code` 400/403/409/422 + `error_message` |
| Usuário tentou, o sistema quebrou (bug real) | `status_code` 5xx + `error_message` + payload enviado |
| Usuário nunca tentou a ação que diz ter feito | **Ausência** de registro no período |
| Usuário fez, mas outra coisa/pessoa alterou depois | Sequência de registros no mesmo recurso, com autores diferentes |

Por isso o log **não pode registrar só os sucessos**: as tentativas que falharam são a parte mais valiosa.

Exemplo real encontrado na revisão: cancelar NFS-e devolve **403 para toda oficina** porque o handler exige `requireOwner`
([painel §2.3](../admin/owner-panel-plan.md#23-bug-funcional-encontrado-na-varredura)). Com o log, isso apareceria como
`nfse.cancel` / `denied` repetido em várias oficinas, sem ninguém precisar reproduzir.

## 2. Diagnóstico do estado atual

Levantado no código em 2026-11-08:

- **248 handlers** em `server/api`: **155 de escrita** (92 `POST`, 28 `PUT`, 34 `DELETE`, 1 `PATCH`) e 93 `GET`.
  **Não existe** `server/middleware` nem `server/plugins`.
- O front **não fala direto com o Supabase** (nenhum `createClient`/`supabase-js` em `app/`). Toda escrita passa por
  `server/api` com o **service role** (`getSupabaseAdminClient`). Isso é o que torna viável um ponto central de captura.
- Autoria hoje: só `created_by` / `updated_by` / `deleted_by` (e-mail) — guarda **apenas o último** autor.
- Auditorias parciais existentes, isoladas:
  - `financial_transactions` / `service_order_installments` / `employee_financial_records`: `deletion_reason` + `deletion_source` (migrations 75, 76, 84).
  - `service_orders.commission_manual_adjustments_log` (jsonb, migration 93).
  - `fiscal_integration_logs` (migration 32): log técnico de cada chamada à Focus NFe (request/response/usuário). Mantém-se.
  - **`service_order_edit_logs`** (migration 36): criada para auditar OS, **nenhum código grava nela**; só é lida em
    `service-orders/[id].get.ts:49`, que portanto sempre devolve lista vazia. **Morta.**
- Autenticação: `requireAuthUser(event)` (224 handlers) devolve o usuário mas **não grava em `event.context`**;
  `resolveOrganizationId(event, userId)` (170 handlers) idem; `requireOrgPermission(userId, code)` (37 handlers) nem recebe `event`.
- `requireAuthUser` chama `supabase.auth.getUser()` (rede) a cada requisição. O plugin de auditoria **não pode** chamar de novo:
  lê o que o handler já resolveu.
- Deploy não fixado (`nuxt.config.ts` sem `preset`); o ícone da Vercel na página de preços sugere Vercel (não confirmado).
- Migrations: a última é a **096**; existem **dois arquivos `...093`** (`add_commission_manual_adjustments_log_to_service_orders` e
  `drop_legacy_employee_commission_columns`). Não afeta este plano, mas a próxima livre é a **097**.

## 3. Arquitetura: três camadas

### Camada 1 — Log HTTP automático (cobre 100% dos endpoints) ← **fazer primeiro**
Plugin Nitro `server/plugins/audit-log.ts` observa toda requisição a `/api/**` e grava **uma linha por requisição** relevante.
**Zero alteração nos 155 handlers** (só nos 3 utilitários de auth, §5.5).
Responde: *"o que o usuário tentou e o que o sistema respondeu"*.

### Camada 2 — Antes/depois nas entidades críticas
Helper `recordAudit()` chamado nos handlers sensíveis, que anexa `changes = { before, after, changed_fields }` à **mesma linha**
da Camada 1 (mesmo `request_id`). Responde: *"o que exatamente mudou"* (ex.: a parcela era 500, passou para 50).

### Camada 3 — Gatilhos no banco (opcional, rede de segurança)
Triggers `AFTER INSERT/UPDATE/DELETE` nas tabelas financeiras para mudanças feitas **fora** da API (SQL manual, scripts,
migrations). Como a API usa service role, `auth.uid()` é nulo; o autor viria de `updated_by`/`deleted_by`. **Fase 4.**

## 4. Modelo de dados

Migration: `supabase/migrations/20240101000097_create_audit_logs.sql`.

### 4.1 Tabela (particionada por mês)

```sql
CREATE TABLE public.audit_logs (
  id                  uuid         NOT NULL DEFAULT gen_random_uuid(),
  created_at          timestamptz  NOT NULL DEFAULT now(),

  -- Correlação
  request_id          uuid         NOT NULL,          -- devolvido ao front no header X-Request-Id
  organization_id     uuid,                           -- NULL em login falho / webhook sem org / owner sem org

  -- Quem
  actor_user_id       uuid,                           -- auth.users.id
  actor_email         varchar(200),
  actor_role          varchar(100),                   -- snapshot do papel (ou 'owner')
  actor_type          varchar(20)  NOT NULL DEFAULT 'user'
                      CHECK (actor_type IN ('user','owner','system','webhook','anonymous')),

  -- O quê
  action              varchar(100) NOT NULL,          -- ex.: 'service_order.cancel', 'client.update'
  resource_type       varchar(60),                    -- ex.: 'service_order'
  resource_id         varchar(100),
  http_method         varchar(10)  NOT NULL,
  http_path           varchar(300) NOT NULL,          -- rota com parâmetros resolvidos
  route_pattern       varchar(300),                   -- ex.: /api/clients/:id

  -- Resultado
  status_code         smallint     NOT NULL,
  outcome             varchar(10)  NOT NULL CHECK (outcome IN ('success','denied','invalid','error')),
  error_message       text,
  duration_ms         integer,

  -- Conteúdo
  query_params        jsonb,
  request_body        jsonb,                          -- sanitizado e truncado (§5.3)
  body_truncated      boolean      NOT NULL DEFAULT false,
  response_body       jsonb,                          -- só GET de detalhe e erros (§5.3)
  response_truncated  boolean      NOT NULL DEFAULT false,
  response_size_bytes integer,
  changes             jsonb,                          -- Camada 2: { before, after, changed_fields }

  -- Origem
  ip_address          inet,
  user_agent          varchar(400),
  platform            varchar(10),                    -- web | ios | android (header X-Client-Platform, §5.7)

  CONSTRAINT audit_logs_pkey PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_audit_org_created   ON public.audit_logs (organization_id, created_at DESC);
CREATE INDEX idx_audit_actor_created ON public.audit_logs (actor_user_id, created_at DESC);
CREATE INDEX idx_audit_email_created ON public.audit_logs (lower(actor_email), created_at DESC);
CREATE INDEX idx_audit_resource      ON public.audit_logs (resource_type, resource_id, created_at DESC);
CREATE INDEX idx_audit_failures      ON public.audit_logs (created_at DESC) WHERE outcome <> 'success';
CREATE INDEX idx_audit_request       ON public.audit_logs (request_id);
CREATE INDEX idx_audit_action        ON public.audit_logs (action, created_at DESC);
```

Índices criados no pai são replicados automaticamente em cada partição (PostgreSQL ≥ 11; Supabase usa 15+).

### 4.2 Regras de acesso e integridade

- **Somente o service role grava e lê.** O front nunca acessa o Supabase direto, então não há caso de uso para policy.
  `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` **sem nenhuma policy** + `REVOKE ALL ... FROM anon, authenticated`.
  A tela do owner lê via `GET /api/admin/audit-logs` (guard por prefixo + `requireOwner`).
- **Append-only.** Trigger `BEFORE UPDATE OR DELETE` que lança exceção (vale até para o service role) + `REVOKE TRUNCATE`.
  O descarte por retenção é por `DROP` de partição, que o trigger de linha não bloqueia.
- **Sem FKs** para `organizations`/`user_profiles`: o log sobrevive à exclusão de usuário/org e nunca bloqueia uma operação.
- `outcome`: `success` = 2xx/3xx · `denied` = 401/403 · `invalid` = 400/404/409/422 · `error` = 5xx e qualquer outro.

```sql
CREATE OR REPLACE FUNCTION public.audit_logs_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs é append-only (% bloqueado)', TG_OP;
END $$;

CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_block_mutation();

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_logs FROM anon, authenticated;
REVOKE TRUNCATE ON public.audit_logs FROM service_role;
```

### 4.3 Partições e retenção de 6 meses

```sql
-- Cria a partição do mês de `p_month` (idempotente) já trancada para anon/authenticated
CREATE OR REPLACE FUNCTION public.audit_logs_create_partition(p_month date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := format('audit_logs_y%sm%s', to_char(v_start, 'YYYY'), to_char(v_start, 'MM'));
BEGIN
  EXECUTE format('CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.audit_logs FOR VALUES FROM (%L) TO (%L)',
                 v_name, v_start, v_end);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_name);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', v_name);
END $$;

-- Mantém mês atual + N meses à frente e descarta o que passou da retenção
CREATE OR REPLACE FUNCTION public.audit_logs_maintain(p_months_ahead int DEFAULT 2, p_retention_months int DEFAULT 6)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  v_cutoff date := (date_trunc('month', now()) - make_interval(months => p_retention_months))::date;
BEGIN
  FOR i IN 0..p_months_ahead LOOP
    PERFORM public.audit_logs_create_partition((now() + make_interval(months => i))::date);
  END LOOP;

  FOR r IN
    SELECT c.relname
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'audit_logs' AND c.relname ~ '^audit_logs_y\d{4}m\d{2}$'
      AND to_date(regexp_replace(c.relname, '^audit_logs_y(\d{4})m(\d{2})$', '\1\2'), 'YYYYMM') < v_cutoff
  LOOP
    EXECUTE format('DROP TABLE public.%I', r.relname);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.audit_logs_create_partition(date), public.audit_logs_maintain(int, int) FROM PUBLIC, anon, authenticated;

-- Partição padrão: evita perder linhas se a manutenção falhar; deve ficar vazia (monitorar)
CREATE TABLE public.audit_logs_default PARTITION OF public.audit_logs DEFAULT;
ALTER TABLE public.audit_logs_default ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_logs_default FROM anon, authenticated;

SELECT public.audit_logs_maintain(2, 6);   -- cria as partições iniciais

-- Agendamento (requer a extensão pg_cron habilitada no painel do Supabase → Database → Extensions)
SELECT cron.schedule('audit-logs-maintain', '15 3 * * *', $$SELECT public.audit_logs_maintain(2, 6)$$);
```

Retenção efetiva: 6 meses completos + o mês corrente. Se `pg_cron` não puder ser habilitado, expor
`POST /api/admin/system/maintain` (owner ou segredo de cron) chamando `audit_logs_maintain` e acionar por agendador externo
(ex.: Vercel Cron). A partição `default` precisa ficar vazia; se tiver linhas, criar a partição do mês falha — alerta em `/admin/system`.

### 4.4 Volume e custo (medir na Fase 1)

Estimativa para dimensionar: linhas/dia ≈ escritas/dia + GETs de detalhe/dia + GETs com falha/dia. Com ~1–3 KB por linha
sem resposta e até 16 KB com resposta: **50 oficinas × 200 requisições registradas/dia ≈ 10 mil linhas/dia ≈ 30–60 MB/dia
≈ 5–10 GB em 6 meses.** É relevante frente ao disco incluído no plano do Supabase. Medir após uma semana:

```sql
SELECT date_trunc('day', created_at) AS dia, count(*),
       pg_size_pretty(sum(pg_column_size(request_body))::bigint)  AS req,
       pg_size_pretty(sum(pg_column_size(response_body))::bigint) AS resp
FROM audit_logs GROUP BY 1 ORDER BY 1 DESC;
```
Se pesar: reduzir o teto de resposta (16 → 4 KB), parar de gravar `response_body` de sucesso e manter só nos erros.

## 5. Camada 1 em detalhe — plugin Nitro

### 5.1 Fluxo e hooks (nitropack 2.13 / h3 1.15)

```
request         → cria event.context.audit = { requestId, startedAt }, define header X-Request-Id
handler         → requireAuthUser / resolveOrganizationId / requireOrgPermission preenchem actor, org e papel
error           → (se houver) guarda statusCode e mensagem em event.context.audit.error
beforeResponse  → (GET de detalhe ou erro) guarda o corpo da resposta, já sanitizado e truncado
afterResponse   → monta a linha e enfileira o INSERT (nunca bloqueia nem quebra a resposta)
```

Esboço:

```ts
// server/plugins/audit-log.ts
import { randomUUID } from 'node:crypto'
import { shouldAudit, buildAuditRow } from '../utils/audit/build'
import { enqueueAudit } from '../utils/audit/queue'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    if (!event.path.startsWith('/api/')) return
    const requestId = randomUUID()
    event.context.audit = { requestId, startedAt: Date.now() }
    setResponseHeader(event, 'X-Request-Id', requestId)
  })

  nitroApp.hooks.hook('error', (error, { event }) => {
    const ctx = event?.context.audit
    if (ctx) ctx.error = { statusCode: (error as any).statusCode ?? 500, message: (error as any).statusMessage || error.message }
  })

  nitroApp.hooks.hook('beforeResponse', (event, response) => {
    const ctx = event.context.audit
    if (ctx && shouldAudit(event, ctx).captureResponse) ctx.responseBody = response?.body
  })

  nitroApp.hooks.hook('afterResponse', async (event) => {
    const ctx = event.context.audit
    if (!ctx || ctx.logged) return
    ctx.logged = true
    try {
      const row = await buildAuditRow(event, ctx)   // lê corpo cacheado, sanitiza, deriva action
      if (row) enqueueAudit(event, row)
    } catch (err) {
      console.error('[audit] falha ao montar linha', err)
    }
  })
})
```

**Pontos a confirmar no spike (Fase 0)** — são os únicos riscos técnicos do plano:
1. `afterResponse` dispara também quando o handler lança `createError` (senão, gravar a partir do hook `error`, deduplicando por `ctx.logged`).
2. `getResponseStatus(event)` devolve o status final do erro dentro de `afterResponse`.
3. `readBody(event)` depois do handler devolve o corpo **cacheado** (h3 guarda o corpo bruto lido); para handlers que não leram o corpo, ler no `afterResponse` não trava.
4. `event.context.matchedRoute?.path` traz o padrão da rota (`/api/clients/:id`) para `route_pattern`; senão, derivar do caminho trocando UUIDs/números por `:id`.
5. `beforeResponse` recebe o corpo serializável do erro (para `response_body` de 4xx/5xx).

Fallback se 1–3 falharem: wrapper `defineAuditedHandler()` aplicado por codemod nos 248 arquivos (troca de `defineEventHandler`/`eventHandler`).

### 5.2 O que registrar e o que ignorar

| Registrar | Ignorar |
|---|---|
| Todo `POST`/`PUT`/`PATCH`/`DELETE` em `/api/**` | `GET /api/supabase/health` |
| **`GET` de detalhe** (allowlist abaixo), com a resposta | `GET` de listas, relatórios e polling com sucesso (`notifications`, `billing/status`, `*/next-number`, `products/next-code`) |
| **Qualquer `GET` que falhe** (401/403/404/5xx), só com a mensagem de erro | `GET /api/admin/audit-logs` (lista da própria tela) |
| Login, logout, signup, pedidos e redefinições de senha (inclusive **falhas**) | `GET /api/auth/me`, `POST /api/auth/set-session` (ruído de sessão) |
| `POST` de exportação (`*/export*`) — é saída de dados | `POST /api/notifications/read`, `read-all` |
| `POST /api/stripe/webhook` como `actor_type='webhook'` | `POST /api/metrics/track` (o coletor de métricas; volume alto e sem valor de auditoria) |
| Ações do owner em `/api/admin/**` (escritas) e **abertura de detalhe do log** (`audit.view`) | Rotas inexistentes (`matchedRoute` vazio) de visitantes **sem** sessão (varredura de bots) |

**GETs de detalhe registrados** (`server/utils/audit/config.ts`; regra: devolve um único registro por `:id` ou complemento de tela):

| Domínio | Rotas |
|---|---|
| Ordens de serviço | `service-orders/[id]`, `service-orders/[id]/edit-data`, `service-orders/[id]/nfse` |
| Financeiro | `financial/[id]` |
| Comissões / bônus | `commissions/[id]`, `commissions/[id]/rules`, `commissions/[id]/impact`, `bonuses/[id]`, `bonuses/[id]/progress`, `bonuses/[id]/financial-records`, `reports/commissions/[id]`, `employees/[id]/commissions`, `employees/[id]/commission-plans`, `employees/[id]/commission-rules`, `employees/[id]/bonuses` |
| Acesso | `roles/[id]`, `roles/[id]/actions` |
| Fiscal | `fiscal/nfse/[id]`, `fiscal/nfse/[reference]` |
| Feedback | `feedback/[id]`, `feedback/[id]/responses` |

Fora da lista: catálogos externos (`fiscal/municipalities/**`, `fiscal/zip_code/[zip_code]`, `fiscal/business_id/[business_id]`).
Clientes, veículos e produtos **não têm** GET de detalhe (a tela usa a lista) — para eles o log mostra só as escritas.

Alguns `POST` só leem (`commissions/preview`, `clients/batch`) — registrados mesmo assim; custo baixo e ajuda a reconstruir a tela.

### 5.3 Sanitização (obrigatória)

- **Redigir** (`"[REDACTED]"`) por nome de campo, em qualquer profundidade, sem diferenciar maiúsculas:
  `password`, `new_password`, `current_password`, `token`, `access_token`, `refresh_token`, `secret`, `api_key`, `apikey`,
  `authorization`, `card*`, `cvv`, `cvc`, `certificate*`, `certificado*`, `senha*` (o cadastro Focus NFe pode trazer certificado e senha).
- **Não ler** corpos `multipart/form-data` (`auth/avatar`, `organizations/logo`, `feedback/upload`, `products/import`,
  `suppliers/import`): registrar só nome, tipo e tamanho do arquivo.
- **Truncar** o JSON de request acima de ~32 KB (`body_truncated = true`).
- **Nunca** gravar cookies nem o header `Authorization`.
- **Resposta (`response_body`)**: só em GET de detalhe e em erros.
  - Inteira até ~16 KB; acima disso `response_truncated = true`, `response_size_bytes` e um **resumo** (chaves de 1º nível e tamanho de cada array).
  - Erros 4xx/5xx sempre inteiros (pequenos e os mais úteis).
  - `/api/auth/*` devolve sessão/tokens: gravar só `user.id` e `user.email`.
  - Exportações: só tamanho e tipo do arquivo, nunca o conteúdo (`base64`).
- CPF/CNPJ e telefone **ficam** no log (são evidência). Isso torna a tabela dado pessoal: acesso restrito (§4.2) e retenção definida.

### 5.4 Gravação sem atrasar nem perder linhas

- **Serverless (ex.: Vercel):** `event.waitUntil(insert)` quando existir — a resposta já saiu e a função espera o INSERT.
- **Node (servidor persistente):** buffer em memória com descarga a cada 2 s ou 50 linhas, num único `insert([...])`.
- `enqueueAudit` escolhe automaticamente: se `event.waitUntil` existe, grava a linha (ou o lote acumulado) dentro dele; senão, buffer.
- Falha de INSERT: 1 nova tentativa; depois `console.error` com a linha resumida (sem corpos). **Nunca** propaga erro à requisição.
- Reaproveitar `getSupabaseAdminClient()` — sem dependência nova.

### 5.5 Mudanças nos utilitários existentes

| Arquivo | Mudança | Impacto |
|---|---|---|
| `server/utils/require-auth.ts` | Ao autenticar: `event.context.audit && Object.assign(event.context.audit, { userId, email })` | 224 handlers passam a ter autor sem alteração |
| `server/utils/organization.ts` (`resolveOrganizationId`) | Gravar `organizationId` e `employeeId` no contexto | 170 handlers |
| `server/utils/require-owner.ts` | Gravar `actorType='owner'`, `role='owner'` | 7+ handlers |
| `server/utils/require-org-permission.ts` | Nova assinatura `requireOrgPermission(userId, actionCode, event?)`; quando `event` vier, gravar `role.name` e `organizationId` | Codemod nas **37** chamadas para passar `event`; sem `event` continua funcionando |
| `server/api/auth/login.post.ts` (e signup/reset) | Nenhuma: o plugin extrai `email` do corpo (nunca a senha) e marca `actor_type='anonymous'` quando não há usuário | Explica "não consigo entrar" |
| `server/api/stripe/webhook.post.ts` | Gravar no contexto `actorType='webhook'`, `action='stripe.<event.type>'`, `organizationId` quando resolvido | Cobrança investigável |

Tipagem: declarar `event.context.audit` em `server/types/audit.d.ts` (`declare module 'h3' { interface H3EventContext { audit?: AuditContext } }`).

### 5.6 Derivação de `action` / `resource_type` / `resource_id`

Algoritmo (sem mapear 155 rotas à mão):
1. Segmentos após `/api`, separando estáticos de parâmetros.
2. `resource_type` = 1º segmento estático no singular e em `snake_case` (`service-orders` → `service_order`, `purchase-requests` → `purchase_request`, `financial` → `financial`).
3. Sub-recurso estático depois de um parâmetro entra no nome (`service-orders/:id/installments/:installmentId` → `service_order.installment`).
4. Verbo: se o último segmento estático é um verbo conhecido (`cancel`, `pay`, `authorize`, `reject`, `generate`, `generate-commissions`,
   `process-payment`, `receive-extra-payment`, `down-payment`, `grant-access`, `migrate`, `extend-recurrence`, `email`, `sync`,
   `hook`, `link`, `import`, `export*`, `batch`, `preview`, `assignments`, `versions`, `value-versions`), usá-lo em `snake_case`;
   senão, pelo método: `POST`→`create`, `PUT`/`PATCH`→`update`, `DELETE`→`delete`, `GET`→`view`.
5. `resource_id` = último parâmetro de rota.

| Rota | `action` |
|---|---|
| `POST /api/clients` | `client.create` |
| `PUT /api/clients/:id` | `client.update` |
| `POST /api/service-orders/:id/cancel` | `service_order.cancel` |
| `POST /api/financial/:id/pay` | `financial.pay` |
| `DELETE /api/service-orders/:id/installments/:installmentId` | `service_order.installment.delete` |
| `GET /api/service-orders/:id` | `service_order.view` |

**Overrides obrigatórios** (`config.ts`; alguns dependem do corpo, que o plugin já tem):

| Rota | `action` | Motivo |
|---|---|---|
| `POST /api/service-orders` com `body.orderId` | `service_order.update` (`resource_id = body.orderId`) | O handler cria **e** edita |
| `POST /api/service-orders` sem `orderId` | `service_order.create` (`resource_id` = `id` da resposta) | idem |
| `POST /api/roles/:id/actions` | `role.permissions_update` | Não é "criar ação" |
| `POST /api/users/update-role`, `update-fields` | `user.role_change`, `user.update_fields` | Clareza na investigação |
| `POST /api/financial/pay-entries-bulk` · `pay-commissions-bulk` · `update-recurring` | `financial.pay_bulk` · `commission.pay_bulk` · `financial.recurrence_update` | Rotas sem `:id` |
| `DELETE /api/fiscal/nfse/:reference` · `POST .../hook` · `POST .../email` | `nfse.cancel` · `nfse.retry_hook` · `nfse.email` | Vocabulário do domínio |
| `POST /api/auth/login` · `logout` · `signup` · `forgot-password` · `reset-password*` · `PUT password` · `DELETE account` | `auth.login` · `auth.logout` · `auth.signup` · `auth.password_reset_request` · `auth.password_reset` · `auth.password_change` · `auth.account_delete` | — |
| `POST /api/stripe/webhook` | `stripe.<type>` (definido pelo handler) | Um nome por evento |
| `GET /api/admin/audit-logs/:id` | `audit.view` | Rastrear quem viu o quê |

### 5.7 Front-end

- **Plataforma:** o `$fetch` global (plugin do cliente) envia `X-Client-Platform: web|ios|android` (`Capacitor.getPlatform()`),
  gravado em `platform`. O mesmo plugin envia `X-Analytics-Session` para o [plano de métricas](../metrics/usage-metrics-plan.md#53-ações-de-negócio--emitidas-pelo-servidor).
- **Código do erro para o usuário:** o plugin `app/plugins/api-client.ts` registra `onResponseError`, lê `X-Request-Id` e o
  anexa ao erro (`error.requestId`). Um composable `useApiErrorToast(error)` mostra "Código: `abc12345`" (8 primeiros caracteres)
  com botão copiar. Adoção gradual nos `toast.add` de erro existentes; começar por OS, financeiro e login.
- Alternativa no servidor (validar no spike): no hook `error`, incluir `requestId` em `error.data`, para que telas que já mostram
  `error.data` exibam o código sem mudança.

## 6. Cobertura por domínio (checklist de validação da Camada 1)

| Domínio | Endpoints de escrita | Risco para suporte |
|---|---|---|
| Ordens de serviço (`service-orders/*`) | create/update (mesma rota), delete, cancel, down-payment, process-payment, receive-extra-payment, payment.delete, installments pay/patch/delete, financial-transactions delete, generate-commissions, export-csv | **Alto** — "valor errado" |
| Financeiro (`financial/*`) | create, update, delete, pay, pay-entries-bulk, pay-commissions-bulk, recorrência (extend/update), categorias (CRUD/migrate), export | **Alto** |
| Comissões / bônus (`commissions/*`, `bonuses/*`, `reports/commissions/*`) | planos, versões, assignments, generate, pay, delete | **Alto** |
| Compras (`purchases`, `purchase-requests`, `purchase-returns`) | CRUD, pay, authorize, reject | Médio |
| Cadastros (`clients`, `vehicles`, `suppliers`, `products`, `parts`, `master-products`, `employees`, `taxes`, `bank-accounts`, `payment-terminals`, `product-categories`, `appointments`) | CRUD + imports | Médio |
| Fiscal (`fiscal/*`) | company sync, nfse create/cancel/email/retry-hook | Médio (há `fiscal_integration_logs`) |
| Acesso (`roles/*`, `users/*`, `employees/:id/grant-access`) | papéis, permissões, vínculo de usuário | **Alto** — "perdi acesso" |
| Auth (`auth/*`) | login, logout, signup, senha, perfil, avatar, exclusão de conta | **Alto** |
| Organização / assinatura (`organizations/*`, `billing/*`, `stripe/*`) | edição, logo, onboarding, checkout, portal, cancel, webhook | Médio |
| Feedback / notificações / settings | CRUD | Baixo |

## 7. Camada 2 — antes/depois nas entidades críticas

```ts
// server/utils/audit/record.ts
export function recordAudit(event: H3Event, input: {
  action?: string            // sobrescreve a derivada
  resourceType?: string
  resourceId?: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  ignore?: string[]          // campos fora do diff (default: updated_at, updated_by, created_at)
}): void
// Calcula changed_fields e guarda só o DIFF ({ campo: { from, to } }) em event.context.audit.changes.
// O plugin da Camada 1 anexa à mesma linha. Não faz I/O.
```

Ordem de aplicação:
1. **Ordens de serviço** — `service-orders/index.post.ts` já carrega a OS inteira antes de editar (`existingOrder`, `:50-63`),
   então o "before" sai sem query extra. Também `cancel`, pagamentos e parcelas. Diff de `items` (jsonb) por posição/código do item.
2. `financial/*`.
3. `commissions/*`, `bonuses/*`, `employee_financial_records`.
4. `roles/*` / `role_actions` (permissões concedidas/revogadas listadas por código de ação).
5. `bank-accounts` e `purchases/*`.
6. Demais cadastros só se a Camada 1 se mostrar insuficiente.

## 8. Destino das auditorias já existentes

- **`service_order_edit_logs`** (morta): migrar a leitura de `service-orders/[id].get.ts:49` para `audit_logs`
  (`resource_type='service_order' AND resource_id=:id`, últimas 50) e remover a tabela numa migration futura (098+).
  A tela de OS passa a mostrar histórico real.
- `deletion_reason` / `deletion_source` e `commission_manual_adjustments_log`: **manter** (têm o motivo digitado pelo usuário).
- `fiscal_integration_logs`: **manter** — é o log técnico da Focus NFe; o `request_id` pode ser gravado lá também para cruzar.
- `created_by/updated_by/deleted_by`: manter.

## 9. Consulta

### 9.1 Tela (Fase 3) — `/admin/audit`
Contrato de API e UI no [plano do painel §5.1](../admin/owner-panel-plan.md#51-auditoria-adminaudit--depende-da-fase-1-do-plano-de-auditoria).
Toda consulta exige intervalo de datas (máx. 31 dias) para aproveitar o *partition pruning*.

### 9.2 SQL pronto (até a tela existir — SQL Editor do Supabase)

```sql
-- 1. Tudo que um usuário tentou nas últimas 24h
SELECT created_at, action, resource_id, status_code, outcome, error_message
FROM audit_logs
WHERE lower(actor_email) = 'fulano@oficina.com' AND created_at > now() - interval '24 hours'
ORDER BY created_at DESC;

-- 2. Falhas de um usuário (quase sempre a resposta da reclamação)
SELECT created_at, http_method, route_pattern, status_code, error_message, request_body
FROM audit_logs
WHERE lower(actor_email) = 'fulano@oficina.com' AND outcome <> 'success' AND created_at > now() - interval '7 days'
ORDER BY created_at DESC LIMIT 100;

-- 3. Histórico de uma OS / lançamento
SELECT created_at, actor_email, action, status_code, changes
FROM audit_logs
WHERE resource_type = 'service_order' AND resource_id = '<uuid>' AND created_at > now() - interval '180 days'
ORDER BY created_at;

-- 4. Quem excluiu coisas hoje
SELECT created_at, actor_email, organization_id, resource_type, resource_id
FROM audit_logs
WHERE action LIKE '%.delete' AND outcome = 'success' AND created_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';

-- 5. Ações que mais falham (bug × erro de uso)
SELECT action, outcome, status_code, count(*) AS n, count(DISTINCT organization_id) AS oficinas
FROM audit_logs
WHERE created_at > now() - interval '7 days' AND outcome <> 'success'
GROUP BY 1,2,3 ORDER BY n DESC;

-- 6. "Ele disse que salvou": houve tentativa naquele horário?
SELECT * FROM audit_logs
WHERE lower(actor_email) = 'fulano@oficina.com'
  AND created_at BETWEEN '2026-11-08 14:00-03' AND '2026-11-08 15:00-03';

-- 7. Pelo código que o usuário viu no toast
SELECT * FROM audit_logs WHERE request_id::text LIKE 'abc12345%' AND created_at > now() - interval '30 days';
```

### 9.3 Roteiro de investigação (suporte)
1. Pedir ao cliente o **código do erro** (toast) ou e-mail + horário aproximado.
2. Consultas 7 → 6 → 2. Classificar: `invalid` (orientar o usuário), `denied` (rever papel), `error` (bug → abrir issue com `request_id`), ausência (o usuário não chegou a enviar; olhar métricas de navegação).
3. Se envolver valor, consulta 3 para ver `changes` e quem mexeu depois.

## 10. Pendências técnicas (resolver na Fase 0)

1. **`pg_cron` habilitado?** Define como roda `audit_logs_maintain` (§4.3).
2. **Spike dos hooks** (§5.1, itens 1–5) na versão em uso (nitropack 2.13.1 / h3 1.15.5).
3. **Destino de deploy** (Vercel × Node): confirma `waitUntil` × buffer (§5.4) e de onde vem o IP real (`x-forwarded-for` / `x-real-ip` / `x-vercel-forwarded-for`).

## 11. Fases de entrega

| Fase | Entrega | Esforço | Critério de pronto |
|---|---|---|---|
| **0 — Spike** | Plugin mínimo com `console.log` de método/rota/status/usuário/`matchedRoute`; validar itens do §10 | ½ dia | Log aparece para sucesso **e** erro (`createError`), com e-mail do usuário e padrão de rota |
| **1 — Fundação** | Migration 097 (tabela particionada, trigger append-only, RLS/REVOKE, funções de partição, `pg_cron`); contexto nos utilitários (§5.5) incl. codemod das 37 chamadas; plugin completo (sanitização, resposta truncada, gravação, exclusões, overrides); header `X-Request-Id`; `X-Client-Platform` | 2–3 dias | Toda escrita e GET de detalhe gera linha; senha/token nunca aparecem; login falho registra; editar uma OS gera `service_order.update` |
| **2 — Domínio** | `recordAudit()` em OS, financeiro, comissões/bônus, papéis; leitura de `service_order_edit_logs` migrada | 2–3 dias | Editar o valor de uma parcela mostra `before`/`after` |
| **3 — Consulta** | `GET /api/admin/audit-logs[/:id]`, página `/admin/audit`, `useApiErrorToast` com código | 2 dias | Owner filtra por usuário e vê falhas e respostas sem SQL; não-owner recebe 403 |
| **4 — Opcional** | Triggers no banco (tabelas financeiras); alertas (ex.: > 20 exclusões em 10 min na mesma oficina; > 10 erros 5xx na mesma rota em 1 h) via notificação ao owner | variável | Alteração direta no banco aparece no log; alerta chega |

**Recomendação:** Fase 0 e 1 logo depois da Fase 0a de segurança do painel (que apaga/move rotas; evita auditar rotas que vão sumir).
A partir da Fase 1 cada reclamação nova já é investigável pelos SQLs do §9.2.

## 12. Riscos e cuidados

- **Falha no log não pode derrubar a operação** — `try/catch` isolado em todos os hooks.
- **Crescimento da tabela** — `request_body`/`response_body` dominam; ver §4.4. Partição mensal + descarte por `DROP`.
- **Dados pessoais nas respostas** — detalhes de OS e funcionários entram no log; mitigação: acesso só do owner, retenção de 6 meses.
- **Sanitização por denylist** — revisar a lista a cada endpoint novo que receba segredo (incluir no checklist de PR).
- **Log ≠ tela** — registra o que a API recebeu e respondeu, não o que o usuário viu. Para "a tela não atualizou", cruzar com as
  métricas de navegação (`page_view`/`active_time`) do plano de métricas.
- **Escrita fora da API** (scripts em `scripts/`, SQL manual, migrations) não passa pela Camada 1 — só a Camada 3 cobre.
- **`denied` raro hoje** — enquanto as permissões por papel não forem checadas no servidor (painel §2.2), uma ação proibida
  aparece como `success`. O log mostra **quem** fez, o que já resolve a investigação, mas não o bloqueio.

## 13. Testes de aceitação

- [ ] `POST /api/clients` → 1 linha `client.create`, `outcome=success`, `actor_email` e `organization_id` corretos, `X-Request-Id` igual ao `request_id`.
- [ ] `POST /api/service-orders` com `orderId` → `service_order.update` com `resource_id = orderId`; sem `orderId` → `service_order.create`.
- [ ] `PUT /api/clients/:id` com `person_type` inválido → `outcome=invalid`, status 400, mensagem do erro.
- [ ] Rota que lança 403 → `outcome=denied` (ex.: `DELETE /api/fiscal/nfse/:ref` antes da correção do painel §2.3).
- [ ] Erro 500 forçado → `outcome=error`, `response_body` com a mensagem.
- [ ] Login com senha errada → `actor_type=anonymous`, e-mail presente, **sem senha** no corpo.
- [ ] Corpo com `password`/`token`/`certificado` aninhado → `[REDACTED]`.
- [ ] Import de planilha (multipart) → linha com nome/tamanho do arquivo, sem conteúdo.
- [ ] Simular falha do INSERT de log → a requisição original responde normalmente.
- [ ] `UPDATE`/`DELETE` em `audit_logs` (inclusive via service role) → exceção.
- [ ] `anon`/`authenticated` via PostgREST não leem `audit_logs` **nem** uma partição (`audit_logs_y2026m11`).
- [ ] Não-owner recebe 403 em `GET /api/admin/audit-logs`.
- [ ] `GET /api/service-orders/:id` → linha com `response_body` e `response_size_bytes`.
- [ ] `GET /api/clients` (lista) com sucesso → **nenhuma** linha; com 403/500 → linha de falha.
- [ ] Login não grava tokens na resposta; `GET /api/auth/me` e `POST /api/metrics/track` não geram linha.
- [ ] `audit_logs_maintain()` cria as partições dos próximos 2 meses e descarta as anteriores a 6 meses; `audit_logs_default` vazia.
- [ ] Webhook do Stripe gera `stripe.<type>` com `actor_type=webhook` e `organization_id` quando resolvido.
- [ ] Cancelar OS gera `service_order.cancel` com `changes` (Fase 2).

## 14. Estado da implementação (2026-11-09)

**Entregue**

| Item | Onde |
|---|---|
| Migration 097 (tabela particionada, append-only, RLS sem policy, `REVOKE`, funções de partição/retenção, `pg_cron` condicional) | `supabase/migrations/20240101000097_create_audit_logs.sql` |
| Plugin Nitro (hooks `request`/`error`/`beforeResponse`/`afterResponse`/`close`), `X-Request-Id` | `server/plugins/audit-log.ts` |
| Regras, derivação de `action`, sanitização, montagem da linha, fila (waitUntil × buffer), diff antes/depois | `server/utils/audit/*` |
| Autor/oficina/papel no contexto sem tocar nos handlers | `require-auth`, `organization`, `require-owner`, `require-org-permission` (novo 3º parâmetro `event`, 35 chamadas ajustadas) |
| Webhook do Stripe (`actor_type=webhook`, `stripe.<tipo>`, oficina quando resolvida) | `server/api/stripe/webhook.post.ts` |
| Camada 2 (`recordAudit`): OS (criar/editar/cancelar), `financial/:id` (PUT), `financial/:id/pay`, `roles/:id/actions` | handlers correspondentes |
| Histórico da OS lido de `audit_logs` (substitui `service_order_edit_logs`, que nunca foi gravada) | `server/api/service-orders/[id].get.ts` |
| API do owner `GET /api/admin/audit-logs[/:id]` (filtros, máx. 31 dias, `audit.view`) e tela `/admin/audit` | `server/api/admin/audit-logs/*`, `app/pages/admin/audit.vue` |
| Código do erro para o usuário (`X-Request-Id` → toast com "Copiar código") e `X-Client-Platform` sempre enviado | `app/composables/useApiErrorToast.ts`, `app/plugins/api-client.client.ts` |
| Testes | `tests/unit/audit/*`, `tests/unit/handlers/admin-audit-logs.test.ts` |

**Validado com o Nitro 2.13.1 em execução (Fase 0):** `X-Request-Id` sai em toda resposta `/api/**`; `matchedRoute` vem preenchido (`/api/clients`, `/api/auth/login`) e o catch-all do Nuxt aparece como `/**` (tratado como "sem rota"). **Correção ao plano (§5.1, item 1):** quando o handler lança `createError`, o Nitro responde sozinho e o h3 **não** chama `afterResponse` (`event.handled`). Por isso o erro é registrado no hook `error` (`ctx.logged` evita duplicar); `afterResponse` cobre só os sucessos.

**Ainda não validado (precisa de ambiente)**
- Migration 097 **validada isolada** em Postgres 17 real (imagem `supabase/postgres`): 13 testes em `tests/api/audit-logs.sql.test.ts` cobrem partições, append-only (inclusive service role), `TRUNCATE` negado, `anon`/`authenticated` sem acesso à tabela, às partições e às funções, constraints, `inet`, idempotência, retenção de 6 meses e o encaixe das linhas montadas por `buildAuditRow`. **Não** validada no schema completo: `supabase start` falha antes (KF-23 em `docs/testing/known-failures.md`: a migration 012 referencia `employees`, criada na 013). O ramo `cron.schedule` (com `pg_cron` ligado) também não foi exercitado.
- Leitura do corpo JSON em `afterResponse`/`error` com tráfego autenticado real (item 3 do §5.1) e o INSERT contra um banco de verdade: só foi exercitado até a tentativa de gravar.
- `pg_cron` habilitado no projeto Supabase (§10.1) e o destino de deploy (§10.3). Sem `pg_cron`, agendar `SELECT public.audit_logs_maintain(2, 6)` antes do fim de cada mês.

**Diagnóstico:** com `AUDIT_DEBUG=1` o plugin imprime, por requisição, método, caminho, rota casada, status, usuário e a decisão de gravar (`[audit:debug]`). Usar para confirmar `matchedRoute` no ambiente real.

**Camada 2 ampliada (2026-11-09):** além de OS/financeiro/papéis, `recordAudit` está em compras, solicitações e devoluções de compra, contas bancárias, planos de comissão (criar/editar/excluir/versões/atribuições), bônus (criar/editar/excluir/versões/atribuições/geração/exclusão de geração/exclusão de pagamento), pagamentos e estornos da OS (`process-payment`, `down-payment`, `receive-extra-payment`, `payment`, `[id]` DELETE, recebimentos, parcelas pagar/alterar/excluir) e financeiro (criar, excluir, recorrência, pagamentos em lote, categorias). Nos handlers de parcela, `resource_id` é o id da **OS** (o `installmentId` vai em `changes.extra`), para o histórico da OS reunir tudo.

**Fora desta entrega:** Camada 3 (triggers no banco), alertas (Fase 4), `recordAudit` em cadastros simples (clientes, veículos, fornecedores, produtos, funcionários, impostos, maquininhas, agenda) e adoção do `useApiErrorToast` nos toasts além do login.
