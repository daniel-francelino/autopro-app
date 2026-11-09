// Cálculos puros do painel do owner: cobrança (MRR/churn), bateria GEO e checagens do /admin/system.
import { describe, expect, it } from 'vitest'
import { computeChurnSeries, computeMrr, lastMonths, monthKey, type SubscriptionRow } from '../../../server/utils/billing-metrics'
import { computeRates, weekStart, weeklySeries, type GeoRunRow } from '../../../server/utils/geo-metrics'
import { ownerAlert, runCheck, topFailingRoutes } from '../../../server/utils/system-checks'
import { isOrganizationSuspended } from '../../../server/utils/organization'
import { GEO_QUESTIONS, geoQuestionText } from '../../../lib/geo/questions'

const sub = (over: Partial<SubscriptionRow>): SubscriptionRow => ({
  status: 'active', plan_key: 'pro', monthly_amount: 100, start_date: '2026-01-10', cancellation_date: null, ...over
})

describe('billing: MRR', () => {
  it('soma só assinaturas active, por plano, e conta as sem valor', () => {
    const r = computeMrr([
      sub({ monthly_amount: 99.9 }),
      sub({ plan_key: 'fiscal', monthly_amount: '199.90' }),
      sub({ plan_key: 'fiscal', monthly_amount: null }),
      sub({ status: 'cancelled', monthly_amount: 500 }),
      sub({ status: 'trial', monthly_amount: 50 })
    ])
    expect(r.mrr).toBe(299.8)
    expect(r.active_subscriptions).toBe(3)
    expect(r.trial_subscriptions).toBe(1)
    expect(r.missing_amount).toBe(1)
    expect(r.by_plan).toEqual([
      { plan: 'fiscal', subscriptions: 2, mrr: 199.9 },
      { plan: 'pro', subscriptions: 1, mrr: 99.9 }
    ])
  })

  it('sem assinaturas → zero', () => {
    expect(computeMrr([])).toMatchObject({ mrr: 0, active_subscriptions: 0, by_plan: [] })
  })
})

describe('billing: churn e novas', () => {
  const now = new Date('2026-11-15T12:00:00Z')

  it('lastMonths devolve 12 meses terminando no atual', () => {
    const months = lastMonths(now, 12)
    expect(months).toHaveLength(12)
    expect(months[0]).toBe('2025-12')
    expect(months[11]).toBe('2026-11')
  })

  it('churn = canceladas no mês ÷ ativas no início do mês', () => {
    const rows = [
      sub({ start_date: '2026-01-05' }), // ativa o tempo todo
      sub({ start_date: '2026-02-01' }), // ativa o tempo todo
      sub({ start_date: '2026-03-01', cancellation_date: '2026-10-20' }), // cancela em outubro
      sub({ start_date: '2026-10-05' }), // nova em outubro (não conta no início de outubro)
      sub({ start_date: '2026-04-01', cancellation_date: '2026-06-02' }) // já cancelada antes
    ]
    const oct = computeChurnSeries(rows, now, 12).find(m => m.month === '2026-10')!
    expect(oct).toMatchObject({ new: 1, cancelled: 1, active_at_start: 3, churn_rate: 33.33 })
  })

  it('base zero → churn null (sem divisão por zero)', () => {
    expect(computeChurnSeries([], now, 3).every(m => m.churn_rate === null)).toBe(true)
  })

  it('monthKey', () => {
    expect(monthKey('2026-10-20T10:00:00Z')).toBe('2026-10')
    expect(monthKey(null)).toBeNull()
    expect(monthKey('lixo')).toBeNull()
  })
})

