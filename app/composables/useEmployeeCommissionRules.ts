import type { ResolvedCommissionRule } from '../../lib/utils/employee-commission-engine'

/**
 * Fetches and caches, per employee (and reference date), the flat list of
 * new-model commission rules used by the live OS commission preview (Step 8
 * cutover — docs/finance/commissions-step8-engine-cutover.md §7.1). Backs
 * computeServiceOrderCommissionBreakdown()'s `rulesByEmployeeId` param in
 * app/utils/service-orders.ts.
 *
 * Call ensureRules() with the OS's current responsible employee ids and
 * entry_date whenever either changes; already-cached (employeeId,
 * referenceDate) pairs are not re-fetched. `rulesByEmployeeId` starts each
 * employee at an empty array until its fetch resolves, so the preview shows
 * the legacy calculation (computeServiceOrderCommissionBreakdown's own
 * fallback) until the new-model rules are known — never blocks rendering.
 */
export function useEmployeeCommissionRules() {
  const rulesByEmployeeId = ref(new Map<string, ResolvedCommissionRule[]>())
  const loadedKeys = new Set<string>()
  const pending = new Map<string, Promise<void>>()

  async function fetchOne(employeeId: string, referenceDate: string) {
    const key = `${employeeId}::${referenceDate}`
    if (loadedKeys.has(key)) return
    if (pending.has(key)) return pending.get(key)

    const promise = $fetch<{ items: ResolvedCommissionRule[] }>(`/api/employees/${employeeId}/commission-rules`, {
      query: { referenceDate }
    })
      .then((response) => {
        const next = new Map(rulesByEmployeeId.value)
        next.set(employeeId, response.items ?? [])
        rulesByEmployeeId.value = next
        loadedKeys.add(key)
      })
      .catch(() => {
        // Leave the employee unset — computeServiceOrderCommissionBreakdown
        // treats a missing entry the same as an empty one (legacy fallback).
      })
      .finally(() => {
        pending.delete(key)
      })

    pending.set(key, promise)
    return promise
  }

  async function ensureRules(employeeIds: Array<string | null | undefined>, referenceDate: string) {
    const ids = [...new Set(employeeIds.filter((id): id is string => Boolean(id)))]
    await Promise.all(ids.map(id => fetchOne(id, referenceDate)))
  }

  return { rulesByEmployeeId, ensureRules }
}
