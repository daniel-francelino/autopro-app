-- =============================================================================
-- FILE: 20240101000098_create_analytics_events.sql
-- PURPOSE: Telemetria própria de uso (substitui o PostHog).
--          Ver docs/metrics/usage-metrics-plan.md.
--
-- PRIVACIDADE
--   * user_hash = HMAC-SHA256(segredo do servidor, user_id)[0:24] ou 'visitor' / 'server'.
--   * organization_id em claro (unidade de análise B2B), sem FK (o coletor nunca falha por integridade).
--   * NUNCA grava IP, User-Agent, URL completa, IDs de registros, corpo ou texto livre.
--   * Só o service role acessa (RLS ligada, sem policy; REVOKE para anon/authenticated).
-- =============================================================================

-- Contas internas/demo ficam fora dos números por padrão (decisão §10.4 do plano).
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id               uuid         NOT NULL DEFAULT gen_random_uuid(),
  created_at       timestamptz  NOT NULL DEFAULT now(),

  user_hash        text         NOT NULL DEFAULT 'visitor',
  organization_id  uuid,
  session_id       text         NOT NULL,
  event            text         NOT NULL,
  area             text,
  platform         text,
  country          char(2),

  traffic          text,
  bot              text,
  bot_purpose      text,

  duration_ms      integer,
  step             smallint,
  attribution      jsonb,

  CONSTRAINT analytics_events_pkey PRIMARY KEY (id),
  CONSTRAINT analytics_events_platform_chk CHECK (platform IS NULL OR platform IN ('ios', 'android', 'web')),
  CONSTRAINT analytics_events_duration_chk CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 3600000),
  CONSTRAINT analytics_events_step_chk CHECK (step IS NULL OR step BETWEEN 0 AND 20)
);

CREATE INDEX IF NOT EXISTS analytics_events_created_event_idx ON public.analytics_events (created_at, event);
CREATE INDEX IF NOT EXISTS analytics_events_session_idx       ON public.analytics_events (session_id);
CREATE INDEX IF NOT EXISTS analytics_events_user_idx          ON public.analytics_events (user_hash, created_at);
CREATE INDEX IF NOT EXISTS analytics_events_org_idx           ON public.analytics_events (organization_id, created_at)
  WHERE organization_id IS NOT NULL;

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_events FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- Fonte única dos eventos de AÇÃO (espelha ACTION_EVENTS em lib/analytics/events.ts)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_action_events()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'service_order_created', 'service_order_updated', 'service_order_cancelled',
    'appointment_created', 'client_created', 'vehicle_created',
    'financial_entry_created', 'financial_entry_paid', 'installment_paid', 'payment_processed',
    'commission_paid', 'bonus_created', 'commission_plan_created',
    'product_created', 'purchase_created', 'purchase_request_created', 'purchase_return_created',
    'catalog_imported', 'nfse_issued', 'fiscal_company_synced',
    'employee_created', 'access_granted', 'role_changed', 'report_exported'
  ]::text[];
$$;

-- -----------------------------------------------------------------------------
-- Eventos do período, sem contas internas (a menos que p_include_internal)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_scope(
  p_from timestamptz,
  p_to timestamptz,
  p_include_internal boolean DEFAULT false
)
RETURNS SETOF public.analytics_events
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.*
  FROM public.analytics_events e
  WHERE e.created_at >= p_from
    AND e.created_at < p_to
    AND (
      p_include_internal
      OR e.organization_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = e.organization_id AND o.is_internal
      )
    );
$$;

