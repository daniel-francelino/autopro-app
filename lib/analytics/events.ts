// Núcleo puro da telemetria própria (docs/metrics/usage-metrics-plan.md).
// Sem dependências de Nuxt/Supabase: é importado pelo cliente, pelo servidor e por testes.
// Tudo aqui é lista FECHADA — nada de texto livre vindo do cliente é gravado.

/** Eventos que o cliente pode enviar (também aceitos de visitantes). */
export const CLIENT_EVENTS = [
  'page_view',
  'session_start',
  'active_time',
  'onboarding_step',
  'onboarding_skip',
  'onboarding_complete',
  'tour_started',
  'tour_completed',
  'cta_hero_click',
  'cta_final_click',
  'cta_footer_click',
  'nav_click',
  'pricing_interval_changed',
  'pricing_checkout_started',
  'pricing_login_redirected'
] as const

/** Eventos de AÇÃO de negócio: emitidos só pelo servidor, após resposta 2xx. */
export const ACTION_EVENTS = [
  'service_order_created',
  'service_order_updated',
  'service_order_cancelled',
  'appointment_created',
  'client_created',
  'vehicle_created',
  'financial_entry_created',
  'financial_entry_paid',
  'installment_paid',
  'payment_processed',
  'commission_paid',
  'bonus_created',
  'commission_plan_created',
  'product_created',
  'purchase_created',
  'purchase_request_created',
  'purchase_return_created',
  'catalog_imported',
  'nfse_issued',
  'fiscal_company_synced',
  'employee_created',
  'access_granted',
  'role_changed',
  'report_exported'
] as const

/** Marcos de conversão/assinatura emitidos pelo servidor (não são "ação" de uso). */
export const LIFECYCLE_EVENTS = [
  'signup_completed',
  'login_completed',
  'onboarding_completed',
  'org_created',
  'subscription_started',
  'subscription_cancelled',
  'payment_failed'
] as const

export type ClientEvent = (typeof CLIENT_EVENTS)[number]
export type ActionEvent = (typeof ACTION_EVENTS)[number]
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number]
export type AnalyticsEvent = ClientEvent | ActionEvent | LifecycleEvent

export const PLATFORMS = ['ios', 'android', 'web'] as const
export type Platform = (typeof PLATFORMS)[number]

/** Rótulos de área (nunca a rota crua). */
export const AREAS = [
  'Site',
  'Planos',
  'Entrar',
  'Assinatura',
  'Onboarding',
  'Painel',
  'Ordens de serviço',
  'Fiscal',
  'Comissões e bônus',
  'Financeiro',
  'Estoque e compras',
  'Clientes e veículos',
  'Agenda',
  'Relatórios',
  'Equipe e acesso',
  'Configurações',
  'Suporte',
  'Admin',
  'Sem acesso',
  'Outras'
] as const
export type Area = (typeof AREAS)[number]

export const MAX_EVENTS_PER_BATCH = 25
export const MAX_DURATION_MS = 3_600_000
export const MAX_STEP = 20
export const MAX_PAST_MS = 5 * 60 * 1000

const CLIENT_SET: ReadonlySet<string> = new Set(CLIENT_EVENTS)
const AREA_SET: ReadonlySet<string> = new Set(AREAS)
const PLATFORM_SET: ReadonlySet<string> = new Set(PLATFORMS)

export function isClientEvent(value: unknown): value is ClientEvent {
  return typeof value === 'string' && CLIENT_SET.has(value)
}

export function normalizePlatform(value: unknown): Platform | null {
  return typeof value === 'string' && PLATFORM_SET.has(value) ? (value as Platform) : null
}

export function normalizeArea(value: unknown): Area {
  return typeof value === 'string' && AREA_SET.has(value) ? (value as Area) : 'Outras'
}

/** Identificador de sessão gerado pelo cliente: só aceita UUID/ids curtos seguros. */
export function normalizeSessionId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : null
}

export interface RawClientEvent {
  event?: unknown
  area?: unknown
  durationMs?: unknown
  step?: unknown
  attribution?: unknown
  at?: unknown
}

export interface CleanClientEvent {
  event: ClientEvent
  area: Area
  durationMs: number | null
  step: number | null
  attribution: unknown
  createdAt: Date
}

/** Valida e normaliza um evento do cliente; devolve null se for inválido. */
export function cleanClientEvent(raw: RawClientEvent, now = Date.now()): CleanClientEvent | null {
  if (!raw || !isClientEvent(raw.event)) return null

  let durationMs: number | null = null
  if (raw.event === 'active_time') {
    const n = Number(raw.durationMs)
    if (!Number.isFinite(n) || n < 0 || n > MAX_DURATION_MS) return null
    durationMs = Math.round(n)
  }

  let step: number | null = null
  if (raw.event.startsWith('onboarding_')) {
    const n = Number(raw.step)
    if (Number.isFinite(n)) {
      if (n < 0 || n > MAX_STEP) return null
      step = Math.round(n)
    }
  }

  const at = Number(raw.at)
  const createdMs = Number.isFinite(at) && at <= now && now - at <= MAX_PAST_MS ? at : now

  return {
    event: raw.event,
    area: normalizeArea(raw.area),
    durationMs,
    step,
    attribution: raw.attribution,
    createdAt: new Date(createdMs)
  }
}

/** Atribuição só é aceita nestes eventos (os demais vêm do servidor). */
export const ATTRIBUTION_EVENTS: ReadonlySet<string> = new Set(['session_start', 'pricing_checkout_started'])
