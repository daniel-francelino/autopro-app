// Auditoria: o plugin Nitro de ponta a ponta (hooks request → handler → afterResponse → INSERT),
// com Supabase em memória. Cobre os critérios de aceite do plano §13 que não precisam de Postgres real.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../../helpers/fake-supabase'

let fake: FakeSupabase
vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))

type Hook = (...args: any[]) => unknown
const hooks: Record<string, Hook> = {}
;(globalThis as any).defineNitroPlugin = (fn: (app: unknown) => void) => fn
const { default: plugin } = await import('../../../server/plugins/audit-log')
const { flushAudit } = await import('../../../server/utils/audit/queue')
const { setAuditContext } = await import('../../../server/utils/audit/context')
const { recordAudit } = await import('../../../server/utils/audit/record')

;(plugin as unknown as (app: unknown) => void)({ hooks: { hook: (name: string, fn: Hook) => { hooks[name] = fn } } })

interface Req {
  method?: string
  path?: string
  route?: string | null
  params?: Record<string, string>
  body?: unknown
  headers?: Record<string, string>
  status?: number
}

function makeEvent(req: Req = {}) {
  return {
    method: req.method ?? 'POST',
    path: req.path ?? '/api/clients',
    context: { matchedRoute: req.route === null ? undefined : { path: req.route ?? req.path ?? '/api/clients' }, params: req.params ?? {} } as any,
    headers: { 'content-type': 'application/json', ...req.headers },
    query: {},
    body: req.body,
    status: req.status ?? 200,
    responseHeaders: {} as Record<string, string>
  }
}

/** Percorre o ciclo de uma requisição. `handler` roda entre `request` e `afterResponse`. */
async function run(req: Req, handler?: (event: ReturnType<typeof makeEvent>) => void | Promise<void>, thrown?: { statusCode: number, statusMessage: string }) {
  const event = makeEvent(req)
  await hooks.request!(event)
  try {
    await handler?.(event)
    if (thrown) {
      event.status = thrown.statusCode
      // Fiel ao Nitro: handler que lança → hook `error`; o h3 NÃO chama afterResponse (event.handled).
      hooks.error!(thrown as unknown as Error, { event, tags: ['request'] })
    } else {
      hooks.beforeResponse!(event, { body: undefined })
      hooks.afterResponse!(event, { body: undefined })
    }
  } finally {
    await new Promise(resolve => setTimeout(resolve, 0))
    await flushAudit()
  }
  return event
}

const rows = () => fake.tables.audit_logs ?? []
const USER = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'
const asUser = (event: any) => setAuditContext(event, { userId: USER, email: 'a@a.com', organizationId: ORG, role: 'admin' })

