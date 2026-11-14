// Espelho do contrato de GET /api/service-orders/:id/history (não importar de server/).

export type OsHistoryCategory = 'status' | 'order' | 'items' | 'payment' | 'commission'

export interface OsHistoryDetail {
  label: string
  from: string | null
  to: string | null
}

export interface OsHistoryEvent {
  id: string
  occurredAt: string
  category: string
  title: string
  description: string
  details: OsHistoryDetail[]
  actorName: string | null
  source: { code: string, label: string }
  groupId: string
}

export interface OsHistoryPage {
  items: OsHistoryEvent[]
  nextCursor: string | null
}

export type OsHistoryStatus = 'idle' | 'loading' | 'ready' | 'error' | 'not-found'

export interface OsHistoryDayGroup {
  key: string
  label: string
  items: OsHistoryEvent[]
}
