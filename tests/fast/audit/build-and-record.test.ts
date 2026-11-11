// Auditoria: o que entra no log, como a linha é montada e o diff antes/depois.
import { describe, expect, it } from 'vitest'
import { buildAuditRow, outcomeFor, shouldAudit, type RowInput } from '../../../server/utils/audit/build'
import { buildChanges, diffSnapshots } from '../../../server/utils/audit/record'

const REQ = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'

function input(overrides: Partial<RowInput> & { ctx?: Partial<RowInput['ctx']> } = {}): RowInput {
  const { ctx, ...rest } = overrides
  return {
    ctx: { requestId: REQ, startedAt: Date.now() - 20, ...ctx },
    method: 'POST',
    path: '/api/clients',
    matchedRoute: '/api/clients',
    params: {},
    status: 200,
    headers: {},
    ...rest
  }
}

describe('outcomeFor', () => {
  it.each([[200, 'success'], [302, 'success'], [401, 'denied'], [403, 'denied'], [400, 'invalid'], [404, 'invalid'], [409, 'invalid'], [422, 'invalid'], [500, 'error'], [503, 'error'], [429, 'error']])(
    '%i → %s', (status, expected) => expect(outcomeFor(status)).toBe(expected)
  )
})

describe('shouldAudit (§5.2)', () => {
  const base = { hasUser: true, matchedRoute: null as string | null }

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('registra toda escrita (%s)', (method) => {
    expect(shouldAudit({ ...base, method, path: '/api/clients/abc', matchedRoute: '/api/clients/:id' }).audit).toBe(true)
  })

  it('successful list GET is NOT recorded; with 403 or 500 it is', () => {
    const req = { ...base, method: 'GET', path: '/api/clients', matchedRoute: '/api/clients' }
    expect(shouldAudit({ ...req, status: 200 }).audit).toBe(false)
    expect(shouldAudit({ ...req, status: 403 }).audit).toBe(true)
    expect(shouldAudit({ ...req, status: 500 }).audit).toBe(true)
  })

  it('detail GET is recorded with response capture', () => {
    expect(shouldAudit({ ...base, method: 'GET', path: '/api/service-orders/o1', matchedRoute: '/api/service-orders/:id', status: 200 }))
      .toEqual({ audit: true, captureResponse: true })
  })

  it('detail GET under /api/auth never captures the response', () => {
    expect(shouldAudit({ ...base, method: 'GET', path: '/api/auth/profile', matchedRoute: '/api/auth/profile', status: 200 }).captureResponse).toBe(false)
  })

  it.each([
    ['GET', '/api/supabase/health'],
    ['GET', '/api/auth/me'],
    ['POST', '/api/auth/set-session'],
    ['POST', '/api/metrics/track'],
    ['POST', '/api/notifications/read'],
    ['POST', '/api/notifications/read-all'],
    ['GET', '/api/admin/audit-logs']
  ])('ignora %s %s', (method, path) => {
    expect(shouldAudit({ ...base, method, path, matchedRoute: path, status: 500 }).audit).toBe(false)
  })

  it('opening a log detail is recorded (audit.view), without storing the response', () => {
    expect(shouldAudit({ ...base, method: 'GET', path: '/api/admin/audit-logs/x', matchedRoute: '/api/admin/audit-logs/:id', status: 200 }))
      .toEqual({ audit: true, captureResponse: false })
  })

  it('nonexistent route from guest without session (bot) is ignored; with session it is recorded', () => {
    const req = { method: 'POST', path: '/api/wp-login.php', matchedRoute: null, status: 404 }
    expect(shouldAudit({ ...req, hasUser: false }).audit).toBe(false)
    expect(shouldAudit({ ...req, hasUser: true }).audit).toBe(true)
  })

  it('outside /api and no-effect methods are not included', () => {
    expect(shouldAudit({ ...base, method: 'POST', path: '/app/x' }).audit).toBe(false)
    expect(shouldAudit({ ...base, method: 'OPTIONS', path: '/api/clients', matchedRoute: '/api/clients' }).audit).toBe(false)
  })
})

