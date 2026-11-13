// Histórico da OS F1: catálogo x renderizador, chaves de idempotência (OSH-015) e vínculo lançamento -> OS.
import { describe, expect, it } from 'vitest'
import { OS_EVENT_CATALOG, OS_EVENT_KEYS, OS_SOURCE_POLICIES, osEventKey, entryChangeSet, recordOsEventsSafe } from '../../../server/utils/os-history/events'
import { renderOsEvent } from '../../../server/utils/os-history/render'
import { isOsHistorySourceCode } from '../../../lib/utils/os-history-sources'
import { createFakeSupabase } from '../../support/fake-supabase'

const row = (event_type: string, payload: Record<string, unknown>) => renderOsEvent({
  id: 'x', occurred_at: '2026-11-13T10:00:00Z', event_type, schema_version: 1, category: 'payment', actor_name: 'Maria',
  payload, correlation_id: 'c', source_code: 'os_detail', source_label: 'x'
})

describe('catálogo F1', () => {
  it('todo tipo do catálogo tem texto próprio (não cai no fallback)', () => {
    for (const type of Object.keys(OS_EVENT_CATALOG)) {
      expect(row(type, {}).title, type).not.toBe('Evento registrado')
    }
  })
  it('tipo desconhecido usa fallback seguro e payload não vaza', () => {
    const r = row('foo.bar', { secret: 'abc' })
    expect(r.title).toBe('Evento registrado')
    expect(r.description).not.toContain('abc')
  })
  it('visibilidade: comissão só em commission; cancelamento geral sem citar comissão', () => {
    for (const [t, m] of Object.entries(OS_EVENT_CATALOG)) if (t.startsWith('commission.')) expect(m.visibility).toBe('commission')
    expect(OS_EVENT_CATALOG['order.cancelled'].visibility).toBe('general')
    expect(row('order.cancelled', { order_number: 12 }).description.toLowerCase()).not.toContain('comiss')
    expect(OS_EVENT_CATALOG['receipt.reversed'].visibility).toBe('financial')
  })
  it('políticas de origem usam só códigos do catálogo', () => {
    for (const p of Object.values(OS_SOURCE_POLICIES)) {
      expect(isOsHistorySourceCode(p.defaultSource)).toBe(true)
      for (const a of ('allowedSources' in p ? p.allowedSources : [])) expect(isOsHistorySourceCode(a)).toBe(true)
    }
  })
})

describe('textos', () => {
  it('comissão paga sem recebimento e via lançamento', () => {
    expect(row('commission.paid', { employee_name: 'Carlos', amount: 45, payment_date: '2026-11-13', without_receipt: true }).description)
      .toContain('ainda não tinha recebimento')
    expect(row('commission.paid', { employee_name: 'Carlos', amount: 45, via_entry: true, record_synced: false }).description)
      .toContain('não foi atualizado')
  })
  it('comissão removida paga destaca; nunca mostra id', () => {
    const d = row('commission.removed', { employee_name: 'Carlos', amount: 45, was_paid: true, reason: 'manual_delete', id: 'uuid-1' }).description
    expect(d).toContain('já estava paga')
    expect(d).not.toContain('uuid-1')
  })
  it('entry.edited gera detalhes legíveis', () => {
    const r = row('entry.edited', { changes: [{ field: 'amount', from: 300, to: 250 }, { field: 'secret', from: 1, to: 2 }] })
    expect(r.details).toEqual([{ label: 'Valor', from: 'R$ 300,00', to: 'R$ 250,00' }])
  })
  it('status do pagamento traduzido', () => {
    expect(row('payment.status_changed', { from: 'pending', to: 'partial' }).description).toContain("'Pendente' para 'Parcialmente pago'")
  })
})

