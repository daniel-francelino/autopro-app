-- =============================================================================
-- Migration: 20240101000100_seed_roles_and_fiscal_manage_actions
-- Description:
--   Passa a exigir permissão no servidor para administrar papéis e usuários
--   (roles/*, users/update-role, users/update-fields) e para sincronizar a
--   empresa fiscal (fiscal/company/sync). Os códigos usados nessas checagens
--   (roles.*, fiscal.manage) existiam no front (app/constants/action-codes.ts)
--   mas nunca foram semeados em public.actions; sem isto, só admin/owner
--   (que ignoram role_actions) conseguiriam passar, e nenhum papel
--   personalizado poderia receber essas permissões na tela de Perfis.
--
--   Admin/owner continuam ignorando role_actions (server/utils/require-org-permission.ts).
--   INSERT … ON CONFLICT DO NOTHING: reexecutar é seguro.
-- =============================================================================

INSERT INTO public.actions (code, name, resource, action_type, description, created_by)
VALUES
  ('roles.view',               'Visualizar perfis',            'roles', 'read',   'Permite visualizar os perfis de acesso e suas permissões.',        'migration'),
  ('roles.create',             'Criar perfis',                 'roles', 'create', 'Permite criar novos perfis de acesso.',                            'migration'),
  ('roles.update',             'Editar perfis',                'roles', 'update', 'Permite editar perfis de acesso existentes.',                      'migration'),
  ('roles.delete',             'Excluir perfis',               'roles', 'delete', 'Permite excluir perfis de acesso.',                                'migration'),
  ('roles.manage_permissions', 'Gerenciar permissões',         'roles', 'manage', 'Permite conceder e revogar permissões de um perfil.',              'migration'),
  ('roles.manage_members',     'Gerenciar membros dos perfis', 'roles', 'manage', 'Permite trocar o perfil de acesso de um usuário da oficina.',      'migration'),
  ('fiscal.manage',            'Gerenciar dados fiscais',      'fiscal', 'manage', 'Permite cadastrar e sincronizar a empresa na integração fiscal.', 'migration')
ON CONFLICT (code) DO NOTHING;