-- -----------------------------------------------------------------------------
-- Sessões reconstruídas por session_id (não há tabela de sessões)
--   kind: robô declarado → o próprio tipo; sem conta + sem tempo ativo + sem ação → 'suspect'; senão 'human'
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_sessions(
  p_from timestamptz,
  p_to timestamptz,
  p_include_internal boolean DEFAULT false
)
RETURNS TABLE (
  session_id      text,
  started_at      timestamptz,
  kind            text,
  bot             text,
  bot_purpose     text,
  has_account     boolean,
  user_hash       text,
  organization_id uuid,
  active_ms       bigint,
  has_action      boolean,
  platform        text,
  country         text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    SELECT
      e.session_id,
      min(e.created_at) AS started_at,
      (array_agg(e.traffic) FILTER (WHERE e.traffic IS NOT NULL AND e.traffic <> 'human'))[1] AS bot_kind,
      (array_agg(e.bot) FILTER (WHERE e.bot IS NOT NULL))[1] AS bot,
      (array_agg(e.bot_purpose) FILTER (WHERE e.bot_purpose IS NOT NULL))[1] AS bot_purpose,
      bool_or(e.user_hash NOT IN ('visitor', 'server')) AS has_account,
      (array_agg(e.user_hash) FILTER (WHERE e.user_hash NOT IN ('visitor', 'server')))[1] AS user_hash,
      (array_agg(e.organization_id) FILTER (WHERE e.organization_id IS NOT NULL))[1] AS organization_id,
      sum(e.duration_ms) FILTER (WHERE e.event = 'active_time') AS active_ms,
      bool_or(e.event = ANY (public.analytics_action_events())) AS has_action,
      (array_agg(e.platform) FILTER (WHERE e.platform IS NOT NULL))[1] AS platform,
      (array_agg(e.country) FILTER (WHERE e.country IS NOT NULL))[1]::text AS country
    FROM public.analytics_scope(p_from, p_to, p_include_internal) e
    WHERE e.session_id <> 'server'
    GROUP BY e.session_id
  )
  SELECT
    s.session_id,
    s.started_at,
    CASE
      WHEN s.bot_kind IS NOT NULL THEN s.bot_kind
      WHEN NOT s.has_account AND s.active_ms IS NULL AND NOT s.has_action THEN 'suspect'
      ELSE 'human'
    END AS kind,
    s.bot,
    s.bot_purpose,
    s.has_account,
    s.user_hash,
    s.organization_id,
    s.active_ms,
    s.has_action,
    s.platform,
    s.country
  FROM s;
$$;

