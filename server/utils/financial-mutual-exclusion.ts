import { createError } from 'h3'

/**
 * A financial_transactions row can't be both an installment and a
 * recurring occurrence at the same time — see docs/finance/financial-recurrence-flow.md
 * (Bug 5 for creation, Bug 7 for the same gap on edit). Single choke point so
 * both index.post.ts (create) and [id].put.ts (edit) reject the same way.
 */
export function assertNotInstallmentAndRecurring(isInstallment: unknown, recurrence: unknown) {
  const hasRecurrence = Boolean(recurrence) && recurrence !== 'non_recurring'
  if (isInstallment && hasRecurrence) {
    throw createError({ statusCode: 400, statusMessage: 'Um lançamento não pode ser parcelado e recorrente ao mesmo tempo' })
  }
}
