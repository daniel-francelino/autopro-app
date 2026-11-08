-- =============================================================================
-- Migration: 20240101000087_grant_commission_actions_to_admin_roles
-- Description:
--   Backfills the commissions.* actions (seeded by 20240101000086) into
--   role_actions for every organization's existing admin role.
--
--   New organizations get this for free: the Stripe webhook
--   (server/api/stripe/webhook.post.ts) grants every row currently in
--   `actions` to a freshly-created admin role at signup time. Organizations
--   that already existed before commissions.* was seeded never got that
--   grant, so their admin role's row in the Roles settings screen would show
--   Comissões as ungranted even though requireOrgPermission() and
--   useWorkshopPermissions().can() both already bypass the role gate entirely
--   for is_system_role admin roles — this migration is about UI/data
--   consistency (and defense in depth), not about unblocking access that was
--   actually broken.
--
--   Uses INSERT … ON CONFLICT DO NOTHING (role_actions has a unique
--   (role_id, action_id) constraint) so re-running the migration is safe.
-- =============================================================================

INSERT INTO public.role_actions (role_id, action_id, is_granted, created_by)
SELECT r.id, a.id, true, 'migration'
FROM public.roles r
CROSS JOIN public.actions a
WHERE r.name = 'admin'
  AND r.is_system_role = true
  AND r.deleted_at IS NULL
  AND a.code IN ('commissions.read', 'commissions.create', 'commissions.update', 'commissions.delete')
  AND a.deleted_at IS NULL
ON CONFLICT (role_id, action_id) DO NOTHING;
