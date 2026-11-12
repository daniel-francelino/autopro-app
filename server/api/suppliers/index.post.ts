import { defineEventHandler, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

/**
 * POST /api/suppliers
 * Creates a new supplier record.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'suppliers.create', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)

  if (!body?.name?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'name is required' })
  }
  if (!body?.person_type?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'person_type is required' })
  }
  if (!body?.phone?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'phone is required' })
  }

  const payload: Record<string, unknown> = {
    organization_id: organizationId,
    name: body.name.trim(),
    person_type: body.person_type.trim(),
    phone: body.phone.trim(),
    trade_name: body.trade_name ?? null,
    tax_id: body.tax_id ?? null,
    state_registration: body.state_registration ?? null,
    whatsapp: body.whatsapp ?? null,
    email: body.email ?? null,
    website: body.website ?? null,
    zip_code: body.zip_code ?? null,
    street: body.street ?? null,
    address_number: body.address_number ?? null,
    address_complement: body.address_complement ?? null,
    neighborhood: body.neighborhood ?? null,
    city: body.city ?? null,
    state: body.state ?? null,
    contact_name: body.contact_name ?? null,
    contact_role: body.contact_role ?? null,
    contact_phone: body.contact_phone ?? null,
    contact_email: body.contact_email ?? null,
    category: body.category ?? null,
    payment_term_days: body.payment_term_days ?? null,
    credit_limit: body.credit_limit ?? null,
    is_active: body.is_active ?? true,
    notes: body.notes ?? null,
    created_by: authUser.email,
    updated_by: authUser.email
  }

  const { data, error } = await supabase
    .from('suppliers')
    .insert(payload)
    .select()
    .single()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to create supplier: ${error.message}` })
  }

  return { item: data }
})