describe('buildAuditRow', () => {
  it('successful write: author, workshop, action and time', () => {
    const row = buildAuditRow(input({ ctx: { userId: USER, email: 'a@a.com', organizationId: ORG, role: 'admin' }, body: { name: 'João' } }))
    expect(row).toMatchObject({
      request_id: REQ, actor_user_id: USER, actor_email: 'a@a.com', actor_role: 'admin', actor_type: 'user',
      organization_id: ORG, action: 'client.create', http_method: 'POST', http_path: '/api/clients',
      status_code: 200, outcome: 'success', error_message: null, request_body: { name: 'João' }
    })
    expect(row.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('login with wrong password: anonymous, email present and NEVER the password', () => {
    const row = buildAuditRow(input({
      method: 'POST', path: '/api/auth/login', matchedRoute: '/api/auth/login', status: 401,
      body: { email: ' Fulano@Oficina.com ', password: 'minhasenha123' },
      ctx: { error: { statusCode: 401, message: 'Invalid login credentials' } }
    }))
    expect(row).toMatchObject({ action: 'auth.login', actor_type: 'anonymous', actor_user_id: null, actor_email: 'fulano@oficina.com', outcome: 'denied', error_message: 'Invalid login credentials' })
    expect(JSON.stringify(row)).not.toContain('minhasenha123')
  })

  it('error 500: outcome=error and the response stores the message', () => {
    const row = buildAuditRow(input({ status: 500, ctx: { userId: USER, error: { statusCode: 500, message: 'boom' } } }))
    expect(row).toMatchObject({ outcome: 'error', error_message: 'boom', response_body: { statusCode: 500, message: 'boom' } })
  })

  it('validation 400 and 403 receive the right outcome', () => {
    expect(buildAuditRow(input({ status: 400, ctx: { error: { statusCode: 400, message: 'Invalid payload' } } })).outcome).toBe('invalid')
    expect(buildAuditRow(input({ status: 403, ctx: { error: { statusCode: 403, message: 'Acesso negado' } } })).outcome).toBe('denied')
  })

  it('nested password, token and certificate become [REDACTED]', () => {
    const row = buildAuditRow(input({ body: { company: { certificado_senha: 's', token: 't' }, name: 'ok' } }))
    expect(row.request_body).toEqual({ company: { certificado_senha: '[REDACTED]', token: '[REDACTED]' }, name: 'ok' })
  })

  it('multipart: only name/type/size, never the content', () => {
    const row = buildAuditRow(input({ path: '/api/suppliers/import', matchedRoute: '/api/suppliers/import', contentType: 'multipart/form-data; boundary=x', contentLength: 5000, body: 'CONTEUDO-DO-ARQUIVO' }))
    expect(row.request_body).toEqual({ multipart: true, content_type: 'multipart/form-data; boundary=x', size_bytes: 5000 })
    expect(JSON.stringify(row)).not.toContain('CONTEUDO-DO-ARQUIVO')
  })

  it('detail GET stores the response and its size; huge response becomes a truncated summary', () => {
    const small = buildAuditRow(input({ method: 'GET', path: '/api/service-orders/o1', matchedRoute: '/api/service-orders/:id', params: { id: 'o1' }, ctx: { responseBody: { id: 'o1', total: 10 } } }))
    expect(small).toMatchObject({ action: 'service_order.view', resource_id: 'o1', response_body: { id: 'o1', total: 10 }, response_truncated: false })
    expect(small.response_size_bytes).toBeGreaterThan(0)

    const big = buildAuditRow(input({ method: 'GET', path: '/api/service-orders/o1', matchedRoute: '/api/service-orders/:id', params: { id: 'o1' }, ctx: { responseBody: { items: Array.from({ length: 3000 }, (_, i) => ({ i, t: 'x'.repeat(20) })) } } }))
    expect(big.response_truncated).toBe(true)
    expect(big.response_body).toMatchObject({ items: { type: 'array', length: 3000 } })
  })

  it('response of /api/auth/* is never stored (carries session)', () => {
    const row = buildAuditRow(input({ method: 'GET', path: '/api/auth/profile', matchedRoute: '/api/auth/profile', ctx: { responseBody: { access_token: 'tok', user: { id: 'u' } } } }))
    expect(row.response_body).toBeNull()
  })

  it('webhook: type, action and workshop come from context', () => {
    const row = buildAuditRow(input({ path: '/api/stripe/webhook', matchedRoute: '/api/stripe/webhook', ctx: { actorType: 'webhook', action: 'stripe.invoice.paid', organizationId: ORG, resourceType: 'stripe_event', resourceId: 'evt_1' } }))
    expect(row).toMatchObject({ actor_type: 'webhook', action: 'stripe.invoice.paid', organization_id: ORG, resource_type: 'stripe_event', resource_id: 'evt_1' })
  })

  it('platform owner', () => {
    const row = buildAuditRow(input({ ctx: { userId: USER, actorType: 'owner', role: 'owner' } }))
    expect(row).toMatchObject({ actor_type: 'owner', actor_role: 'owner' })
  })

  it('IP: uses the 1st of x-forwarded-for, ignores invalid value and never drops the row', () => {
    expect(buildAuditRow(input({ headers: { forwardedFor: '203.0.113.9, 10.0.0.1' } })).ip_address).toBe('203.0.113.9')
    expect(buildAuditRow(input({ headers: { forwardedFor: 'not-an-ip', socketIp: '::ffff:127.0.0.1' } })).ip_address).toBe('127.0.0.1')
    expect(buildAuditRow(input({ headers: { forwardedFor: 'lixo' } })).ip_address).toBeNull()
  })

  it('platform only accepts web/ios/android; ids that are not UUID become null (they do not break the INSERT)', () => {
    expect(buildAuditRow(input({ headers: { platform: 'android' } })).platform).toBe('android')
    expect(buildAuditRow(input({ headers: { platform: 'windows-phone' } })).platform).toBeNull()
    const row = buildAuditRow(input({ ctx: { userId: 'nao-uuid', organizationId: 'nao-uuid' } }))
    expect(row).toMatchObject({ actor_user_id: null, organization_id: null })
  })

  it('fields respect the column limits', () => {
    const row = buildAuditRow(input({ path: `/api/${'a'.repeat(500)}`, matchedRoute: null, headers: { userAgent: 'u'.repeat(900) }, ctx: { email: `${'e'.repeat(400)}@x.com`, userId: USER } }))
    expect(row.http_path.length).toBeLessThanOrEqual(300)
    expect(row.user_agent!.length).toBeLessThanOrEqual(400)
    expect(row.actor_email!.length).toBeLessThanOrEqual(200)
  })

  it('attaches the Layer 2 diff to the same row', () => {
    const row = buildAuditRow(input({ ctx: { changes: { changed_fields: ['total'], diff: { total: { from: 500, to: 50 } } } } }))
    expect(row.changes).toEqual({ changed_fields: ['total'], diff: { total: { from: 500, to: 50 } } })
  })
})

describe('before/after diff (Layer 2)', () => {
  it('shows only what changed and ignores updated_at/updated_by', () => {
    const r = diffSnapshots(
      { id: 'i1', amount: 500, status: 'pending', updated_at: 'a', updated_by: 'x' },
      { id: 'i1', amount: 50, status: 'pending', updated_at: 'b', updated_by: 'y' }
    )
    expect(r).toEqual({ changed_fields: ['amount'], diff: { amount: { from: 500, to: 50 } } })
  })

  it('compares structures (jsonb) and fields that appeared or disappeared', () => {
    const r = diffSnapshots({ items: [{ code: 1, qty: 1 }], note: 'a' }, { items: [{ code: 1, qty: 2 }] })
    expect(r.changed_fields.sort()).toEqual(['items', 'note'])
    expect(r.diff.note).toEqual({ from: 'a', to: null })
  })

  it('no change → no fields', () => {
    expect(diffSnapshots({ a: 1 }, { a: 1 }).changed_fields).toEqual([])
  })

  it('creation stores the snapshot; deletion stores the previous; secrets come out redacted', () => {
    expect(buildChanges({ after: { id: 'n', name: 'x', created_at: 'z' } })).toMatchObject({ after: { id: 'n', name: 'x' } })
    expect(buildChanges({ before: { id: 'n', password: 'p' } })).toMatchObject({ before: { id: 'n', password: '[REDACTED]' } })
    expect(buildChanges({})).toBeNull()
  })
})
