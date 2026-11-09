-- =============================================================================
-- Migration: 20240101000103_create_geo_probe_runs
-- Description:
--   Bateria semanal de perguntas às IAs (docs/seo/geo-audit-brasil.md §10.4), cadastrada à mão pelo owner
--   em /admin/geo. Uma linha por (data, pergunta, motor, com/sem busca).
-- =============================================================================

CREATE TABLE public.geo_probe_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date        date        NOT NULL,
  question_id     smallint    NOT NULL CHECK (question_id BETWEEN 1 AND 20),
  question_text   text        NOT NULL,
  engine          text        NOT NULL
                  CHECK (engine IN ('chatgpt', 'gemini', 'google_ai_mode', 'claude', 'perplexity', 'copilot', 'meta_ai')),
  model_label     text,
  search_enabled  boolean     NOT NULL,
  brand_mentioned boolean     NOT NULL,
  brand_linked    boolean     NOT NULL,
  recommended     boolean     NOT NULL,
  price_correct   boolean,
  fiscal_correct  boolean,
  competitors     text[],
  cited_urls      text[],
  evidence_url    text,
  notes           text,
  created_by      varchar(200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_date, question_id, engine, search_enabled)
);

ALTER TABLE public.geo_probe_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.geo_probe_runs FROM anon, authenticated;

CREATE INDEX idx_geo_probe_runs_date ON public.geo_probe_runs (run_date DESC);
