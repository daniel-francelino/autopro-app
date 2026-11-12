import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

interface ImportRow {
  name: string
  person_type?: string
  trade_name?: string
  tax_id?: string
  phone?: string
  whatsapp?: string
  email?: string
  website?: string
  zip_code?: string
  street?: string
  address_number?: string
  address_complement?: string
  neighborhood?: string
  city?: string
  state?: string
  category?: string
  is_active?: boolean
  contact_name?: string
  contact_role?: string
  contact_phone?: string
  contact_email?: string
  payment_term_days?: number
  credit_limit?: number
  notes?: string
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'suppliers.create', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)
  const rows: ImportRow[] = body?.rows

  if (!Array.isArray(rows) || rows.length === 0)
    throw createError({ statusCode: 400, statusMessage: 'No rows to import' })

  const created: string[] = []
  const errors: { row: number, message: string }[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    try {
      if (!row.name?.trim())
        throw new Error('name is required')

      const { data, error } = await supabase
        .from('suppliers')
        .insert({
          organization_id: organizationId,
          name: row.name.trim(),
          person_type: row.person_type?.trim() || 'pj',
          trade_name: row.trade_name || null,
          tax_id: row.tax_id || null,
          phone: row.phone?.trim() || '',
          whatsapp: row.whatsapp || null,
          email: row.email || null,
          website: row.website || null,
          zip_code: row.zip_code || null,
          street: row.street || null,
          address_number: row.address_number || null,
          address_complement: row.address_complement || null,
          neighborhood: row.neighborhood || null,
          city: row.city || null,
          state: row.state || null,
          category: row.category || null,
          is_active: row.is_active !== false,
          contact_name: row.contact_name || null,
          contact_role: row.contact_role || null,
          contact_phone: row.contact_phone || null,
          contact_email: row.contact_email || null,
          payment_term_days: row.payment_term_days ?? null,
          credit_limit: row.credit_limit ?? null,
          notes: row.notes || null,
          created_by: authUser.email,
          updated_by: authUser.email
        })
        .select('id')
        .single()

      if (error) {
        errors.push({ row: i + 1, message: error.message })
        continue
      }

      created.push(data.id)
    } catch (err: unknown) {
      const e = err as Error
      errors.push({ row: i + 1, message: e.message ?? 'Unknown error' })
    }
  }

  return { created: created.length, errors }
})
