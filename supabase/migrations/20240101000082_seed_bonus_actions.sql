-- =============================================================================
-- Migration: 20240101000082_seed_bonus_actions
-- Description:
--   Seeds the bonus permission actions (bonuses.*) into the global actions
--   catalogue. These actions gate the goal-based employee bonus feature
--   (see docs/employee-bonus-feature-design.md) both in the UI
--   (workshop.can(...)) and server-side (requireOrgPermission(...)).
--
--   Admin/owner roles bypass role_actions entirely (see
--   server/utils/require-org-permission.ts), and 20240101000080 additionally
--   grants every action to the admin role explicitly. Other roles must be
--   granted these actions via the Roles settings screen, same as every other
--   resource.
--
--   Uses INSERT … ON CONFLICT DO NOTHING so re-running the migration is safe.
-- =============================================================================

INSERT INTO public.actions (code, name, resource, action_type, description, created_by)
VALUES
  ('bonuses.read',   'Visualizar bônus', 'bonuses', 'read',   'Permite visualizar bônus, seu progresso e histórico de valores.', 'migration'),
  ('bonuses.create', 'Criar bônus',      'bonuses', 'create', 'Permite criar novos bônus.',                                       'migration'),
  ('bonuses.update', 'Editar bônus',     'bonuses', 'update', 'Permite editar bônus, alterar valores, atribuir/remover funcionários e gerar registros do mês.', 'migration'),
  ('bonuses.delete', 'Excluir bônus',    'bonuses', 'delete', 'Permite excluir bônus.',                                           'migration')
ON CONFLICT (code) DO NOTHING;
