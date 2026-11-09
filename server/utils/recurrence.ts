/**
 * Simple RRULE expansion utility for MVP.
 * Supports: FREQ=DAILY|WEEKLY|MONTHLY, INTERVAL, COUNT, UNTIL, BYDAY
 * Generates occurrence start dates within a given range.
 */

interface ParsedRRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  interval: number
  count?: number
  until?: Date
  byday?: string[]
}

const DAY_MAP: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6
}

export function parseRRule(rrule: string): ParsedRRule {
  const parts = rrule.split(';')
  const result: ParsedRRule = {
    freq: 'DAILY',
    interval: 1
  }

  for (const part of parts) {
    const [key, value] = part.split('=')
    if (!key || !value) continue

    switch (key) {
      case 'FREQ':
        result.freq = value as ParsedRRule['freq']
        break
      case 'INTERVAL':
        result.interval = parseInt(value, 10)
        break
      case 'COUNT':
        result.count = parseInt(value, 10)
        break
      case 'UNTIL':
        result.until = parseRRuleDate(value)
        break
      case 'BYDAY':
        result.byday = value.split(',')
        break
    }
  }

  return result
}

function parseRRuleDate(value: string): Date {
  // Format: 20260315T120000Z or 20260315
  if (value.length === 8) {
    const y = value.substring(0, 4)
    const m = value.substring(4, 6)
    const d = value.substring(6, 8)
    return new Date(`${y}-${m}-${d}T00:00:00Z`)
  }
  // Full datetime
  const y = value.substring(0, 4)
  const m = value.substring(4, 6)
  const d = value.substring(6, 8)
  const h = value.substring(9, 11)
  const min = value.substring(11, 13)
  const s = value.substring(13, 15)
  return new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`)
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function addMonths(date: Date, months: number): Date {
  // Ancora no dia original e limita ao último dia do mês de destino (31/01 + 1 mês = 28/02).
  const result = new Date(date)
  const day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

/**
 * Expand a recurring event into occurrence start dates within [rangeStart, rangeEnd].
 * Returns ISO date strings of each occurrence start.
 */
export function expandRecurrence(
  eventStartAt: string,
  rrule: string,
  rangeStart: Date,
  rangeEnd: Date,
  maxOccurrences: number = 500
): Date[] {
  const parsed = parseRRule(rrule)
  const eventStart = new Date(eventStartAt)
  const occurrences: Date[] = []

  let current = new Date(eventStart)
  let count = 0
  const limit = parsed.count ?? maxOccurrences

  // Safety limit
  const absoluteMax = 1000
  let iterations = 0
  let monthSteps = 0

  while (iterations < absoluteMax) {
    iterations++

    // Check termination conditions
    if (parsed.until && current > parsed.until) break
    if (count >= limit) break
    if (current > rangeEnd) break

    if (parsed.freq === 'WEEKLY' && parsed.byday && parsed.byday.length > 0) {
      // For WEEKLY with BYDAY, iterate through the week
      const weekStart = getWeekStart(current)
      for (const dayCode of parsed.byday) {
        const dayNum = DAY_MAP[dayCode]
        if (dayNum === undefined) continue
        const candidate = addDays(weekStart, dayNum)
        // Preserve time from event start
        candidate.setUTCHours(
          eventStart.getUTCHours(),
          eventStart.getUTCMinutes(),
          eventStart.getUTCSeconds()
        )

        if (candidate >= eventStart && candidate >= rangeStart && candidate <= rangeEnd) {
          if (!parsed.until || candidate <= parsed.until) {
            if (count < limit) {
              occurrences.push(new Date(candidate))
              count++
            }
          }
        } else if (candidate >= eventStart && candidate > rangeEnd) {
          // Past range, will break outer loop
        }

        if (count >= limit) break
      }

      // Move to next interval week
      current = addDays(weekStart, 7 * parsed.interval)
    } else {
      // DAILY or MONTHLY or WEEKLY without BYDAY
      if (current >= rangeStart && current <= rangeEnd && current >= eventStart) {
        occurrences.push(new Date(current))
        count++
      }

      switch (parsed.freq) {
        case 'DAILY':
          current = addDays(current, parsed.interval)
          break
        case 'WEEKLY':
          current = addDays(current, 7 * parsed.interval)
          break
        case 'MONTHLY':
          // Sempre a partir do início do evento, para o dia 31 não "derivar" para 28 depois de fevereiro.
          monthSteps += parsed.interval
          current = addMonths(eventStart, monthSteps)
          break
      }
    }
  }

  return occurrences
}

function getWeekStart(date: Date): Date {
  const result = new Date(date)
  const day = result.getUTCDay()
  // Sunday = 0, so week start is Sunday
  result.setUTCDate(result.getUTCDate() - day)
  result.setUTCHours(0, 0, 0, 0)
  return result
}
