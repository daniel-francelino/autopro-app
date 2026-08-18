import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireAuthUser } from '../../../../utils/require-auth'
import { requireOrgPermission } from '../../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../../utils/organization'
import { fetchBonus, currentMonthStart } from '../../../../utils/bonuses'

interface BonusGenerationRow {
  id: string
  financial_record_id: string | null
}

/**
 * DELETE /api/bonuses/:id/generations/:employeeId?referenceMonth=YYYY-MM-01
 * Clears the bonus_generations snapshot for this (bonus, employee, month) so
 * the employee can be generated again — the only way to unstick an employee
 * whose goal wasn't met (generated=true, financial_record_id=null): no
 * payment exists for those, so the "Excluir pagamento" flow never applies to
 * them, yet the unique(bonus_id, employee_id, reference_month) constraint on
 * bonus_generations still blocks "Gerar" forever without this.
 *
 * Refuses (409) when a financial_record_id IS set — that case already went
 * through payout/payment and must be undone via
 * DELETE /api/bonuses/:id/financial-records/:recordId instead, which
 * reverses the money movement AND clears the generation row itself.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'bonuses.update')
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const bonusId = getRouterParam(event, 'id')
  const employeeId = getRouterParam(event, 'employeeId')
  if (!bonusId || !employeeId) {
    throw createError({ statusCode: 400, statusMessage: 'Bonus id and employee id are required' })
  }

  const bonus = await fetchBonus(supabase, organizationId, bonusId)
  if (!bonus) {
    throw createError({ statusCode: 404, statusMessage: 'Bônus não encontrado' })
  }

  const query = getQuery(event)
  const referenceMonth = typeof query.referenceMonth === 'string' && query.referenceMonth.trim()
    ? query.referenceMonth.trim()
    : currentMonthStart()

  const { data: generation, error: generationError } = await supabase
    .from('bonus_generations')
    .select('id, financial_record_id')
    .eq('bonus_id', bonusId)
    .eq('employee_id', employeeId)
    .eq('reference_month', referenceMonth)
    .maybeSingle()

  if (generationError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load bonus generation: ${generationError.message}` })
  }
  if (!generation) {
    throw createError({ statusCode: 404, statusMessage: 'Nada foi gerado para esse funcionário neste mês.' })
  }

  const typedGeneration = generation as BonusGenerationRow
  if (typedGeneration.financial_record_id) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Este mês já tem um pagamento gerado para esse funcionário. Exclua o pagamento (na lista de Pagamentos) antes de reprocessar.'
    })
  }

  const { error: deleteError } = await supabase
    .from('bonus_generations')
    .delete()
    .eq('id', typedGeneration.id)

  if (deleteError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to reprocess bonus generation: ${deleteError.message}` })
  }

  return { success: true }
})
