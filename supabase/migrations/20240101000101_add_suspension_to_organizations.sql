-- =============================================================================
-- Migration: 20240101000101_add_suspension_to_organizations
-- Description:
--   Suspensão de oficina pelo owner da plataforma (painel /admin, ficha da oficina).
--   Colunas PRÓPRIAS: `organizations.is_active` é sobrescrito pelo webhook do Stripe a
--   cada evento de assinatura e não serve para bloqueio manual.
--   Enforçado no servidor em resolveOrganizationId / requireOrgPermission (403 "Oficina suspensa").
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS suspended_at     timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text,
  ADD COLUMN IF NOT EXISTS suspended_by     varchar(200);

COMMENT ON COLUMN public.organizations.suspended_at     IS 'Preenchido quando o owner da plataforma suspende a oficina; a API responde 403 a todos os usuários dela.';
COMMENT ON COLUMN public.organizations.suspended_reason IS 'Motivo informado pelo owner ao suspender.';
COMMENT ON COLUMN public.organizations.suspended_by     IS 'E-mail do owner que suspendeu.';

CREATE INDEX IF NOT EXISTS idx_organizations_suspended ON public.organizations (suspended_at) WHERE suspended_at IS NOT NULL;
