// Histórico da OS (F2): diff puro + renderização (OSH-201/202/203/204/215-221/225/226/231/237/246/250).
import { describe, expect, it } from 'vitest'
import { diffItems, diffOrderFields, diffRefs, diffResponsibles, ITEM_LINES_CAP } from '../../../server/utils/os-history/diff'
import { renderOsEvent, type OsEventRow } from '../../../server/utils/os-history/render'
import { OS_EVENT_CATALOG } from '../../../server/utils/os-history/events'

const row = (event_type: string, payload: Record<string, unknown>): OsEventRow => ({
  id: 'e1', occurred_at: '2026-11-13T12:00:00Z', event_type, schema_version: 1, category: 'order', actor_name: 'Maria',
  payload, correlation_id: 'c1', source_code: 'os_form', source_label: 'x'
})

describe('diffOrderFields', () => {
  it('ignora colunas técnicas, comissão, custo, ids e campos de pagamento', () => {
    const b = { id: 'a', updated_at: '1', updated_by: 'x', commission_amount: 1, commission_manual_adjustments_log: [], total_cost_amount: 1, terminal_fee_amount: 1, appointment_id: 'a', payment_status: 'pending', status: 'open', client_id: 'c1', items: [] }
    const a = { ...b, id: 'b', updated_at: '2', updated_by: 'y', commission_amount: 9, commission_manual_adjustments_log: [{ x: 1 }], total_cost_amount: 9, terminal_fee_amount: 9, appointment_id: 'z', payment_status: 'paid', status: 'completed', client_id: 'c2', items: [{ name: 'x' }] }
    expect(diffOrderFields(b, a)).toEqual([])
  })
  it('mudança sem efeito não gera linha', () => {
    const b = { reported_defect: 'barulho', diagnosis: null, discount: 50, entry_date: '2026-11-13', apply_taxes: null, notes: '  a  ' }
    const a = { reported_defect: ' barulho ', diagnosis: '', discount: '50.00', entry_date: '2026-11-13T00:00:00Z', apply_taxes: false, notes: 'a' }
    expect(diffOrderFields(b, a)).toEqual([])
    expect(diffOrderFields({ discount: 0.1 + 0.2 }, { discount: '0,3' })).toEqual([])
  })
  it('campos alterados: conhecidos com chave, desconhecidos como other (sem nome de coluna)', () => {
    const out = diffOrderFields({ reported_defect: 'a', discount: 0, mystery: 'x', blob: { a: 1 } }, { reported_defect: 'b', discount: 50, mystery: 'y', blob: { a: 2 } })
    expect(out).toEqual([
      { field: 'reported_defect', from: 'a', to: 'b' },
      { field: 'discount', from: 0, to: 50 },
      { field: 'other', from: '(alterado)', to: '(alterado)' },
      { field: 'other', from: '(alterado)', to: '(alterado)' }
    ])
    expect(JSON.stringify(out)).not.toMatch(/mystery|"x"|"y"/)
  })
  it('diffRefs só detecta troca de id', () => {
    expect(diffRefs({ client_id: 'a', vehicle_id: 'v' }, { client_id: 'b', vehicle_id: 'v' })).toEqual([{ field: 'client_id', from: 'a', to: 'b' }])
    expect(diffRefs({ vehicle_id: '' }, { vehicle_id: null })).toEqual([])
  })
})

