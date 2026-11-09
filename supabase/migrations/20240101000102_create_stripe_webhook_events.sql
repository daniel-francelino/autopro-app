-- =============================================================================
-- Migration: 20240101000102_create_stripe_webhook_events
-- Description:
--   Registro dos eventos recebidos do Stripe. Dá IDEMPOTÊNCIA ao webhook (reentrega do mesmo
--   evt_... vira no-op) e visibilidade de falhas em /admin/billing.
--   Só o service role acessa (RLS ligado, sem policies).
-- =============================================================================

CREATE TABLE public.stripe_webhook_events (
  id               text        PRIMARY KEY,
  type             text        NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  status           text        NOT NULL DEFAULT 'received'
                   CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  error_message    text,
  organization_id  uuid,
  payload          jsonb       NOT NULL
);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_webhook_events FROM anon, authenticated;

CREATE INDEX idx_stripe_webhook_events_received ON public.stripe_webhook_events (received_at DESC);
CREATE INDEX idx_stripe_webhook_events_failed   ON public.stripe_webhook_events (received_at DESC) WHERE status = 'failed';
