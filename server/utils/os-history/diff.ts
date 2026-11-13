import { snapshotDate, snapshotMoney } from './events'

/**
 * Diff PURO da OS para o histórico (F2). Sem I/O. Regras (docs/architecture/os-history-timeline.md §6/§11.1):
 * - todo campo alterado vira linha; campo fora do mapa de rótulos usa o rótulo genérico (`other`), sem nome de coluna;
 * - nunca entram: ids crus (viram nomes antes de gravar), colunas técnicas, comissão (`commission*`), custo e
 *   taxa de maquininha (margem interna), campos do fluxo de pagamento (têm eventos próprios);
 * - mudança sem efeito (espaço, null x '', número igual, data com/sem hora) é ignorada.
 */

export type FieldKind = 'text' | 'money' | 'date' | 'bool' | 'opaque'

/** Campos conhecidos: chave -> tipo de formatação. O rótulo pt-BR fica no renderizador (render.ts). */
export const ORDER_FIELD_KINDS: Record<string, FieldKind> = {
  number: 'text',
  reported_defect: 'text',
  diagnosis: 'text',
  notes: 'text',
  entry_date: 'date',
  expected_date: 'date',
  expected_payment_date: 'date',
  completion_date: 'date',
  discount: 'money',
  total_amount: 'money',
  total_taxes_amount: 'money',
  apply_taxes: 'bool',
  selected_taxes: 'opaque'
}

/** Campos que apontam para cadastros: o diff só os detecta; o nome (snapshot) é resolvido por quem chama. */
export const ORDER_REF_FIELDS = ['client_id', 'vehicle_id', 'employee_responsible_id', 'master_product_id'] as const
export type OrderRefField = typeof ORDER_REF_FIELDS[number]

/** Tratados por eventos próprios ou deliberadamente fora do histórico da OS. */
const EXCLUDED_FIELDS = new Set<string>([
  'items', 'responsible_employees', 'status', 'payment_status', 'payment_method', 'is_installment', 'installment_count',
  'total_cost_amount', 'terminal_fee_amount', 'appointment_id', 'organization_id', 'id'
])

const isTechnical = (key: string) =>
  EXCLUDED_FIELDS.has(key) || /^commission/i.test(key) || /(^|_)id$/.test(key) || /_at$/.test(key) || /_by$/.test(key) || /^deleted/.test(key)

export type FieldChange = { field: string, from: unknown, to: unknown }

const TEXT_MAX = 200

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o).sort().map(k => `${k}:${stable(o[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** Normaliza para comparar/gravar. `null` = vazio. */
export function normalizeValue(value: unknown, kind: FieldKind | 'unknown'): unknown {
  if (value === null || value === undefined) return null
  if (kind === 'opaque') {
    if (Array.isArray(value) && !value.length) return null
    return stable(value)
  }
  if (typeof value === 'object') return stable(value)
  if (kind === 'money') {
    if (typeof value === 'string' && !value.trim()) return null
    const n = Number(typeof value === 'string' ? value.replace(',', '.') : value)
    return Number.isFinite(n) ? Number(n.toFixed(2)) : null
  }
  if (kind === 'date') return snapshotDate(value) ?? (String(value).trim() || null)
  if (kind === 'bool') return value === true || value === 'true' ? true : (value === false || value === 'false' ? false : null)
  if (typeof value === 'string') {
    const t = value.trim()
    if (!t) return null
    return kind === 'unknown' && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  return null
}

const sameNorm = (a: unknown, b: unknown) => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 0.0005)

/** Para exibir o valor de campos `opaque` ou desconhecidos não escalares, o payload guarda só o marcador. */
const OPAQUE = '(alterado)'

const clip = (v: unknown) => (typeof v === 'string' && v.length > TEXT_MAX ? `${v.slice(0, TEXT_MAX)}…` : v)

/**
 * Diferenças dos campos escalares. `bool` ausente x false não conta como mudança (null e false iguais para apply_taxes).
 * `before`/`after` devem conter as colunas da OS (select '*'); campo ausente nos dois lados é ignorado.
 */
export function diffOrderFields(before: Record<string, unknown>, after: Record<string, unknown>): FieldChange[] {
  const out: FieldChange[] = []
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const known = Object.keys(ORDER_FIELD_KINDS).filter(k => keys.has(k))
  const unknown = [...keys].filter(k => !(k in ORDER_FIELD_KINDS) && !isTechnical(k) && !ORDER_REF_FIELDS.includes(k as OrderRefField)).sort()
  let otherCount = 0
  for (const key of [...known, ...unknown]) {
    const kind = ORDER_FIELD_KINDS[key] ?? 'unknown'
    let a = normalizeValue(before[key], kind)
    let b = normalizeValue(after[key], kind)
    if (kind === 'bool') { a = a === true; b = b === true }
    // O handler grava 0 quando o valor monetário falta: null x 0 é sem efeito.
    if (kind === 'money') { a = a ?? 0; b = b ?? 0 }
    if (sameNorm(a, b)) continue
    // Coluna desconhecida (nova/sensível): nunca grava o valor cru, só o marcador (visibilidade general).
    const isUnknown = (kind as string) === 'unknown'
    if (kind === 'opaque' || isUnknown) {
      out.push({ field: isUnknown ? 'other' : key, from: a === null ? null : OPAQUE, to: b === null ? null : OPAQUE })
    } else {
      // Compara o valor completo; só a exibição/payload é limitada (com reticências).
      out.push({ field: key, from: clip(a), to: clip(b) })
    }
    if (isUnknown) otherCount++
    if (otherCount > 10) break
  }
  return out
}

/** Campos de cadastro cujo id mudou: `{ client_id: { from, to } }`. */
export function diffRefs(before: Record<string, unknown>, after: Record<string, unknown>): Array<{ field: OrderRefField, from: string | null, to: string | null }> {
  const id = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return ORDER_REF_FIELDS.flatMap((field) => {
    const from = id(before[field]); const to = id(after[field])
    return from === to ? [] : [{ field, from, to }]
  })
}

// ---- Itens ----

export type ItemChangeField = 'name' | 'quantity' | 'unit_price' | 'discount'
export type ItemLine = {
  action: 'added' | 'removed' | 'changed'
  name: string
  quantity: number | null
  unit_price: number | null
  discount?: number | null
  changes?: Array<{ field: ItemChangeField, from: unknown, to: unknown }>
}
export const ITEM_LINES_CAP = 50

type Norm = { key: string, name: string, quantity: number | null, unit_price: number | null, discount: number | null }

function normItems(raw: unknown): Norm[] {
  let list: unknown = raw
  if (typeof list === 'string') { try { list = JSON.parse(list) } catch { list = [] } }
  if (!Array.isArray(list)) return []
  const seen = new Map<string, number>()
  const out: Norm[] = []
  for (const it of list) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const name = (typeof o.name === 'string' && o.name.trim() ? o.name.trim() : typeof o.description === 'string' && o.description.trim() ? o.description.trim() : '(sem nome)').slice(0, 120)
    const stableId = typeof o.id === 'string' && o.id.trim() ? `id:${o.id.trim()}` : null
    const base = stableId ?? `n:${String(o.product_id ?? '')}|${name.toLowerCase()}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    out.push({
      key: `${base}#${n}`,
      name,
      quantity: normalizeValue(o.quantity, 'money') as number | null,
      unit_price: normalizeValue(o.unit_price, 'money') as number | null,
      // `discount` só existe se o item tiver desconto próprio.
      discount: normalizeValue(o.discount, 'money') as number | null
    })
  }
  return out
}

