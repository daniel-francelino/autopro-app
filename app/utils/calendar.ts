export type CalendarView = 'month' | 'week' | 'day'

export const HOUR_START = 0 // 00:00
export const HOUR_END = 24 // 23:30 (last slot)
export const SLOT_MINUTES = 30
export const SLOT_HEIGHT_PX = 48
export const TOTAL_SLOTS = (HOUR_END - HOUR_START) * (60 / SLOT_MINUTES) // 48
/** Total scrollable grid height in pixels (48 slots × 48px) */
export const GRID_HEIGHT = TOTAL_SLOTS * SLOT_HEIGHT_PX // 2304

/** Formats a Date to YYYY-MM-DD using local time (avoids UTC offset issues) */
export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

export function isToday(d: Date): boolean {
  const t = new Date()
  return (
    d.getFullYear() === t.getFullYear()
    && d.getMonth() === t.getMonth()
    && d.getDate() === t.getDate()
  )
}

export function getMonthRange(d: Date): { from: string, to: string } {
  const y = d.getFullYear()
  const m = d.getMonth()
  return { from: toISO(new Date(y, m, 1)), to: toISO(new Date(y, m + 1, 0)) }
}

export function getWeekRange(d: Date): { from: string, to: string } {
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const mon = new Date(d)
  mon.setDate(d.getDate() + diff)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  return { from: toISO(mon), to: toISO(sun) }
}

export function getDayRange(d: Date): { from: string, to: string } {
  const iso = toISO(d)
  return { from: iso, to: iso }
}

/** Returns 42 Date objects covering 6 weeks for the month containing d (Mon-first) */
export function buildMonthGrid(d: Date): Date[] {
  const y = d.getFullYear()
  const m = d.getMonth()
  const first = new Date(y, m, 1)
  const startOffset = first.getDay() === 0 ? 6 : first.getDay() - 1
  const start = new Date(first)
  start.setDate(1 - startOffset)
  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(start)
    day.setDate(start.getDate() + i)
    return day
  })
}

/** Returns the 7 days (Mon–Sun) of the week containing d */
export function buildWeekDays(d: Date): Date[] {
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const mon = new Date(d)
  mon.setDate(d.getDate() + diff)
  return Array.from({ length: 7 }, (_, i) => {
    const wd = new Date(mon)
    wd.setDate(mon.getDate() + i)
    return wd
  })
}

/** Returns time slot labels every 30 min from 00:00 to 23:30 (48 slots) */
export function buildTimeSlots(): string[] {
  const slots: string[] = []
  for (let h = HOUR_START; h < HOUR_END; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`)
    slots.push(`${String(h).padStart(2, '0')}:30`)
  }
  return slots // ['00:00', '00:30', ..., '23:00', '23:30']
}

/**
 * Converts a HH:MM time string to pixel offset from the top of the grid (00:00).
 * Returns px position — used as `top` in absolute-positioned event cards.
 */
export function minuteFromStart(time: string): number {
  const [hh, mm] = time.split(':').map(Number)
  const totalMinutes = (hh ?? 0) * 60 + (mm ?? 0)
  return (totalMinutes / SLOT_MINUTES) * SLOT_HEIGHT_PX
}

/** Current time pixel offset — used for the now-indicator `top` value */
export function getCurrentMinuteFromStart(): number {
  const now = new Date()
  const totalMinutes = now.getHours() * 60 + now.getMinutes()
  return (totalMinutes / SLOT_MINUTES) * SLOT_HEIGHT_PX
}

/** Always true: 24h grid covers the full day */
export function isCurrentTimeVisible(): boolean {
  return true
}

/** Short weekday name for a date (seg, ter, qua…) */
export function formatDayShort(d: Date): string {
  return d
    .toLocaleDateString('pt-BR', { weekday: 'short' })
    .replace('.', '')
    .toLowerCase()
}

export function formatCalendarTitle(d: Date, view: CalendarView): string {
  if (view === 'month') {
    return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(d)
  }
  if (view === 'week') {
    const { from, to } = getWeekRange(d)
    const f = new Date(`${from}T00:00:00`)
    const t = new Date(`${to}T00:00:00`)
    if (f.getMonth() === t.getMonth()) {
      return `${f.getDate()}–${t.getDate()} de ${new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(f)}`
    }
    const fStr = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' }).format(f)
    const tStr = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' }).format(t)
    return `${fStr} – ${tStr}`
  }
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
}

/**
 * Scrolls the given container element to show the current time (or 07:00 as fallback).
 * Call on mount for WeekView and DayView.
 */
export function scrollToCurrentTime(containerEl: HTMLElement) {
  const now = new Date()
  const totalMinutes = now.getHours() * 60 + now.getMinutes()
  const scrollTop = (totalMinutes / SLOT_MINUTES) * SLOT_HEIGHT_PX - 200
  containerEl.scrollTop = Math.max(0, scrollTop)
}
