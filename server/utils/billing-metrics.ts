// Cálculos do /admin/billing (docs/admin/owner-panel-plan.md §5.5). Puros: recebem as linhas e devolvem números.

export interface SubscriptionRow {
  status: string
  plan_key: string | null
  monthly_amount: number | string | null
  start_date: string | null
  cancellation_date: string | null
  created_at?: string | null
}

const num = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** `YYYY-MM` de uma data ISO/`YYYY-MM-DD`; vazio → null. */
export function monthKey(value: string | null | undefined): string | null {
  return value && /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : null
}

/** Últimos `count` meses terminando em `now` (UTC), do mais antigo ao mais recente. */
export function lastMonths(now: Date, count: number): string[] {
  const out: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7))
  }
  return out
}

/** MRR = soma de `monthly_amount` das assinaturas `active`, total e por plano. Linhas sem valor são contadas à parte. */
export function computeMrr(subscriptions: SubscriptionRow[]) {
  const active = subscriptions.filter(s => s.status === 'active')
  const byPlan = new Map<string, { plan: string, subscriptions: number, mrr: number }>()
  let missingAmount = 0
  let mrr = 0

  for (const sub of active) {
    const amount = num(sub.monthly_amount)
    if (sub.monthly_amount === null || sub.monthly_amount === undefined || amount <= 0) missingAmount++
    const plan = sub.plan_key || 'sem_plano'
    const entry = byPlan.get(plan) ?? { plan, subscriptions: 0, mrr: 0 }
    entry.subscriptions++
    entry.mrr += amount
    mrr += amount
    byPlan.set(plan, entry)
  }

  return {
    mrr: Math.round(mrr * 100) / 100,
    active_subscriptions: active.length,
    trial_subscriptions: subscriptions.filter(s => s.status === 'trial').length,
    missing_amount: missingAmount,
    by_plan: [...byPlan.values()].map(p => ({ ...p, mrr: Math.round(p.mrr * 100) / 100 })).sort((a, b) => b.mrr - a.mrr)
  }
}

/**
 * Série mensal de novas e canceladas, e churn do mês = canceladas no mês ÷ ativas no início do mês.
 * "Ativa no início" = começou antes do mês e não tinha sido cancelada antes dele.
 */
export function computeChurnSeries(subscriptions: SubscriptionRow[], now: Date, months = 12) {
  return lastMonths(now, months).map((month) => {
    const monthStart = `${month}-01`
    const newCount = subscriptions.filter(s => monthKey(s.start_date ?? s.created_at) === month).length
    const cancelled = subscriptions.filter(s => monthKey(s.cancellation_date) === month).length
    const activeAtStart = subscriptions.filter((s) => {
      const started = s.start_date ?? s.created_at
      if (!started || started.slice(0, 10) >= monthStart) return false
      return !s.cancellation_date || s.cancellation_date.slice(0, 10) >= monthStart
    }).length
    return {
      month,
      new: newCount,
      cancelled,
      active_at_start: activeAtStart,
      churn_rate: activeAtStart > 0 ? Math.round((cancelled / activeAtStart) * 10000) / 100 : null
    }
  })
}
