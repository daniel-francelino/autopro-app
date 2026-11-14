import type { OsHistoryCategory, OsHistoryDayGroup, OsHistoryEvent } from '~/types/service-order-history'

// Apresentação do histórico da OS. Fuso: o do navegador (decisão do responsável). Sem regra de negócio.

export const OS_HISTORY_CATEGORY_OPTIONS: Array<{ label: string, value: OsHistoryCategory | 'all' }> = [
  { label: 'Todas', value: 'all' },
  { label: 'Status', value: 'status' },
  { label: 'Dados da OS', value: 'order' },
  { label: 'Itens', value: 'items' },
  { label: 'Pagamentos', value: 'payment' },
  { label: 'Comissões', value: 'commission' }
]

const CATEGORY_UI: Record<string, { label: string, icon: string, indicatorClass: string }> = {
  status: { label: 'Status', icon: 'i-lucide-flag', indicatorClass: 'text-info' },
  order: { label: 'Dados da OS', icon: 'i-lucide-clipboard-list', indicatorClass: 'text-muted' },
  items: { label: 'Itens', icon: 'i-lucide-package', indicatorClass: 'text-muted' },
  payment: { label: 'Pagamentos', icon: 'i-lucide-banknote', indicatorClass: 'text-success' },
  commission: { label: 'Comissões', icon: 'i-lucide-percent', indicatorClass: 'text-warning' }
}
const CATEGORY_FALLBACK: { label: string, icon: string, indicatorClass: string } = {
  label: 'Outros',
  icon: 'i-lucide-circle-dot',
  indicatorClass: 'text-muted'
}

export function getCategoryUi(category: string) {
  return CATEGORY_UI[category] ?? CATEGORY_FALLBACK
}

/** Origem fora da OS (outra tela): código que não começa com `os_` e não é `unknown`. */
export function isExternalSource(code: string): boolean {
  return !code.startsWith('os_') && code !== 'unknown'
}

const pad = (n: number) => String(n).padStart(2, '0')

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "Hoje", "Ontem" ou dd/MM/yyyy (fuso local). */
export function formatDayLabel(date: Date, now: Date = new Date()): string {
  const key = dayKey(date)
  if (key === dayKey(now)) return 'Hoje'
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (key === dayKey(yesterday)) return 'Ontem'
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
}

/** HH:mm no fuso local; string vazia se a data for inválida. */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Agrupa por dia (fuso local) preservando a ordem recebida; nunca reordena. */
/** Eventos consecutivos com o mesmo groupId (uma única ação do usuário) viram uma entrada só. */
export function groupEventsByAction(events: OsHistoryEvent[]): OsHistoryEvent[][] {
  const out: OsHistoryEvent[][] = []
  for (const ev of events) {
    const last = out[out.length - 1]
    if (last && last[0]!.groupId === ev.groupId) last.push(ev)
    else out.push([ev])
  }
  return out
}

export function groupEventsByDay(events: OsHistoryEvent[], now: Date = new Date()): OsHistoryDayGroup[] {
  const groups: OsHistoryDayGroup[] = []
  for (const ev of events) {
    const d = new Date(ev.occurredAt)
    const valid = !Number.isNaN(d.getTime())
    const key = valid ? dayKey(d) : 'invalid'
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.items.push(ev)
    } else {
      groups.push({ key, label: valid ? formatDayLabel(d, now) : 'Data indisponível', items: [ev] })
    }
  }
  return groups
}
