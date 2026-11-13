import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { OS_SOURCE_POLICIES, historyContext, recordWithContext } from '../../utils/os-history/events'
import { buildAppointmentEvents, loadAppointmentSnap, toAppointmentSnap } from '../../utils/os-history/appointment-events'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'appointments.update', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID obrigatório' })

  const { data: existing, error: findError } = await supabase
    .from('appointments')
    .select('id')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (findError)
    throw createError({ statusCode: 500, statusMessage: findError.message })
  if (!existing)
    throw createError({ statusCode: 404, statusMessage: 'Agendamento não encontrado' })

  const body = await readBody(event)

  const updates: Record<string, unknown> = { updated_by: authUser.email }

  const updatableFields = [
    'client_id', 'vehicle_id', 'appointment_date', 'time',
    'service_type', 'priority', 'status', 'service_order_id', 'notes'
  ]

  for (const field of updatableFields) {
    if (body[field] !== undefined)
      updates[field] = body[field]
  }

  // Histórico da OS: estado anterior (leitura extra que nunca propaga erro).
  const beforeSnap = await loadAppointmentSnap(supabase, organizationId, id)

  const { data: item, error } = await supabase
    .from('appointments')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  // Só se havia estado anterior legível e (antes ou depois) existe OS vinculada, depois do update confirmado.
  if (beforeSnap && (beforeSnap.service_order_id || item?.service_order_id)) {
    const history = historyContext(event, OS_SOURCE_POLICIES.appointments)
    await recordWithContext(history, supabase, () => buildAppointmentEvents(supabase, {
      organizationId, appointmentId: id, before: beforeSnap, after: toAppointmentSnap(item), scope: history.scope!
    }))
  }

  return { item }
})