-- -----------------------------------------------------------------------------
-- KPIs de uma janela [p_from, p_to)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_kpis(
  p_from timestamptz,
  p_to timestamptz,
  p_include_internal boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ses AS (
    SELECT * FROM public.analytics_sessions(p_from, p_to, p_include_internal)
  ),
  ev AS (
    SELECT * FROM public.analytics_scope(p_from, p_to, p_include_internal)
  )
  SELECT jsonb_build_object(
    'visits_people',        (SELECT count(*) FROM ses WHERE kind = 'human'),
    'visits_bots',          (SELECT count(*) FROM ses WHERE kind NOT IN ('human', 'suspect')),
    'visits_suspect',       (SELECT count(*) FROM ses WHERE kind = 'suspect'),
    'avg_visit_ms',         (SELECT COALESCE(round(avg(active_ms)), 0) FROM ses WHERE kind = 'human' AND active_ms IS NOT NULL),
    'active_orgs',          (SELECT count(DISTINCT organization_id) FROM ev WHERE event = ANY (public.analytics_action_events())),
    'active_users',         (SELECT count(DISTINCT user_hash) FROM ev WHERE user_hash NOT IN ('visitor', 'server')),
    'signups',              (SELECT count(*) FROM ev WHERE event = 'signup_completed'),
    'subscriptions_started',(SELECT count(*) FROM ev WHERE event = 'subscription_started'),
    'orgs_created',         (SELECT count(*) FROM ev WHERE event = 'org_created'),
    'onboarding_completed', (SELECT count(*) FROM ev WHERE event = 'onboarding_completed'),
    'os_orgs',              (SELECT count(DISTINCT organization_id) FROM ev WHERE event = 'service_order_created'),
    'payment_orgs',         (SELECT count(DISTINCT organization_id) FROM ev WHERE event = 'payment_processed'),
    'actions',              (SELECT count(*) FROM ev WHERE event = ANY (public.analytics_action_events()))
  );
$$;

-- -----------------------------------------------------------------------------
-- Resumo: KPIs do período × período anterior, série diária e funil
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_summary(
  p_days int,
  p_include_internal boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH b AS (
    SELECT
      ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - make_interval(days => p_days - 1)) AT TIME ZONE 'America/Sao_Paulo') AS cur_from,
      ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day') AT TIME ZONE 'America/Sao_Paulo') AS cur_to,
      ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - make_interval(days => (2 * p_days) - 1)) AT TIME ZONE 'America/Sao_Paulo') AS prev_from
  ),
  ses AS (
    SELECT s.* FROM b, public.analytics_sessions(b.cur_from, b.cur_to, p_include_internal) s
  ),
  ev AS (
    SELECT e.* FROM b, public.analytics_scope(b.cur_from, b.cur_to, p_include_internal) e
  ),
  days AS (
    SELECT g::date AS dia
    FROM b, generate_series(
      (b.cur_from AT TIME ZONE 'America/Sao_Paulo')::date,
      ((b.cur_to - interval '1 second') AT TIME ZONE 'America/Sao_Paulo')::date,
      interval '1 day'
    ) g
  )
  SELECT jsonb_build_object(
    'days', p_days,
    'current', public.analytics_kpis(b.cur_from, b.cur_to, p_include_internal),
    'previous', public.analytics_kpis(b.prev_from, b.cur_from, p_include_internal),
    'subscriptions_active', (
      SELECT count(*) FROM public.subscriptions s WHERE s.status = 'active' AND s.deleted_at IS NULL
    ),
    'by_day', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day', d.dia,
        'people', (SELECT count(*) FROM ses WHERE ses.kind = 'human' AND (ses.started_at AT TIME ZONE 'America/Sao_Paulo')::date = d.dia),
        'bots', (SELECT count(*) FROM ses WHERE ses.kind NOT IN ('human', 'suspect') AND (ses.started_at AT TIME ZONE 'America/Sao_Paulo')::date = d.dia),
        'signups', (SELECT count(*) FROM ev WHERE ev.event = 'signup_completed' AND (ev.created_at AT TIME ZONE 'America/Sao_Paulo')::date = d.dia),
        'orgs', (SELECT count(DISTINCT ev.organization_id) FROM ev WHERE ev.event = ANY (public.analytics_action_events()) AND (ev.created_at AT TIME ZONE 'America/Sao_Paulo')::date = d.dia),
        'users', (SELECT count(DISTINCT ev.user_hash) FROM ev WHERE ev.user_hash NOT IN ('visitor', 'server') AND (ev.created_at AT TIME ZONE 'America/Sao_Paulo')::date = d.dia)
      ) ORDER BY d.dia), '[]'::jsonb)
      FROM days d
    ),
    'peak_hour', (
      SELECT jsonb_build_object('dow', t.dow, 'hour', t.hr, 'events', t.n)
      FROM (
        SELECT extract(dow FROM ev.created_at AT TIME ZONE 'America/Sao_Paulo')::int AS dow,
               extract(hour FROM ev.created_at AT TIME ZONE 'America/Sao_Paulo')::int AS hr,
               count(*) AS n
        FROM ev
        WHERE ev.event = ANY (public.analytics_action_events())
        GROUP BY 1, 2
        ORDER BY n DESC
        LIMIT 1
      ) t
    )
  )
  FROM b;
$$;

