import { describe, expect, it } from 'vitest'
import { expandRecurrence, parseRRule } from '../../../server/utils/recurrence'

const iso = (dates: Date[]) => dates.map(d => d.toISOString().slice(0, 10))

describe('parseRRule', () => {
  it('lê FREQ/INTERVAL/COUNT/BYDAY', () => {
    expect(parseRRule('FREQ=WEEKLY;INTERVAL=2;COUNT=5;BYDAY=MO,WE')).toEqual({ freq: 'WEEKLY', interval: 2, count: 5, byday: ['MO', 'WE'] })
  })
  it('UNTIL só data e data/hora', () => {
    expect(parseRRule('FREQ=DAILY;UNTIL=20260315').until?.toISOString()).toBe('2026-03-15T00:00:00.000Z')
    expect(parseRRule('FREQ=DAILY;UNTIL=20260315T120000Z').until?.toISOString()).toBe('2026-03-15T12:00:00.000Z')
  })
  it('padrões e partes vazias', () => {
    expect(parseRRule('')).toEqual({ freq: 'DAILY', interval: 1 })
    expect(parseRRule('FREQ=;COUNT')).toEqual({ freq: 'DAILY', interval: 1 })
  })
})

describe('expandRecurrence', () => {
  const start = '2026-01-01T10:00:00Z'
  const rangeStart = new Date('2026-01-01T00:00:00Z')
  const farEnd = new Date('2026-12-31T00:00:00Z')

  it('diário com COUNT', () => {
    expect(iso(expandRecurrence(start, 'FREQ=DAILY;COUNT=3', rangeStart, farEnd))).toEqual(['2026-01-01', '2026-01-02', '2026-01-03'])
  })
  it('semanal com INTERVAL=2', () => {
    expect(iso(expandRecurrence(start, 'FREQ=WEEKLY;INTERVAL=2;COUNT=3', rangeStart, farEnd))).toEqual(['2026-01-01', '2026-01-15', '2026-01-29'])
  })
  it('mensal respeita o fim do range', () => {
    expect(iso(expandRecurrence(start, 'FREQ=MONTHLY', rangeStart, new Date('2026-04-30T00:00:00Z'))))
      .toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'])
  })
  it('UNTIL antes do início não gera nada', () => {
    expect(expandRecurrence(start, 'FREQ=DAILY;UNTIL=20251231', rangeStart, farEnd)).toEqual([])
  })
  it('UNTIL limita as ocorrências', () => {
    expect(iso(expandRecurrence(start, 'FREQ=DAILY;UNTIL=20260103T235959Z', rangeStart, farEnd))).toEqual(['2026-01-01', '2026-01-02', '2026-01-03'])
  })
  it('maxOccurrences limita quando não há COUNT', () => {
    expect(expandRecurrence(start, 'FREQ=DAILY', rangeStart, new Date('2030-01-01T00:00:00Z'), 5)).toHaveLength(5)
  })
  it('ocorrências antes do rangeStart são omitidas', () => {
    const r = expandRecurrence(start, 'FREQ=DAILY;COUNT=10', new Date('2026-01-08T00:00:00Z'), farEnd)
    expect(iso(r)[0]).toBe('2026-01-08')
  })
  it('semanal com BYDAY preserva o horário e usa os dias pedidos', () => {
    const r = expandRecurrence('2026-01-05T09:30:00Z', 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4', new Date('2026-01-01T00:00:00Z'), farEnd)
    expect(iso(r)).toEqual(['2026-01-05', '2026-01-07', '2026-01-12', '2026-01-14'])
    expect(r.every(d => d.getUTCHours() === 9 && d.getUTCMinutes() === 30)).toBe(true)
  })
  // KF-01: ver docs/testing/known-failures.md
  it.fails('mensal no dia 31 cai no último dia do mês curto (28/02)', () => {
    const r = expandRecurrence('2026-01-31T10:00:00Z', 'FREQ=MONTHLY;COUNT=3', rangeStart, farEnd)
    expect(iso(r)[0]).toBe('2026-01-31')
    expect(iso(r)[1]).toBe('2026-02-28')
  })
  it('INTERVAL=0 não trava (limite de segurança)', () => {
    const r = expandRecurrence(start, 'FREQ=DAILY;INTERVAL=0', rangeStart, farEnd, 3)
    expect(r.length).toBeLessThanOrEqual(1000)
  })
})
