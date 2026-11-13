import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SourcePolicy } from '../../../lib/utils/os-history-sources'
import { recordOsEvents, type OsEventCategory, type OsEventInput, type OsEventVisibility } from './record'

/**
 * Catálogo de eventos da fatia F0/F1 (docs/architecture/os-history-timeline.md §6) e helpers de gravação.
 * Fonte única de categoria/visibilidade por `event_type`; o renderizador (render.ts) deve cobrir cada tipo.
 * Visibilidade (defaults do responsável): pagamento/valores = financial (gate orders.pay);
 * comissão = commission (gate provisório reports.commissions); order.cancelled = general.
 */
export const OS_EVENT_CATALOG = {
  'order.status_changed': { category: 'status', visibility: 'general' },
  'order.cancelled': { category: 'order', visibility: 'general' },
  'order.created': { category: 'order', visibility: 'general' },
  'order.fields_changed': { category: 'order', visibility: 'general' },
  'order.items_changed': { category: 'items', visibility: 'general' },
  'order.responsibles_changed': { category: 'order', visibility: 'general' },
  // Só o desenvolvimento lê (GET history responde 404 para OS excluída); visibilidade mantida coerente.
  'order.deleted': { category: 'order', visibility: 'general' },
  'installment.paid': { category: 'payment', visibility: 'financial' },
  'installment.removed': { category: 'payment', visibility: 'financial' },
  'installment.edited': { category: 'payment', visibility: 'financial' },
  'payment.plan_created': { category: 'payment', visibility: 'financial' },
  'payment.deleted': { category: 'payment', visibility: 'financial' },
  'payment.down_payment_received': { category: 'payment', visibility: 'financial' },
  'payment.extra_received': { category: 'payment', visibility: 'financial' },
  'payment.status_changed': { category: 'payment', visibility: 'financial' },
  'receipt.reversed': { category: 'payment', visibility: 'financial' },
  'entry.paid_outside_os': { category: 'payment', visibility: 'financial' },
  'entry.edited': { category: 'payment', visibility: 'financial' },
  'commission.released': { category: 'commission', visibility: 'commission' },
  'commission.recalculated': { category: 'commission', visibility: 'commission' },
  'commission.regenerated': { category: 'commission', visibility: 'commission' },
  'commission.release_mode_changed': { category: 'commission', visibility: 'commission' },
  'commission.removed': { category: 'commission', visibility: 'commission' },
  'commission.paid': { category: 'commission', visibility: 'commission' },
  'commission.entry_edited': { category: 'commission', visibility: 'commission' },
  'commission.entry_deleted': { category: 'commission', visibility: 'commission' }
} as const satisfies Record<string, { category: OsEventCategory, visibility: OsEventVisibility }>

export type OsEventType = keyof typeof OS_EVENT_CATALOG

/**
 * Montagem PURA da chave de idempotência: `<tipo-do-efeito>:<parte>:...`. Cada efeito inclui o id da
 * transação/lançamento/comissão (ou, para efeitos sem entidade própria, o escopo da requisição),
 * então reenvio/retry da mesma gravação colapsa e efeitos distintos nunca colidem.
 * Lança se faltar alguma parte (chave ambígua); quem chama usa `recordOsEventsSafe`, que absorve o erro.
 */
export function osEventKey(kind: string, ...parts: Array<string | number | null | undefined>): string {
  const clean = parts.map(p => String(p ?? '').trim())
  if (!kind || !clean.length || clean.some(p => !p)) throw new Error(`idempotency key incompleta: ${kind}`)
  return [kind, ...clean].join(':')
}