-- -----------------------------------------------------------------------------
-- Aquisição: origens, campanhas (first touch) e países
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_acquisition(
  p_days int,
  p_include_internal boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH b AS (
    SELECT
      ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - make_interval(days => p_days - 1)) AT TIME ZONE 'America/Sao_Paulo') AS f,
      ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day') AT TIME ZONE 'America/Sao_Paulo') AS t
  ),
  ses AS (
    SELECT s.* FROM b, public.analytics_sessions(b.f, b.t, p_include_internal) s
  ),
  ev AS (
    SELECT e.* FROM b, public.analytics_scope(b.f, b.t, p_include_internal) e
  ),
  st AS (
    SELECT DISTINCT ON (e.session_id) e.session_id, e.attribution
    FROM ev e
    WHERE e.event = 'session_start'
    ORDER BY e.session_id, e.created_at
  ),
  people AS (
    SELECT st.session_id,
           COALESCE(st.attribution -> 'last' ->> 'channel', st.attribution -> 'first' ->> 'channel', 'direct') AS channel,
           COALESCE(st.attribution -> 'last' ->> 'ai', st.attribution -> 'first' ->> 'ai') AS ai
    FROM st JOIN ses ON ses.session_id = st.session_id
    WHERE ses.kind = 'human'
  )
  SELECT jsonb_build_object(
    'channels', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('channel', c.channel, 'ai', c.ai, 'visits', c.n) ORDER BY c.n DESC), '[]'::jsonb)
      FROM (SELECT channel, ai, count(*) AS n FROM people GROUP BY channel, ai) c
    ),
    'campaigns', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('campaign', c.campaign, 'source', c.source, 'medium', c.medium, 'visits', c.visits, 'signups', c.signups) ORDER BY c.visits DESC), '[]'::jsonb)
      FROM (
        SELECT
          COALESCE(a.attribution -> 'first' ->> 'utm_campaign', '(sem campanha)') AS campaign,
          a.attribution -> 'first' ->> 'utm_source' AS source,
          a.attribution -> 'first' ->> 'utm_medium' AS medium,
          count(*) FILTER (WHERE a.event = 'session_start') AS visits,
          count(*) FILTER (WHERE a.event = 'signup_completed') AS signups
        FROM ev a
        WHERE a.event IN ('session_start', 'signup_completed')
          AND a.attribution -> 'first' ->> 'utm_campaign' IS NOT NULL
        GROUP BY 1, 2, 3
        ORDER BY visits DESC
        LIMIT 20
      ) c
    ),
    'countries', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'country', c.country, 'people', c.people, 'bots', c.bots, 'with_account', c.with_account
      ) ORDER BY c.people DESC), '[]'::jsonb)
      FROM (
        SELECT COALESCE(country, '??') AS country,
               count(*) FILTER (WHERE kind = 'human') AS people,
               count(*) FILTER (WHERE kind NOT IN ('human', 'suspect')) AS bots,
               count(*) FILTER (WHERE kind = 'human' AND has_account) AS with_account
        FROM ses
        GROUP BY 1
        ORDER BY people DESC
        LIMIT 30
      ) c
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- Engajamento: o que as oficinas fazem, onde ficam, quando usam, plataforma
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_engagement(
  p_days int,
  p_include_internal boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH b AS (
    SELECT
      ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - make_interval(days => p_days - 1)) AT TIME ZONE 'America/Sao_Paulo') AS f,
      ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day') AT TIME ZONE 'America/Sao_Paulo') AS t
  ),
  ses AS (
    SELECT s.* FROM b, public.analytics_sessions(b.f, b.t, p_include_internal) s
  ),
  ev AS (
    SELECT e.* FROM b, public.analytics_scope(b.f, b.t, p_include_internal) e
  ),
  human AS (
    SELECT session_id FROM ses WHERE kind = 'human'
  )
  SELECT jsonb_build_object(
    'actions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('group', g.grp, 'event', g.event, 'count', g.n, 'orgs', g.orgs) ORDER BY g.grp, g.n DESC), '[]'::jsonb)
      FROM (
        SELECT
          CASE
            WHEN event IN ('service_order_created', 'service_order_updated', 'service_order_cancelled', 'appointment_created', 'client_created', 'vehicle_created') THEN 'Operação'
            WHEN event IN ('financial_entry_created', 'financial_entry_paid', 'installment_paid', 'payment_processed', 'commission_paid', 'bonus_created', 'commission_plan_created') THEN 'Financeiro'
            WHEN event IN ('product_created', 'purchase_created', 'purchase_request_created', 'purchase_return_created', 'catalog_imported') THEN 'Estoque e compras'
            WHEN event IN ('nfse_issued', 'fiscal_company_synced') THEN 'Fiscal'
            ELSE 'Gestão'
          END AS grp,
          event,
          count(*) AS n,
          count(DISTINCT organization_id) AS orgs
        FROM ev
        WHERE event = ANY (public.analytics_action_events())
        GROUP BY 1, 2
      ) g
    ),
    'time_by_area', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('area', t.area, 'ms', t.ms) ORDER BY t.ms DESC), '[]'::jsonb)
      FROM (
        SELECT COALESCE(ev.area, 'Outras') AS area, sum(ev.duration_ms) AS ms
        FROM ev JOIN human h ON h.session_id = ev.session_id
        WHERE ev.event = 'active_time'
        GROUP BY 1
      ) t
    ),
    'duration_buckets', (
      SELECT jsonb_build_object(
        'under_2m', count(*) FILTER (WHERE active_ms < 120000),
        'from_2_to_10m', count(*) FILTER (WHERE active_ms >= 120000 AND active_ms <= 600000),
        'over_10m', count(*) FILTER (WHERE active_ms > 600000)
      )
      FROM ses WHERE kind = 'human' AND active_ms IS NOT NULL
    ),
    'heatmap', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('dow', h.dow, 'hour', h.hr, 'visits', h.n)), '[]'::jsonb)
      FROM (
        SELECT extract(dow FROM s.started_at AT TIME ZONE 'America/Sao_Paulo')::int AS dow,
               extract(hour FROM s.started_at AT TIME ZONE 'America/Sao_Paulo')::int AS hr,
               count(*) AS n
        FROM ses s WHERE s.kind = 'human' AND s.has_account
        GROUP BY 1, 2
      ) h
    ),
    'platforms', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('platform', p.platform, 'visits', p.n) ORDER BY p.n DESC), '[]'::jsonb)
      FROM (SELECT COALESCE(platform, 'desconhecida') AS platform, count(*) AS n FROM ses WHERE kind = 'human' GROUP BY 1) p
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- Ativação: coorte de cadastros, 1ª ação, retorno e onboarding
--   Janelas só contam quem teve o prazo INTEIRO ("janela em aberto" no resto).
--   A ação só vale se veio DEPOIS do cadastro.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_funnel(
  p_days int,
  p_include_internal boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH b AS (
    SELECT
      ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - make_interval(days => p_days - 1)) AT TIME ZONE 'America/Sao_Paulo') AS f,
      ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day') AT TIME ZONE 'America/Sao_Paulo') AS t
  ),
  signups AS (
    SELECT e.user_hash, min(e.created_at) AS signup_at
    FROM b, public.analytics_scope(b.f, b.t, p_include_internal) e
    WHERE e.event = 'signup_completed' AND e.user_hash NOT IN ('visitor', 'server')
    GROUP BY e.user_hash
  ),
  actions AS (
    SELECT s.user_hash, a.event, a.created_at, s.signup_at
    FROM signups s
    JOIN public.analytics_events a ON a.user_hash = s.user_hash
    WHERE a.event = ANY (public.analytics_action_events())
      AND a.created_at > s.signup_at
  ),
  first_action AS (
    SELECT DISTINCT ON (user_hash) user_hash, event, created_at, signup_at
    FROM actions
    ORDER BY user_hash, created_at
  ),
  back AS (
    SELECT s.user_hash, s.signup_at,
           (SELECT min(a.created_at) FROM public.analytics_events a
             WHERE a.user_hash = s.user_hash
               AND (a.created_at AT TIME ZONE 'America/Sao_Paulo')::date > (s.signup_at AT TIME ZONE 'America/Sao_Paulo')::date) AS back_at
    FROM signups s
  ),
  steps AS (
    SELECT e.step, e.event, count(DISTINCT e.user_hash) AS n
    FROM b, public.analytics_scope(b.f, b.t, p_include_internal) e
    WHERE e.event IN ('onboarding_step', 'onboarding_skip', 'onboarding_complete') AND e.step IS NOT NULL
    GROUP BY e.step, e.event
  )
  SELECT jsonb_build_object(
    'cohort', (SELECT count(*) FROM signups),
    'activated_24h', (SELECT count(*) FROM first_action WHERE created_at <= signup_at + interval '24 hours'),
    'eligible_24h',  (SELECT count(*) FROM signups WHERE signup_at + interval '24 hours' <= now()),
    'activated_7d',  (SELECT count(*) FROM first_action WHERE created_at <= signup_at + interval '7 days'),
    'eligible_7d',   (SELECT count(*) FROM signups WHERE signup_at + interval '7 days' <= now()),
    'median_hours_to_first_action', (
      SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (created_at - signup_at)) / 3600.0))::numeric, 1)
      FROM first_action
    ),
    'first_actions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('event', x.event, 'users', x.n) ORDER BY x.n DESC), '[]'::jsonb)
      FROM (SELECT event, count(*) AS n FROM first_action GROUP BY event) x
    ),
    'only_explored', (
      SELECT count(*) FROM signups s WHERE NOT EXISTS (SELECT 1 FROM first_action f WHERE f.user_hash = s.user_hash)
    ),
    'returned', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'days', d.n,
        'eligible', (SELECT count(*) FROM signups WHERE signup_at + make_interval(days => d.n) <= now()),
        'returned', (SELECT count(*) FROM back r WHERE r.back_at IS NOT NULL
                       AND r.back_at <= r.signup_at + make_interval(days => d.n)
                       AND r.signup_at + make_interval(days => d.n) <= now())
      ) ORDER BY d.n), '[]'::jsonb)
      FROM (VALUES (1), (3), (7), (14), (30)) AS d(n)
    ),
    'onboarding', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('step', s.step, 'event', s.event, 'users', s.n) ORDER BY s.step, s.event), '[]'::jsonb)
      FROM steps s
    ),
    'weekly', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('week', w.wk, 'size', w.size, 'activated_7d', w.act) ORDER BY w.wk), '[]'::jsonb)
      FROM (
        SELECT (date_trunc('week', s.signup_at AT TIME ZONE 'America/Sao_Paulo'))::date AS wk,
               count(*) AS size,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM first_action f
                 WHERE f.user_hash = s.user_hash AND f.created_at <= s.signup_at + interval '7 days'
               )) AS act
        FROM signups s
        GROUP BY 1
      ) w
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- Saúde das contas (por oficina)
--   ativa: ação nos últimos 7 d · esfriando: 7–14 d · parada: > 14 d
--   nunca ativou: criada há > 7 d sem nenhuma ação · sem dados: criada antes do início da coleta
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_accounts_health(
  p_include_internal boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH since AS (
    SELECT min(created_at) AS first_at FROM public.analytics_events
  ),
  orgs AS (
    SELECT
      o.id,
      o.name,
      o.created_at,
      (SELECT s.plan_name FROM public.subscriptions s
        WHERE s.organization_id = o.id AND s.deleted_at IS NULL
        ORDER BY s.created_at DESC LIMIT 1) AS plan,
      max(e.created_at) FILTER (WHERE e.event = ANY (public.analytics_action_events())) AS last_action,
      count(*) FILTER (WHERE e.event = ANY (public.analytics_action_events()) AND e.created_at >= now() - interval '7 days') AS actions_7d,
      count(*) FILTER (WHERE e.event = 'service_order_created' AND e.created_at >= now() - interval '7 days') AS os_7d,
      count(DISTINCT e.user_hash) FILTER (WHERE e.user_hash NOT IN ('visitor', 'server') AND e.created_at >= now() - interval '7 days') AS users_7d
    FROM public.organizations o
    LEFT JOIN public.analytics_events e ON e.organization_id = o.id
    WHERE o.deleted_at IS NULL
      AND o.is_active
      AND (p_include_internal OR NOT o.is_internal)
    GROUP BY o.id, o.name, o.created_at
  ),
  classified AS (
    SELECT
      orgs.*,
      CASE
        WHEN orgs.last_action IS NULL AND orgs.created_at < (SELECT first_at FROM since) THEN 'no_data'
        WHEN orgs.last_action IS NULL AND orgs.created_at < now() - interval '7 days' THEN 'never'
        WHEN orgs.last_action IS NULL THEN 'new'
        WHEN orgs.last_action >= now() - interval '7 days' THEN 'active'
        WHEN orgs.last_action >= now() - interval '14 days' THEN 'cooling'
        ELSE 'stopped'
      END AS status
    FROM orgs
  )
  SELECT jsonb_build_object(
    'tracking_since', (SELECT first_at FROM since),
    'organizations', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'plan', c.plan,
        'created_at', c.created_at,
        'last_action', c.last_action,
        'days_since_action', CASE WHEN c.last_action IS NULL THEN NULL ELSE floor(extract(epoch FROM (now() - c.last_action)) / 86400)::int END,
        'actions_7d', c.actions_7d,
        'os_7d', c.os_7d,
        'users_7d', c.users_7d,
        'status', c.status
      ) ORDER BY
        CASE c.status WHEN 'cooling' THEN 1 WHEN 'stopped' THEN 2 WHEN 'never' THEN 3 WHEN 'new' THEN 4 WHEN 'active' THEN 5 ELSE 6 END,
        c.last_action NULLS FIRST), '[]'::jsonb)
      FROM (SELECT * FROM classified ORDER BY created_at DESC LIMIT 300) c
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- Qualidade: pessoas × robôs, quais robôs, cobertura dos campos
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_traffic(
  p_days int,
  p_include_internal boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH b AS (
    SELECT
      ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - make_interval(days => p_days - 1)) AT TIME ZONE 'America/Sao_Paulo') AS f,
      ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day') AT TIME ZONE 'America/Sao_Paulo') AS t
  ),
  ses AS (
    SELECT s.* FROM b, public.analytics_sessions(b.f, b.t, p_include_internal) s
  ),
  ev AS (
    SELECT e.* FROM b, public.analytics_scope(b.f, b.t, p_include_internal) e
  )
  SELECT jsonb_build_object(
    'split', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', k.kind, 'visits', k.n) ORDER BY k.n DESC), '[]'::jsonb)
      FROM (SELECT kind, count(*) AS n FROM ses GROUP BY kind) k
    ),
    'bots', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'bot', x.bot, 'kind', x.kind, 'purpose', x.bot_purpose, 'visits', x.visits, 'areas', x.areas
      ) ORDER BY x.visits DESC), '[]'::jsonb)
      FROM (
        SELECT
          COALESCE(s.bot, '(não identificado)') AS bot,
          s.kind,
          s.bot_purpose,
          count(*) AS visits,
          (SELECT COALESCE(jsonb_agg(DISTINCT e.area), '[]'::jsonb)
             FROM ev e WHERE e.session_id = ANY (array_agg(s.session_id)) AND e.area IS NOT NULL) AS areas
        FROM ses s
        WHERE s.kind NOT IN ('human', 'suspect')
        GROUP BY 1, 2, 3
        ORDER BY visits DESC
        LIMIT 30
      ) x
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.analytics_coverage()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_events', count(*),
    'oldest', min(created_at),
    'retention_days', 365,
    'pct_traffic', COALESCE(round(100.0 * count(*) FILTER (WHERE traffic IS NOT NULL) / NULLIF(count(*) FILTER (WHERE user_hash <> 'server'), 0), 1), 0),
    'pct_platform', COALESCE(round(100.0 * count(*) FILTER (WHERE platform IS NOT NULL) / NULLIF(count(*) FILTER (WHERE user_hash <> 'server'), 0), 1), 0),
    'pct_country', COALESCE(round(100.0 * count(*) FILTER (WHERE country IS NOT NULL) / NULLIF(count(*) FILTER (WHERE user_hash <> 'server'), 0), 1), 0),
    'pct_attribution', COALESCE(round(100.0 * count(*) FILTER (WHERE event = 'session_start' AND attribution IS NOT NULL) / NULLIF(count(*) FILTER (WHERE event = 'session_start'), 0), 1), 0)
  )
  FROM public.analytics_events;