beforeEach(() => {
  fake = createFakeSupabase({ audit_logs: [] })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('plugin de auditoria', () => {
  it('POST /api/clients: 1 linha client.create e X-Request-Id igual ao request_id', async () => {
    const event = await run({ body: { name: 'João' } }, asUser)
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatchObject({ action: 'client.create', outcome: 'success', actor_email: 'a@a.com', organization_id: ORG, actor_role: 'admin', request_body: { name: 'João' } })
    expect(event.responseHeaders['X-Request-Id']).toBe(rows()[0]!.request_id)
  })

  it('handler que lança 400 → outcome invalid com a mensagem', async () => {
    await run({ method: 'PUT', path: '/api/clients/c1', route: '/api/clients/:id', params: { id: 'c1' }, body: { person_type: 'x' } }, asUser, { statusCode: 400, statusMessage: 'Invalid person_type' })
    expect(rows()[0]).toMatchObject({ action: 'client.update', resource_id: 'c1', status_code: 400, outcome: 'invalid', error_message: 'Invalid person_type' })
  })

  it('403 → denied; 500 → error com a mensagem na resposta', async () => {
    await run({ method: 'DELETE', path: '/api/fiscal/nfse/ref1', route: '/api/fiscal/nfse/:reference', params: { reference: 'ref1' } }, asUser, { statusCode: 403, statusMessage: 'Acesso negado' })
    await run({}, asUser, { statusCode: 500, statusMessage: 'boom' })
    expect(rows().map(r => [r.action, r.outcome])).toEqual([['nfse.cancel', 'denied'], ['client.create', 'error']])
    expect(rows()[1]!.response_body).toMatchObject({ message: 'boom' })
  })

  it('erro que chega só pelo afterResponse (sem hook error) ainda registra a mensagem', async () => {
    const event = makeEvent()
    await hooks.request!(event)
    asUser(event)
    event.status = 422
    hooks.afterResponse!(event, { body: { statusCode: 422, statusMessage: 'Sem estoque' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    await flushAudit()
    expect(rows()[0]).toMatchObject({ outcome: 'invalid', error_message: 'Sem estoque' })
  })

  it('login com senha errada: anônimo, e-mail e sem senha', async () => {
    await run({ path: '/api/auth/login', body: { email: 'Fulano@x.com', password: 'segredo-123' } }, undefined, { statusCode: 401, statusMessage: 'Invalid credentials' })
    expect(rows()[0]).toMatchObject({ action: 'auth.login', actor_type: 'anonymous', actor_email: 'fulano@x.com', outcome: 'denied' })
    expect(JSON.stringify(rows())).not.toContain('segredo-123')
  })

  it('GET de lista com sucesso não gera linha; com 500 gera', async () => {
    await run({ method: 'GET', path: '/api/clients' }, asUser)
    expect(rows()).toHaveLength(0)
    await run({ method: 'GET', path: '/api/clients' }, asUser, { statusCode: 500, statusMessage: 'db' })
    expect(rows()).toHaveLength(1)
  })

  it('GET de detalhe guarda a resposta; GET /api/auth/me e métricas não geram linha', async () => {
    const event = makeEvent({ method: 'GET', path: '/api/service-orders/o1', route: '/api/service-orders/:id', params: { id: 'o1' } })
    await hooks.request!(event)
    asUser(event)
    hooks.beforeResponse!(event, { body: { id: 'o1', total: 99 } })
    hooks.afterResponse!(event, { body: { id: 'o1', total: 99 } })
    await new Promise(resolve => setTimeout(resolve, 0))
    await flushAudit()
    expect(rows()[0]).toMatchObject({ action: 'service_order.view', resource_id: 'o1', response_body: { id: 'o1', total: 99 } })

    await run({ method: 'GET', path: '/api/auth/me' }, asUser)
    await run({ path: '/api/metrics/track' }, asUser)
    expect(rows()).toHaveLength(1)
  })

  it('POST /api/service-orders com orderId vira service_order.update com o diff', async () => {
    await run({ path: '/api/service-orders', body: { orderId: 'o9', total: 50 } }, (event) => {
      asUser(event)
      recordAudit(event as any, { before: { id: 'o9', total: 500, updated_at: 'a' }, after: { id: 'o9', total: 50, updated_at: 'b' } })
    })
    expect(rows()[0]).toMatchObject({
      action: 'service_order.update', resource_id: 'o9',
      changes: { changed_fields: ['total'], diff: { total: { from: 500, to: 50 } } }
    })
  })

  it('ignora o que não é /api e não cria contexto nem cabeçalho', async () => {
    const event = makeEvent({ path: '/app/clients' })
    await hooks.request!(event)
    expect(event.context.audit).toBeUndefined()
    expect(event.responseHeaders['X-Request-Id']).toBeUndefined()
  })

  it('falha do INSERT de log não propaga: a requisição responde normalmente', async () => {
    const from = vi.spyOn(fake.client, 'from').mockImplementation(() => { throw new Error('banco fora do ar') })
    await expect(run({ body: { name: 'x' } }, asUser)).resolves.toBeDefined()
    expect(from).toHaveBeenCalledTimes(2) // 1 tentativa + 1 nova tentativa, depois desiste
    expect(console.error).toHaveBeenCalledTimes(1)
    expect(String((console.error as any).mock.calls[0][0])).not.toContain('"name"') // log de erro sem corpos
  })

  it('rota inexistente de bot sem sessão não gera linha', async () => {
    await run({ path: '/api/wp-login.php', route: null, status: 404 }, undefined, { statusCode: 404, statusMessage: 'Not Found' })
    expect(rows()).toHaveLength(0)
  })
})
