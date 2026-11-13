// Histórico da OS (F2): UNIT (diff/render/chaves) e STATIC complementares a f2-diff-render.test.ts.
// OSH-201/202/204/205/206/220/221/226/231/237/246/250/260/272/276/278/285/286/287.
import { describe, expect, it } from 'vitest'
import { diffFinancialFields, FINANCIAL_FIELD_KINDS, diffItems, diffOrderFields, diffRefs, normalizeValue, ITEM_LINES_CAP, ORDER_FIELD_KINDS, ORDER_REF_FIELDS } from '../../../server/utils/os-history/diff'
import { buildOrderUpdateEvents } from '../../../server/utils/os-history/order-events'
import { renderOsEvent, type OsEventRow } from '../../../server/utils/os-history/render'
import { OS_EVENT_CATALOG, OS_EVENT_KEYS, OS_SOURCE_POLICIES } from '../../../server/utils/os-history/events'
import { read, walk, rel, ROOT } from '../../support/source-scan'
import { join } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'

const row = (event_type: string, payload: Record<string, unknown>): OsEventRow => ({
  id: 'e1', occurred_at: '2026-11-13T12:00:00Z', event_type, schema_version: 1, category: 'order', actor_name: 'Maria',
  payload, correlation_id: 'c1', source_code: 'os_form', source_label: 'x'
})
const STATUSES = ['estimate', 'open', 'in_progress', 'waiting_for_part', 'completed', 'invoiced', 'delivered', 'cancelled']
const LABELS: Record<string, string> = {
  estimate: 'Orçamento', open: 'Aberta', in_progress: 'Em andamento', waiting_for_part: 'Aguardando peça',
  completed: 'Concluída', invoiced: 'Faturada', delivered: 'Entregue', cancelled: 'Cancelada'
}
const noDb = {} as never // buildOrderUpdateEvents só consulta o banco para nomes de cadastros/funcionários

describe('[OSH-202/226/231] mudança sem efeito => zero (tabela)', () => {
  it.each([
    ['null x undefined', { discount: null }, { discount: undefined }],
    ['ausente x null', {}, { reported_defect: null }],
    ['"" x null', { reported_defect: '' }, { reported_defect: null }],
    ['só espaços x null', { notes: '   ' }, { notes: null }],
    ['"85000" x 85000 (monetário)', { total_amount: '85000' }, { total_amount: 85000 }],
    ['85000.0 x 85000', { total_amount: 85000.0 }, { total_amount: 85000 }],
    ['vírgula decimal', { discount: '50,00' }, { discount: 50 }],
    ['desconto 50 x "50.00"', { discount: 50 }, { discount: '50.00' }],
    ['desconto null x 0', { discount: null }, { discount: 0 }],
    ['0.1+0.2 x 0.3', { discount: 0.1 + 0.2 }, { discount: 0.3 }],
    ['data com/sem hora', { entry_date: '2026-11-13' }, { entry_date: '2026-11-13T00:00:00Z' }],
    ['espaços nas bordas', { reported_defect: ' a ' }, { reported_defect: 'a' }],
    ['coluna desconhecida "85000" x 85000', { mystery: '85000' }, { mystery: 85000 }],
    ['coluna desconhecida 85000.0 x 85000', { mystery: 85000.0 }, { mystery: 85000 }],
    ['opaque com chaves em outra ordem', { selected_taxes: [{ a: 1, b: 2 }] }, { selected_taxes: [{ b: 2, a: 1 }] }],
    ['opaque [] x null', { selected_taxes: [] }, { selected_taxes: null }],
    ['bool null x false', { apply_taxes: null }, { apply_taxes: false }]
  ])('%s', (_n, a, b) => {
    expect(diffOrderFields(a, b)).toEqual([])
    expect(diffOrderFields(b, a)).toEqual([])
  })

  it('contraste: 85000 x 85320 gera exatamente 1 mudança (monetário e desconhecido)', () => {
    expect(diffOrderFields({ total_amount: 85000 }, { total_amount: 85320 })).toEqual([{ field: 'total_amount', from: 85000, to: 85320 }])
    expect(diffOrderFields({ mystery: 85000 }, { mystery: 85320 })).toHaveLength(1)
    expect(diffOrderFields({ discount: 0.1 + 0.2 }, { discount: 0.31 })).toHaveLength(1)
  })

  it('itens: preço 0.1+0.2 x 0.3 e "35,00" x 35 => zero', () => {
    expect(diffItems([{ name: 'A', quantity: 1, unit_price: 0.1 + 0.2 }], [{ name: 'A', quantity: 1, unit_price: 0.3 }]).total).toBe(0)
    expect(diffItems([{ name: 'A', quantity: '2', unit_price: '35,00' }], [{ name: 'A', quantity: 2, unit_price: 35 }]).total).toBe(0)
  })
})

