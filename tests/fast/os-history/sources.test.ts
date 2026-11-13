// Histórico da OS: catálogo de origens, validação servidor (§5.2) e mapa rota -> origem do front.
import { describe, expect, it } from 'vitest'
import { OS_HISTORY_SOURCES, originForPath, resolveSource, isOsHistorySourceCode } from '../../../lib/utils/os-history-sources'

const policy = { defaultSource: 'commission_report', allowedSources: ['bonus_page'] } as const

describe('resolveSource', () => {
  it('header ausente: origem do endpoint, confiança inferred', () => {
    expect(resolveSource(undefined, policy)).toEqual({ code: 'commission_report', label: 'Relatórios > Comissões', declared: null, trust: 'inferred' })
  })

  it('header fora do catálogo: descartado, sem guardar lixo em declared', () => {
    expect(resolveSource('hacker_screen', policy)).toMatchObject({ code: 'commission_report', declared: null, trust: 'inferred' })
  })

  it('header no catálogo e aceito pelo endpoint: declared', () => {
    expect(resolveSource('bonus_page', policy)).toMatchObject({ code: 'bonus_page', declared: 'bonus_page', trust: 'declared' })
    expect(resolveSource(' Commission_Report ', policy)).toMatchObject({ code: 'commission_report', trust: 'declared' })
  })

  it('header no catálogo mas não aceito pelo endpoint: usa a inferida e marca mismatch', () => {
    expect(resolveSource('financial_bulk', policy)).toMatchObject({ code: 'commission_report', declared: 'financial_bulk', trust: 'mismatch' })
  })

  it('não confia em valores não string nem prototype keys', () => {
    expect(resolveSource(['bonus_page'], policy).code).toBe('bonus_page')
    expect(resolveSource({}, policy).trust).toBe('inferred')
    expect(isOsHistorySourceCode('toString')).toBe(false)
    expect(isOsHistorySourceCode('__proto__')).toBe(false)
  })
})

describe('originForPath (front)', () => {
  it.each([
    ['/app/service-orders', 'os_detail'],
    ['/app/financial', 'financial_entries'],
    ['/app/financial/', 'financial_entries'],
    ['/app/financial/bonuses/abc', 'bonus_page'],
    ['/app/financial/service-invoices', 'fiscal'],
    ['/app/reports/commissions?month=1', 'commission_report'],
    ['/app/appointments', 'appointments'],
    ['/admin/audit', 'admin_support']
  ])('%s -> %s', (path, code) => expect(originForPath(path)).toBe(code))

  it('rotas sem mapa e prefixo parcial não declaram origem', () => {
    expect(originForPath('/app/customers')).toBeNull()
    expect(originForPath('/app/financialx')).toBeNull()
    expect(originForPath(null)).toBeNull()
  })

  it('todo valor do mapa existe no catálogo', () => {
    for (const p of ['/app/service-orders', '/app/financial', '/app/appointments', '/admin']) {
      expect(Object.keys(OS_HISTORY_SOURCES)).toContain(originForPath(p))
    }
  })
})
