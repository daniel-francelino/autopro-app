-- =============================================================================
-- Migration: 20240101000074_add_commission_release_mode_to_service_orders
-- Description: Lets a service order choose how employee commission is
--              released as payments come in. Today, releaseServiceOrderCommissions()
--              (server/utils/service-order-commissions.ts) always releases
--              proportionally to the amount received so far
--              (docs/service-orders-payment-flow-redesign.md, section 5.2/6.2).
--
--              In practice, some workshops want the full commission released
--              right away when the payment plan is generated, instead of
--              waiting for the order to be paid off. `commission_release_mode`
--              is a one-way, per-order switch: 'proportional' (default,
--              current behavior, unchanged) or 'full' (releaseServiceOrderCommissions
--              treats the order as 100% received regardless of what's actually
--              been paid). Set once, from process-payment.post.ts, when the
--              payment plan is generated — there's no UI to revert it back to
--              'proportional'.
-- =============================================================================

ALTER TABLE public.service_orders
  ADD COLUMN commission_release_mode varchar(20) NOT NULL DEFAULT 'proportional';

ALTER TABLE public.service_orders
  ADD CONSTRAINT service_orders_commission_release_mode_check
    CHECK (commission_release_mode IN ('proportional', 'full'));