/** Chaves por efeito (referência única, testável). `scope` = request id da requisição. */
export const OS_EVENT_KEYS = {
  installmentPaid: (installmentId: string, transactionId: string) => osEventKey('installment_paid', installmentId, transactionId),
  installmentRemoved: (installmentId: string) => osEventKey('installment_removed', installmentId),
  installmentEdited: (installmentId: string, scope: string) => osEventKey('installment_edited', installmentId, scope),
  planCreated: (orderId: string, scope: string) => osEventKey('payment_plan_created', orderId, scope),
  paymentDeleted: (orderId: string, scope: string) => osEventKey('payment_deleted', orderId, scope),
  downPayment: (transactionId: string) => osEventKey('down_payment', transactionId),
  extraPayment: (transactionId: string) => osEventKey('extra_payment', transactionId),
  paymentStatus: (orderId: string, scope: string, from: string, to: string) => osEventKey('payment_status', orderId, scope, from, to),
  receiptReversed: (transactionId: string) => osEventKey('receipt_reversed', transactionId),
  entryPaid: (entryId: string, scope: string) => osEventKey('entry_paid', entryId, scope),
  entryEdited: (entryId: string, scope: string) => osEventKey('entry_edited', entryId, scope),
  commissionReleased: (recordId: string) => osEventKey('commission_released', recordId),
  commissionRecalculatedRecord: (recordId: string, scope: string) => osEventKey('commission_recalculated_record', recordId, scope),
  commissionRecalculatedEmployee: (orderId: string, employeeId: string, scope: string) => osEventKey('commission_recalculated', orderId, employeeId, scope),
  commissionRegenerated: (orderId: string, scope: string) => osEventKey('commission_regenerated', orderId, scope),
  commissionReleaseMode: (orderId: string, scope: string) => osEventKey('commission_release_mode', orderId, scope),
  commissionRemoved: (recordId: string) => osEventKey('commission_removed', recordId),
  commissionPaid: (recordId: string, transactionId: string) => osEventKey('commission_paid', recordId, transactionId),
  commissionEntryEdited: (entryId: string, scope: string) => osEventKey('commission_entry_edited', entryId, scope),
  commissionEntryDeleted: (entryId: string) => osEventKey('commission_entry_deleted', entryId),
  orderCancelled: (orderId: string, scope: string) => osEventKey('order_cancelled', orderId, scope),
  orderCreated: (orderId: string) => osEventKey('order_created', orderId),
  orderFieldsChanged: (orderId: string, scope: string) => osEventKey('order_fields_changed', orderId, scope),
  orderItemsChanged: (orderId: string, scope: string) => osEventKey('order_items_changed', orderId, scope),
  orderResponsiblesChanged: (orderId: string, scope: string) => osEventKey('order_responsibles_changed', orderId, scope),
  orderStatusChanged: (orderId: string, scope: string, from: string, to: string) => osEventKey('order_status_changed', orderId, scope, from, to),
  orderDeleted: (orderId: string, scope: string) => osEventKey('order_deleted', orderId, scope)
} as const

/**
 * Escopo da requisição para chaves de efeitos sem entidade própria (request_id; aleatório só se faltar).
 * Atenção: a idempotência por escopo só deduplica o retry interno da mesma requisição (o helper regrava com a
 * mesma chave). Um REENVIO do cliente é outra requisição (outro request_id) e gera um novo evento.
 */
export function requestScope(event: H3Event | null | undefined): string {
  const id = event?.context?.audit?.requestId
  return typeof id === 'string' && id.trim() ? id.trim() : randomUUID()
}

/** Contexto de histórico repassado aos utilitários compartilhados (opcional: sem ele, nada é gravado). */
export interface OsHistoryContext {
  event: H3Event | null | undefined
  sourcePolicy: SourcePolicy
  /** Escopo calculado uma vez por requisição, para que chaves de efeitos da mesma ação coincidam. */
  scope?: string
}

export function historyContext(event: H3Event | null | undefined, sourcePolicy: SourcePolicy): OsHistoryContext {
  return { event, sourcePolicy, scope: requestScope(event) }
}

