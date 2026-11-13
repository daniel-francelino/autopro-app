import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireAuthUser } from '../../../../utils/require-auth'
import { resolveOrganizationId } from '../../../../utils/organization'
import { requireOrgPermission } from '../../../../utils/require-org-permission'
import { recordAudit } from '../../../../utils/audit/record'
import { OS_EVENT_KEYS, OS_SOURCE_POLICIES, entryChangeSet, historyContext, osEvent, recordWithContext } from '../../../../utils/os-history/events'

/**
 * PATCH /api/service-orders/:id/installments/:installmentId
 * Edits the due date and/or expected amount of an installment that hasn't
 * received any money yet — e.g. to reschedule it, or to bump its amount up
 * when merging another still-pending line into it during a renegotiation.
 * Once anything has been received against a line (partial or paid), its
 * terms are locked; fix it by cancelling the specific receipt instead
 * (DELETE .../financial-transactions/:transactionId).
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'orders.update', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const history = historyContext(event, OS_SOURCE_POLICIES.osDetail)
  const orderId = getRouterParam(event, 'id')
  const installmentId = getRouterParam(event, 'installmentId')

  if (!orderId || !installmentId) {
    throw createError({ statusCode: 400, statusMessage: 'Parâmetros obrigatórios ausentes' })
  }

  const { data: installment, error: installmentError } = await supabase
    .from('service_order_installments')
    .select('id, status, installment_number, due_date, amount')
    .eq('id', installmentId)
    .eq('service_order_id', orderId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (installmentError || !installment) {
    throw createError({ statusCode: 404, statusMessage: 'Parcela não encontrada' })
  }

  if (installment.status !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'Só é possível editar uma parcela que ainda não recebeu nenhum pagamento' })
  }

  const body = await readBody(event)
  const update: Record<string, unknown> = { updated_by: authUser.email }

  if (body?.due_date != null) {
    update.due_date = body.due_date
  }

  if (body?.amount != null) {
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'Informe um valor maior que zero' })
    }
    update.amount = amount
  }

  if (Object.keys(update).length <= 1) {
    throw createError({ statusCode: 400, statusMessage: 'Informe ao menos due_date ou amount' })
  }

  const { data: updatedInstallment, error: updateError } = await supabase
    .from('service_order_installments')
    .update(update)
    .eq('id', installmentId)
    .select()
    .single()

  if (updateError) {
    throw createError({ statusCode: 500, statusMessage: updateError.message })
  }

  // Histórico da OS: de -> para legível (valor e vencimento), depois do update confirmado.
  await recordWithContext(history, supabase, async () => {
    const changes = await entryChangeSet(
      installment as Record<string, unknown>,
      updatedInstallment as Record<string, unknown>,
      async () => null
    ).then(list => list.filter(c => c.field === 'amount' || c.field === 'due_date'))
    if (!changes.length) return []
    return [osEvent('installment.edited', {
      organizationId,
      serviceOrderId: orderId,
      entityType: 'installment',
      entityId: installmentId,
      idempotencyKey: OS_EVENT_KEYS.installmentEdited(installmentId, history.scope!)
    }, { installment_number: installment.installment_number ?? null, changes })]
  })

  recordAudit(event, {
    resourceId: orderId,
    // Auditoria mantém o `before` original (id, status); os demais campos do select servem só ao histórico.
    before: { id: installment.id, status: installment.status },
    after: updatedInstallment,
    extra: { installmentId }
  })

  return { data: updatedInstallment }
})