describe('[OSH-201/206] allowlist/denylist: só o que pode entrar entra', () => {
  const excluded = ['id', 'organization_id', 'created_at', 'updated_at', 'deleted_at', 'created_by', 'updated_by', 'deleted_by', 'appointment_id', 'active_nfe_id', 'active_nfse_id',
    'commission_amount', 'commission_release_mode', 'commission_manual_adjustments_log', 'commission_whatever',
    'status', 'items', 'responsible_employees', 'client_id', 'vehicle_id', 'employee_responsible_id', 'master_product_id']
  it.each(excluded)('%s mudando => nenhuma mudança escalar', (col) => {
    const out = diffOrderFields({ [col]: 'a-1' }, { [col]: 'b-2' })
    expect(out).toEqual([])
  })
  it('coluna desconhecida => "other" sem o nome da coluna em lugar nenhum da saída', () => {
    const out = diffOrderFields({ coluna_secreta_xyz: 'a', blob_xyz: { k: 1 } }, { coluna_secreta_xyz: 'b', blob_xyz: { k: 2 } })
    expect(out.map(c => c.field)).toEqual(['other', 'other'])
    expect(out.every(c => c.from === '(alterado)' && c.to === '(alterado)')).toBe(true)
    expect(JSON.stringify(out)).not.toMatch(/xyz/)
    const scalar = diffOrderFields({ coluna_x: 'a' }, { coluna_x: 'b' })
    expect(scalar).toEqual([{ field: 'other', from: '(alterado)', to: '(alterado)' }])
    const txt = JSON.stringify([scalar, renderOsEvent(row('order.fields_changed', { changes: scalar }))])
    expect(txt).not.toMatch(/"a"|"b"|coluna_x/)
    expect(out.find(c => c.to === '(alterado)')).toBeTruthy() // estruturado nunca mostra conteúdo
  })
  it('estruturado: payload do blob não vaza chaves/valores internos', () => {
    const out = diffOrderFields({ blob: { token: 'abc123' } }, { blob: { token: 'zzz999' } })
    expect(JSON.stringify(out)).not.toMatch(/abc123|zzz999|token/)
  })
  // nfe_ids/nfse_ids: coluna desconhecida escalar grava só o marcador (sem ids crus).
  it('nfe_ids/nfse_ids (ids de NF em texto) não aparecem como valor do diff', () => {
    const out = diffOrderFields({ nfse_ids: '["11111111-1111-4111-8111-111111111111"]' }, { nfse_ids: '["22222222-2222-4222-8222-222222222222"]' })
    expect(JSON.stringify(out)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
  })
})

describe('[OSH-278] texto livre longo (Q30)', () => {
  it('o valor gravado no diff é limitado (200) e nunca lança', () => {
    const big = 'x'.repeat(10 * 1024)
    const out = diffOrderFields({ reported_defect: 'a' }, { reported_defect: big })
    expect(out).toHaveLength(1)
    expect(String(out[0]!.to).length).toBeLessThanOrEqual(201) // 200 + reticências
  })
  // A comparação usa o texto completo (não o truncado); só o valor gravado é limitado a 200 caracteres.
  it('alteração após o caractere 200 de um texto longo gera evento', () => {
    const a = `${'a'.repeat(250)}FIM-ANTIGO`
    const b = `${'a'.repeat(250)}FIM-NOVO`
    expect(diffOrderFields({ reported_defect: a }, { reported_defect: b })).toHaveLength(1)
  })
  it('texto truncado é marcado com reticências', () => {
    const out = diffOrderFields({ reported_defect: 'a' }, { reported_defect: 'y'.repeat(500) })
    expect(String(out[0]!.to)).toMatch(/…|\.\.\./)
  })
})

describe('[OSH-220/221/276] itens: comissão nunca entra; ordem e teto', () => {
  const com = { commissions: [{ employee_id: 'e1', amount: 4321 }], commission_total: 4321, total_commission: 4321, commission_percent: 12 }
  const noLeak = (v: unknown) => expect(JSON.stringify(v)).not.toMatch(/commission|4321|8642|"e1"/i)
  it('(a) só o snapshot de comissão muda => zero; (b) preço + comissão => só preço; (c) adicionar/remover item com comissão', () => {
    const it0 = { id: 'i1', name: 'Troca', quantity: 1, unit_price: 300, ...com }
    expect(diffItems([it0], [{ ...it0, commissions: [], commission_total: 0, total_commission: 0 }]).total).toBe(0)
    const b = diffItems([it0], [{ ...it0, unit_price: 350, commission_total: 8642, commissions: [{ amount: 8642 }] }])
    expect(b.lines).toEqual([{ action: 'changed', name: 'Troca', quantity: 1, unit_price: 350, changes: [{ field: 'unit_price', from: 300, to: 350 }] }])
    noLeak(b)
    const c = diffItems([it0], [{ name: 'Novo', quantity: 1, unit_price: 1, ...com }])
    expect(c.lines.map(l => l.action)).toEqual(['removed', 'added'])
    noLeak(c)
  })
  it('chave de comissão em item sem nome/id não vaza no nome', () => {
    noLeak(diffItems([], [{ quantity: 1, unit_price: 1, ...com }]))
  })
  it('reordenar e trocar posições => zero; dois itens iguais: remover um gera 1 removido', () => {
    const x1 = { name: 'X', quantity: 1, unit_price: 5 }; const y = { name: 'Y', quantity: 1, unit_price: 5 }
    expect(diffItems([x1, y], [y, x1]).total).toBe(0)
    const r = diffItems([x1, { ...x1 }, y], [x1, y])
    expect(r.lines.map(l => [l.action, l.name])).toEqual([['removed', 'X']])
  })
  it('300 itens: saída determinística, teto de 50 linhas, contagem exata em "more", tamanho limitado', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ name: `Item ${String(i).padStart(3, '0')}`, quantity: 1, unit_price: i }))
    const r1 = diffItems([], many); const r2 = diffItems([], many)
    expect(r1).toEqual(r2)
    expect(r1.lines).toHaveLength(ITEM_LINES_CAP)
    expect(r1.total).toBe(300)
    expect(r1.more).toBe(250)
    expect(r1.lines.map(l => l.name)).toEqual(many.slice(0, 50).map(m => m.name)) // ordem estável, sem .sort()
    expect(JSON.stringify(r1).length).toBeLessThan(20_000)
  })
  it('exatamente 50 itens: sem "e mais"; 51: "e mais 1 item" (singular) no render', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `I${i}`, quantity: 1, unit_price: 1 }))
    expect(diffItems([], mk(50)).more).toBe(0)
    const r = diffItems([], mk(51))
    const rendered = renderOsEvent(row('order.items_changed', { lines: r.lines, more: r.more }))
    expect(rendered.details).toHaveLength(51)
    expect(rendered.details.at(-1)).toEqual({ label: 'e mais 1 item', from: null, to: null })
  })
})