$$;

-- -----------------------------------------------------------------------------
-- Retenção: 365 dias, em lotes de 10 000 (agendada com pg_cron quando a extensão existir)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_purge(p_days int DEFAULT 365)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer := 0;
  v_batch integer;
  v_loops integer := 0;
BEGIN
  LOOP
    DELETE FROM public.analytics_events
    WHERE id IN (
      SELECT id FROM public.analytics_events
      WHERE created_at < now() - make_interval(days => p_days)
      LIMIT 10000
    );
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_total := v_total + v_batch;
    v_loops := v_loops + 1;
    EXIT WHEN v_batch = 0 OR v_loops >= 20;
  END LOOP;
  RETURN v_total;
END;
$$;

-- -----------------------------------------------------------------------------
-- Permissões: só o service role executa
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.analytics_scope(timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_sessions(timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_kpis(timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_summary(int, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_acquisition(int, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_engagement(int, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_funnel(int, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_accounts_health(boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_traffic(int, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_coverage() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_purge(int) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.analytics_scope(timestamptz, timestamptz, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_sessions(timestamptz, timestamptz, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_kpis(timestamptz, timestamptz, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_summary(int, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_acquisition(int, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_engagement(int, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_funnel(int, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_accounts_health(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_traffic(int, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_coverage() TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_purge(int) TO service_role;

-- Agenda a limpeza diária quando pg_cron estiver disponível (senão, rode analytics_purge() manualmente).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('analytics-purge', '30 6 * * *', 'SELECT public.analytics_purge()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponível; agende public.analytics_purge() manualmente (%).', SQLERRM;
END;
$$;
