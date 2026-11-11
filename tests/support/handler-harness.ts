// Harness "L3-lite": executa os handlers REAIS de server/api sem subir o Nitro nem o banco.
// Os auto-imports do Nitro viram globais controláveis; o Supabase é um fake em memória.
import { vi } from 'vitest'
import { createError } from './h3-stub'

export interface FakeEventInit {
  method?: string
  cookies?: Record<string, string>
  query?: Record<string, unknown>
  params?: Record<string, string>
  body?: unknown
  headers?: Record<string, string>
}

export interface FakeEvent {
  __fake: true
  method: string
  cookies: Record<string, string>
  query: Record<string, unknown>
  params: Record<string, string>
  body: unknown
  headers: Record<string, string>
  setCookies: Array<{ name: string, value: string }>
}

export function fakeEvent(init: FakeEventInit = {}): FakeEvent {
  return {
    __fake: true,
    method: init.method ?? 'GET',
    cookies: init.cookies ?? {},
    query: init.query ?? {},
    params: init.params ?? {},
    body: init.body,
    headers: init.headers ?? {},
    setCookies: []
  }
}

/** Instala os auto-imports do Nitro como globais. Chamar uma vez por arquivo de teste. */
export function installNitroGlobals(runtimeConfig: Record<string, unknown> = {}) {
  const g = globalThis as Record<string, unknown>
  const handler = (fn: unknown) => fn
  g.defineEventHandler = handler
  g.eventHandler = handler
  g.defineCachedEventHandler = handler
  g.createError = createError
  g.getQuery = (e: FakeEvent) => e.query
  g.getRouterParam = (e: FakeEvent, name: string) => e.params[name]
  g.getRouterParams = (e: FakeEvent) => e.params
  g.readBody = async (e: FakeEvent) => e.body
  g.readMultipartFormData = async () => undefined
  g.getCookie = (e: FakeEvent, name: string) => e.cookies[name]
  g.setCookie = (e: FakeEvent, name: string, value: string) => { e.setCookies.push({ name, value }) }
  g.deleteCookie = vi.fn()
  g.getHeader = (e: FakeEvent, name: string) => e.headers[name.toLowerCase()]
  g.getHeaders = (e: FakeEvent) => e.headers
  g.getRequestHeader = g.getHeader
  g.getRequestURL = () => new URL('http://localhost/api/test')
  g.getMethod = (e: FakeEvent) => e.method
  g.setResponseStatus = vi.fn()
  g.setResponseHeader = vi.fn()
  g.setHeader = vi.fn()
  g.sendRedirect = vi.fn()
  g.readRawBody = async () => ''
  g.useRuntimeConfig = () => ({ supabaseUrl: 'http://localhost', supabaseAnonKey: 'anon', supabaseServiceRoleKey: 'service', ...runtimeConfig })
  g.useStorage = vi.fn()
  g.defineNitroPlugin = handler
}

export async function callHandler(file: string, event: FakeEvent): Promise<{ status: number, body?: unknown, error?: { statusCode?: number, statusMessage?: string, message?: string } }> {
  try {
    const mod = await import(/* @vite-ignore */ `../../${file}`)
    const body = await mod.default(event)
    return { status: 200, body }
  } catch (error) {
    const e = error as { statusCode?: number, statusMessage?: string, message?: string }
    if (typeof e?.statusCode === 'number') return { status: e.statusCode, error: e }
    return { status: 0, error: e }
  }
}

/**
 * Reproduz o auto-import do Nitro para `server/utils/*.ts`: todo export vira global
 * (ex.: handlers de fiscal chamam requireAuthUser sem importar).
 */
export async function installServerUtilsGlobals() {
  const { readdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { ROOT } = await import('./source-scan')
  const g = globalThis as Record<string, unknown>
  const dir = join(ROOT, 'server/utils')
  for (const name of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
    const mod = await import(/* @vite-ignore */ `../../server/utils/${name}`)
    for (const [key, value] of Object.entries(mod)) {
      if (!(key in g)) g[key] = value
    }
  }
}
