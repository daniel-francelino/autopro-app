import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'
import { recordAudit } from '../../../utils/audit/record'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID obrigatório' })

  // Verify the role belongs to this org (only org-specific roles can be mutated)
  const { data: role } = await supabase
    .from('roles')
    .select('id')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!role) throw createError({ statusCode: 404, statusMessage: 'Perfil não encontrado' })

  const body = await readBody(event)
  const { action_id, is_granted } = body

  if (!action_id || is_granted === undefined || is_granted === null)
    throw createError({ statusCode: 400, statusMessage: 'action_id e is_granted são obrigatórios' })

  // Check if a role_action record already exists
  const { data: existing } = await supabase
    .from('role_actions')
    .select('id, is_granted')
    .eq('role_id', id)
    .eq('action_id', action_id)
    .maybeSingle()

  let item
  let error

  if (existing) {
    // Update existing record
    const result = await supabase
      .from('role_actions')
      .update({ is_granted })
      .eq('id', existing.id)
      .select()
      .single()
    item = result.data
    error = result.error
  } else {
    // Create new record
    const result = await supabase
      .from('role_actions')
      .insert({ role_id: id, action_id, is_granted })
      .select()
      .single()
    item = result.data
    error = result.error
  }

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  // Auditoria: qual permissão mudou e de quê para quê (código da ação, não só o id).
  const { data: actionRow } = await supabase.from('actions').select('code').eq('id', action_id).maybeSingle()
  recordAudit(event, {
    resourceType: 'role',
    resourceId: id,
    before: existing ? { is_granted: existing.is_granted } : { is_granted: null },
    after: { is_granted },
    extra: { action_id, action_code: actionRow?.code ?? null }
  })

  return { item }
})
