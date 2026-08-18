-- =============================================================================
-- Migration: 20240101000086_seed_commission_actions
-- Description:
--   Seeds the commission permission actions (commissions.*) into the global
--   actions catalogue. These actions gate the new Financeiro > Comissões
--   feature (see docs/finance/commissions-configuration-architecture.md) both
--   in the UI (workshop.can(...)) and server-side (requireOrgPermission(...)).
--
--   Admin/owner roles bypass role_actions entirely (see
--   server/utils/require-org-permission.ts). Other roles must be granted
--   these actions via the Roles settings screen, same as every other
--   resource (e.g. bonuses.*, seeded by 20240101000082).
--
--   Uses INSERT … ON CONFLICT DO NOTHING so re-running the migration is safe.
-- =============================================================================

INSERT INTO public.actions (code, name, resource, action_type, description, created_by)
VALUES
  ('commissions.read',   'Visualizar comissões', 'commissions', 'read',   'Permite visualizar configurações de comissão, regras, versões e funcionários atribuídos.', 'migration'),
  ('commissions.create', 'Criar comissões',      'commissions', 'create', 'Permite criar novas configurações de comissão.',                                              'migration'),
  ('commissions.update', 'Editar comissões',     'commissions', 'update', 'Permite editar configurações de comissão, criar novas versões de regras e atribuir/remover funcionários.', 'migration'),
  ('commissions.delete', 'Excluir comissões',    'commissions', 'delete', 'Permite excluir configurações de comissão.',                                                  'migration')
ON CONFLICT (code) DO NOTHING;
