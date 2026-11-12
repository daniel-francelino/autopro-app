import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

interface ClientRow {
  name: string
  phone: string
  person_type?: string
  email?: string
  mobile_phone?: string
  tax_id?: string
  birth_date?: string
  zip_code?: string
  street?: string
  address_number?: string
  address_complement?: string
  neighborhood?: string
  city?: string
  state?: string
  notes?: string
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'customers.create', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody<{ rows: ClientRow[] }>(event)

  if (!Array.isArray(body?.rows) || body.rows.length === 0)
    throw createError({ statusCode: 400, statusMessage: 'Nenhuma linha válida encontrada para importar' })

  if (body.rows.length > 500)
    throw createError({ statusCode: 400, statusMessage: 'Máximo de 500 clientes por importação' })

  const errors: { row: number, message: string }[] = []
  const validRows: ReturnType<typeof buildRow>[] = []

  for (let i = 0; i < body.rows.length; i++) {
    const row = body.rows[i]!
    const rowNum = i + 1

    if (!row.name?.trim()) {
      errors.push({ row: rowNum, message: 'Campo "nome" é obrigatório' })
      continue
    }
    if (!row.phone?.trim()) {
      errors.push({ row: rowNum, message: 'Campo "telefone" é obrigatório' })
      continue
    }

    const personType = row.person_type?.toLowerCase()?.trim()
    if (personType && !['pf', 'pj'].includes(personType)) {
      errors.push({ row: rowNum, message: '"tipo_pessoa" deve ser "pf" ou "pj"' })
      continue
    }

    validRows.push(buildRow(row, organizationId, authUser.email!))
  }

  if (validRows.length === 0)
    throw createError({ statusCode: 400, statusMessage: 'Nenhum registro válido para importar', data: { errors } })

  const { data: inserted, error } = await supabase
    .from('clients')
    .insert(validRows)
    .select('id, name')

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  return {
    imported: inserted?.length ?? 0,
    errors
  }
})

function buildRow(row: ClientRow, organizationId: string, createdBy: string) {
  return {
    organization_id: organizationId,
    name: row.name.trim(),
    phone: row.phone.replace(/\D/g, ''),
    person_type: (['pf', 'pj'].includes(row.person_type?.toLowerCase()?.trim() ?? ''))
      ? row.person_type!.toLowerCase().trim()
      : 'pf',
    email: row.email?.trim() || null,
    mobile_phone: row.mobile_phone?.replace(/\D/g, '') || null,
    tax_id: row.tax_id?.replace(/\D/g, '') || null,
    birth_date: row.birth_date?.trim() || null,
    zip_code: row.zip_code?.replace(/\D/g, '') || null,
    street: row.street?.trim() || null,
    address_number: row.address_number?.trim() || null,
    address_complement: row.address_complement?.trim() || null,
    neighborhood: row.neighborhood?.trim() || null,
    city: row.city?.trim() || null,
    state: row.state?.trim()?.toUpperCase() || null,
    notes: row.notes?.trim() || null,
    created_by: createdBy,
    updated_by: createdBy
  }
}