/** Diff de itens por chave (id estável, senão produto+nome, com índice de ocorrência). Nunca lê comissão nem custo. */
export function diffItems(beforeRaw: unknown, afterRaw: unknown): { lines: ItemLine[], total: number, more: number } {
  const before = normItems(beforeRaw)
  const after = normItems(afterRaw)
  const afterByKey = new Map(after.map(i => [i.key, i]))
  const beforeKeys = new Set(before.map(i => i.key))
  const lines: ItemLine[] = []
  for (const b of before) {
    const a = afterByKey.get(b.key)
    if (!a) { lines.push({ action: 'removed', name: b.name, quantity: b.quantity, unit_price: b.unit_price, discount: b.discount }); continue }
    const changes: NonNullable<ItemLine['changes']> = []
    if (b.name !== a.name) changes.push({ field: 'name', from: b.name, to: a.name })
    for (const f of ['quantity', 'unit_price', 'discount'] as const) {
      if (!sameNorm(b[f] ?? (f === 'discount' ? 0 : null), a[f] ?? (f === 'discount' ? 0 : null))) changes.push({ field: f, from: b[f], to: a[f] })
    }
    if (changes.length) lines.push({ action: 'changed', name: a.name, quantity: a.quantity, unit_price: a.unit_price, changes })
  }
  for (const a of after) {
    if (!beforeKeys.has(a.key)) lines.push({ action: 'added', name: a.name, quantity: a.quantity, unit_price: a.unit_price, discount: a.discount })
  }
  const total = lines.length
  return { lines: lines.slice(0, ITEM_LINES_CAP), total, more: Math.max(0, total - ITEM_LINES_CAP) }
}

// ---- Responsáveis ----

function responsibleIds(raw: unknown): string[] {
  let list: unknown = raw
  if (typeof list === 'string') { try { list = JSON.parse(list) } catch { list = [] } }
  if (!Array.isArray(list)) return []
  return [...new Set(list.map(r => (r && typeof r === 'object' ? (r as { employee_id?: unknown }).employee_id : null)).filter((i): i is string => typeof i === 'string' && !!i.trim()))]
}

/** Responsáveis adicionados/removidos (por id; ordem diferente não conta). Percentuais de comissão são ignorados. */
export function diffResponsibles(before: unknown, after: unknown): { added: string[], removed: string[] } {
  const a = responsibleIds(before); const b = responsibleIds(after)
  return { added: b.filter(i => !a.includes(i)), removed: a.filter(i => !b.includes(i)) }
}
