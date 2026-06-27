import { defineEventHandler, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { resolveFinancialCategory } from '../../utils/resolve-financial-category'

/**
 * POST /api/financial
 * Create a new financial transaction.
 * When body.installments is provided, creates all installments in a batch
 * linking them via parent_transaction_id.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)

  if (!body.description) throw createError({ statusCode: 400, statusMessage: 'O campo "description" é obrigatório' })
  if (body.amount == null) throw createError({ statusCode: 400, statusMessage: 'O campo "amount" é obrigatório' })
  if (!body.due_date) throw createError({ statusCode: 400, statusMessage: 'O campo "due_date" é obrigatório' })
  if (!body.type) throw createError({ statusCode: 400, statusMessage: 'O campo "type" é obrigatório' })
  if (!body.category_id && !body.category) throw createError({ statusCode: 400, statusMessage: 'O campo "category_id" é obrigatório' })

  const resolvedCategory = await resolveFinancialCategory(supabase, organizationId, body.type, {
    category_id: body.category_id,
    category: body.category
  })

  const installmentList: Array<{ number: number, amount: number, due_date: string, status: string }>
    = Array.isArray(body.installments) ? body.installments : []

  // Batch installment creation
  if (body.is_installment && installmentList.length > 1) {
    const total = installmentList.length

    // Create first installment (parent)
    const firstInst = installmentList[0]!
    const { data: parent, error: parentError } = await supabase
      .from('financial_transactions')
      .insert({
        organization_id: organizationId,
        description: body.description,
        amount: firstInst.amount,
        due_date: firstInst.due_date,
        type: body.type,
        status: firstInst.status ?? body.status ?? 'pending',
        category: resolvedCategory.name,
        category_id: resolvedCategory.id,
        recurrence: null,
        is_installment: true,
        installment_count: total,
        current_installment: 1,
        bank_account_id: body.bank_account_id ?? null,
        notes: body.notes ?? null,
        created_by: authUser.email,
        updated_by: authUser.email
      })
      .select('id')
      .single()

    if (parentError || !parent) throw createError({ statusCode: 500, statusMessage: parentError?.message ?? 'Erro ao criar parcela' })

    // Create remaining installments referencing the parent
    const remaining = installmentList.slice(1).map((inst, i) => ({
      organization_id: organizationId,
      description: body.description,
      amount: inst.amount,
      due_date: inst.due_date,
      type: body.type,
      status: inst.status ?? 'pending',
      category: resolvedCategory.name,
      category_id: resolvedCategory.id,
      recurrence: null,
      is_installment: true,
      installment_count: total,
      current_installment: i + 2,
      parent_transaction_id: parent.id,
      bank_account_id: body.bank_account_id ?? null,
      notes: body.notes ?? null,
      created_by: authUser.email,
      updated_by: authUser.email
    }))

    const { error: childError } = await supabase.from('financial_transactions').insert(remaining)
    if (childError) throw createError({ statusCode: 500, statusMessage: childError.message })

    return { id: parent.id, installment_count: total }
  }

  // Single transaction
  const { data: item, error } = await supabase
    .from('financial_transactions')
    .insert({
      organization_id: organizationId,
      description: body.description,
      amount: body.amount,
      due_date: body.due_date,
      type: body.type,
      status: body.status ?? 'pending',
      category: resolvedCategory.name,
      category_id: resolvedCategory.id,
      recurrence: body.recurrence ?? null,
      recurrence_end_date: body.recurrence_end_date ?? null,
      is_installment: body.is_installment ?? false,
      installment_count: body.installment_count ?? null,
      current_installment: body.current_installment ?? null,
      bank_account_id: body.bank_account_id ?? null,
      notes: body.notes ?? null,
      created_by: authUser.email,
      updated_by: authUser.email
    })
    .select('*, category_ref:financial_categories(id, name, icon, color)')
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return item
})
