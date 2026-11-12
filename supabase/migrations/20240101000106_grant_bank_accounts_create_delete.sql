-- =============================================================================
-- Migration: 20240101000106_grant_bank_accounts_create_delete
-- Description:
--   Rule R2 of the access-control rollout plan (Phase 2, decision D3): the code
--   bank_accounts.update was split into create/update/delete, so every role
--   that has bank_accounts.update granted (role_actions not soft-deleted) and
--   is itself not soft-deleted (roles.deleted_at IS NULL) receives
--   bank_accounts.create and bank_accounts.delete.
--
--   Runs after 20240101000104 (seeds create/delete) and 20240101000105 (seeds
--   bank_accounts.update in a new environment).
--
--   - Only these two codes are granted, only to roles that already hold
--     bank_accounts.update with is_granted = true and deleted_at IS NULL.
--   - Marker: role_actions.created_by = 'migration-104'. Rollback:
--       DELETE FROM public.role_actions WHERE created_by = 'migration-104';
--   - ON CONFLICT (role_id, action_id) DO NOTHING: existing rows are never
--     touched and re-running does not duplicate.
-- =============================================================================

INSERT INTO public.role_actions (role_id, action_id, is_granted, created_by)
SELECT ra.role_id, new_action.id, true, 'migration-104'
FROM public.role_actions ra
JOIN public.actions upd
  ON upd.id = ra.action_id
 AND upd.code = 'bank_accounts.update'
JOIN public.roles r
  ON r.id = ra.role_id
 AND r.deleted_at IS NULL
JOIN public.actions new_action
  ON new_action.code IN ('bank_accounts.create', 'bank_accounts.delete')
WHERE ra.is_granted = true
  AND ra.deleted_at IS NULL
ON CONFLICT (role_id, action_id) DO NOTHING;
