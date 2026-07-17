import { defineEventHandler, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { resolveDefaultCategoryId } from '../../utils/financial-category-defaults'
import { softDeleteFinancialTransaction, FINANCIAL_TRANSACTION_DELETION_SOURCES } from '../../utils/financial-transaction-deletion'

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
  const dataPagamento = normalizeIsoDateOrNull(body.dataPagamento) || new Date().toISOString().split('T')[0]

  let contaBancaria: any = null

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

  const salariesCategory = await resolveDefaultCategoryId(supabase, organizationId, 'Salários', 'expense')

  const results: any[] = []
  let paidCount = 0, skippedCount = 0, failedCount = 0

  for (const registroId of registroIds) {
    const resultBase = { registroId }

    const { data: registro } = await supabase.from('employee_financial_records').select('*').eq('id', registroId).eq('organization_id', organizationId).single()

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

    let lancamento: any = null
    let extrato: any = null
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
        due_date: dataPagamento,
        type: 'expense',
        status: 'paid',
        category: salariesCategory.name,
        category_id: salariesCategory.id,
        recurrence: 'nao_recorrente',
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
        transaction_date: dataPagamento,
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
      const { error: registroError } = await supabase.from('employee_financial_records').update({
        status: 'paid',
        payment_date: dataPagamento,
        financial_transaction_id: String(lancamento?.id || ''),
        updated_by: authUser.email
      }).eq('id', registroId)

      if (registroError) throw new Error(registroError.message)

      paidCount += 1
      results.push({ ...resultBase, status: 'paid', lancamentoId: lancamento?.id })
    } catch (error: any) {
      failedCount += 1

      // Best-effort rollback
      try { if (extrato?.id) await supabase.from('bank_account_statements').delete().eq('id', extrato.id) } catch {}
      try { if (updatedConta && saldoAnterior !== null) await supabase.from('bank_accounts').update({ current_balance: saldoAnterior, updated_by: authUser.email }).eq('id', contaId) } catch {}
      try {
        if (lancamento?.id) {
          await softDeleteFinancialTransaction({
            supabase,
            id: lancamento.id,
            organizationId,
            reason: `Rollback automático: falha ao pagar comissão em lote (${error?.message || String(error)})`,
            source: FINANCIAL_TRANSACTION_DELETION_SOURCES.PAY_COMMISSIONS_BULK_ROLLBACK,
            userEmail: authUser.email
          })
        }
      } catch {}

      results.push({ ...resultBase, status: 'failed', message: error?.message || String(error) })
    }
  }

  return {
    organization_id: organizationId,
    data: { paidCount, skippedCount, failedCount, results }
  }
})
