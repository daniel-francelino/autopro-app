-- =============================================================================
-- Migration: 20240101000104_seed_missing_action_codes
-- Description:
--   Seeds into the global actions catalogue the permission codes that exist in
--   app/constants/action-codes.ts (ActionCode enum, the reference) but were not
--   seeded by any previous migration:
--     bank_accounts.create, bank_accounts.read, bank_accounts.delete,
--     inventory.adjust, members.remove, orders.finish, purchases.authorize
--
--   This migration does NOT grant any action to any role:
--     - Owner and admin system roles bypass role_actions (see
--       server/utils/require-org-permission.ts).
--     - New organizations receive every action in the catalogue through the
--       Stripe webhook at signup, so they get these automatically.
--     - Existing custom roles keep their current grants; granting them is a
--       product decision, done through the Roles settings screen.
--
--   Uses INSERT ... ON CONFLICT (code) DO NOTHING, so existing rows (including
--   any already present in production) are never changed and re-running is safe.
-- =============================================================================

INSERT INTO public.actions (code, name, resource, action_type, description, created_by)
VALUES
  ('bank_accounts.create', 'Criar contas bancárias',   'bank_accounts', 'create', 'Permite criar contas bancárias.',                  'migration'),
  ('bank_accounts.read',   'Visualizar contas bancárias', 'bank_accounts', 'read',   'Permite visualizar contas bancárias.',                'migration'),
  ('bank_accounts.delete', 'Excluir contas bancárias', 'bank_accounts', 'delete', 'Permite excluir contas bancárias.',                  'migration'),
  ('inventory.adjust',     'Ajustar estoque',          'inventory',     'update', 'Permite ajustar o saldo de estoque.',              'migration'),
  ('members.remove',       'Remover membros',          'members',       'delete', 'Permite remover membros da organização.',          'migration'),
  ('orders.finish',        'Finalizar ordens',         'orders',        'update', 'Permite finalizar ordens de serviço.',             'migration'),
  ('purchases.authorize',  'Autorizar compras',        'purchases',     'update', 'Permite autorizar solicitações de compra.',        'migration')
ON CONFLICT (code) DO NOTHING;