describe('[OSH-246/250] status: todos os pares e fallback', () => {
  it('todo par (origem != destino) gera 1 evento com rótulos do app; par igual gera zero', async () => {
    let n = 0
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const ev = await buildOrderUpdateEvents(noDb, { organizationId: 'org-a', orderId: 'o1', before: { status: from }, after: { status: to }, scope: 'r1' })
        if (from === to) { expect(ev).toEqual([]); continue }
        expect(ev).toHaveLength(1)
        expect(ev[0]).toMatchObject({ eventType: 'order.status_changed', visibility: 'general', payload: { from, to } })
        const r = renderOsEvent(row('order.status_changed', ev[0]!.payload as Record<string, unknown>))
        expect(r.details).toEqual([{ label: 'Status', from: LABELS[from], to: LABELS[to] }])
        expect(r.description).toBe(`Status alterado de '${LABELS[from]}' para '${LABELS[to]}' por Maria.`)
        n++
      }
    }
    expect(n).toBe(STATUSES.length * (STATUSES.length - 1))
  })
  it('status inalterado com campos escalares iguais => nenhum evento; status nunca aparece em fields_changed', async () => {
    const ev = await buildOrderUpdateEvents(noDb, { organizationId: 'o', orderId: 'o1', before: { status: 'open', notes: 'a' }, after: { status: 'completed', notes: 'b' }, scope: 'r1' })
    expect(ev.map(e => e.eventType)).toEqual(['order.status_changed', 'order.fields_changed'])
    expect(JSON.stringify(ev[1]!.payload)).not.toMatch(/status/)
  })
  it('status fora do mapa não lança', () => {
    expect(() => renderOsEvent(row('order.status_changed', { from: null, to: undefined }))).not.toThrow()
    expect(renderOsEvent(row('order.status_changed', {})).details[0]).toEqual({ label: 'Status', from: '-', to: '-' })
  })
  // (resolvido: status desconhecido usa o rótulo genérico 'outro status')
})

