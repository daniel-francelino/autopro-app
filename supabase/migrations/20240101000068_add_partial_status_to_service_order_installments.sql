-- =============================================================================
-- Migration: 20240101000068_add_partial_status_to_service_order_installments
-- Description: Phase 4 of the service-order payment redesign (see
--              docs/service-orders-payment-flow-redesign.md). An installment
--              can now be settled across more than one receipt — adds
--              'partial' as a valid status for "some, but not all, of the
--              expected amount has been received".
-- =============================================================================

ALTER TABLE public.service_order_installments
    DROP CONSTRAINT IF EXISTS service_order_installments_status_check;

ALTER TABLE public.service_order_installments
    ADD CONSTRAINT service_order_installments_status_check
    CHECK (status IN ('pending', 'paid', 'overdue', 'partial'));

COMMENT ON COLUMN public.service_order_installments.status IS
    'pending | paid | overdue | partial — partial means some, but not all, of `amount` has been received across one or more financial_transactions linked via service_order_installment_id.';
