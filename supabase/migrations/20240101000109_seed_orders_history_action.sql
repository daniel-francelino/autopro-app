-- =============================================================================
-- Migration: 20240101000109_seed_orders_history_action
-- Description:
--   Adds the 'orders.history' action ("Ver histórico da OS") to the global
--   actions catalogue. Dedicated permission to read the service order history
--   (docs/architecture/os-history-timeline.md, section 11.2).
--
--   - It grants nothing to any role (no backfill): only the owner and the
--     admin system role pass, through the requireOrgPermission bypass. Whoever
--     manages roles grants the code explicitly.
--   - Idempotent: INSERT ... ON CONFLICT (code) DO NOTHING.
-- =============================================================================

INSERT INTO public.actions (code, name, resource, action_type, description, created_by)
VALUES
  ('orders.history', 'Ver histórico da OS', 'orders', 'read', 'Permite ver o histórico (linha do tempo) da ordem de serviço.', 'migration')
ON CONFLICT (code) DO NOTHING;
