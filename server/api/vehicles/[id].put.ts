import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

const VALID_FUEL_TYPES = ['gasoline', 'ethanol', 'diesel', 'flex', 'cng', 'electric', 'hybrid']

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'vehicles.update', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID obrigatório' })

  const { data: existing, error: findError } = await supabase
    .from('vehicles')
    .select('id')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (findError)
    throw createError({ statusCode: 500, statusMessage: findError.message })

  if (!existing)
    throw createError({ statusCode: 404, statusMessage: 'Veículo não encontrado' })

  const body = await readBody(event)

  if (body.fuel_type && !VALID_FUEL_TYPES.includes(body.fuel_type))
    throw createError({ statusCode: 400, statusMessage: `O campo "fuel_type" deve ser um dos valores: ${VALID_FUEL_TYPES.join(', ')}` })

  // If client_id is being changed, verify the new client belongs to the same org
  if (body.client_id) {
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id')
      .eq('id', body.client_id)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .maybeSingle()

    if (clientError)
      throw createError({ statusCode: 500, statusMessage: clientError.message })

    if (!client)
      throw createError({ statusCode: 404, statusMessage: 'Cliente não encontrado nesta organização' })
  }

  const updates: Record<string, unknown> = {
    updated_by: authUser.email
  }

  const updatableFields = [
    'client_id', 'license_plate', 'brand', 'model',
    'color', 'engine', 'fuel_type', 'notes'
  ]

  for (const field of updatableFields) {
    if (body[field] !== undefined)
      updates[field] = body[field]
  }

  if (body.year !== undefined)
    updates.year = body.year != null ? Number(body.year) : null

  if (body.mileage !== undefined)
    updates.mileage = body.mileage != null ? Number(body.mileage) : null

  const { data: item, error } = await supabase
    .from('vehicles')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  return { item }
})