describe('GEO: taxas e série semanal', () => {
  const row = (over: Partial<GeoRunRow>): GeoRunRow => ({
    run_date: '2026-11-09', engine: 'chatgpt', search_enabled: true, brand_mentioned: true, brand_linked: false, recommended: false,
    price_correct: null, fiscal_correct: null, ...over
  })

  it('exatidão considera só as respostas que citaram preço/fiscal', () => {
    const r = computeRates([
      row({ price_correct: true }), row({ price_correct: false }), row({ price_correct: null }),
      row({ fiscal_correct: true })
    ])
    expect(r.price_accuracy).toBe(50)
    expect(r.fiscal_accuracy).toBe(100)
    expect(r.mention_rate).toBe(100)
    expect(r.link_rate).toBe(0)
  })

  it('sem registros → null, nunca NaN', () => {
    expect(computeRates([])).toMatchObject({ total: 0, mention_rate: null, price_accuracy: null })
  })

  it('weekStart devolve a segunda-feira', () => {
    expect(weekStart('2026-11-09')).toBe('2026-11-09') // segunda
    expect(weekStart('2026-11-15')).toBe('2026-11-09') // domingo
    expect(weekStart('2026-11-16')).toBe('2026-11-16')
  })

  it('série separa COM e SEM busca e ordena por semana', () => {
    const series = weeklySeries([
      row({ run_date: '2026-11-16' }), row({ run_date: '2026-11-09', search_enabled: false }), row({ run_date: '2026-11-10' })
    ])
    expect(series.map(s => `${s.week} ${s.mode}`)).toEqual(['2026-11-09 no_search', '2026-11-09 search', '2026-11-16 search'])
  })

  it('a bateria tem 20 perguntas fixas, ids 1..20, e o texto vem do servidor', () => {
    expect(GEO_QUESTIONS.map(q => q.id)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    expect(geoQuestionText(19)).toContain('AutoPro')
    expect(geoQuestionText(99)).toBeNull()
  })
})

describe('system: checagens', () => {
  it('runCheck captura erro e timeout sem lançar', async () => {
    const failed = await runCheck('x', 'X', async () => { throw new Error('banco caiu') })
    expect(failed).toMatchObject({ status: 'error', detail: 'banco caiu' })

    const slow = await runCheck('y', 'Y', () => new Promise(() => {}), 30)
    expect(slow.status).toBe('error')
    expect(slow.detail).toMatch(/sem resposta/)
  })

  it('runCheck repassa status e detalhe', async () => {
    expect(await runCheck('z', 'Z', async () => ({ status: 'warning', detail: 'devagar' }))).toMatchObject({ status: 'warning', detail: 'devagar' })
    expect((await runCheck('k', 'K', async () => ({}))).status).toBe('ok')
  })

  it('topFailingRoutes agrupa, ignora sucesso e põe 5xx antes de 4xx', () => {
    const at = (n: number) => `2026-11-09T10:0${n}:00Z`
    const rows = [
      { http_method: 'POST', route_pattern: '/api/a', status_code: 400, outcome: 'invalid', created_at: at(1) },
      { http_method: 'POST', route_pattern: '/api/a', status_code: 400, outcome: 'invalid', created_at: at(3) },
      { http_method: 'POST', route_pattern: '/api/a', status_code: 400, outcome: 'invalid', created_at: at(2) },
      { http_method: 'GET', route_pattern: '/api/b', status_code: 500, outcome: 'error', created_at: at(1) },
      { http_method: 'GET', route_pattern: '/api/c', status_code: 200, outcome: 'success', created_at: at(1) }
    ]
    const top = topFailingRoutes(rows)
    expect(top.map(t => `${t.status_code} ${t.route_pattern} x${t.total}`)).toEqual(['500 /api/b x1', '400 /api/a x3'])
    expect(top[1]!.last_at).toBe(at(3))
  })

  it('alerta de owner único', () => {
    expect(ownerAlert(0)).toMatch(/Nenhum owner/)
    expect(ownerAlert(1)).toMatch(/um owner/)
    expect(ownerAlert(2)).toBeNull()
  })
})

describe('suspensão de oficina', () => {
  it('detecta suspensão no embed do PostgREST (objeto ou lista) e ignora o resto', () => {
    expect(isOrganizationSuspended({ organizations: { suspended_at: '2026-11-09T10:00:00Z' } })).toBe(true)
    expect(isOrganizationSuspended({ organizations: [{ suspended_at: '2026-11-09T10:00:00Z' }] })).toBe(true)
    expect(isOrganizationSuspended({ organizations: { suspended_at: null } })).toBe(false)
    expect(isOrganizationSuspended({ organizations: null })).toBe(false)
    expect(isOrganizationSuspended({})).toBe(false)
    expect(isOrganizationSuspended(null)).toBe(false)
  })
})