describe('[OSH-204/205] renderização de valores', () => {
  const r = (changes: unknown[]) => renderOsEvent(row('order.fields_changed', { changes })).details
  it('moeda, data, booleano, vazio; valor de coluna desconhecida mostrado sem o nome da coluna', () => {
    expect(r([{ field: 'total_amount', from: 1234.5, to: null }, { field: 'expected_date', from: '2026-12-31', to: '2027-01-02T10:00:00Z' }, { field: 'other', from: null, to: 85320 }]).map(d => [d.label, d.from, d.to])).toEqual([
      ['Valor total', 'R$ 1.234,50', '(vazio)'], ['Previsão de entrega', '31/12/2026', '02/01/2027'], ['Outro campo', '(vazio)', '85320']
    ])
  })
  it('rótulo de chave desconhecida/maliciosa nunca vaza o nome (inclusive __proto__/constructor)', () => {
    for (const f of ['mystery_col', '__proto__', 'constructor', 'toString', '']) {
      const d = r([{ field: f, from: 'a', to: 'b' }])[0]!
      expect(d.label).toBe('Outro campo')
    }
  })
  it('texto livre com HTML, aspas, emoji e quebra de linha sai literal (escape é do front) e não lança', () => {
    const txt = '<b>"oi"</b>\n\'x\' 🚗 &amp;'
    const d = r([{ field: 'reported_defect', from: txt, to: 'ok' }])[0]!
    expect(d.from).toBe(txt)
  })
  it('descrição lista rótulos e não cita ids nem nomes de coluna', () => {
    const rr = renderOsEvent(row('order.fields_changed', { changes: [{ field: 'client_id', from: 'x', to: 'y' }, { field: 'reported_defect', from: 'a', to: 'b' }] }))
    expect(rr.description).toBe('Maria alterou: Outro campo, Defeito relatado.')
  })
})

describe('[OSH-260] chaves de idempotência', () => {
  it('determinísticas por request; edições distintas e tipos distintos nunca colidem', () => {
    const k = OS_EVENT_KEYS
    expect(k.orderFieldsChanged('o1', 'r1')).toBe(k.orderFieldsChanged('o1', 'r1'))
    expect(new Set([
      k.orderFieldsChanged('o1', 'r1'), k.orderFieldsChanged('o1', 'r2'), k.orderItemsChanged('o1', 'r1'), k.orderResponsiblesChanged('o1', 'r1'),
      k.orderStatusChanged('o1', 'r1', 'open', 'completed'), k.orderStatusChanged('o1', 'r1', 'completed', 'open'), k.orderDeleted('o1', 'r1'), k.orderCreated('o1'), k.orderCreated('o2')
    ]).size).toBe(9)
    expect(k.orderCreated('o1')).toBe('order_created:o1') // por id, não por request
    expect(() => k.orderFieldsChanged('o1', '')).toThrow()
    expect(() => k.orderCreated(' ')).toThrow()
  })
})

