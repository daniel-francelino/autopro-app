// Auditoria: derivação de action/resource e sanitização (docs/audit/audit-log-plan.md §5.3 e §5.6).
import { describe, expect, it } from 'vitest'
import { deriveAction, normalizePattern, routePatternFor, singular } from '../../../server/utils/audit/derive'
import { REDACTED, redact, sanitizeAndCap, MAX_REQUEST_BYTES } from '../../../server/utils/audit/sanitize'

const derive = (method: string, pattern: string, params: Record<string, string> = {}, body: Record<string, unknown> | null = null) =>
  deriveAction({ method, pattern, params, body })

describe('deriveAction', () => {
  it.each([
    ['POST', '/api/clients', 'client.create'],
    ['PUT', '/api/clients/:id', 'client.update'],
    ['DELETE', '/api/clients/:id', 'client.delete'],
    ['GET', '/api/service-orders/:id', 'service_order.view'],
    ['POST', '/api/service-orders/:id/cancel', 'service_order.cancel'],
    ['POST', '/api/financial/:id/pay', 'financial.pay'],
    ['DELETE', '/api/service-orders/:id/installments/:installmentId', 'service_order.installment.delete'],
    ['POST', '/api/financial/categories/:id/migrate', 'financial.category.migrate'],
    ['POST', '/api/service-orders/:id/process-payment', 'service_order.process_payment'],
    ['POST', '/api/reports/export-file', 'report.export_file'],
    ['POST', '/api/bonuses', 'bonus.create'],
    ['POST', '/api/product-categories', 'product_category.create'],
    ['POST', '/api/billing/cancel', 'billing.cancel']
  ])('%s %s → %s', (method, pattern, expected) => {
    expect(derive(method, pattern).action).toBe(expected)
  })

  it('resource_type é o 1º segmento no singular e resource_id o último parâmetro', () => {
    const r = derive('DELETE', '/api/service-orders/:id/installments/:installmentId', { id: 'o1', installmentId: 'i9' })
    expect(r.resourceType).toBe('service_order')
    expect(r.resourceId).toBe('i9')
  })

  it('/api/admin/** usa o recurso que vem depois de admin', () => {
    expect(derive('POST', '/api/admin/organizations/:id/suspend', { id: 'x' }).action).toBe('organization.suspend')
  })

  describe('overrides', () => {
    it('POST /api/service-orders sem orderId é create', () => {
      expect(derive('POST', '/api/service-orders', {}, { number: '1' })).toMatchObject({ action: 'service_order.create' })
    })

    it('POST /api/service-orders com orderId é update e usa o orderId como resource_id', () => {
      expect(derive('POST', '/api/service-orders', {}, { orderId: 'o-7' })).toMatchObject({ action: 'service_order.update', resourceId: 'o-7' })
    })

    it.each([
      ['POST', '/api/roles/:id/actions', 'role.permissions_update'],
      ['POST', '/api/users/update-role', 'user.role_change'],
      ['POST', '/api/users/update-fields', 'user.update_fields'],
      ['POST', '/api/financial/pay-entries-bulk', 'financial.pay_bulk'],
      ['POST', '/api/financial/pay-commissions-bulk', 'commission.pay_bulk'],
      ['DELETE', '/api/fiscal/nfse/:reference', 'nfse.cancel'],
      ['POST', '/api/fiscal/nfse/:reference/hook', 'nfse.retry_hook'],
      ['POST', '/api/auth/login', 'auth.login'],
      ['PUT', '/api/auth/password', 'auth.password_change'],
      ['DELETE', '/api/auth/account', 'auth.account_delete'],
      ['GET', '/api/admin/audit-logs/:id', 'audit.view']
    ])('%s %s → %s', (method, pattern, expected) => {
      expect(derive(method, pattern).action).toBe(expected)
    })
  })
})

describe('padrões de rota', () => {
  it('normalizePattern troca qualquer parâmetro por :p', () => {
    expect(normalizePattern('/api/service-orders/:id/installments/:installmentId')).toBe('/api/service-orders/:p/installments/:p')
  })

  it('sem rota casada, UUIDs e números viram :id e a query some', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000'
    expect(routePatternFor(`/api/clients/${uuid}/notes/42?x=1`)).toBe('/api/clients/:id/notes/:id')
  })

  it('singular: plurais irregulares usados nas rotas', () => {
    expect([singular('bonuses'), singular('taxes'), singular('categories'), singular('roles'), singular('status'), singular('financial')])
      .toEqual(['bonus', 'tax', 'category', 'role', 'status', 'financial'])
  })
})

describe('sanitização', () => {
  it('redige senha, token, certificado e cartão em qualquer profundidade, sem diferenciar maiúsculas', () => {
    const out = redact({
      email: 'a@a.com',
      Password: 'x',
      nested: { access_token: 'a', deep: [{ refresh_token: 'b', Certificado_Senha: 'c', cardNumber: '4111', cvv: '123', keep: 1 }] },
      apiKey: 'k'
    }) as any
    expect(out.email).toBe('a@a.com')
    expect(out.Password).toBe(REDACTED)
    expect(out.nested.access_token).toBe(REDACTED)
    expect(out.nested.deep[0]).toMatchObject({ refresh_token: REDACTED, Certificado_Senha: REDACTED, cardNumber: REDACTED, cvv: REDACTED, keep: 1 })
    expect(out.apiKey).toBe(REDACTED)
    expect(JSON.stringify(out)).not.toMatch(/4111|"x"|"a"/)
  })

  it('não altera o objeto original', () => {
    const input = { password: 'segredo' }
    redact(input)
    expect(input.password).toBe('segredo')
  })

  it('sobrevive a referência circular', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    expect(() => redact(a)).not.toThrow()
  })

  it('corpo acima do teto vira resumo e é marcado como truncado', () => {
    const big = { items: Array.from({ length: 2000 }, (_, i) => ({ i, text: 'x'.repeat(30) })), note: 'ok' }
    const capped = sanitizeAndCap(big, MAX_REQUEST_BYTES)
    expect(capped.truncated).toBe(true)
    expect(capped.size).toBeGreaterThan(MAX_REQUEST_BYTES)
    expect(capped.value).toMatchObject({ items: { type: 'array', length: 2000 }, note: 'string' })
  })

  it('corpo pequeno passa inteiro', () => {
    expect(sanitizeAndCap({ a: 1 }, MAX_REQUEST_BYTES)).toMatchObject({ truncated: false, value: { a: 1 } })
  })
})