/** Políticas de origem por caminho (§5.1/§5.2). Origem é só informativa. */
export const OS_SOURCE_POLICIES = {
  osDetail: { defaultSource: 'os_detail' },
  // POST service-orders cria/edita/avança status: sem header cai em os_form; lista e detalhe declaram a própria tela.
  osForm: { defaultSource: 'os_form', allowedSources: ['os_list', 'os_detail'] },
  orderDelete: { defaultSource: 'os_detail', allowedSources: ['os_list'] },
  orderCancel: { defaultSource: 'os_detail', allowedSources: ['os_list'] },
  // Compartilhado por duas telas (card da OS e relatório): sem header cai no rótulo genérico do fluxo.
  commissionBulk: { defaultSource: 'commission_bulk', allowedSources: ['os_detail'] },
  commissionPay: { defaultSource: 'commission_report', allowedSources: ['bonus_page', 'os_detail'] },
  commissionDelete: { defaultSource: 'commission_report', allowedSources: ['os_detail'] },
  entriesBulk: { defaultSource: 'financial_bulk', allowedSources: ['financial_entries'] },
  financialEntries: { defaultSource: 'financial_entries' }
} as const satisfies Record<string, SourcePolicy>

type EventBuilder = () => OsEventInput[] | Promise<OsEventInput[]>

/** Monta o evento a partir do catálogo (categoria/visibilidade vêm do tipo, nunca do chamador). */
export function osEvent(
  type: OsEventType,
  base: { organizationId: string, serviceOrderId: string, entityType?: string, entityId?: string, idempotencyKey: string },
  payload: Record<string, unknown>
): OsEventInput {
  const meta = OS_EVENT_CATALOG[type]
  return { ...base, eventType: type, category: meta.category, visibility: meta.visibility, payload }
}

/**
 * Grava eventos montados sob demanda. Absorve QUALQUER erro (inclusive ao montar payload/chave ou ao ler
 * dados extras), porque o histórico nunca pode derrubar uma operação de negócio já concluída.
 */
export async function recordOsEventsSafe(
  event: H3Event | null | undefined,
  supabase: SupabaseClient,
  build: EventBuilder,
  sourcePolicy: SourcePolicy
): Promise<void> {
  try {
    const events = await build()
    if (events.length) await recordOsEvents(event, supabase, events, sourcePolicy)
  } catch (err) {
    console.error('[os-history] erro ao montar evento', { error: (err as Error)?.message })
  }
}

export function recordWithContext(ctx: OsHistoryContext | null | undefined, supabase: SupabaseClient, build: EventBuilder) {
  if (!ctx) return Promise.resolve()
  return recordOsEventsSafe(ctx.event, supabase, build, ctx.sourcePolicy)
}

// ---- Snapshots legíveis (nomes, nunca ids crus no texto) ----

export function snapshotMethod(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 30) : null
}

