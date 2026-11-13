// Histórico da OS (F1): verificações estáticas (OSH-144, OSH-154). Sem rede nem banco.
import { describe, expect, it } from 'vitest'
import { OS_EVENT_CATALOG, OS_SOURCE_POLICIES } from '../../../server/utils/os-history/events'
import { renderOsEvent } from '../../../server/utils/os-history/render'
import { read, walk, rel, ROOT } from '../../support/source-scan'
import { join } from 'node:path'

// Handlers da lista F1 (docs/testing/os-history-scenarios.md, OSH-154).
const INSTRUMENTED = [
  'server/api/service-orders/[id]/cancel.post.ts',
  'server/api/service-orders/[id]/payment.delete.ts',
  'server/api/service-orders/[id]/process-payment.post.ts',
  'server/api/service-orders/[id]/down-payment.post.ts',
  'server/api/service-orders/[id]/receive-extra-payment.post.ts',
  'server/api/service-orders/[id]/generate-commissions.post.ts',
  'server/api/service-orders/[id]/installments/[installmentId].delete.ts',
  'server/api/service-orders/[id]/installments/[installmentId].patch.ts',
  'server/api/service-orders/[id]/installments/[installmentId]/pay.post.ts',
  'server/api/service-orders/[id]/financial-transactions/[transactionId].delete.ts',
  'server/api/financial/pay-commissions-bulk.post.ts',
  'server/api/financial/pay-entries-bulk.post.ts',
  'server/api/financial/[id]/pay.post.ts',
  'server/api/financial/[id].put.ts',
  'server/api/financial/[id].delete.ts',
  'server/api/reports/commissions/[id]/pay.post.ts',
  'server/api/reports/commissions/[id].delete.ts'
]


