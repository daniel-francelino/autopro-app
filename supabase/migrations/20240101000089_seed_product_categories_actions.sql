-- =============================================================================
-- Migration: 20240101000089_seed_product_categories_actions
-- Description:
--   Seeds the product categories permission actions (product_categories.*)
--   into the global actions catalogue. Until now, Produtos > Categorias
--   (app/pages/app/products/categories.vue) was gated by the products.*
--   actions, so it couldn't be granted/restricted independently from the
--   Products screen in the Roles settings screen. These actions give it its
--   own tab, same as every other resource (e.g. commissions.*, seeded by
--   20240101000086).
--
--   Admin/owner roles bypass role_actions entirely (see
--   server/utils/require-org-permission.ts). Other roles must be granted
--   these actions via the Roles settings screen.
--
--   Uses INSERT … ON CONFLICT DO NOTHING so re-running the migration is safe.
-- =============================================================================

INSERT INTO public.actions (code, name, resource, action_type, description, created_by)
VALUES
  ('product_categories.read',   'Visualizar categorias de produtos', 'product_categories', 'read',   'Permite visualizar as categorias de produtos.', 'migration'),
  ('product_categories.create', 'Criar categorias de produtos',      'product_categories', 'create', 'Permite criar novas categorias de produtos.',    'migration'),
  ('product_categories.update', 'Editar categorias de produtos',     'product_categories', 'update', 'Permite editar categorias de produtos existentes.', 'migration'),
  ('product_categories.delete', 'Excluir categorias de produtos',    'product_categories', 'delete', 'Permite excluir categorias de produtos.',        'migration')
ON CONFLICT (code) DO NOTHING;
