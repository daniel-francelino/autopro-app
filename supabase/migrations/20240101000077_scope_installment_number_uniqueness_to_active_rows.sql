-- =============================================================================
-- Migration: 20240101000077_scope_installment_number_uniqueness_to_active_rows.sql
-- Description: Scopes service_order_installments' installment_number
--              uniqueness to non-deleted rows only.
--
--              Migration 20240101000076 introduced soft delete for this
--              table, but the original unique constraint from
--              20240101000019 (service_order_id, installment_number) was
--              never updated to account for it. Since deleting an
--              installment only sets deleted_at (the row and its number stay
--              in the table forever), every endpoint that computes "the next
--              installment_number" by counting active rows was undercounting
--              once anything had been removed from the plan — producing a
--              number that collides with a soft-deleted row and fails with
--              "duplicate key value violates unique constraint
--              service_order_installments_service_order_id_number_key".
--
--              Replacing the plain unique constraint with a partial unique
--              index (WHERE deleted_at IS NULL) fixes this at the source:
--              a deleted installment's number becomes available for reuse,
--              so numbering stays contiguous and the count-based approach in
--              application code (server/utils/service-order-installments.ts)
--              works correctly again.
-- =============================================================================

ALTER TABLE public.service_order_installments
    DROP CONSTRAINT service_order_installments_service_order_id_number_key;

CREATE UNIQUE INDEX service_order_installments_service_order_id_number_key
    ON public.service_order_installments (service_order_id, installment_number)
    WHERE deleted_at IS NULL;

COMMENT ON INDEX public.service_order_installments_service_order_id_number_key IS
    'Installment numbers are unique per service order only among non-deleted rows — a soft-deleted installment frees its number for reuse.';
