-- Auditoria: uma linha por requisição relevante em /api/** (quem, o quê, quando, resultado).
-- Plano: docs/audit/audit-log-plan.md. Particionada por mês, append-only, lida só pelo service role.

CREATE TABLE public.audit_logs (
  id                  uuid         NOT NULL DEFAULT gen_random_uuid(),
  created_at          timestamptz  NOT NULL DEFAULT now(),

  -- Correlação
  request_id          uuid         NOT NULL,
  organization_id     uuid,

  -- Quem
  actor_user_id       uuid,
  actor_email         varchar(200),
  actor_role          varchar(100),
  actor_type          varchar(20)  NOT NULL DEFAULT 'user'
                      CHECK (actor_type IN ('user', 'owner', 'system', 'webhook', 'anonymous')),

  -- O quê
  action              varchar(100) NOT NULL,
  resource_type       varchar(60),
  resource_id         varchar(100),
  http_method         varchar(10)  NOT NULL,
  http_path           varchar(300) NOT NULL,
  route_pattern       varchar(300),

  -- Resultado
  status_code         smallint     NOT NULL,
  outcome             varchar(10)  NOT NULL CHECK (outcome IN ('success', 'denied', 'invalid', 'error')),
  error_message       text,
  duration_ms         integer,

  -- Conteúdo
  query_params        jsonb,
  request_body        jsonb,
  body_truncated      boolean      NOT NULL DEFAULT false,
  response_body       jsonb,
  response_truncated  boolean      NOT NULL DEFAULT false,
  response_size_bytes integer,
  changes             jsonb,

  -- Origem
  ip_address          inet,
  user_agent          varchar(400),
  platform            varchar(10),

  CONSTRAINT audit_logs_pkey PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

COMMENT ON TABLE public.audit_logs IS 'Log de auditoria de requisições da API. Append-only, retenção de 6 meses por partição mensal.';

CREATE INDEX idx_audit_org_created   ON public.audit_logs (organization_id, created_at DESC);
CREATE INDEX idx_audit_actor_created ON public.audit_logs (actor_user_id, created_at DESC);
CREATE INDEX idx_audit_email_created ON public.audit_logs (lower(actor_email), created_at DESC);
CREATE INDEX idx_audit_resource      ON public.audit_logs (resource_type, resource_id, created_at DESC);
CREATE INDEX idx_audit_failures      ON public.audit_logs (created_at DESC) WHERE outcome <> 'success';
CREATE INDEX idx_audit_request       ON public.audit_logs (request_id);
CREATE INDEX idx_audit_action        ON public.audit_logs (action, created_at DESC);

-- Append-only: vale também para o service role. O descarte por retenção é DROP de partição.
CREATE OR REPLACE FUNCTION public.audit_logs_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs é append-only (% bloqueado)', TG_OP;
END $$;

CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_block_mutation();

-- Só o service role lê/grava (o front nunca acessa o Supabase direto): RLS ligado e nenhuma policy.
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_logs FROM anon, authenticated;
REVOKE TRUNCATE ON public.audit_logs FROM service_role;

-- Cria a partição do mês (idempotente), já trancada para anon/authenticated.
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

-- Mantém o mês atual + N meses à frente e descarta partições além da retenção.
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
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'audit_logs'
      AND c.relname ~ '^audit_logs_y\d{4}m\d{2}$'
      AND to_date(regexp_replace(c.relname, '^audit_logs_y(\d{4})m(\d{2})$', '\1\2'), 'YYYYMM') < v_cutoff
  LOOP
    EXECUTE format('DROP TABLE public.%I', r.relname);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.audit_logs_create_partition(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_logs_maintain(int, int) FROM PUBLIC, anon, authenticated;

-- Partição padrão: rede de segurança se a manutenção falhar. Deve ficar vazia.
CREATE TABLE public.audit_logs_default PARTITION OF public.audit_logs DEFAULT;
ALTER TABLE public.audit_logs_default ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_logs_default FROM anon, authenticated;

SELECT public.audit_logs_maintain(2, 6);

-- Agendamento diário, se a extensão pg_cron estiver habilitada (Supabase → Database → Extensions).
-- Sem ela, a migration continua e a manutenção deve ser acionada por outro agendador
-- (SELECT public.audit_logs_maintain(2, 6)) antes do fim de cada mês.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('audit-logs-maintain', '15 3 * * *', 'SELECT public.audit_logs_maintain(2, 6)');
  ELSE
    RAISE NOTICE 'pg_cron não habilitado: agende public.audit_logs_maintain(2, 6) manualmente.';
  END IF;
END $$;
