import type { SupabaseClient } from '@supabase/supabase-js'
import type { OsEventInput } from './record'
import { OS_EVENT_KEYS, osEvent, snapshotDate } from './events'

/**
 * Eventos de agendamento vinculado à OS (F3). Só LEITURA + montagem de payload; nunca lança para quem usa
 * `recordWithContext`. O evento só existe quando há OS vinculada e a OS pertence à MESMA organização do usuário.
 */

export interface AppointmentSnap {
  service_order_id: string | null
  appointment_date: string | null
  time: string | null
  status: string | null
  service_type: string | null
}

const text = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

export function snapshotTime(value: unknown): string | null {
  const m = typeof value === 'string' ? /^(\d{2}):(\d{2})/.exec(value.trim()) : null
  return m ? `${m[1]}:${m[2]}` : null
}

export function toAppointmentSnap(row: Record<string, unknown> | null | undefined): AppointmentSnap | null {
  if (!row) return null
  return {
    service_order_id: text(row.service_order_id, 64),
    appointment_date: snapshotDate(row.appointment_date),
    time: snapshotTime(row.time),
    status: text(row.status, 30),
    service_type: text(row.service_type)
  }
}

/** Estado anterior do agendamento (leitura extra, nunca lança). `null` = não deu para ler. */
export async function loadAppointmentSnap(supabase: SupabaseClient, organizationId: string, id: string): Promise<AppointmentSnap | null> {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('service_order_id, appointment_date, time, status, service_type')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (error) return null
    return toAppointmentSnap(data as Record<string, unknown> | null)
  } catch { return null }
}

/** `true` só se a OS existe, não está excluída e é da organização. Nunca lança. */
export async function orderBelongsToOrg(supabase: SupabaseClient, organizationId: string, orderId: string | null | undefined): Promise<boolean> {
  if (!orderId) return false
  try {
    const { data, error } = await supabase
      .from('service_orders')
      .select('id')
      .eq('id', orderId)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .maybeSingle()
    return !error && !!data
  } catch { return false }
}

export type AppointmentChange = { field: 'date' | 'time' | 'status' | 'service_type', from: string | null, to: string | null }

export function diffAppointment(before: AppointmentSnap, after: AppointmentSnap): AppointmentChange[] {
  const out: AppointmentChange[] = []
  if (before.appointment_date !== after.appointment_date) out.push({ field: 'date', from: before.appointment_date, to: after.appointment_date })
  if (before.time !== after.time) out.push({ field: 'time', from: before.time, to: after.time })
  if (before.status !== after.status) out.push({ field: 'status', from: before.status, to: after.status })
  if (before.service_type !== after.service_type) out.push({ field: 'service_type', from: before.service_type, to: after.service_type })
  return out
}

const when = (s: AppointmentSnap) => ({ date: s.appointment_date, time: s.time })

/**
 * Monta os eventos de um agendamento. `before = null` => criação. `after = null` => exclusão (usa `before`).
 * Trocar de OS gera `unlinked` na OS antiga e `linked` na nova (cada uma só se for da organização).
 */
export async function buildAppointmentEvents(
  supabase: SupabaseClient,
  p: { organizationId: string, appointmentId: string, before: AppointmentSnap | null, after: AppointmentSnap | null, scope: string }
): Promise<OsEventInput[]> {
  const { organizationId, appointmentId, before, after, scope } = p
  const out: OsEventInput[] = []
  const entity = { entityType: 'appointment', entityId: appointmentId }
  const valid = new Map<string, boolean>()
  const ok = async (orderId: string | null) => {
    if (!orderId) return false
    if (!valid.has(orderId)) valid.set(orderId, await orderBelongsToOrg(supabase, organizationId, orderId))
    return valid.get(orderId)!
  }

  if (!after) {
    // Exclusão do agendamento.
    if (before?.service_order_id && await ok(before.service_order_id)) {
      out.push(osEvent('appointment.removed', { organizationId, serviceOrderId: before.service_order_id, ...entity, idempotencyKey: OS_EVENT_KEYS.appointmentRemoved(appointmentId) }, { ...when(before), status: before.status }))
    }
    return out
  }

  const bOrder = before?.service_order_id ?? null
  const aOrder = after.service_order_id

  if (before && bOrder && bOrder !== aOrder && await ok(bOrder)) {
    out.push(osEvent('appointment.unlinked', { organizationId, serviceOrderId: bOrder, ...entity, idempotencyKey: OS_EVENT_KEYS.appointmentUnlinked(appointmentId, bOrder, scope) }, { ...when(before) }))
  }
  if (aOrder && aOrder !== bOrder && await ok(aOrder)) {
    out.push(osEvent('appointment.linked', { organizationId, serviceOrderId: aOrder, ...entity, idempotencyKey: OS_EVENT_KEYS.appointmentLinked(appointmentId, aOrder, scope) }, { ...when(after), status: after.status, created: !before }))
  }
  if (before && aOrder && aOrder === bOrder && await ok(aOrder)) {
    const changes = diffAppointment(before, after)
    const cancelled = after.status === 'cancelled' && before.status !== 'cancelled'
    const rest = cancelled ? changes.filter(c => c.field !== 'status') : changes
    if (cancelled) {
      out.push(osEvent('appointment.cancelled', { organizationId, serviceOrderId: aOrder, ...entity, idempotencyKey: OS_EVENT_KEYS.appointmentCancelled(appointmentId, scope) }, { ...when(before) }))
    }
    if (rest.length) {
      out.push(osEvent('appointment.changed', { organizationId, serviceOrderId: aOrder, ...entity, idempotencyKey: OS_EVENT_KEYS.appointmentChanged(appointmentId, scope) }, { changes: rest }))
    }
  }
  return out
}

/** Agendamento criado junto da OS (POST service-orders com `appointmentData`). */
export function buildAppointmentCreatedWithOrderEvent(organizationId: string, orderId: string, appointment: Record<string, unknown>): OsEventInput {
  const snap = toAppointmentSnap(appointment)
  const id = String(appointment.id)
  return osEvent('appointment.created', {
    organizationId, serviceOrderId: orderId, entityType: 'appointment', entityId: id,
    idempotencyKey: OS_EVENT_KEYS.appointmentCreated(id)
  }, { date: snap?.appointment_date ?? null, time: snap?.time ?? null, status: snap?.status ?? null })
}
