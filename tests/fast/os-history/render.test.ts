// Histórico da OS: renderizador pt-BR no servidor (2 eventos + fallback).
import { describe, expect, it } from 'vitest'
import { renderOsEvent, type OsEventRow } from '../../../server/utils/os-history/render'

const base: OsEventRow = {
  id: 'e1', occurred_at: '2026-11-13T12:00:00Z', event_type: 'installment.paid', schema_version: 1, category: 'payment',
  actor_name: 'Maria', payload: {}, correlation_id: '11111111-1111-4111-8111-111111111111',
  source_code: 'os_detail', source_label: 'Ordem de serviço (detalhe)'
}

describe('renderOsEvent', () => {
  it('installment.paid', () => {
    const r = renderOsEvent({ ...base, payload: { installment_number: 2, amount: 300, payment_method: 'pix', payment_date: '2026-11-12' } })
    expect(r.title).toBe('Parcela 2 recebida')
    expect(r.description).toBe('Parcela 2 recebida: R$ 300,00 (Pix) em 12/11/2026. Registrado por Maria.')
    expect(r.source).toEqual({ code: 'os_detail', label: 'Ordem de serviço (detalhe)' })
  })

  it('installment.paid parcial e sem forma/data', () => {
    const r = renderOsEvent({ ...base, payload: { installment_number: 1, amount: 50.5, partial: true } })
    expect(r.description).toBe('Parcela 1 recebida parcialmente: R$ 50,50. Registrado por Maria.')
  })

  it('order.status_changed traduz status e devolve de/para', () => {
    const r = renderOsEvent({ ...base, event_type: 'order.status_changed', category: 'status', payload: { from: 'open', to: 'completed' } })
    expect(r.description).toBe("Status alterado de 'Aberta' para 'Concluída' por Maria.")
    expect(r.details).toEqual([{ label: 'Status', from: 'Aberta', to: 'Concluída' }])
  })

  it.each(['constructor', 'toString', '__proto__'])('valor %s não lê o protótipo', (v) => {
    const pay = renderOsEvent({ ...base, payload: { installment_number: 1, amount: 1, payment_method: v } })
    expect(pay.description).toContain(`(${v})`)
    const st = renderOsEvent({ ...base, event_type: 'order.status_changed', payload: { from: v, to: v } })
    expect(st.description).toBe("Status alterado de 'outro status' para 'outro status' por Maria.")
  })

  it('tipo desconhecido e ator ausente não quebram', () => {
    const r = renderOsEvent({ ...base, event_type: 'future.thing', actor_name: null, payload: null })
    expect(r.title).toBe('Evento registrado')
    expect(r.description).toContain('usuário')
  })

  it('não vaza ids crus: groupId é opaco e origem desconhecida vira unknown', () => {
    const r = renderOsEvent({ ...base, source_code: 'weird', source_label: '' })
    expect(r.groupId).toMatch(/^[0-9a-f]{16}$/)
    expect(r.groupId).not.toContain('1111')
    expect(r.source.code).toBe('unknown')
    expect(r.source.label).toBe('Origem não identificada')
    expect(Object.keys(r)).not.toContain('correlation_id')
  })
})