describe('chaves de idempotência (OSH-015)', () => {
  it('determinísticas e distintas por efeito', () => {
    expect(OS_EVENT_KEYS.receiptReversed('t1')).toBe(OS_EVENT_KEYS.receiptReversed('t1'))
    expect(OS_EVENT_KEYS.receiptReversed('t1')).not.toBe(OS_EVENT_KEYS.receiptReversed('t2'))
    expect(OS_EVENT_KEYS.commissionPaid('r1', 't1')).not.toBe(OS_EVENT_KEYS.commissionRemoved('r1'))
    expect(OS_EVENT_KEYS.paymentStatus('o', 's', 'pending', 'partial')).not.toBe(OS_EVENT_KEYS.paymentStatus('o', 's', 'partial', 'paid'))
    expect(OS_EVENT_KEYS.installmentPaid('i1', 't1')).toBe('installment_paid:i1:t1')
  })
  it('parte vazia lança; recordOsEventsSafe absorve', async () => {
    expect(() => osEventKey('x', '')).toThrow()
    const fake = createFakeSupabase()
    await expect(recordOsEventsSafe(null, fake.client, () => { throw new Error('boom') }, OS_SOURCE_POLICIES.osDetail)).resolves.toBeUndefined()
  })
})

describe('entryChangeSet', () => {
  it('só campos permitidos, conta vira nome', async () => {
    const ch = await entryChangeSet(
      { amount: 300, due_date: '2026-11-10', status: 'pending', bank_account_id: 'a', notes: 'x' },
      { amount: 250, due_date: '2026-11-10', status: 'paid', bank_account_id: 'b', notes: 'y' },
      async id => (id === 'a' ? 'Caixa' : 'Banco')
    )
    expect(ch.map(c => c.field)).toEqual(['amount', 'status', 'bank_account'])
    expect(ch[2]).toMatchObject({ from: 'Caixa', to: 'Banco' })
  })
})

import { orderReceivedTotal, planIsAfterRemoval, createHistoryCache } from '../../../server/utils/os-history/events'

describe('M1/L4/installment.edited', () => {
  it('recebido real vem das transações income pagas, não do valor da parcela (parcela parcial)', async () => {
    const fake = createFakeSupabase({
      service_order_installments: [{ id: 'i1', service_order_id: 'o1', organization_id: 'org', status: 'partial', amount: 500 }],
      financial_transactions: [
        { id: 't1', service_order_id: 'o1', organization_id: 'org', type: 'income', status: 'paid', amount: 100, deleted_at: null },
        { id: 't2', service_order_id: 'o1', organization_id: 'org', type: 'income', status: 'paid', amount: 50, deleted_at: '2026-01-01' }
      ]
    })
    const cache = createHistoryCache()
    expect(await orderReceivedTotal(fake.client, 'org', 'o1', cache)).toBe(100)
    expect(cache.received.get('o1')).toBe(100)
  })
  it('after_removal só vale para o ciclo mais recente', async () => {
    const ev = (event_type: string, occurred_at: string) => ({ organization_id: 'org', service_order_id: 'o1', event_type, occurred_at })
    const a = createFakeSupabase({ service_order_events: [ev('payment.plan_created', '2026-01-01'), ev('payment.deleted', '2026-01-02')] })
    expect(await planIsAfterRemoval(a.client, 'org', 'o1')).toBe(true)
    const b = createFakeSupabase({ service_order_events: [ev('payment.deleted', '2026-01-02'), ev('payment.plan_created', '2026-01-03')] })
    expect(await planIsAfterRemoval(b.client, 'org', 'o1')).toBe(false)
  })
  it('installment.edited renderiza de -> para legível', () => {
    const r = row('installment.edited', { installment_number: 3, changes: [{ field: 'due_date', from: '2026-12-10', to: '2026-12-15' }] })
    expect(r.details).toEqual([{ label: 'Vencimento', from: '10/12/2026', to: '15/12/2026' }])
    expect(OS_EVENT_CATALOG['installment.edited'].visibility).toBe('financial')
  })
})
