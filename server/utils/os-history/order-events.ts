import type { SupabaseClient } from '@supabase/supabase-js'
import type { OsEventInput } from './record'
import { OS_EVENT_KEYS, loadEmployeeNames, osEvent } from './events'
import { diffItems, diffOrderFields, diffRefs, diffResponsibles, type FieldChange, type OrderRefField } from './diff'

/**
 * Montagem dos eventos de edição/status/criação/exclusão da OS (F2). Só LEITURA, nunca lança para quem usa
 * `recordWithContext` (que absorve erros). Compara o estado anterior (já carregado pelo handler) ao salvo.
 */

const REF_FIELD_KEY: Record<OrderRefField, string> = {
  client_id: 'client',
  vehicle_id: 'vehicle',
  employee_responsible_id: 'employee_responsible',
  master_product_id: 'master_product'
}

const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

type Names = Map<string, string>

/** Nomes (snapshot) para os ids que mudaram. Falha de leitura => sem nome (o renderizador usa fallback). */
async function loadRefNames(supabase: SupabaseClient, organizationId: string, refs: ReturnType<typeof diffRefs>): Promise<Record<OrderRefField, Names>> {
  const out: Record<OrderRefField, Names> = { client_id: new Map(), vehicle_id: new Map(), employee_responsible_id: new Map(), master_product_id: new Map() }
  const ids = (f: OrderRefField) => refs.filter(r => r.field === f).flatMap(r => [r.from, r.to]).filter((i): i is string => !!i)
  const tasks: Array<Promise<void>> = []
  const simple = (field: OrderRefField, table: string, select: string, label: (r: Record<string, unknown>) => string | null) => {
    const list = ids(field)
    if (!list.length) return
    tasks.push((async () => {
      try {
        const { data } = await supabase.from(table).select(select).eq('organization_id', organizationId).in('id', list)
        for (const r of (data ?? []) as unknown as Array<Record<string, unknown>>) {
          const l = label(r)
          if (l) out[field].set(String(r.id), l)
        }
      } catch { /* nome é só exibição */ }
    })())
  }
  simple('client_id', 'clients', 'id, name', r => clean(r.name))
  simple('master_product_id', 'master_products', 'id, name', r => clean(r.name))
  simple('vehicle_id', 'vehicles', 'id, brand, model, license_plate', (r) => {
    const base = [clean(r.brand), clean(r.model)].filter(Boolean).join(' ')
    const plate = clean(r.license_plate)
    return base && plate ? `${base} (${plate})` : (base || plate)
  })
  const empIds = ids('employee_responsible_id')
  if (empIds.length) tasks.push(loadEmployeeNames(supabase, organizationId, empIds).then((m) => { for (const [k, v] of m) out.employee_responsible_id.set(k, v) }))
  await Promise.all(tasks)
  return out
}

export function buildOrderCreatedEvent(organizationId: string, order: { id: string, number?: unknown }): OsEventInput {
  return osEvent('order.created', {
    organizationId, serviceOrderId: order.id, entityType: 'service_order', entityId: order.id,
    idempotencyKey: OS_EVENT_KEYS.orderCreated(order.id)
  }, { order_number: clean(order.number) ?? (order.number != null ? String(order.number) : null) })
}

export function buildOrderDeletedEvent(organizationId: string, orderId: string, orderNumber: unknown, scope: string): OsEventInput {
  return osEvent('order.deleted', {
    organizationId, serviceOrderId: orderId, entityType: 'service_order', entityId: orderId,
    idempotencyKey: OS_EVENT_KEYS.orderDeleted(orderId, scope)
  }, { order_number: orderNumber != null ? String(orderNumber) : null })
}

export async function buildOrderUpdateEvents(
  supabase: SupabaseClient,
  p: { organizationId: string, orderId: string, before: Record<string, unknown>, after: Record<string, unknown>, scope: string }
): Promise<OsEventInput[]> {
  const { organizationId, orderId, before, after, scope } = p
  const base = { organizationId, serviceOrderId: orderId, entityType: 'service_order', entityId: orderId }
  const events: OsEventInput[] = []

  const fromStatus = clean(before.status); const toStatus = clean(after.status)
  if (fromStatus !== toStatus && (fromStatus || toStatus)) {
    events.push(osEvent('order.status_changed', { ...base, idempotencyKey: OS_EVENT_KEYS.orderStatusChanged(orderId, scope, fromStatus ?? 'none', toStatus ?? 'none') }, { from: fromStatus, to: toStatus }))
  }

  const changes: FieldChange[] = diffOrderFields(before, after)
  const refs = diffRefs(before, after)
  if (refs.length) {
    const names = await loadRefNames(supabase, organizationId, refs)
    for (const r of refs) {
      changes.push({
        field: REF_FIELD_KEY[r.field],
        from: r.from ? (names[r.field].get(r.from) ?? '(sem nome)') : null,
        to: r.to ? (names[r.field].get(r.to) ?? '(sem nome)') : null
      })
    }
  }
  if (changes.length) events.push(osEvent('order.fields_changed', { ...base, idempotencyKey: OS_EVENT_KEYS.orderFieldsChanged(orderId, scope) }, { changes }))

  const items = diffItems(before.items, after.items)
  if (items.total > 0) events.push(osEvent('order.items_changed', { ...base, idempotencyKey: OS_EVENT_KEYS.orderItemsChanged(orderId, scope) }, { lines: items.lines, more: items.more }))

  const resp = diffResponsibles(before.responsible_employees, after.responsible_employees)
  if (resp.added.length || resp.removed.length) {
    const names = await loadEmployeeNames(supabase, organizationId, [...resp.added, ...resp.removed])
    const nm = (id: string) => names.get(id) ?? '(sem nome)'
    events.push(osEvent('order.responsibles_changed', { ...base, idempotencyKey: OS_EVENT_KEYS.orderResponsiblesChanged(orderId, scope) }, { added: resp.added.map(nm), removed: resp.removed.map(nm) }))
  }
  return events
}
