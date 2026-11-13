import { defineEventHandler, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { recordAudit } from '../../utils/audit/record'
import { resolveDefaultCategoryId } from '../../utils/financial-category-defaults'
import { softDeleteFinancialTransaction, FINANCIAL_TRANSACTION_DELETION_SOURCES } from '../../utils/financial-transaction-deletion'
import { OS_SOURCE_POLICIES, buildCommissionPaidEvent, createHistoryCache, historyContext, loadEmployeeNames, recordWithContext } from '../../utils/os-history/events'

/**
 * POST /api/financial/pay-commissions-bulk
 * Pays multiple commission records, creates financial transactions & bank statements.
 * Migrated from: supabase/functions/payCommissionsBulk
 */

function normalizeId(value: unknown) {
  const id = String(value ?? '').trim()
  return id.length > 0 ? id : null
}

function normalizeNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeIsoDateOrNull(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().split('T')[0]
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item: unknown) => normalizeId(item)).filter(Boolean) as string[]
}

function uniquePreserveOrder(ids: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'financial.update', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = (await readBody(event)) || {}
  const registroIds = uniquePreserveOrder(parseStringArray(body.registroIds))

  if (registroIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'registroIds é obrigatório (array não vazio)' })
  }
  if (registroIds.length > 200) {
    throw createError({ statusCode: 400, statusMessage: 'Limite excedido: máximo 200 registros por operação' })
  }

  const requestedContaId = normalizeId(body.contaBancariaId)
  const today = new Date().toISOString().split('T')[0]
  const dataPagamento = normalizeIsoDateOrNull(body.dataPagamento) || today
  const dateStrategy = body.dateStrategy === 'reference_date' ? 'reference_date' : 'today'

  let contaBancaria: { id?: string } | null = null

  if (requestedContaId) {
    const { data: conta } = await supabase.from('bank_accounts').select('*').eq('id', requestedContaId).eq('organization_id', organizationId).single()
    if (!conta) throw createError({ statusCode: 400, statusMessage: 'Conta bancária inválida ou acesso negado' })
    contaBancaria = conta
  } else {
    const { data: contasAtivas } = await supabase.from('bank_accounts').select('*').eq('organization_id', organizationId).eq('is_active', true).limit(1)
    if (!contasAtivas || contasAtivas.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'Nenhuma conta bancária ativa encontrada. Configure uma conta bancária antes de pagar comissões.' })
    }
    contaBancaria = contasAtivas[0]
  }

  const history = historyContext(event, OS_SOURCE_POLICIES.commissionBulk)
  const paidForHistory: Array<{ registro: Record<string, unknown>, transactionId: string, paymentDate: string }> = []

  const salariesCategory = await resolveDefaultCategoryId(supabase, organizationId, 'Salários', 'expense')

  const results: Record<string, unknown>[] = []
  let paidCount = 0, skippedCount = 0, failedCount = 0

  for (const registroId of registroIds) {
    const resultBase = { registroId }

    const { data: registro } = await supabase.from('employee_financial_records').select('*').eq('id', registroId).eq('organization_id', organizationId).is('deleted_at', null).single()

    if (!registro) {
      failedCount += 1
      results.push({ ...resultBase, status: 'failed', message: 'Registro não encontrado ou acesso negado' })
      continue
    }

    if (String(registro?.status || '') === 'paid') {
      skippedCount += 1
      results.push({ ...resultBase, status: 'skipped', message: 'Já estava pago' })
      continue
    }

    if (String(registro?.record_type || '') === 'adiantamento') {
      skippedCount += 1
      results.push({ ...resultBase, status: 'skipped', message: 'Tipo de registro não suportado para pagamento em massa' })
      continue
    }

    const contaId = String(contaBancaria?.id || '')
    if (!contaId) {
      failedCount += 1
      results.push({ ...resultBase, status: 'failed', message: 'Conta bancária inválida' })
      continue
    }

    const registroDataPagamento = dateStrategy === 'reference_date'
      ? (registro?.reference_date || today)
      : dataPagamento

    let lancamento: { id?: string } | null = null
    let extrato: { id?: string } | null = null
    let saldoAnterior: number | null = null
    let saldoPosterior: number | null = null
    let updatedConta = false

    try {
      const { data: contaAtual } = await supabase.from('bank_accounts').select('*').eq('id', contaId).eq('organization_id', organizationId).single()
      if (!contaAtual) throw new Error('Conta bancária não encontrada ou acesso negado')

      saldoAnterior = normalizeNumber(contaAtual?.current_balance)
      const valor = normalizeNumber(registro?.amount)
      saldoPosterior = saldoAnterior - valor

      const { data: lancamentoCreated } = await supabase.from('financial_transactions').insert({
        description: registro?.description || `Pagamento de comissão (${registroId})`,
        amount: valor,
        due_date: registroDataPagamento,
        type: 'expense',
        status: 'paid',
        category: salariesCategory.name,
        category_id: salariesCategory.id,
        recurrence: 'non_recurring',
        bank_account_id: contaId,
        employee_financial_record_id: registroId,
        notes: `Pagamento de comissão - ${String(registro?.employee_id || '')}`,
        organization_id: organizationId,
        created_by: authUser.email
      }).select().single()

      lancamento = lancamentoCreated

      await supabase.from('bank_accounts').update({ current_balance: saldoPosterior, updated_by: authUser.email }).eq('id', contaId)
      updatedConta = true

      const { data: extratoCreated } = await supabase.from('bank_account_statements').insert({
        bank_account_id: contaId,
        financial_transaction_id: String(lancamento?.id || ''),
        transaction_date: registroDataPagamento,
        description: registro?.description || `Pagamento de comissão (${registroId})`,
        transaction_type: 'expense',
        amount: valor,
        previous_balance: saldoAnterior,
        balance_after: saldoPosterior,
        notes: `Pagamento de comissão - ${String(registro?.employee_id || '')}`,
        organization_id: organizationId,
        created_by: authUser.email
      }).select().single()

      extrato = extratoCreated

      // Status must be 'paid' (DB check constraint only allows 'paid'/'pending')
      const { data: registroUpdated, error: registroError } = await supabase.from('employee_financial_records').update({
        status: 'paid',
        payment_date: registroDataPagamento,
        financial_transaction_id: String(lancamento?.id || ''),
        updated_by: authUser.email
      }).eq('id', registroId).is('deleted_at', null).select('id')

      if (registroError) throw new Error(registroError.message)
      // Matched zero rows — the record was deleted between the read above and
      // this write (e.g. reprocessed from another tab). Roll back the
      // transaction/statement/balance just created instead of leaving a real,
      // untracked payment attached to a record nobody can see anymore.
      if (!registroUpdated || registroUpdated.length === 0) throw new Error('Registro foi excluído durante o pagamento')

      paidCount += 1
      results.push({ ...resultBase, status: 'paid', lancamentoId: lancamento?.id })
      // Só entra no histórico o que confirmou o último passo (registro marcado como pago).
      paidForHistory.push({ registro, transactionId: String(lancamento?.id || ''), paymentDate: String(registroDataPagamento) })
    } catch (error: unknown) {
      const errorMessage = (error as { message?: string } | null)?.message || String(error)
      failedCount += 1

      // Best-effort rollback
      try {
        if (extrato?.id) await supabase.from('bank_account_statements').delete().eq('id', extrato.id)
      } catch {}
      try {
        if (updatedConta && saldoAnterior !== null) await supabase.from('bank_accounts').update({ current_balance: saldoAnterior, updated_by: authUser.email }).eq('id', contaId)
      } catch {}
      try {
        if (lancamento?.id) {
          await softDeleteFinancialTransaction({
            supabase,
            id: lancamento.id,
            organizationId,
            reason: `Rollback automático: falha ao pagar comissão em lote (${errorMessage})`,
            source: FINANCIAL_TRANSACTION_DELETION_SOURCES.PAY_COMMISSIONS_BULK_ROLLBACK,
            userEmail: authUser.email
          })
        }
      } catch {}

      results.push({ ...resultBase, status: 'failed', message: errorMessage })
    }
  }

  // Histórico da OS: uma gravação por comissão de OS paga, depois do loop (nunca derruba o lote).
  const accountId = String(contaBancaria?.id || '')
  await recordWithContext(history, supabase, async () => {
    const events = []
    // Cache por requisição: nomes em lote (1 consulta), conta e recebido por OS uma vez só.
    const cache = createHistoryCache()
    await loadEmployeeNames(supabase, organizationId, paidForHistory.map(p => p.registro.employee_id as string | null), cache)
    for (const p of paidForHistory) {
      if (!p.registro.service_order_id || p.registro.record_type !== 'commission' || !p.transactionId) continue
      events.push(await buildCommissionPaidEvent(supabase, {
        organizationId,
        serviceOrderId: String(p.registro.service_order_id),
        recordId: String(p.registro.id),
        employeeId: p.registro.employee_id as string | null,
        amount: p.registro.amount,
        paymentDate: p.paymentDate,
        bankAccountId: accountId,
        transactionId: p.transactionId,
        cache
      }))
    }
    return events
  })

  recordAudit(event, { extra: { paidCount, skippedCount, failedCount, results: results.map((r: Record<string, unknown>) => ({ id: r.registroId ?? null, status: r.status, message: r.message ?? null })) } })

  return {
    organization_id: organizationId,
    data: { paidCount, skippedCount, failedCount, results }
  }
})
