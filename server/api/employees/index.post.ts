import { defineEventHandler, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { enforceEmployeeLimit } from '../../utils/license'

/**
 * POST /api/employees
 * Creates a new employee record.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)

  await enforceEmployeeLimit(organizationId)

  if (!body?.name?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'name is required' })
  }
  if (!body?.person_type?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'person_type is required' })
  }
  if (!body?.tax_id?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'tax_id is required' })
  }
  if (!body?.phone?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'phone is required' })
  }

  const payload: Record<string, unknown> = {
    organization_id: organizationId,
    name: body.name.trim(),
    person_type: body.person_type.trim(),
    tax_id: body.tax_id.trim(),
    phone: body.phone.trim(),
    email: body.email ?? null,
    role: body.role ?? null,
    zip_code: body.zip_code ?? null,
    street: body.street ?? null,
    address_number: body.address_number ?? null,
    address_complement: body.address_complement ?? null,
    neighborhood: body.neighborhood ?? null,
    city: body.city ?? null,
    state: body.state ?? null,
    has_salary: body.has_salary ?? false,
    salary_amount: body.salary_amount ?? null,
    payment_day: body.payment_day ?? null,
    salary_installments: body.salary_installments ?? null,
    has_minimum_guarantee: body.has_minimum_guarantee ?? false,
    minimum_guarantee_amount: body.minimum_guarantee_amount ?? null,
    minimum_guarantee_installments: body.minimum_guarantee_installments ?? null,
    pix_key_type: body.pix_key_type ?? null,
    pix_key: body.pix_key ?? null,
    termination_date: body.termination_date ?? null,
    termination_reason: body.termination_reason ?? null,
    created_by: authUser.email,
    updated_by: authUser.email
  }

  const { data, error } = await supabase
    .from('employees')
    .insert(payload)
    .select()
    .single()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to create employee: ${error.message}` })
  }

  return { item: data }
})
