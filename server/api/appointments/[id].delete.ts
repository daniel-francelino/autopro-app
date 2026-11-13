import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { OS_SOURCE_POLICIES, historyContext, recordWithContext } from '../../utils/os-history/events'
import { buildAppointmentEvents, loadAppointmentSnap } from '../../utils/os-history/appointment-events'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'appointments.delete', event)
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

  // Histórico da OS: estado antes da exclusão (leitura extra que nunca propaga erro).
  const beforeSnap = await loadAppointmentSnap(supabase, organizationId, id)

  const { error } = await supabase
    .from('appointments')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: authUser.email
    })
    .eq('id', id)

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  if (beforeSnap?.service_order_id) {
    const history = historyContext(event, OS_SOURCE_POLICIES.appointments)
    await recordWithContext(history, supabase, () => buildAppointmentEvents(supabase, {
      organizationId, appointmentId: id, before: beforeSnap, after: null, scope: history.scope!
    }))
  }

  return { success: true }
})