const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const SHARED = /\b(reverseServiceOrderReceipt|releaseServiceOrderCommissions|recalculateServiceOrderPaymentStatus)\(\{/g
/** Chamadas reais (sem comentários) com o literal de argumentos completo, respeitando chaves aninhadas. */
function sharedCalls(source: string): Array<{ fn: string, args: string }> {
  const src = stripComments(source)
  const out: Array<{ fn: string, args: string }> = []
  for (const m of src.matchAll(SHARED)) {
    let depth = 1
    let i = m.index! + m[0].length
    const start = i
    while (i < src.length && depth > 0) { const c = src[i++]; if (c === '{') depth++; else if (c === '}') depth-- }
    out.push({ fn: m[1]!, args: src.slice(start, i - 1) })
  }
  return out
}
const hasHistoryKey = (args: string) => /(^|[\s,{])history\s*(,|:|$)/m.test(args)

describe('OSH-154: todo handler instrumentado declara política de origem e grava via helper', () => {
  it.each(INSTRUMENTED)('%s', (file) => {
    const src = read(file)
    const m = /historyContext\(\s*event\s*,\s*OS_SOURCE_POLICIES\.(\w+)\s*\)/.exec(src)
    expect(m, 'historyContext(event, OS_SOURCE_POLICIES.<x>)').not.toBeNull()
    const policy = (OS_SOURCE_POLICIES as Record<string, { defaultSource?: string }>)[m![1]!]
    expect(policy?.defaultSource, `política ${m![1]} com defaultSource`).toBeTruthy()
    // grava via recordWithContext (ou delega a util compartilhada recebendo `history`)
    expect(/recordWithContext\(|recordOsEvents\(|history[,\s}]/.test(src), 'grava ou repassa history').toBe(true)
  })

  it('todas as políticas têm defaultSource; allowedSources nunca repete o default', () => {
    for (const [name, p] of Object.entries(OS_SOURCE_POLICIES) as Array<[string, { defaultSource: string, allowedSources?: string[] }]>) {
      expect(p.defaultSource, name).toBeTruthy()
      expect(p.allowedSources ?? [], name).not.toContain(p.defaultSource)
    }
  })

  it('utilitários compartilhados recebem e usam `history`', () => {
    for (const f of ['server/utils/service-order-commissions.ts', 'server/utils/service-order-receipt-reversal.ts', 'server/utils/service-order-payment-status.ts']) {
      const src = read(f)
      expect(src, f).toMatch(/history\?: OsHistoryContext/)
      expect(src, f).toMatch(/recordWithContext\(/)
    }
  })

  it('o extrator de chamadas ignora comentários e respeita chaves aninhadas (auto-teste)', () => {
    const fake = [
      '// reverseServiceOrderReceipt({ nada })',
      'await releaseServiceOrderCommissions({ a: { b: 1 }, c: [{ d: 2 }], history })',
      'await recalculateServiceOrderPaymentStatus({ orderId, meta: { x: 1 } })'
    ].join('\n')
    const calls = sharedCalls(fake)
    expect(calls.map(c => c.fn)).toEqual(['releaseServiceOrderCommissions', 'recalculateServiceOrderPaymentStatus'])
    expect(hasHistoryKey(calls[0]!.args)).toBe(true)
    expect(hasHistoryKey(calls[1]!.args)).toBe(false)
  })

  it('chamadas aos utilitários compartilhados, dentro de handler instrumentado, repassam `history` (cascata herda origem)', () => {
    const missing: string[] = []
    let total = 0
    for (const f of INSTRUMENTED) {
      for (const c of sharedCalls(read(f))) { total++; if (!hasHistoryKey(c.args)) missing.push(`${f}: ${c.fn}`) }
    }
    expect(total).toBeGreaterThan(5)
    expect(missing).toEqual([])
  })
})

describe('OSH-154 (informativo): chamadores dos utilitários FORA da lista instrumentada', () => {
  it('lista os chamadores sem history para revisão (não falha; documenta lacunas conhecidas)', () => {
    const all = walk(join(ROOT, 'server/api')).map(rel).filter(f => f.endsWith('.ts'))
    const gaps: string[] = []
    for (const f of all) {
      if (INSTRUMENTED.includes(f)) continue
      for (const c of sharedCalls(read(f))) if (!hasHistoryKey(c.args)) gaps.push(`${f}: ${c.fn}`)
    }
    // eslint-disable-next-line no-console
    if (gaps.length) console.info('[os-history] chamadores sem history:', gaps)
    expect(Array.isArray(gaps)).toBe(true)
  })
})

describe('OSH-144: mapa único de visibilidade/categoria por event_type', () => {
  const visibilityOf = (t: string) => t === 'order.payment_terms_changed' ? 'financial' : (t.startsWith('order.') || t.startsWith('appointment.')) ? 'general' : t.startsWith('commission.') ? 'commission' : 'financial'
  const categoryOf = (t: string) => t === 'order.status_changed' ? 'status' : t === 'order.items_changed' ? 'items' : t === 'order.payment_terms_changed' ? 'payment' : (t.startsWith('order.') || t.startsWith('appointment.')) ? 'order' : t.startsWith('commission.') ? 'commission' : 'payment'
  it.each(Object.keys(OS_EVENT_CATALOG))('%s', (t) => {
    const meta = OS_EVENT_CATALOG[t as keyof typeof OS_EVENT_CATALOG]
    expect(['order.', 'appointment.', 'items.', 'installment.', 'payment.', 'receipt.', 'entry.', 'commission.'].some(p => t.startsWith(p)), `família desconhecida: ${t}`).toBe(true)
    expect(meta.visibility).toBe(visibilityOf(t))
    expect(meta.category).toBe(categoryOf(t))
  })

  it('todo tipo emitido por osEvent(\'x\') no servidor existe no catálogo e tem renderizador próprio', () => {
    const files = walk(join(ROOT, 'server')).map(rel).filter(f => f.endsWith('.ts'))
    const used = new Set<string>()
    for (const f of files) for (const m of read(f).matchAll(/osEvent\(\s*'([a-z_.]+)'/g)) used.add(m[1]!)
    expect(used.size).toBeGreaterThan(10)
    for (const t of used) {
      expect(Object.keys(OS_EVENT_CATALOG), t).toContain(t)
      const r = renderOsEvent({ id: 'x', occurred_at: '2026-11-13T10:00:00Z', event_type: t, schema_version: 1, category: 'payment', actor_name: 'Maria', payload: {}, correlation_id: 'c', source_code: 'os_detail', source_label: 'x' })
      expect(r.title, t).not.toBe('Evento registrado')
    }
  })

  it('todo tipo de pagamento/comissão do catálogo (order.* é de F0/F2; installment.paid é gravado direto) é emitido por osEvent() em algum handler/util', () => {
    const files = walk(join(ROOT, 'server')).map(rel).filter(f => f.endsWith('.ts'))
    const src = files.map(f => read(f)).join('\n')
    const F0 = new Set(['installment.paid'])
    const dead = Object.keys(OS_EVENT_CATALOG).filter(t => !t.startsWith('order.') && !F0.has(t) && !new RegExp(`osEvent\\(\\s*'${t.replace('.', '\\.')}'`).test(src))
    expect(dead).toEqual([])
  })
})
