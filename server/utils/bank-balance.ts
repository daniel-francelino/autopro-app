import type { SupabaseClient } from '@supabase/supabase-js'

type StatementLike = {
  bank_account_id?: string | null
  previous_balance?: number | string | null
  balance_after?: number | string | null
  amount?: number | string | null
  transaction_type?: string | null
}

/**
 * Efeito (com sinal) que o extrato teve no saldo da conta quando foi criado.
 * Receita: positivo; despesa/saída: negativo.
 */
export function statementBalanceDelta(statement: StatementLike): number {
  const after = statement.balance_after
  const before = statement.previous_balance
  if (after !== null && after !== undefined && before !== null && before !== undefined) {
    return Number(after) - Number(before)
  }
  const amount = Number(statement.amount || 0)
  return statement.transaction_type === 'income' ? amount : -amount
}

/**
 * Desfaz o efeito de UM extrato no saldo atual da conta (saldo - efeito), em vez de regravar o
 * "saldo anterior" do extrato — que sobrescreveria outros movimentos feitos depois (KF-02/KF-19).
 */
export async function revertStatementOnAccount(params: {
  supabase: SupabaseClient
  organizationId: string
  statement: StatementLike
  userEmail?: string | null
}): Promise<void> {
  const { supabase, organizationId, statement, userEmail } = params
  if (!statement.bank_account_id) return

  const { data: account } = await supabase
    .from('bank_accounts')
    .select('current_balance')
    .eq('id', statement.bank_account_id)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (!account) return

  const nextBalance = Math.round((Number(account.current_balance || 0) - statementBalanceDelta(statement)) * 100) / 100

  await supabase
    .from('bank_accounts')
    .update({ current_balance: nextBalance, updated_by: userEmail || null })
    .eq('id', statement.bank_account_id)
    .eq('organization_id', organizationId)
}
