import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../../helpers/fake-supabase'
import { recalculateServiceOrderPaymentStatus } from '../../../server/utils/service-order-payment-status'
import { getNextInstallmentNumber } from '../../../server/utils/service-order-installments'
import { softDeleteFinancialTransaction } from '../../../server/utils/financial-transaction-deletion'
import { reverseServiceOrderReceipt } from '../../../server/utils/service-order-receipt-reversal'

vi.mock('../../../server/utils/service-order-commissions', () => ({
  releaseServiceOrderCommissions: vi.fn(async () => ({ warnings: [] }))
}))

const ORG = 'org-a'

describe('recalculateServiceOrderPaymentStatus', () => {
  const run = async (installments: Array<Record<string, unknown>>) => {
    const fake = createFakeSupabase({
      service_order_installments: installments.map((i, n) => ({ id: `i${n}`, service_order_id: 'o1', organization_id: ORG, deleted_at: null, ...i })),
      service_orders: [{ id: 'o1', organization_id: ORG, payment_status: 'x' }]
    })
    const status = await recalculateServiceOrderPaymentStatus({ supabase: fake.client, organizationId: ORG, orderId: 'o1', userEmail: 'a@b.c' })
    return { status, stored: fake.tables.service_orders![0]!.payment_status }
  }

  it('0 installments → pending', async () => {
    expect((await run([])).status).toBe('pending')
  })
  it('all paid → paid (and stores on the OS)', async () => {
    const r = await run([{ status: 'paid' }, { status: 'paid' }])
    expect(r).toEqual({ status: 'paid', stored: 'paid' })
  })
  it('one partial → partial', async () => {
    expect((await run([{ status: 'partial' }])).status).toBe('partial')
  })
  it('one paid and another pending → partial', async () => {
    expect((await run([{ status: 'paid' }, { status: 'pending' }])).status).toBe('partial')
  })
  it('only pending → pending', async () => {
    expect((await run([{ status: 'pending' }, { status: 'pending' }])).status).toBe('pending')
  })
  it('soft-deleted installment is ignored', async () => {
    const r = await run([{ status: 'paid' }, { status: 'pending', deleted_at: '2026-01-01' }])
    expect(r.status).toBe('paid')
  })
  it('installment from another organization is ignored', async () => {
    const r = await run([{ status: 'paid' }, { status: 'pending', organization_id: 'org-b' }])
    expect(r.status).toBe('paid')
  })
})

describe('getNextInstallmentNumber', () => {
  const next = async (rows: Array<Record<string, unknown>>) => {
    const fake = createFakeSupabase({
      service_order_installments: rows.map((r, n) => ({ id: `i${n}`, service_order_id: 'o1', organization_id: ORG, deleted_at: null, ...r }))
    })
    return getNextInstallmentNumber({ supabase: fake.client, organizationId: ORG, orderId: 'o1' })
  }
  it('first installment = 1', async () => {
    expect(await next([])).toBe(1)
  })
  it('counts only the active ones', async () => {
    expect(await next([{}, {}, { deleted_at: '2026-01-01' }])).toBe(3)
  })
  it('number is reused after soft delete', async () => {
    expect(await next([{}, { deleted_at: '2026-01-01' }])).toBe(2)
  })
})

describe('softDeleteFinancialTransaction', () => {
  it('never really deletes: marks deleted_at + reason + origin, filtering by organization', async () => {
    const fake = createFakeSupabase({
      financial_transactions: [{ id: 't1', organization_id: ORG }, { id: 't1', organization_id: 'org-b' }]
    })
    await softDeleteFinancialTransaction({ supabase: fake.client, id: 't1', organizationId: ORG, reason: 'teste', source: 'financial.manual_delete', userEmail: 'u@x.com' })
    const [mine, other] = fake.tables.financial_transactions!
    expect(mine).toMatchObject({ deletion_reason: 'teste', deletion_source: 'financial.manual_delete', deleted_by: 'u@x.com' })
    expect(mine!.deleted_at).toBeTruthy()
    expect(other!.deleted_at).toBeUndefined()
    expect(fake.writes.every(w => w.op === 'update')).toBe(true)
  })
})

