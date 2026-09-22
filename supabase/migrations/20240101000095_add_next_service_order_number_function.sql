-- =============================================================================
-- Migration: 20240101000095_add_next_service_order_number_function.sql
-- Description: Computes the next service order number entirely inside
--              Postgres (single scalar RPC) instead of fetching every
--              service_orders.number row to the app to compute a max in JS.
--              Also respects organizations.initial_service_order_number as
--              a floor. See docs/service-orders/next-number-rpc-fix.md.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.next_service_order_number(p_organization_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT 'OS' || GREATEST(
    (SELECT initial_service_order_number FROM public.organizations WHERE id = p_organization_id),
    COALESCE(
      (SELECT MAX((regexp_match(number, '^OS([0-9]+)$', 'i'))[1]::integer)
       FROM public.service_orders
       WHERE organization_id = p_organization_id
         AND deleted_at IS NULL),
      0
    ) + 1
  );
$$;

COMMENT ON FUNCTION public.next_service_order_number(uuid) IS
  'Calcula o próximo número de OS (formato OS<n>) para uma organização, direto no banco — evita trazer todas as linhas de service_orders.number para o app só para achar o maior número, e respeita organizations.initial_service_order_number como piso mínimo (ver docs/service-orders/next-number-rpc-fix.md).';

GRANT EXECUTE ON FUNCTION public.next_service_order_number(uuid) TO authenticated;
