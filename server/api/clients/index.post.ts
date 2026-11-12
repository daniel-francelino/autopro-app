import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'customers.create', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)

  if (!body.name)
    throw createError({ statusCode: 400, statusMessage: 'O campo "name" é obrigatório' })
  if (!body.phone)
    throw createError({ statusCode: 400, statusMessage: 'O campo "phone" é obrigatório' })
  if (!body.person_type)
    throw createError({ statusCode: 400, statusMessage: 'O campo "person_type" é obrigatório' })
  if (!['pf', 'pj'].includes(body.person_type))
    throw createError({ statusCode: 400, statusMessage: 'O campo "person_type" deve ser "pf" ou "pj"' })

  const { data: item, error } = await supabase
    .from('clients')
    .insert({
      organization_id: organizationId,
      name: body.name,
      phone: body.phone,
      person_type: body.person_type,
      tax_id: body.tax_id ?? null,
      email: body.email ?? null,
      mobile_phone: body.mobile_phone ?? null,
      birth_date: body.birth_date ?? null,
      zip_code: body.zip_code ?? null,
      street: body.street ?? null,
      address_number: body.address_number ?? null,
      address_complement: body.address_complement ?? null,
      neighborhood: body.neighborhood ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      responsible_employees: body.responsible_employees ?? null,
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