describe('reverseServiceOrderReceipt', () => {
  let fake: ReturnType<typeof createFakeSupabase>
  beforeEach(() => {
    fake = createFakeSupabase({
      bank_accounts: [{ id: 'acc1', organization_id: ORG, current_balance: 1100 }],
      bank_account_statements: [
        { id: 's1', organization_id: ORG, financial_transaction_id: 't1', bank_account_id: 'acc1', transaction_type: 'income', amount: 100, previous_balance: 1000, balance_after: 1100 }
      ],
      financial_transactions: [
        { id: 't1', organization_id: ORG, type: 'income', status: 'paid', amount: 100, service_order_id: 'o1', service_order_installment_id: 'i1', deleted_at: null }
      ],
      service_order_installments: [
        { id: 'i1', organization_id: ORG, service_order_id: 'o1', amount: 100, status: 'paid', financial_transaction_id: 't1', payment_date: '2026-01-01', deleted_at: null }
      ],
      service_orders: [{ id: 'o1', organization_id: ORG, payment_status: 'paid' }],
      employee_financial_records: []
    })
  })
  const reverse = (transaction: Record<string, unknown> = { id: 't1', type: 'income', service_order_id: 'o1', service_order_installment_id: 'i1' }) =>
    reverseServiceOrderReceipt({ supabase: fake.client, organizationId: ORG, transaction, reason: 'erro', source: 'service_orders.financial_transactions.delete', userEmail: 'u@x.com' })

  it('reverses balance, installment, OS status and removes the statement', async () => {
    await reverse()
    expect(fake.tables.bank_accounts![0]!.current_balance).toBe(1000)
    expect(fake.tables.bank_account_statements).toHaveLength(0)
    expect(fake.tables.financial_transactions![0]!.deleted_at).toBeTruthy()
    expect(fake.tables.service_order_installments![0]).toMatchObject({ status: 'pending', payment_date: null, financial_transaction_id: null })
    expect(fake.tables.service_orders![0]!.payment_status).toBe('pending')
  })
  it('refuses entry without OS', async () => {
    await expect(reverse({ id: 't1', type: 'income' })).rejects.toMatchObject({ statusCode: 500 })
  })
  it('refuses entry that is not a receipt (409)', async () => {
    await expect(reverse({ id: 't1', type: 'expense', service_order_id: 'o1' })).rejects.toMatchObject({ statusCode: 409 })
  })
  it('refuses when there is commission already paid on the OS (409) and does not touch the balance', async () => {
    fake.tables.employee_financial_records!.push({ id: 'c1', organization_id: ORG, service_order_id: 'o1', record_type: 'commission', status: 'paid' })
    await expect(reverse()).rejects.toMatchObject({ statusCode: 409 })
    expect(fake.tables.bank_accounts![0]!.current_balance).toBe(1100)
  })
  it('is idempotent: repeating does not change the balance again', async () => {
    await reverse()
    await reverse()
    expect(fake.tables.bank_accounts![0]!.current_balance).toBe(1000)
  })
  it('partial receipt of an installment with another remaining receipt → partial', async () => {
    fake.tables.financial_transactions!.push({ id: 't2', organization_id: ORG, type: 'income', status: 'paid', amount: 40, service_order_installment_id: 'i1', deleted_at: null })
    await reverse()
    expect(fake.tables.service_order_installments![0]!.status).toBe('partial')
    expect(fake.tables.service_orders![0]!.payment_status).toBe('partial')
  })
  it('does not touch accounts from another organization', async () => {
    fake.tables.bank_accounts!.push({ id: 'acc1', organization_id: 'org-b', current_balance: 5 })
    await reverse()
    expect(fake.tables.bank_accounts![1]!.current_balance).toBe(5)
  })
  // KF-02: o estorno restaura o saldo "anterior" gravado no extrato, e não subtrai o valor
  // do recebimento; qualquer movimento posterior na conta é sobrescrito.
  it('reverses only the receipt amount, preserving later movements on the account', async () => {
    fake.tables.bank_accounts![0]!.current_balance = 1400 // +300 de outro lançamento depois do recebimento
    await reverse()
    expect(fake.tables.bank_accounts![0]!.current_balance).toBe(1300)
  })
})