export function snapshotDate(value: unknown): string | null {
  const m = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(value) : null
  if (!m) return null
  const d = new Date(`${m[1]}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== m[1] ? null : m[1]!
}

export function snapshotMoney(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null
}

/** Cache por requisição (lotes de até 200): evita consultar o mesmo nome/conta/recebido repetidas vezes. */
export interface OsHistoryCache {
  employees: Map<string, string | null>
  accounts: Map<string, string | null>
  received: Map<string, number | null>
  /** Registros de comissão (employee_financial_records) já lidos em lote, por id. */
  records: Map<string, Record<string, unknown> | null>
}

export function createHistoryCache(): OsHistoryCache {
  return { employees: new Map(), accounts: new Map(), received: new Map(), records: new Map() }
}

export async function loadEmployeeNames(supabase: SupabaseClient, organizationId: string, ids: Array<string | null | undefined>, cache?: OsHistoryCache): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => typeof i === 'string' && !!i))]
  const out = new Map<string, string>()
  if (!unique.length) return out
  const missing = cache ? unique.filter(id => !cache.employees.has(id)) : unique
  if (missing.length) {
    try {
      const { data } = await supabase.from('employees').select('id, name').eq('organization_id', organizationId).in('id', missing)
      const found = new Map<string, string>()
      for (const row of data ?? []) if (typeof row.name === 'string' && row.name.trim()) found.set(String(row.id), row.name.trim())
      for (const id of missing) cache?.employees.set(id, found.get(id) ?? null)
      if (!cache) return found
    } catch { /* nome é só exibição */ }
  }
  if (cache) for (const id of unique) { const n = cache.employees.get(id); if (n) out.set(id, n) }
  return out
}

export async function loadBankAccountName(supabase: SupabaseClient, organizationId: string, accountId: string | null | undefined, cache?: OsHistoryCache): Promise<string | null> {
  if (!accountId) return null
  if (cache?.accounts.has(accountId)) return cache.accounts.get(accountId) ?? null
  try {
    const { data } = await supabase.from('bank_accounts').select('name').eq('id', accountId).eq('organization_id', organizationId).maybeSingle()
    const name = typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : null
    cache?.accounts.set(accountId, name)
    return name
  } catch { return null }
}

/** `true` se a OS já teve um evento desse tipo (qualquer momento). Nunca lança. */
export async function orderHasEvent(supabase: SupabaseClient, organizationId: string, orderId: string, eventType: string): Promise<boolean> {
  try {
    const { data } = await supabase.from('service_order_events').select('id').eq('organization_id', organizationId).eq('service_order_id', orderId).eq('event_type', eventType).limit(1)
    return Array.isArray(data) && data.length > 0
  } catch { return false }
}

/**
 * Ciclo mais recente: `true` se existe `payment.deleted` MAIS NOVO que o último `payment.plan_created`
 * (o plano atual é um plano refeito). Um plano antigo, já seguido de outro plano, não conta. Nunca lança.
 */
export async function planIsAfterRemoval(supabase: SupabaseClient, organizationId: string, orderId: string): Promise<boolean> {
  try {
    const latest = async (type: string) => {
      const { data } = await supabase.from('service_order_events').select('occurred_at').eq('organization_id', organizationId).eq('service_order_id', orderId).eq('event_type', type).order('occurred_at', { ascending: false }).limit(1)
      const at = Array.isArray(data) && data[0] ? String((data[0] as { occurred_at?: string }).occurred_at ?? '') : ''
      return at || null
    }
    const removed = await latest('payment.deleted')
    if (!removed) return false
    const planned = await latest('payment.plan_created')
    return !planned || removed > planned
  } catch { return false }
}

export type CommissionRecordLike = {
  id: string
  employee_id?: string | null
  service_order_id?: string | null
  record_type?: string | null
  amount?: number | string | null
  status?: string | null
}

/** Payload comum de comissão removida (snapshot legível). */
export function commissionRemovedPayload(record: CommissionRecordLike, employeeName: string | null, reason: string, extra: Record<string, unknown> = {}) {
  return {
    employee_name: employeeName,
    amount: snapshotMoney(record.amount),
    was_paid: record.status === 'paid',
    reason,
    ...extra
  }
}

export type EntryLink =
  | { kind: 'commission', serviceOrderId: string, recordId: string, employeeName: string | null, recordPaid: boolean }
  | { kind: 'entry', serviceOrderId: string }

/**
 * Descobre se um lançamento financeiro está ligado a uma OS: registro de comissão (=> commission.*)
 * ou recebimento da OS (=> entry.*). Nunca os dois para o mesmo registro. `null` = sem vínculo com OS.
 */
export async function resolveEntryOsLink(
  supabase: SupabaseClient,
  organizationId: string,
  entry: { employee_financial_record_id?: string | null, service_order_id?: string | null },
  cache?: OsHistoryCache
): Promise<EntryLink | null> {
  if (entry.employee_financial_record_id) {
    const recordId = String(entry.employee_financial_record_id)
    const cached = cache?.records.has(recordId)
    const rec = cached
      ? cache!.records.get(recordId) as { id: string, employee_id: string, service_order_id: string | null, record_type: string, status: string } | null
      : (await supabase
          .from('employee_financial_records')
          .select('id, employee_id, service_order_id, record_type, status')
          .eq('id', recordId)
          .eq('organization_id', organizationId)
          .maybeSingle()).data
    if (rec?.service_order_id && rec.record_type === 'commission') {
      const names = await loadEmployeeNames(supabase, organizationId, [rec.employee_id], cache)
      return { kind: 'commission', serviceOrderId: String(rec.service_order_id), recordId: String(rec.id), employeeName: names.get(String(rec.employee_id)) ?? null, recordPaid: rec.status === 'paid' }
    }
    // Registro de funcionário que não é comissão de OS: sem evento de OS.
    return entry.service_order_id ? { kind: 'entry', serviceOrderId: String(entry.service_order_id) } : null
  }
  return entry.service_order_id ? { kind: 'entry', serviceOrderId: String(entry.service_order_id) } : null
}

/**
 * Caixa realmente recebido na OS: soma das transações `income` pagas e ativas ligadas à OS (inclui sinal, avulso e
 * recebimento parcial de parcela). NÃO usa o valor da parcela (parcela parcial teria valor cheio sem caixa).
 * Serve para sinalizar "comissão paga sem recebimento". `null` se não deu para ler. Cache por requisição.
 */
export async function orderReceivedTotal(supabase: SupabaseClient, organizationId: string, orderId: string, cache?: OsHistoryCache): Promise<number | null> {
  if (cache?.received.has(orderId)) return cache.received.get(orderId) ?? null
  try {
    const { data, error } = await supabase
      .from('financial_transactions')
      .select('amount')
      .eq('service_order_id', orderId)
      .eq('organization_id', organizationId)
      .eq('type', 'income')
      .eq('status', 'paid')
      .is('deleted_at', null)
    if (error) return null
    const total = (data ?? []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
    cache?.received.set(orderId, total)
    return total
  } catch { return null }
}

/**
 * Pré-carrega o caixa recebido de várias OS com UMA consulta (`.in`), com o mesmo critério de `orderReceivedTotal`,
 * e preenche o cache (OS sem recebimento = 0). Só otimização: em erro não preenche e cada OS cai na consulta individual.
 */
export async function prefetchReceivedTotals(supabase: SupabaseClient, organizationId: string, orderIds: Array<string | null | undefined>, cache: OsHistoryCache): Promise<void> {
  try {
    const ids = [...new Set(orderIds.filter((i): i is string => typeof i === 'string' && !!i))].filter(id => !cache.received.has(id))
    if (!ids.length) return
    const { data, error } = await supabase
      .from('financial_transactions')
      .select('service_order_id, amount')
      .in('service_order_id', ids)
      .eq('organization_id', organizationId)
      .eq('type', 'income')
      .eq('status', 'paid')
      .is('deleted_at', null)
    if (error) return
    const totals = new Map<string, number>(ids.map(id => [id, 0]))
    for (const r of data ?? []) totals.set(String(r.service_order_id), (totals.get(String(r.service_order_id)) ?? 0) + (Number(r.amount) || 0))
    for (const [id, total] of totals) cache.received.set(id, total)
  } catch { /* só otimização */ }
}

/**
 * Evento `commission.paid` (snapshot legível). `viaEntry`: o pagamento veio de um lançamento financeiro,
 * e `recordSynced` diz se o registro da comissão também foi marcado como pago (financial/[id]/pay não sincroniza: D13).
 * `paymentDate`: em financial/[id]/pay é o vencimento (`due_date`), não a data efetiva do pagamento, coerente com o extrato gravado.
 */
export async function buildCommissionPaidEvent(supabase: SupabaseClient, p: {
  organizationId: string
  serviceOrderId: string
  recordId: string
  employeeId?: string | null
  employeeName?: string | null
  amount: unknown
  paymentDate: unknown
  bankAccountId?: string | null
  transactionId: string
  viaEntry?: boolean
  recordSynced?: boolean
  cache?: OsHistoryCache
}): Promise<OsEventInput> {
  const name = p.employeeName ?? (p.employeeId ? (await loadEmployeeNames(supabase, p.organizationId, [p.employeeId], p.cache)).get(p.employeeId) ?? null : null)
  const received = await orderReceivedTotal(supabase, p.organizationId, p.serviceOrderId, p.cache)
  return osEvent('commission.paid', {
    organizationId: p.organizationId,
    serviceOrderId: p.serviceOrderId,
    entityType: 'employee_financial_record',
    entityId: p.recordId,
    idempotencyKey: OS_EVENT_KEYS.commissionPaid(p.recordId, p.transactionId)
  }, {
    employee_name: name,
    amount: snapshotMoney(p.amount),
    payment_date: snapshotDate(p.paymentDate),
    bank_account_name: await loadBankAccountName(supabase, p.organizationId, p.bankAccountId, p.cache),
    // Comissão paga antes de a OS ter qualquer recebimento (modo `full` ou lançamento manual): sensível, só `commission`.
    without_receipt: received === 0,
    ...(p.viaEntry ? { via_entry: true, record_synced: p.recordSynced !== false } : {})
  })
}

export type EntryChange = { field: 'amount' | 'due_date' | 'status' | 'bank_account' | 'description', from: unknown, to: unknown }

/** Diferenças relevantes entre dois estados de um lançamento (allowlist; conta vira nome, nunca id). */
export async function entryChangeSet(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  accountName: (id: string | null) => Promise<string | null>
): Promise<EntryChange[]> {
  const out: EntryChange[] = []
  const amountChanged = Math.abs((Number(before.amount) || 0) - (Number(after.amount) || 0)) > 0.001
  if (amountChanged) out.push({ field: 'amount', from: snapshotMoney(before.amount), to: snapshotMoney(after.amount) })
  if ((before.due_date ?? null) !== (after.due_date ?? null)) out.push({ field: 'due_date', from: snapshotDate(before.due_date), to: snapshotDate(after.due_date) })
  if ((before.status ?? null) !== (after.status ?? null)) out.push({ field: 'status', from: before.status ?? null, to: after.status ?? null })
  if ((before.bank_account_id ?? null) !== (after.bank_account_id ?? null)) {
    out.push({
      field: 'bank_account',
      from: await accountName((before.bank_account_id as string | null) ?? null),
      to: await accountName((after.bank_account_id as string | null) ?? null)
    })
  }
  if ((before.description ?? null) !== (after.description ?? null)) {
    out.push({ field: 'description', from: String(before.description ?? '').slice(0, 200) || null, to: String(after.description ?? '').slice(0, 200) || null })
  }
  return out
}

/**
 * Pré-carrega em lote (1 consulta de registros + 1 de nomes) o que `resolveEntryOsLink` vai precisar para vários
 * lançamentos de uma vez (lotes de até 200). Só leitura e best-effort: sem ele, as consultas seguem uma a uma.
 */
export async function prefetchEntryLinks(
  supabase: SupabaseClient,
  organizationId: string,
  entries: Array<{ employee_financial_record_id?: string | null }>,
  cache: OsHistoryCache
): Promise<void> {
  try {
    const ids = [...new Set(entries.map(e => e.employee_financial_record_id).filter((i): i is string => !!i))]
    if (!ids.length) return
    const { data } = await supabase
      .from('employee_financial_records')
      .select('id, employee_id, service_order_id, record_type, status')
      .eq('organization_id', organizationId)
      .in('id', ids)
    const byId = new Map((data ?? []).map(r => [String(r.id), r as Record<string, unknown>]))
    for (const id of ids) cache.records.set(id, byId.get(id) ?? null)
    await loadEmployeeNames(supabase, organizationId, [...byId.values()].map(r => r.employee_id as string), cache)
  } catch { /* só otimização */ }
}
