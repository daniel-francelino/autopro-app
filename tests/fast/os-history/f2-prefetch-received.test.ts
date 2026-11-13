// prefetchReceivedTotals: 1 consulta .in, mesmo resultado de orderReceivedTotal.
import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '../../support/fake-supabase'
import { createHistoryCache, orderReceivedTotal, prefetchReceivedTotals } from '../../../server/utils/os-history/events'

describe('prefetchReceivedTotals', () => {
  it('agrega por OS (0 sem recebimento) igual à consulta individual', async () => {
    const tx = (id: string, o: string, amount: number, over: Record<string, unknown> = {}) => ({ id, organization_id: 'org-a', service_order_id: o, type: 'income', status: 'paid', amount, deleted_at: null, ...over })
    const fake = createFakeSupabase({ financial_transactions: [tx('1', 'a', 100), tx('2', 'a', 50), tx('3', 'b', 10, { status: 'pending' }), tx('4', 'c', 7, { organization_id: 'org-b' })] })
    const cache = createHistoryCache()
    await prefetchReceivedTotals(fake.client as never, 'org-a', ['a', 'b', 'c', 'a'], cache)
    expect([...cache.received.entries()]).toEqual([['a', 150], ['b', 0], ['c', 0]])
    for (const id of ['a', 'b', 'c']) expect(await orderReceivedTotal(fake.client as never, 'org-a', id)).toBe(cache.received.get(id))
  })
})
