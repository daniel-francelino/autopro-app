import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID obrigatório' })

  const { data: existing, error: findError } = await supabase
    .from('product_categories')
    .select('id')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (findError)
    throw createError({ statusCode: 500, statusMessage: findError.message })

  if (!existing)
    throw createError({ statusCode: 404, statusMessage: 'Categoria não encontrada' })

  const [productsResult, commissionRulesResult] = await Promise.all([
    supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('category_id', id)
      .is('deleted_at', null),
    supabase
      .from('employee_commission_rule_categories')
      .select('rule_id', { count: 'exact', head: true })
      .eq('category_id', id)
  ])

  if (productsResult.error)
    throw createError({ statusCode: 500, statusMessage: productsResult.error.message })
  if (commissionRulesResult.error)
    throw createError({ statusCode: 500, statusMessage: commissionRulesResult.error.message })

  const productsCount = productsResult.count ?? 0
  const commissionRulesCount = commissionRulesResult.count ?? 0

  if (productsCount > 0 || commissionRulesCount > 0) {
    const parts: string[] = []
    if (productsCount > 0) parts.push(`${productsCount} produto${productsCount !== 1 ? 's' : ''}`)
    if (commissionRulesCount > 0) parts.push(`${commissionRulesCount} regra${commissionRulesCount !== 1 ? 's' : ''} de comissão`)
    throw createError({
      statusCode: 409,
      statusMessage: `Categoria em uso por ${parts.join(' e ')} e não pode ser removida.`
    })
  }

  const { error } = await supabase
    .from('product_categories')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: authUser.email
    })
    .eq('id', id)

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  return { success: true }
})
