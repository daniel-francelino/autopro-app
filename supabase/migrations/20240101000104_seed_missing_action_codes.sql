-- =============================================================================
-- Migration: 20240101000104_seed_missing_action_codes
-- Description:
--   Seeds into the global actions catalogue the two bank account permission
--   codes that the ActionCode enum (app/constants/action-codes.ts) uses and
--   that no migration or production row provides:
--     bank_accounts.create, bank_accounts.delete
--   (access-control rollout plan, Phase 2, decisions D3 and D6).
--
--   This migration does NOT grant anything to any role. The grant of these two
--   codes (rule R2: whoever has bank_accounts.update receives them) is done in
--   20240101000106_grant_bank_accounts_create_delete.sql, which must run after
--   20240101000105 seeds bank_accounts.update in a new environment.
--
--   Uses INSERT ... ON CONFLICT (code) DO NOTHING, so existing rows are never
--   changed and re-running is safe.
-- =============================================================================

INSERT INTO public.actions (code, name, resource, action_type, description, created_by)
VALUES
  ('bank_accounts.create', 'Criar contas bancárias',   'bank_accounts', 'create', 'Permite criar contas bancárias.',   'migration'),
  ('bank_accounts.delete', 'Excluir contas bancárias', 'bank_accounts', 'delete', 'Permite excluir contas bancárias.', 'migration')
ON CONFLICT (code) DO NOTHING;
