-- =============================================================================
-- Migration: 20240101000096_set_initial_service_order_number_default_to_4000.sql
-- Description: New organizations should start OS numbering at 4000 (the
--              "showcase number" behavior the old hardcoded
--              DEFAULT_START_OS_NUMBER used to provide in application code)
--              instead of the column's original default of 1. Only affects
--              organizations created from now on — existing rows keep
--              whatever value they already have. See
--              docs/service-orders/next-number-rpc-fix.md §3.1.
-- =============================================================================

ALTER TABLE public.organizations
    ALTER COLUMN initial_service_order_number SET DEFAULT 4000;

COMMENT ON COLUMN public.organizations.initial_service_order_number IS
    'Sequence seed for service order numbering within this organization. Defaults to 4000 for new organizations (see next_service_order_number(), migration 20240101000095); existing organizations keep their current value.';
