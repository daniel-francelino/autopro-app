import { requireOwner } from '../../utils/require-owner'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { getStripe } from '../../utils/stripe'
import { ownerAlert, runCheck, topFailingRoutes, type AuditRowLite } from '../../utils/system-checks'
import pkg from '../../../package.json'

const DAY_MS = 86_400_000

/**
 * GET /api/admin/system
 * Integrações (timeout de 3 s cada, nunca derrubam a resposta), versão, erros recentes e owners cadastrados.
 * Não devolve segredos: só se estão presentes.
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const supabase = getSupabaseAdminClient()
  const config = useRuntimeConfig(event)
  const publicConfig = (config.public ?? {}) as Record<string, unknown>

  const checks = await Promise.all([
    runCheck('supabase', 'Supabase (banco)', async () => {
      const { error } = await supabase.from('organizations').select('id', { head: true, count: 'exact' }).limit(1)
      if (error) throw new Error(error.message)
      return {}
    }),
    runCheck('stripe', 'Stripe', async () => {
      if (!config.stripeSecretKey) return { status: 'not_configured', detail: 'STRIPE_SECRET_KEY ausente' }
      await getStripe().balance.retrieve()
      return {}
    }),
    runCheck('stripe_webhook', 'Stripe (segredo do webhook)', async () =>
      config.stripeWebhookSecret ? {} : { status: 'not_configured', detail: 'STRIPE_WEBHOOK_SECRET ausente' }),
    runCheck('focus_nfe', 'Focus NFe', async () => {
      if (!process.env.FOCUSNFE_API_TOKEN) {
        return { status: 'warning', detail: 'Token da Focus NFe não encontrado no ambiente deste servidor' }
      }
      // Sem chamada externa: usa o resultado real das últimas 24 h (fiscal_integration_logs).
      const { data } = await supabase
        .from('fiscal_integration_logs')
        .select('is_success')
        .gte('created_at', new Date(Date.now() - DAY_MS).toISOString())
        .limit(500)
      const rows = (data ?? []) as Array<{ is_success: boolean | null }>
      if (!rows.length) return { detail: 'Sem chamadas nas últimas 24 h' }
      const failed = rows.filter(r => r.is_success === false).length
      return failed / rows.length > 0.5
        ? { status: 'warning' as const, detail: `${failed} de ${rows.length} chamadas falharam nas últimas 24 h` }
        : { detail: `${rows.length - failed} de ${rows.length} chamadas com sucesso nas últimas 24 h` }
    }),
    runCheck('onesignal', 'OneSignal (push)', async () =>
      publicConfig.oneSignalEnabled ? {} : { status: 'not_configured', detail: 'Push desligado' }),
    runCheck('plate_api', 'API de placas', async () =>
      process.env.WDAPI_TOKEN ? {} : { status: 'not_configured', detail: 'WDAPI_TOKEN ausente' }),
    runCheck('audit_partition', 'Log de auditoria (partição padrão vazia)', async () => {
      const { count, error } = await supabase.from('audit_logs_default').select('id', { head: true, count: 'exact' })
      if (error) return { status: 'warning', detail: 'Tabela de auditoria indisponível (migration 097?)' }
      return count ? { status: 'warning', detail: `${count} linha(s) na partição padrão: crie a partição do mês (audit_logs_maintain)` } : {}
    })
  ])

  const since7d = new Date(Date.now() - 7 * DAY_MS).toISOString()
  const [{ data: failures }, { data: owners }] = await Promise.all([
    supabase
      .from('audit_logs')
      .select('http_method, route_pattern, status_code, outcome, created_at')
      .neq('outcome', 'success')
      .gte('created_at', since7d)
      .limit(5000),
    supabase.from('user_profiles').select('id, email, display_name').eq('is_owner', true).is('deleted_at', null)
  ])

  const all = (failures ?? []) as AuditRowLite[]
  const since24h = Date.now() - DAY_MS
  const ownerList = owners ?? []

  return {
    checks,
    version: {
      app: (pkg as { version?: string }).version ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null,
      environment: process.env.NODE_ENV ?? null,
      site_url: publicConfig.siteUrl ?? null
    },
    errors_24h: topFailingRoutes(all.filter(r => new Date(r.created_at).getTime() >= since24h)),
    errors_7d: topFailingRoutes(all),
    owners: ownerList,
    owner_alert: ownerAlert(ownerList.length)
  }
})
