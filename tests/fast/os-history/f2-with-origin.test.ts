// withOrigin entrega headers como objeto simples; o plugin api-client lê via `new Headers(...)` e só define a origem se faltar.
import { describe, expect, it } from 'vitest'
import { withOrigin } from '../../../app/utils/with-origin'
import { OS_HISTORY_ORIGIN_HEADER } from '../../../lib/utils/os-history-sources'

describe('withOrigin x plugin api-client', () => {
  it('headers simples: x-origin presente após new Headers(), sem duplicar e preservando os demais', () => {
    const opts = withOrigin('os_list', { method: 'POST', headers: { 'x-foo': '1' } })
    expect(opts.headers).toEqual({ 'x-foo': '1', [OS_HISTORY_ORIGIN_HEADER]: 'os_list' })
    const h = new Headers(opts.headers) // mesma leitura do plugin
    expect(h.has(OS_HISTORY_ORIGIN_HEADER)).toBe(true)
    expect(h.get(OS_HISTORY_ORIGIN_HEADER)).toBe('os_list')
    expect(h.get('x-foo')).toBe('1')
  })
  it('aceita Headers de entrada e o plugin (has) não sobrescreve', () => {
    const opts = withOrigin('os_form', { headers: new Headers({ 'X-Origin': 'os_detail' }) })
    expect(new Headers(opts.headers).get('x-origin')).toBe('os_form')
  })
})
