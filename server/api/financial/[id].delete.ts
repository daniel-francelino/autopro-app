import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { softDeleteFinancialTransaction, FINANCIAL_TRANSACTION_DELETION_SOURCES } from '../../utils/financial-transaction-deletion'

/**
 * DELETE /api/financial/:id
 * Soft-delete a financial transaction. Requires a reason: this is the
 * user-facing "excluir lançamento" action, so unlike system-triggered
 * reversals the reason can't be inferred — the person deleting it has to say why.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')

  const body = (await readBody(event).catch(() => null)) || {}
  const reason = String(body?.reason || '').trim()
  if (!reason) throw createError({ statusCode: 400, statusMessage: 'O motivo da exclusão é obrigatório' })

  const { data: existing } = await supabase
    .from('financial_transactions')
    .select('id')
    .eq('id', id!)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Lançamento não encontrado' })

  const { error } = await softDeleteFinancialTransaction({
    supabase,
    id: id!,
    organizationId,
    reason,
    source: FINANCIAL_TRANSACTION_DELETION_SOURCES.MANUAL_DELETE,
    userEmail: authUser.email
  })

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { success: true }
})
