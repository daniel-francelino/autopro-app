// Indicadores da bateria GEO (docs/seo/geo-audit-brasil.md §10.4). Puro: recebe as linhas e devolve taxas.

export interface GeoRunRow {
  run_date: string
  engine: string
  search_enabled: boolean
  brand_mentioned: boolean
  brand_linked: boolean
  recommended: boolean
  price_correct: boolean | null
  fiscal_correct: boolean | null
}

export interface GeoRates {
  total: number
  mention_rate: number | null
  link_rate: number | null
  recommendation_rate: number | null
  /** Entre as respostas que citaram preço (price_correct != null). */
  price_accuracy: number | null
  /** Entre as respostas que falaram de fiscal (fiscal_correct != null). */
  fiscal_accuracy: number | null
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)

export function computeRates(rows: GeoRunRow[]): GeoRates {
  const priced = rows.filter(r => r.price_correct !== null && r.price_correct !== undefined)
  const fiscal = rows.filter(r => r.fiscal_correct !== null && r.fiscal_correct !== undefined)
  return {
    total: rows.length,
    mention_rate: pct(rows.filter(r => r.brand_mentioned).length, rows.length),
    link_rate: pct(rows.filter(r => r.brand_linked).length, rows.length),
    recommendation_rate: pct(rows.filter(r => r.recommended).length, rows.length),
    price_accuracy: pct(priced.filter(r => r.price_correct).length, priced.length),
    fiscal_accuracy: pct(fiscal.filter(r => r.fiscal_correct).length, fiscal.length)
  }
}

/** Segunda-feira (UTC) da semana de `date` (`YYYY-MM-DD`) — chave da série semanal. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  const shift = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - shift)
  return d.toISOString().slice(0, 10)
}

/** Série semanal separada em COM e SEM busca (não se misturam: o modo muda a resposta). */
export function weeklySeries(rows: GeoRunRow[]) {
  const buckets = new Map<string, GeoRunRow[]>()
  for (const row of rows) {
    const key = `${weekStart(row.run_date)}|${row.search_enabled ? 'search' : 'no_search'}`
    buckets.set(key, [...(buckets.get(key) ?? []), row])
  }
  return [...buckets]
    .map(([key, list]) => {
      const [week, mode] = key.split('|') as [string, 'search' | 'no_search']
      return { week, mode, ...computeRates(list) }
    })
    .sort((a, b) => a.week.localeCompare(b.week) || a.mode.localeCompare(b.mode))
}
