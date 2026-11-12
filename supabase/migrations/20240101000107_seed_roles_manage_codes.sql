-- =============================================================================
-- Migration: 20240101000107_seed_roles_manage_codes
-- Description:
--   Additive seed of roles.manage_permissions and roles.manage_members.
--   The server already requires them (roles/* and users/update-role) but they do
--   not exist in the production catalogue, so only admin/owner (which bypass
--   role_actions) can pass. Seeding them makes them assignable in the Roles
--   screen; access is unchanged.
--
--   Grants NOTHING to any role (granting is a Phase 8 decision, Q14).
--   Separate from 20240101000105 so that migration mirrors production exactly.
--   In environments where 20240101000100 already created them, this is a no-op.
-- =============================================================================

INSERT INTO public.actions (code, name, resource, action_type, description, created_by)
VALUES
  ('roles.manage_permissions', 'Gerenciar permissões',         'roles', 'manage', 'Permite conceder e revogar permissões de um perfil.',          'migration'),
  ('roles.manage_members',     'Gerenciar membros dos perfis', 'roles', 'manage', 'Permite trocar o perfil de acesso de um usuário da oficina.', 'migration')
ON CONFLICT (code) DO NOTHING;
