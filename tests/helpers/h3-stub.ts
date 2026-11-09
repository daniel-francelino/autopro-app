// h3 não é dependência direta do projeto (vem pelo Nitro), então o pnpm não o expõe ao Vitest.
// Este stub reproduz só o que os utilitários de servidor usam.
export interface StubH3Error extends Error {
  statusCode: number
  statusMessage?: string
  data?: unknown
}

export function createError(input: string | { statusCode?: number, statusMessage?: string, message?: string, data?: unknown }): StubH3Error {
  const opts = typeof input === 'string' ? { message: input } : input
  const error = new Error(opts.message ?? opts.statusMessage ?? 'Error') as StubH3Error
  error.statusCode = opts.statusCode ?? 500
  error.statusMessage = opts.statusMessage
  error.data = opts.data
  return error
}

export function getHeader(event: { headers?: Record<string, string> }, name: string): string | undefined {
  return event?.headers?.[name.toLowerCase()]
}

// ── Funções que operam sobre o "FakeEvent" do handler-harness ──
type E = {
  query?: Record<string, unknown>
  params?: Record<string, string>
  body?: unknown
  cookies?: Record<string, string>
  headers?: Record<string, string>
  method?: string
  setCookies?: Array<{ name: string, value: string }>
}
const identity = <T>(fn: T) => fn
export const defineEventHandler = identity
export const eventHandler = identity
export const defineCachedEventHandler = identity
export const getQuery = (e: E) => e.query ?? {}
export const getRouterParam = (e: E, name: string) => e.params?.[name]
export const getRouterParams = (e: E) => e.params ?? {}
export const readBody = async (e: E) => e.body
export const readRawBody = async () => ''
export const readMultipartFormData = async () => undefined
export const getCookie = (e: E, name: string) => e.cookies?.[name]
export const setCookie = (e: E, name: string, value: string) => { e.setCookies?.push({ name, value }) }
export const deleteCookie = () => {}
export const getHeaders = (e: E) => e.headers ?? {}
export const getRequestHeader = getHeader
export const getRequestURL = () => new URL('http://localhost/api/test')
export const getMethod = (e: E) => e.method ?? 'GET'
export const setResponseStatus = () => {}
export const setResponseHeader = () => {}
export const setHeader = () => {}
export const sendRedirect = () => {}
export const getRequestIP = () => '127.0.0.1'
export const parseCookies = (e: E) => e.cookies ?? {}
