import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

const VALID_FUEL_TYPES = ['gasoline', 'ethanol', 'diesel', 'flex', 'cng', 'electric', 'hybrid']

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'vehicles.create', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)

  if (!body.client_id)
    throw createError({ statusCode: 400, statusMessage: 'O campo "client_id" é obrigatório' })

  if (body.fuel_type && !VALID_FUEL_TYPES.includes(body.fuel_type))
    throw createError({ statusCode: 400, statusMessage: `O campo "fuel_type" deve ser um dos valores: ${VALID_FUEL_TYPES.join(', ')}` })

  // Verify the client belongs to the same organization
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

  const { data: item, error } = await supabase
    .from('vehicles')
    .insert({
      organization_id: organizationId,
      client_id: body.client_id,
      license_plate: body.license_plate ?? null,
      brand: body.brand ?? null,
      model: body.model ?? null,
      year: body.year != null ? Number(body.year) : null,
      color: body.color ?? null,
      engine: body.engine ?? null,
      fuel_type: body.fuel_type ?? null,
      mileage: body.mileage != null ? Number(body.mileage) : null,
      notes: body.notes ?? null,
      created_by: authUser.email,
      updated_by: authUser.email
    })
    .select()
    .single()

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  return { item }
})
