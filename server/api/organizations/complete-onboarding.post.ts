import { z } from 'zod'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'

/**
 * POST /api/organizations/complete-onboarding
 * Saves the essential company details collected during the onboarding wizard
 * and marks the organization as onboarding_completed = true.
 * After this the middleware allows the user to access /app.
 */

const schema = z.object({
  name: z.string().min(2, 'Razão social deve ter ao menos 2 caracteres'),
  person_type: z.enum(['pf', 'pj'], { error: 'Selecione pessoa física ou jurídica' }),
  tax_id: z.string().optional().nullable(),
  phone: z.string().min(8, 'Telefone inválido'),
  whatsapp: z.string().optional().nullable(),
  email: z.string().email('E-mail inválido').optional().nullable().or(z.literal('')),
  zip_code: z.string().optional().nullable(),
  street: z.string().optional().nullable(),
  address_number: z.string().optional().nullable(),
  neighborhood: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().max(2).optional().nullable()
})

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()

  const body = await readBody(event)
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message || 'Dados inválidos'
    })
  }

  // Resolve organization via user_profiles
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('user_id', authUser.id)
    .maybeSingle()

  if (!profile?.organization_id) {
    throw createError({ statusCode: 403, statusMessage: 'Usuário sem organização vinculada' })
  }

  const organizationId = profile.organization_id as string

  const { data: organization, error } = await supabase
    .from('organizations')
    .update({
      ...parsed.data,
      onboarding_completed: true,
      updated_by: authUser.email
    })
    .eq('id', organizationId)
    .select()
    .single()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return organization
})