describe('[OSH-272/287] catálogo x visibilidade x renderizador', () => {
  const F2 = ['order.created', 'order.deleted', 'order.fields_changed', 'order.items_changed', 'order.payment_terms_changed', 'order.responsibles_changed', 'order.status_changed', 'order.cancelled']
  it('todo tipo order.* tem visibilidade e categoria explícitas (general; payment_terms_changed = financial) e é renderizado', () => {
    expect(Object.keys(OS_EVENT_CATALOG).filter(t => t.startsWith('order.')).sort()).toEqual([...F2].sort())
    for (const t of F2) {
      const meta = OS_EVENT_CATALOG[t as keyof typeof OS_EVENT_CATALOG]
      expect(meta.visibility, t).toBe(t === 'order.payment_terms_changed' ? 'financial' : 'general')
      expect(meta.category, t).toBeTruthy()
      expect(renderOsEvent(row(t, {})).title, t).not.toBe('Evento registrado')
    }
  })
  it('não existe tipo de comissão/financeiro emitido pelo caminho de edição da OS', () => {
    const src = read('server/utils/os-history/order-events.ts')
    expect(src).not.toMatch(/osEvent\(\s*'(commission|installment|payment|receipt|entry)\./)
  })
  it('todo campo do mapa tem rótulo próprio (≠ "Outro campo") e todo campo de cadastro também', () => {
    for (const k of Object.keys(ORDER_FIELD_KINDS)) {
      expect(renderOsEvent(row('order.fields_changed', { changes: [{ field: k, from: 'a', to: 'b' }] })).details[0]!.label, k).not.toBe('Outro campo')
    }
    for (const k of ['client', 'vehicle', 'employee_responsible', 'master_product']) {
      expect(renderOsEvent(row('order.fields_changed', { changes: [{ field: k, from: 'a', to: 'b' }] })).details[0]!.label, k).not.toBe('Outro campo')
    }
    expect(ORDER_REF_FIELDS).toHaveLength(4)
    expect(diffRefs({}, {})).toEqual([])
  })
  it('normalizeValue nunca devolve objeto cru (estruturado vira string estável)', () => {
    expect(typeof normalizeValue({ a: 1 }, 'unknown')).toBe('string')
    expect(normalizeValue(undefined, 'money')).toBeNull()
  })
})

describe('[OSH-285] STATIC: handlers de F2 instrumentados', () => {
  it.each([
    ['server/api/service-orders/index.post.ts', 'osForm', 'defaultSource: \'os_form\''],
    ['server/api/service-orders/[id].delete.ts', 'orderDelete', 'defaultSource: \'os_detail\'']
  ])('%s declara política, grava via recordWithContext e a política tem default/allowed', (file, policy, def) => {
    const src = read(file)
    expect(src).toMatch(new RegExp(`historyContext\\(\\s*event\\s*,\\s*OS_SOURCE_POLICIES\\.${policy}\\s*\\)`))
    expect(src).toMatch(/recordWithContext\(\s*history/)
    const p = (OS_SOURCE_POLICIES as Record<string, { defaultSource: string, allowedSources?: readonly string[] }>)[policy]!
    expect(def.includes(p.defaultSource)).toBe(true)
    expect(p.allowedSources!.length).toBeGreaterThan(0)
  })
  it('POST service-orders: evento só depois do update/insert confirmado (ordem no fonte)', () => {
    const src = read('server/api/service-orders/index.post.ts')
    const upd = src.indexOf('Failed to update service order'); const updRec = src.indexOf('buildOrderUpdateEvents(')
    const ins = src.indexOf('Failed to create service order'); const insRec = src.indexOf('buildOrderCreatedEvent(')
    expect(upd).toBeGreaterThan(0); expect(updRec).toBeGreaterThan(upd)
    expect(ins).toBeGreaterThan(0); expect(insRec).toBeGreaterThan(ins)
  })
  it('DELETE: evento gravado depois do soft delete (ordem no fonte)', () => {
    const src = read('server/api/service-orders/[id].delete.ts')
    const soft = src.search(/deleted_at:\s*new Date|\.update\(\{[^}]*deleted_at/)
    const rec = src.indexOf('buildOrderDeletedEvent(')
    expect(soft).toBeGreaterThan(0)
    expect(rec).toBeGreaterThan(soft)
  })
  it('front: formulário envia os_form e a lista os_list em TODAS as chamadas POST /api/service-orders', () => {
    const form = read('app/components/service-orders/CreateModal.vue')
    expect(form).toMatch(/\$fetch[^(]*\(\s*'\/api\/service-orders'[\s\S]{0,120}x-origin['"]?:\s*'os_form'/)
    const list = read('app/pages/app/service-orders.vue')
    const posts = [...list.matchAll(/\$fetch\(\s*'\/api\/service-orders'/g)]
    expect(posts.length).toBeGreaterThanOrEqual(2)
    expect([...list.matchAll(/'x-origin':\s*'os_list'/g)]).toHaveLength(posts.length)
  })
})

describe('[OSH-286] STATIC: toda coluna de service_orders está classificada', () => {
  // Fonte das colunas: migration de criação + ALTER TABLE ... ADD COLUMN posteriores.
  function migrationColumns(): string[] {
    const dir = join(ROOT, 'supabase/migrations')
    const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    const cols = new Set<string>()
    for (const f of files) {
      const sql = readFileSync(join(dir, f), 'utf8').replace(/--[^\n]*/g, '')
      const create = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?service_orders\s*\(([\s\S]*?)\n\);/i.exec(sql)
      if (create) {
        for (const m of create[1]!.matchAll(/^\s{2,}"?([a-z_]+)"?\s+(?:uuid|varchar|character|text|numeric|boolean|jsonb|json|integer|int|bigint|date|timestamptz|timestamp)\b/gim)) cols.add(m[1]!.toLowerCase())
      }
      for (const alter of sql.matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?service_orders"?\s([^;]*);/gi)) {
        for (const m of alter[1]!.matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?([a-z_]+)"?/gi)) cols.add(m[1]!.toLowerCase())
        for (const m of alter[1]!.matchAll(/DROP COLUMN\s+(?:IF EXISTS\s+)?"?([a-z_]+)"?/gi)) cols.delete(m[1]!.toLowerCase())
        for (const m of alter[1]!.matchAll(/RENAME COLUMN\s+"?([a-z_]+)"?\s+TO\s+"?([a-z_]+)"?/gi)) { cols.delete(m[1]!.toLowerCase()); cols.add(m[2]!.toLowerCase()) }
      }
    }
    return [...cols]
  }
  // 'diff' = campo escalar no histórico; 'ref' = cadastro resolvido por nome; 'own' = tem evento próprio; 'excluded' = fora do histórico por decisão.
  const POLICY: Record<string, 'diff' | 'financial' | 'generic' | 'ref' | 'own' | 'excluded'> = {
    id: 'excluded', organization_id: 'excluded', number: 'diff', client_id: 'ref', vehicle_id: 'ref', entry_date: 'diff', expected_date: 'diff',
    expected_payment_date: 'diff', completion_date: 'diff', master_product_id: 'ref', employee_responsible_id: 'ref', appointment_id: 'excluded',
    responsible_employees: 'own', status: 'own', payment_status: 'financial', payment_method: 'financial', is_installment: 'financial', installment_count: 'financial',
    reported_defect: 'diff', diagnosis: 'diff', items: 'own', apply_taxes: 'diff', selected_taxes: 'diff', total_taxes_amount: 'diff', total_amount: 'diff',
    total_cost_amount: 'financial', discount: 'diff', commission_amount: 'excluded', terminal_fee_amount: 'financial',
    active_nfe_id: 'excluded', nfe_ids: 'generic', active_nfse_id: 'excluded', nfse_ids: 'generic', // generic = cairia em "Outro campo"
     notes: 'diff',
    created_at: 'excluded', created_by: 'excluded', updated_at: 'excluded', updated_by: 'excluded', deleted_at: 'excluded', deleted_by: 'excluded',
    commission_release_mode: 'excluded', commission_manual_adjustments_log: 'excluded'
  }
  const cols = migrationColumns()

  it('o extrator achou as colunas esperadas (auto-teste)', () => {
    expect(cols.length).toBeGreaterThan(30)
    expect(cols).toEqual(expect.arrayContaining(['id', 'organization_id', 'items', 'commission_manual_adjustments_log', 'total_cost_amount']))
  })
  it('coluna nova sem classificação falha; classificação sem coluna (obsoleta) também', () => {
    expect(cols.filter(c => !(c in POLICY)), 'colunas SEM classificação (revise o histórico antes de liberar)').toEqual([])
    expect(Object.keys(POLICY).filter(c => !cols.includes(c)), 'classificações obsoletas').toEqual([])
  })
  it.each(Object.entries(POLICY))('%s (%s) se comporta conforme a classificação', (col, kind) => {
    const fk = ORDER_FIELD_KINDS[col] ?? FINANCIAL_FIELD_KINDS[col]
    const [va, vb]: [unknown, unknown] = fk === 'money' || fk === 'int' ? [1, 2] : fk === 'bool' ? [false, true] : fk === 'date' ? ['2026-01-01', '2026-01-02'] : fk === 'opaque' ? [[{ x: 1 }], [{ x: 2 }]] : ['v-1', 'v-2']
    const diff = diffOrderFields({ [col]: va }, { [col]: vb })
    const fin = diffFinancialFields({ [col]: va }, { [col]: vb })
    const refs = diffRefs({ [col]: 'a-1' }, { [col]: 'b-2' })
    if (kind === 'diff') expect(diff, col).toHaveLength(1)
    else if (kind === 'financial') { expect(diff, col).toEqual([]); expect(fin, col).toHaveLength(1) } else if (kind === 'generic') expect(diff.map(d => d.field)).toEqual(['other'])
    else if (kind === 'ref') { expect(refs).toHaveLength(1); expect(diff).toEqual([]) } else expect(diff, col).toEqual([])
    if (kind === 'excluded') { expect(refs).toEqual([]); expect(fin, col).toEqual([]) }
  })
  it('todo campo "diff" do mapa existe como coluna real (sem campo fantasma)', () => {
    for (const k of Object.keys(ORDER_FIELD_KINDS)) expect(cols, k).toContain(k)
  })
  it('nenhuma coluna de comissão é classificada como visível', () => {
    for (const c of cols.filter(c => /^commission/.test(c))) expect(POLICY[c], c).toBe('excluded')
  })
})

describe('[OSH-171/172] editar cadastro fora da OS não gera evento de OS (STATIC)', () => {
  it('nenhum handler de clients/vehicles/employees/master-products referencia o histórico da OS', () => {
    const files = walk(join(ROOT, 'server/api')).map(rel).filter(f => f.endsWith('.ts') && /\/(clients|vehicles|employees|master-products|products)(\/|\.|-)/.test(`/${f.replace('server/api/', '')}`))
    expect(files.length).toBeGreaterThan(3)
    const offenders = files.filter(f => /os-history|recordOsEvents|recordWithContext|recordOsEventsSafe|service_order_events/.test(read(f)))
    expect(offenders).toEqual([])
  })
  it('só handlers conhecidos de OS/financeiro importam o histórico (ratchet: novo importador exige revisão)', () => {
    const importers = walk(join(ROOT, 'server/api')).map(rel).filter(f => f.endsWith('.ts') && /os-history\//.test(read(f)))
    const outsideOs = importers.filter(f => !/^server\/api\/(service-orders|financial|reports\/commissions|admin\/service-orders|appointments)\//.test(f))
    expect(outsideOs).toEqual([])
  })
})
