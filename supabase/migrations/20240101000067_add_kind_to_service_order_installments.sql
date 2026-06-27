-- =============================================================================
-- Migration: 20240101000067_add_kind_to_service_order_installments
-- Description: Phase 0 of the service-order payment redesign (see
--              docs/service-orders-payment-flow-redesign.md). Adds a `kind`
--              discriminator to distinguish down payments, financed
--              installments and ad-hoc/extra receipts within the same
--              payment plan. Existing rows are all plain installments.
-- =============================================================================

ALTER TABLE public.service_order_installments
    ADD COLUMN IF NOT EXISTS kind varchar(20) NOT NULL DEFAULT 'installment';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'service_order_installments_kind_check'
    ) THEN
        ALTER TABLE public.service_order_installments
            ADD CONSTRAINT service_order_installments_kind_check
            CHECK (kind IN ('down_payment', 'installment', 'extra'));
    END IF;
END $$;

COMMENT ON COLUMN public.service_order_installments.kind IS
    'down_payment = entrada/sinal; installment = parcela financiada do plano; extra = recebimento avulso registrado fora do plano original.';
