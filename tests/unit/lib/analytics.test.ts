import { describe, expect, it, vi } from 'vitest'
import {
  ACTION_EVENTS,
  CLIENT_EVENTS,
  LIFECYCLE_EVENTS,
  MAX_DURATION_MS,
  MAX_STEP,
  cleanClientEvent,
  isClientEvent,
  normalizeArea,
  normalizePlatform,
  normalizeSessionId
} from '../../../lib/analytics/events'
import { classifyTraffic } from '../../../lib/analytics/traffic'
import { analyticsArea } from '../../../lib/analytics/areas'
import { sanitizeAttribution } from '../../../lib/analytics/attribution'

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: vi.fn() }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: vi.fn() }))
vi.mock('../../../server/utils/auth-cookies', () => ({ getAccessTokenFromCookies: vi.fn() }))

const { hashUser } = await import('../../../server/utils/analytics/identity')
const { actionRuleFor, resolveActionEvent } = await import('../../../server/utils/analytics/actions')
const { takeRateLimit } = await import('../../../server/utils/analytics/record')

describe('lib/analytics/events', () => {
  it('evento desconhecido é rejeitado', () => {
    expect(isClientEvent('page_view')).toBe(true)
    expect(isClientEvent('service_order_created')).toBe(false) // ação só nasce no servidor
    expect(isClientEvent('hack')).toBe(false)
    expect(isClientEvent(undefined)).toBe(false)
  })
  it('listas fechadas não se sobrepõem', () => {
    const all = [...CLIENT_EVENTS, ...ACTION_EVENTS, ...LIFECYCLE_EVENTS]
    expect(new Set(all).size).toBe(all.length)
  })
  it('normalizações', () => {
    expect(normalizePlatform('ios')).toBe('ios')
    expect(normalizePlatform('windows')).toBeNull()
    expect(normalizeArea('Painel')).toBe('Painel')
    expect(normalizeArea('/app/segredo/123')).not.toContain('segredo')
    expect(normalizeSessionId('abc12345-xyz')).toBe('abc12345-xyz')
    expect(normalizeSessionId('curto')).toBeNull()
    expect(normalizeSessionId('com espaço e <script>')).toBeNull()
    expect(normalizeSessionId(undefined)).toBeNull()
  })
  it('cleanClientEvent: evento inválido → null', () => {
    expect(cleanClientEvent({ event: 'hack' } as never)).toBeNull()
  })
  it('cleanClientEvent: limita duração e passo', () => {
    const clean = cleanClientEvent({ event: 'active_time', durationMs: MAX_DURATION_MS * 10, step: MAX_STEP * 5, area: 'Painel' } as never)
    if (clean) {
      expect(clean.durationMs ?? 0).toBeLessThanOrEqual(MAX_DURATION_MS)
      expect(clean.step ?? 0).toBeLessThanOrEqual(MAX_STEP)
    }
  })
  it('areas: rota crua vira rótulo, sem IDs', () => {
    expect(analyticsArea('/app/service-orders/6f1c0e1a-1111-2222-3333-444455556666')).not.toMatch(/6f1c/)
    expect(analyticsArea('/pricing')).toBe('Planos')
  })
})

describe('lib/analytics/attribution e traffic', () => {
  it('sanitizeAttribution descarta lixo', () => {
    expect(sanitizeAttribution(null)).toBeNull()
    expect(sanitizeAttribution('texto')).toBeNull()
    expect(sanitizeAttribution(42)).toBeNull()
  })
  it('classifyTraffic reconhece bots e navegadores', () => {
    expect(classifyTraffic('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36').bot).toBeFalsy()
    expect(classifyTraffic('Googlebot/2.1 (+http://www.google.com/bot.html)').bot).toBeTruthy()
    expect(() => classifyTraffic(null)).not.toThrow()
  })
})

describe('server/utils/analytics', () => {
  it('hashUser é estável, depende do segredo e não revela o ID', () => {
    const a = hashUser('user-1', 'segredo')
    expect(hashUser('user-1', 'segredo')).toBe(a)
    expect(hashUser('user-1', 'outro')).not.toBe(a)
    expect(hashUser('user-2', 'segredo')).not.toBe(a)
    expect(a).toHaveLength(24)
    expect(a).not.toContain('user-1')
  })
  it('actionRuleFor mapeia método + rota para evento de negócio', () => {
    const rule = actionRuleFor('POST', '/api/clients')!
    expect(resolveActionEvent(rule, null)).toBe('client_created')
    expect(resolveActionEvent(actionRuleFor('POST', '/api/service-orders/')!, null)).toBe('service_order_created')
    expect(resolveActionEvent(actionRuleFor('POST', '/api/service-orders?x=1')!, { orderId: 'abc' })).toBe('service_order_updated')
    expect(resolveActionEvent(actionRuleFor('POST', '/api/service-orders/abc/installments/def/pay')!, null)).toBe('installment_paid')
  })
  it('rotas sem regra e métodos de leitura não geram evento', () => {
    expect(actionRuleFor('GET', '/api/clients')).toBeNull()
    expect(actionRuleFor('POST', '/api/rota-desconhecida')).toBeNull()
  })
  it('exportações viram report_exported', () => {
    expect(resolveActionEvent(actionRuleFor('POST', '/api/reports/export-file')!, null)).toBe('report_exported')
  })
  it('todo evento de ação usado nas regras existe na lista fechada', () => {
    const probes: Array<[string, string]> = [
      ['POST', '/api/appointments'], ['POST', '/api/vehicles'], ['POST', '/api/financial'], ['POST', '/api/bonuses'],
      ['POST', '/api/commissions'], ['POST', '/api/products'], ['POST', '/api/purchases'], ['POST', '/api/employees'],
      ['POST', '/api/roles'], ['PUT', '/api/roles/1'], ['POST', '/api/fiscal/nfse'], ['POST', '/api/organizations/complete-onboarding']
    ]
    const known = new Set<string>([...ACTION_EVENTS, ...LIFECYCLE_EVENTS])
    for (const [m, p] of probes) {
      const rule = actionRuleFor(m, p)
      expect(rule, `${m} ${p}`).not.toBeNull()
      expect(known.has(resolveActionEvent(rule!, null)), `${m} ${p}`).toBe(true)
    }
  })
  it('takeRateLimit respeita o teto por chave e isola chaves', () => {
    expect(takeRateLimit('k1', 100)).toBe(100)
    expect(takeRateLimit('k1', 100)).toBe(100)
    expect(takeRateLimit('k1', 100)).toBe(40) // 240 - 200
    expect(takeRateLimit('k1', 10)).toBe(0)
    expect(takeRateLimit('k2', 10)).toBe(10)
  })
})
