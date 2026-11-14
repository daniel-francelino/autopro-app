-- =============================================================================
-- Migration: 20240101000108_create_service_order_events
-- Description:
--   Histórico detalhado da OS (fatia F0). Um evento = um fato de negócio, gravado
--   explicitamente pelo servidor. Append-only. Desenho: docs/architecture/os-history-timeline.md
--   (seções 4 e 5). NÃO é fonte de verdade financeira: nenhum saldo/status é lido daqui.
--
--   Sem FK de propósito (mesmo padrão de audit_logs): o evento precisa sobreviver a
--   exclusões e o trigger append-only bloquearia um ON DELETE CASCADE.
--   RLS ligado SEM policy: só o service role lê/grava, e o filtro de tenant e de
--   visibilidade (general/financial/commission) é aplicado pela API. Uma policy
--   por organização deixaria qualquer usuário autenticado ler eventos financeiros
--   direto pelo PostgREST, ignorando a visibilidade.
-- =============================================================================

CREATE TABLE public.service_order_events (
  id                uuid         NOT NULL DEFAULT gen_random_uuid(),
  seq               bigint       GENERATED ALWAYS AS IDENTITY,

  organization_id   uuid         NOT NULL,
  service_order_id  uuid         NOT NULL,
  occurred_at       timestamptz  NOT NULL DEFAULT now(),

  event_type        varchar(60)  NOT NULL,
  schema_version    smallint     NOT NULL DEFAULT 1,
  category          varchar(20)  NOT NULL
                    CHECK (category IN ('order', 'items', 'status', 'payment', 'commission', 'fiscal')),
  visibility        varchar(20)  NOT NULL
                    CHECK (visibility IN ('general', 'financial', 'commission')),

  -- Ator (quem)
  actor_type        varchar(20)  NOT NULL DEFAULT 'user'
                    CHECK (actor_type IN ('user', 'system', 'job', 'owner')),
  actor_user_id     uuid,
  actor_name        varchar(200),

  entity_type       varchar(40),
  entity_id         uuid,

  -- Valores já legíveis (snapshot), formatados só na leitura
  payload           jsonb        NOT NULL DEFAULT '{}'::jsonb,

  -- request_id da requisição (liga ao audit_logs)
  correlation_id    uuid         NOT NULL,

  -- Origem (de qual tela), separada do ator. Catálogo validado no servidor.
  source_code       varchar(40)  NOT NULL,
  source_label      varchar(120) NOT NULL,
  source_declared   varchar(40),
  source_trust      varchar(10)  NOT NULL
                    CHECK (source_trust IN ('inferred', 'declared', 'mismatch')),

  idempotency_key   varchar(200),
  origin            varchar(20)  NOT NULL DEFAULT 'live'
                    CHECK (origin IN ('live', 'backfill')),

  CONSTRAINT service_order_events_pkey PRIMARY KEY (id),
  CONSTRAINT service_order_events_idempotency_unique UNIQUE (organization_id, idempotency_key)
);

COMMENT ON TABLE public.service_order_events IS 'Histórico de eventos da OS (append-only). Registro, nunca fonte de verdade financeira.';

CREATE INDEX idx_so_events_order_time
  ON public.service_order_events (organization_id, service_order_id, occurred_at DESC, seq DESC);
CREATE INDEX idx_so_events_type_time
  ON public.service_order_events (organization_id, event_type, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.service_order_events_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'service_order_events é append-only (% bloqueado)', TG_OP;
END $$;

CREATE TRIGGER trg_service_order_events_append_only
  BEFORE UPDATE OR DELETE ON public.service_order_events
  FOR EACH ROW EXECUTE FUNCTION public.service_order_events_block_mutation();

ALTER TABLE public.service_order_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_order_events FROM anon, authenticated;
REVOKE TRUNCATE ON public.service_order_events FROM service_role;
