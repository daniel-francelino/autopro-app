-- =============================================================================
-- Migration: 20240101000073_backfill_service_order_installment_links
-- Description: Fixes "histórico de pagamento" not showing for some service
--              orders. Root cause (confirmed via data export + git history,
--              see docs/service-orders/payment-flow-redesign.md): before
--              commit 1be5c21 introduced the installments-based payment
--              model, paying an order "à vista" (in full, one shot) created
--              a financial_transactions row and set service_orders
--              .payment_status directly, with no service_order_installments
--              row at all. The current detail endpoint
--              (server/api/service-orders/[id].get.ts) builds the payment
--              history strictly from service_order_installments, grouping
--              financial_transactions by service_order_installment_id — so
--              these older receipts are invisible, even though the money
--              and the 'paid' status are both real.
--
--              Two distinct fixes, validated against a real export before
--              being finalized:
--
--                1. 381 financial_transactions are already linked from the
--                   OTHER side (service_order_installments.financial_transaction_id
--                   points to them) but never got the new column
--                   (financial_transactions.service_order_installment_id)
--                   populated back. Pure pointer fix, zero new rows,
--                   verified zero conflicts/duplicates/org mismatches.
--
--                2. 61 income transactions were paid "à vista" under the
--                   old model and never had ANY service_order_installments
--                   row — there's nothing to point a pointer at. For these,
--                   create one new row with kind='extra' (the exact concept
--                   the current model already uses for "a receipt outside
--                   the formal plan" — see migration 20240101000067) so the
--                   old receipt renders exactly like a same-shaped event
--                   recorded today would.
--
--              Idempotent: safe to re-run (every step only touches rows
--              that still need it).
-- =============================================================================

-- ── Step 1: pointer fix for transactions already linked from the other side ─
UPDATE public.financial_transactions ft
SET service_order_installment_id = soi.id
FROM public.service_order_installments soi
WHERE soi.financial_transaction_id = ft.id
  AND soi.deleted_at IS NULL
  AND ft.deleted_at IS NULL
  AND ft.service_order_installment_id IS NULL;

-- ── Step 2: create one kind='extra' installment row per old "à vista"
--    receipt that never had a plan row at all, then link it back. ──────────
WITH orphaned_receipts AS (
    SELECT ft.id, ft.organization_id, ft.service_order_id, ft.amount, ft.due_date,
           ft.payment_method, ft.bank_account_id, ft.payment_terminal_id, ft.created_at
    FROM public.financial_transactions ft
    JOIN public.service_orders so
        ON so.id = ft.service_order_id
       AND so.organization_id = ft.organization_id
       AND so.deleted_at IS NULL
    WHERE ft.deleted_at IS NULL
      AND ft.type = 'income'
      AND ft.status = 'paid'
      AND ft.service_order_id IS NOT NULL
      AND ft.service_order_installment_id IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.service_order_installments soi
          WHERE soi.financial_transaction_id = ft.id
            AND soi.deleted_at IS NULL
      )
),
-- Existing max installment_number per order, computed once (not per row) —
-- a handful of orders have *more than one* orphaned receipt in this same
-- batch (confirmed against the real export), so a per-row correlated
-- MAX(...)+1 subquery would compute the same number for both and collide on
-- the (service_order_id, installment_number) unique constraint. row_number()
-- below adds each receipt's position within its own order on top of this.
existing_numbers AS (
    SELECT service_order_id, MAX(installment_number) AS max_number
    FROM public.service_order_installments
    WHERE deleted_at IS NULL
    GROUP BY service_order_id
),
numbered_receipts AS (
    SELECT
        r.*,
        COALESCE(existing_numbers.max_number, 0)
            + row_number() OVER (PARTITION BY r.service_order_id ORDER BY r.created_at, r.id) AS next_installment_number
    FROM orphaned_receipts r
    LEFT JOIN existing_numbers ON existing_numbers.service_order_id = r.service_order_id
),
inserted AS (
    INSERT INTO public.service_order_installments (
        organization_id, service_order_id, installment_number, installment_amount, amount,
        due_date, payment_date, status, payment_method, financial_transaction_id,
        bank_account_id, payment_terminal_id, kind, notes, created_at, created_by
    )
    SELECT
        r.organization_id,
        r.service_order_id,
        r.next_installment_number,
        r.amount,
        r.amount,
        r.due_date,
        r.due_date,
        'paid',
        r.payment_method,
        r.id,
        r.bank_account_id,
        r.payment_terminal_id,
        'extra',
        'Backfill (migration 073): recebimento pago à vista antes do modelo de parcelas existir.',
        r.created_at,
        'migration-073'
    FROM numbered_receipts r
    RETURNING id, financial_transaction_id
)
UPDATE public.financial_transactions ft
SET service_order_installment_id = inserted.id
FROM inserted
WHERE ft.id = inserted.financial_transaction_id;

-- ── Diagnostic (not executed): paid income transactions tied to a service
--    order that still have no service_order_installment_id after this
--    migration — should be zero. Run by hand to confirm:
--
--    SELECT ft.id, ft.service_order_id, ft.amount, ft.due_date
--    FROM public.financial_transactions ft
--    WHERE ft.deleted_at IS NULL AND ft.type = 'income' AND ft.status = 'paid'
--      AND ft.service_order_id IS NOT NULL AND ft.service_order_installment_id IS NULL;