describe('diffItems', () => {
  const it1 = { name: 'Filtro', quantity: 1, unit_price: 35, cost_price: 10, commissions: [{ amount: 5 }], commission_total: 5 }
  it('adicionado, removido e alterado; sem comissão nem custo', () => {
    const r = diffItems([it1, { name: 'Troca', quantity: 1, unit_price: 300 }], [{ ...it1, quantity: 3, commission_total: 9 }, { name: 'Novo', quantity: 2, unit_price: 35 }])
    expect(r.lines.map(l => l.action)).toEqual(['changed', 'removed', 'added'])
    expect(r.lines[0]!.changes).toEqual([{ field: 'quantity', from: 1, to: 3 }])
    expect(JSON.stringify(r)).not.toMatch(/commission|cost/)
  })
  it('só mudar snapshot de comissão ou reordenar = zero', () => {
    const b = [it1, { name: 'B', quantity: 1, unit_price: 1 }]
    expect(diffItems(b, [{ name: 'B', quantity: 1, unit_price: 1 }, { ...it1, commissions: [], commission_total: 0 }]).total).toBe(0)
  })
  it('preço e desconto de->para; itens iguais distinguidos por ocorrência', () => {
    const r = diffItems([{ name: 'X', quantity: 1, unit_price: 300 }, { name: 'X', quantity: 2, unit_price: 300 }], [{ name: 'X', quantity: 1, unit_price: 350, discount: 10 }, { name: 'X', quantity: 2, unit_price: 300 }])
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]!.changes).toEqual([{ field: 'unit_price', from: 300, to: 350 }, { field: 'discount', from: null, to: 10 }])
  })
  it('teto de 50 linhas com resumo', () => {
    const many = Array.from({ length: 53 }, (_, i) => ({ name: `I${i}`, quantity: 1, unit_price: 1 }))
    const r = diffItems([], many)
    expect(r.lines).toHaveLength(ITEM_LINES_CAP)
    expect(r.more).toBe(3)
  })
  it('entradas inválidas não lançam', () => {
    for (const v of [undefined, null, {}, 'nao json', [null, 3, 'x'], '[{"name":"a"}]']) expect(() => diffItems(v, [{ quantity: -1 }])).not.toThrow()
  })
})

describe('diffResponsibles', () => {
  it('ordem não conta; percentuais ignorados', () => {
    expect(diffResponsibles([{ employee_id: 'a', percent: 5 }, { employee_id: 'b' }], [{ employee_id: 'b' }, { employee_id: 'a', percent: 9 }])).toEqual({ added: [], removed: [] })
    expect(diffResponsibles([{ employee_id: 'a' }], [{ employee_id: 'b' }])).toEqual({ added: ['b'], removed: ['a'] })
  })
})

describe('render F2', () => {
  it('catálogo: todo tipo order.* tem renderizador próprio', () => {
    for (const t of Object.keys(OS_EVENT_CATALOG).filter(k => k.startsWith('order.'))) {
      expect(renderOsEvent(row(t, {})).title).not.toBe('Evento registrado')
    }
  })
  it('fields_changed: rótulos, moeda, data, booleano, vazio e genérico', () => {
    const r = renderOsEvent(row('order.fields_changed', { changes: [
      { field: 'discount', from: 0, to: 1234.5 }, { field: 'entry_date', from: '2026-11-13', to: null },
      { field: 'apply_taxes', from: false, to: true }, { field: 'other', from: 'x', to: 'y' }, { field: 'client', from: 'Ana', to: 'Beto' }
    ] }))
    expect(r.details.map(d => [d.label, d.from, d.to])).toEqual([
      ['Desconto', 'R$ 0,00', 'R$ 1.234,50'], ['Data de entrada', '13/11/2026', '(vazio)'],
      ['Aplicar impostos', 'Não', 'Sim'], ['Outro campo', 'x', 'y'], ['Cliente', 'Ana', 'Beto']
    ])
  })
  it('items_changed: uma linha por item e "e mais N itens"', () => {
    const r = renderOsEvent(row('order.items_changed', { more: 2, lines: [
      { action: 'added', name: 'Filtro', quantity: 2, unit_price: 35 },
      { action: 'removed', name: 'Velas', quantity: 4, unit_price: 20 },
      { action: 'changed', name: 'Troca', changes: [{ field: 'quantity', from: 1, to: 3 }, { field: 'unit_price', from: 300, to: 350 }] }
    ] }))
    expect(r.details).toEqual([
      { label: 'Item: Filtro', from: null, to: '2 x R$ 35,00' },
      { label: 'Item: Velas', from: '4 x R$ 20,00', to: null },
      { label: 'Item alterado: Troca', from: 'Quantidade 1; Preço R$ 300,00', to: 'Quantidade 3; Preço R$ 350,00' },
      { label: 'e mais 2 itens', from: null, to: null }
    ])
  })
  it('status: rótulos e fallback', () => {
    const r = renderOsEvent(row('order.status_changed', { from: 'in_progress', to: 'weird_code' }))
    expect(r.description).toContain("'Em andamento' para 'outro status'")
    expect(JSON.stringify(r)).not.toContain('weird_code')
    expect(renderOsEvent(row('order.status_changed', { from: 'completed', to: 'open' })).details[0]).toEqual({ label: 'Status', from: 'Concluída', to: 'Aberta' })
  })
  it('responsibles/created/deleted', () => {
    expect(renderOsEvent(row('order.responsibles_changed', { added: ['Carlos'], removed: [] })).description).toContain('adicionado: Carlos')
    expect(renderOsEvent(row('order.created', { order_number: '4012' })).description).toBe('OS nº 4012 criada por Maria.')
    expect(renderOsEvent(row('order.deleted', { order_number: '4012' })).description).toBe('OS nº 4012 excluída por Maria.')
  })
})

