-- =============================================================================
-- Migration: 20240101000110_add_commission_release_mode_to_organizations
-- Description: Organization-level setting for how employee commission is
--              released: 'full' (default; released in full when the payment
--              plan is generated) or 'proportional' (released proportionally
--              to what was received). The setting is read only when a service
--              order is created and when its payment plan is generated (while
--              the order has no released commission). The engine
--              (server/utils/service-order-commissions.ts) keeps reading the
--              mode stored on each service order.
--              Additive, no DML: existing service_orders are untouched.
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN commission_release_mode varchar(20) NOT NULL DEFAULT 'full';

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_commission_release_mode_check
    CHECK (commission_release_mode IN ('proportional', 'full'));

COMMENT ON COLUMN public.organizations.commission_release_mode IS
  'Commission release mode applied to new service orders and to orders without released commission when their payment plan is generated: full (default) or proportional.';
