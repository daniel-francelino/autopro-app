// Fixtures dos specs logados: um "mundo" por worker e helpers de login/API.
import { expect, request as pwRequest, test as base, type APIRequestContext, type Page } from '@playwright/test'
import { authSkipReason } from './env'
import { createWorld, type TestUser, type UserKind, type World } from './world'

/** Entra pela API (mesmo caminho do formulário) e deixa os cookies no contexto da página. */
export async function loginViaApi(request: APIRequestContext, user: TestUser) {
  const res = await request.post('/api/auth/login', { data: { email: user.email, password: user.password } })
  expect(res.status(), `login de ${user.kind}: ${await res.text()}`).toBe(200)
}

/** Resposta de uma chamada de API já tipada para os specs. */
export interface ApiResult<T = any> { status: number, body: T }

export class Api {
  constructor(private readonly request: APIRequestContext) {}

  private async wrap<T>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<ApiResult<T>> {
    const text = await res.text()
    let body: unknown = text
    try { body = text ? JSON.parse(text) : null } catch { /* corpo não-JSON */ }
    return { status: res.status(), body: body as T }
  }

  get<T = any>(url: string, query?: Record<string, string>) { return this.request.get(url, { params: query }).then(r => this.wrap<T>(r)) }
  post<T = any>(url: string, data: unknown = {}) { return this.request.post(url, { data }).then(r => this.wrap<T>(r)) }
  put<T = any>(url: string, data: unknown = {}) { return this.request.put(url, { data }).then(r => this.wrap<T>(r)) }
  del<T = any>(url: string, data?: unknown) { return this.request.delete(url, { data }).then(r => this.wrap<T>(r)) }
}

interface Fixtures {
  /** Faz login do tipo de usuário no contexto da página e devolve a própria página. */
  loginAs: (kind: UserKind) => Promise<TestUser>
  /** API autenticada como o usuário (contexto separado: não mistura cookies de outro usuário). */
  apiAs: (kind: UserKind) => Promise<Api>
}

export const test = base.extend<Fixtures, { world: World }>({
  // O Playwright exige a desestruturação do 1º argumento, mesmo vazia.
  // eslint-disable-next-line no-empty-pattern
  world: [async ({}, use) => {
    const world = await createWorld()
    try {
      await use(world)
    } finally {
      await world.cleanup()
    }
  }, { scope: 'worker' }],

  loginAs: async ({ page, world }, use) => {
    await use(async (kind) => {
      const user = world.users[kind]
      await loginViaApi(page.request, user)
      return user
    })
  },

  apiAs: async ({ world, baseURL }, use) => {
    const contexts: APIRequestContext[] = []
    await use(async (kind) => {
      const ctx = await pwRequest.newContext({ baseURL })
      contexts.push(ctx)
      await loginViaApi(ctx, world.users[kind])
      return new Api(ctx)
    })
    await Promise.all(contexts.map(c => c.dispose()))
  }
})

export { expect }
export type { Page, TestUser, UserKind, World }

/** Usar no topo do spec: `skipUnlessAuth(test)`. */
export function skipUnlessAuth(t: typeof test) {
  const reason = authSkipReason()
  t.skip(reason !== null, reason ?? '')
}