describe('order.payment_terms_changed (financial)', () => {
  it('diffFinancialFields: de->para, null x 0 sem efeito, texto pt-BR', async () => {
    const { diffFinancialFields } = await import('../../../server/utils/os-history/diff')
    expect(diffFinancialFields({ total_cost_amount: 0, installment_count: 0, is_installment: null }, { total_cost_amount: null, installment_count: '0', is_installment: false })).toEqual([])
    const ch = diffFinancialFields({ payment_method: 'pix', is_installment: false, installment_count: 0 }, { payment_method: 'credit_card', is_installment: true, installment_count: 3 })
    const r = renderOsEvent(row('order.payment_terms_changed', { changes: ch }))
    expect(r.details).toEqual([
      { label: 'Forma de pagamento', from: 'Pix', to: 'Cartão de crédito' },
      { label: 'Pagamento parcelado', from: 'Não', to: 'Sim' },
      { label: 'Número de parcelas', from: '0', to: '3' }
    ])
  })
})

describe('ajustes finais (B/C/D)', () => {
  it('B: OS legada com nulos nos campos de pagamento não gera evento financeiro falso; mudança real gera', async () => {
    const { diffFinancialFields } = await import('../../../server/utils/os-history/diff')
    const legacy = { payment_status: null, payment_method: null, is_installment: null, installment_count: null, total_cost_amount: null, terminal_fee_amount: null }
    const saved = { payment_status: 'pending', payment_method: null, is_installment: false, installment_count: 0, total_cost_amount: 0, terminal_fee_amount: 0 }
    expect(diffFinancialFields(legacy, saved)).toEqual([])
    expect(diffFinancialFields(legacy, { ...saved, payment_method: 'pix' })).toEqual([{ field: 'payment_method', from: null, to: 'pix' }])
    expect(diffFinancialFields(legacy, { ...saved, payment_status: 'paid' })).toEqual([{ field: 'payment_status', from: 'pending', to: 'paid' }])
  })
  it('C: NUL é removido do texto livre (diff, itens e payload gravado)', async () => {
    const { stripNul } = await import('../../../server/utils/os-history/diff')
    expect(stripNul('a\u0000b')).toBe('ab')
    expect(diffOrderFields({ reported_defect: 'x' }, { reported_defect: 'a\u0000b' })).toEqual([{ field: 'reported_defect', from: 'x', to: 'ab' }])
    expect(diffOrderFields({ reported_defect: 'ab' }, { reported_defect: 'a\u0000b' })).toEqual([])
    expect(JSON.stringify(diffItems([], [{ name: 'Fi\u0000ltro', quantity: 1, unit_price: 1 }]))).not.toContain('\u0000')
  })
  it('D: valor nulo/não numérico não vira R$ 0,00', async () => {
    const { formatBRL } = await import('../../../server/utils/os-history/render')
    expect(formatBRL(null)).toBe('-')
    expect(formatBRL(undefined)).toBe('-')
    expect(formatBRL('')).toBe('-')
    expect(formatBRL('abc')).toBe('-')
    expect(formatBRL(0)).toBe('R$ 0,00')
    expect(renderOsEvent(row('installment.removed', { amount: null })).description).toContain('(-)')
  })
})
