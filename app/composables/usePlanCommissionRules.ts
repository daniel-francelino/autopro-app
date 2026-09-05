import type { ResolvedCommissionRule } from '../../lib/utils/employee-commission-engine'

/**
 * Fetches and caches, per commission plan (and reference date), the flat
 * list of rules for that plan — used to resolve an active manual commission
 * override (docs/finance/commissions-manual-override.md) client-side, since
 * an override references a plan that isn't necessarily assigned to the
 * employee it applies to (so useEmployeeCommissionRules() can't resolve it).
 *
 * Mirrors useEmployeeCommissionRules() exactly, keyed by planId instead of
 * employeeId, backing GET /api/commissions/:id/rules. Call ensureRules()
 * with the plan ids from getActiveOverridePlanIds() and the OS's entry_date
 * whenever either changes.
 */
export function usePlanCommissionRules() {
  const rulesByPlanId = ref(new Map<string, ResolvedCommissionRule[]>())
  const loadedKeys = new Set<string>()
  const pending = new Map<string, Promise<void>>()

  async function fetchOne(planId: string, referenceDate: string) {
    const key = `${planId}::${referenceDate}`
    if (loadedKeys.has(key)) return
    if (pending.has(key)) return pending.get(key)

    const promise = $fetch<{ items: ResolvedCommissionRule[] }>(`/api/commissions/${planId}/rules`, {
      query: { referenceDate }
    })
      .then((response) => {
        const next = new Map(rulesByPlanId.value)
        next.set(planId, response.items ?? [])
        rulesByPlanId.value = next
        loadedKeys.add(key)
      })
      .catch(() => {
        // Leave the plan unset — resolveEffectiveCommissionRules() treats a
        // missing entry the same as an empty one (no rules matched).
      })
      .finally(() => {
        pending.delete(key)
      })

    pending.set(key, promise)
    return promise
  }

  async function ensureRules(planIds: Array<string | null | undefined>, referenceDate: string) {
    const ids = [...new Set(planIds.filter((id): id is string => Boolean(id)))]
    await Promise.all(ids.map(id => fetchOne(id, referenceDate)))
  }

  return { rulesByPlanId, ensureRules }
}
