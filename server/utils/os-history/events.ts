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
  'installment.paid': { category: 'payment', visibility: 'financial' },
  'installment.removed': { category: 'payment', visibility: 'financial' },
  'payment.plan_created': { category: 'payment', visibility: 'financial' },
  'payment.deleted': { category: 'payment', visibility: 'financial' },
  'payment.down_payment_received': { category: 'payment', visibility: 'financial' },
  'payment.extra_received': { category: 'payment', visibility: 'financial' },
  'payment.status_changed': { category: 'payment', visibility: 'financial' },
  'receipt.reversed': { category: 'payment', visibility: 'financial' },
  'entry.paid_outside_os': { category: 'payment', visibility: 'financial' },
  'entry.edited': { category: 'payment', visibility: 'financial' },
  'entry.deleted': { category: 'payment', visibility: 'financial' },
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
  planCreated: (orderId: string, scope: string) => osEventKey('payment_plan_created', orderId, scope),
  paymentDeleted: (orderId: string, scope: string) => osEventKey('payment_deleted', orderId, scope),
  downPayment: (transactionId: string) => osEventKey('down_payment', transactionId),
  extraPayment: (transactionId: string) => osEventKey('extra_payment', transactionId),
  paymentStatus: (orderId: string, scope: string, from: string, to: string) => osEventKey('payment_status', orderId, scope, from, to),
  receiptReversed: (transactionId: string) => osEventKey('receipt_reversed', transactionId),
  entryPaid: (entryId: string, scope: string) => osEventKey('entry_paid', entryId, scope),
  entryEdited: (entryId: string, scope: string) => osEventKey('entry_edited', entryId, scope),
  entryDeleted: (entryId: string) => osEventKey('entry_deleted', entryId),
  commissionReleased: (recordId: string) => osEventKey('commission_released', recordId),
  commissionRecalculatedRecord: (recordId: string, scope: string) => osEventKey('commission_recalculated_record', recordId, scope),
  commissionRecalculatedEmployee: (orderId: string, employeeId: string, scope: string) => osEventKey('commission_recalculated', orderId, employeeId, scope),
  commissionRegenerated: (orderId: string, scope: string) => osEventKey('commission_regenerated', orderId, scope),
  commissionReleaseMode: (orderId: string, scope: string) => osEventKey('commission_release_mode', orderId, scope),
  commissionRemoved: (recordId: string) => osEventKey('commission_removed', recordId),
  commissionPaid: (recordId: string, transactionId: string) => osEventKey('commission_paid', recordId, transactionId),
  commissionEntryEdited: (entryId: string, scope: string) => osEventKey('commission_entry_edited', entryId, scope),
  commissionEntryDeleted: (entryId: string) => osEventKey('commission_entry_deleted', entryId),
  orderCancelled: (orderId: string, scope: string) => osEventKey('order_cancelled', orderId, scope)
} as const

/** Escopo da requisição para chaves de efeitos sem entidade própria (request_id; aleatório só se faltar). */
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
  orderCancel: { defaultSource: 'os_detail', allowedSources: ['os_list'] },
  receiptFromFinancial: { defaultSource: 'financial_entries' },
  // Compartilhado por duas telas (card da OS e relatório): sem header cai no rótulo genérico do fluxo.
  commissionBulk: { defaultSource: 'commission_bulk', allowedSources: ['os_detail', 'commission_report'] },
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

export async function loadEmployeeNames(supabase: SupabaseClient, organizationId: string, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => typeof i === 'string' && !!i))]
  const out = new Map<string, string>()
  if (!unique.length) return out
  try {
    const { data } = await supabase.from('employees').select('id, name').eq('organization_id', organizationId).in('id', unique)
    for (const row of data ?? []) if (typeof row.name === 'string' && row.name.trim()) out.set(String(row.id), row.name.trim())
  } catch { /* nome é só exibição */ }
  return out
}

export async function loadBankAccountName(supabase: SupabaseClient, organizationId: string, accountId: string | null | undefined): Promise<string | null> {
  if (!accountId) return null
  try {
    const { data } = await supabase.from('bank_accounts').select('name').eq('id', accountId).eq('organization_id', organizationId).maybeSingle()
    return typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : null
  } catch { return null }
}

/** `true` se a OS já teve um evento desse tipo (ex.: pagamento removido antes de gerar um plano novo). Nunca lança. */
export async function orderHasEvent(supabase: SupabaseClient, organizationId: string, orderId: string, eventType: string): Promise<boolean> {
  try {
    const { data } = await supabase.from('service_order_events').select('id').eq('organization_id', organizationId).eq('service_order_id', orderId).eq('event_type', eventType).limit(1)
    return Array.isArray(data) && data.length > 0
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
  entry: { employee_financial_record_id?: string | null, service_order_id?: string | null }
): Promise<EntryLink | null> {
  if (entry.employee_financial_record_id) {
    const { data: rec } = await supabase
      .from('employee_financial_records')
      .select('id, employee_id, service_order_id, record_type, status')
      .eq('id', entry.employee_financial_record_id)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (rec?.service_order_id && rec.record_type === 'commission') {
      const names = await loadEmployeeNames(supabase, organizationId, [rec.employee_id])
      return { kind: 'commission', serviceOrderId: String(rec.service_order_id), recordId: String(rec.id), employeeName: names.get(String(rec.employee_id)) ?? null, recordPaid: rec.status === 'paid' }
    }
    // Registro de funcionário que não é comissão de OS: sem evento de OS.
    return entry.service_order_id ? { kind: 'entry', serviceOrderId: String(entry.service_order_id) } : null
  }
  return entry.service_order_id ? { kind: 'entry', serviceOrderId: String(entry.service_order_id) } : null
}
