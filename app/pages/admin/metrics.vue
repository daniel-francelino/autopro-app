<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['owner-only']
})
useSeoMeta({ title: 'Métricas de uso' })

type Tab = 'summary' | 'acquisition' | 'engagement' | 'activation' | 'accounts' | 'quality'

interface Kpis {
  visits_people: number
  visits_bots: number
  visits_suspect: number
  avg_visit_ms: number
  active_orgs: number
  active_users: number
  signups: number
  subscriptions_started: number
  orgs_created: number
  onboarding_completed: number
  os_orgs: number
  payment_orgs: number
  actions: number
}
interface Day { day: string, people: number, bots: number, signups: number, orgs: number, users: number }
interface Coverage {
  total_events: number
  oldest: string | null
  retention_days: number
  pct_traffic: number
  pct_platform: number
  pct_country: number
  pct_attribution: number
}
interface Summary {
  days: number
  current: Kpis
  previous: Kpis
  subscriptions_active: number
  by_day: Day[]
  peak_hour: { dow: number, hour: number, events: number } | null
  coverage: Coverage
}
interface Acquisition {
  channels: { channel: string, ai: string | null, visits: number }[]
  campaigns: { campaign: string, source: string | null, medium: string | null, visits: number, signups: number }[]
  countries: { country: string, people: number, bots: number, with_account: number }[]
}
interface Engagement {
  actions: { group: string, event: string, count: number, orgs: number }[]
  time_by_area: { area: string, ms: number }[]
  duration_buckets: { under_2m: number, from_2_to_10m: number, over_10m: number }
  heatmap: { dow: number, hour: number, visits: number }[]
  platforms: { platform: string, visits: number }[]
}
interface Funnel {
  cohort: number
  activated_24h: number
  eligible_24h: number
  activated_7d: number
  eligible_7d: number
  median_hours_to_first_action: number | null
  first_actions: { event: string, users: number }[]
  only_explored: number
  returned: { days: number, eligible: number, returned: number }[]
  onboarding: { step: number, event: string, users: number }[]
  weekly: { week: string, size: number, activated_7d: number }[]
}
interface Accounts {
  tracking_since: string | null
  organizations: {
    id: string
    name: string
    plan: string | null
    created_at: string
    last_action: string | null
    days_since_action: number | null
    actions_7d: number
    os_7d: number
    users_7d: number
    status: 'active' | 'cooling' | 'stopped' | 'never' | 'new' | 'no_data'
  }[]
}
interface Quality {
  split: { kind: string, visits: number }[]
  bots: { bot: string, kind: string, purpose: string | null, visits: number, areas: string[] }[]
  coverage: Coverage
}
interface MetricsResponse {
  tab: Tab
  days: number
  cached: boolean
  generatedAt: string
  data: unknown
}

const tabs = [
  { label: 'Resumo', value: 'summary', icon: 'i-lucide-layout-dashboard' },
  { label: 'Aquisição', value: 'acquisition', icon: 'i-lucide-megaphone' },
  { label: 'Engajamento', value: 'engagement', icon: 'i-lucide-activity' },
  { label: 'Ativação', value: 'activation', icon: 'i-lucide-rocket' },
  { label: 'Oficinas', value: 'accounts', icon: 'i-lucide-building-2' },
  { label: 'Qualidade', value: 'quality', icon: 'i-lucide-shield-check' }
]
const periods = [
  { label: '7 dias', value: 7 },
  { label: '30 dias', value: 30 },
  { label: '90 dias', value: 90 }
]

const tab = ref<Tab>('summary')
const days = ref(30)
const includeInternal = ref(false)
const fresh = ref(false)

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const { data: response, status, error, refresh } = await useAsyncData(
  'admin-metrics',
  () => requestFetch<MetricsResponse>('/api/admin/metrics', {
    headers: requestHeaders,
    query: {
      tab: tab.value,
      days: days.value,
      internal: includeInternal.value ? '1' : undefined,
      fresh: fresh.value ? '1' : undefined
    }
  }),
  { watch: [tab, days, includeInternal] }
)

const loading = computed(() => status.value === 'pending')
const errorMessage = computed(() => {
  const err = error.value as { data?: { statusMessage?: string }, statusMessage?: string } | null
  return err ? (err.data?.statusMessage || err.statusMessage || 'Não foi possível carregar as métricas.') : null
})

async function reload() {
  fresh.value = true
  await refresh()
  fresh.value = false
}

// Ao trocar de aba, `response` ainda guarda os dados da aba anterior até a nova chegar:
// só entrega os dados quando a resposta é da aba atual (senão a aba nova lê campos inexistentes).
function dataFor<T>(name: Tab): T | null {
  const current = response.value
  return tab.value === name && current?.tab === name && current.data ? current.data as T : null
}
const summary = computed(() => dataFor<Summary>('summary'))
const acquisition = computed(() => dataFor<Acquisition>('acquisition'))
const engagement = computed(() => dataFor<Engagement>('engagement'))
const funnel = computed(() => dataFor<Funnel>('activation'))
const accounts = computed(() => dataFor<Accounts>('accounts'))
const quality = computed(() => dataFor<Quality>('quality'))

// ── formatação ──────────────────────────────────────────────────────────────
const number = (value: number) => Number(value ?? 0).toLocaleString('pt-BR')
const percent = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)}%` : '—')

function formatDuration(ms: number) {
  const seconds = Math.round((ms ?? 0) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}min ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}min`
}

function dayLabel(iso: string) {
  const [, month, day] = iso.slice(0, 10).split('-')
  return `${day}/${month}`
}

const dowNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const channelLabels: Record<string, string> = {
  direct: 'Direto / sem origem',
  search: 'Buscadores',
  social: 'Redes sociais',
  ai: 'IAs',
  referral: 'Outros sites',
  campaign: 'Campanhas (UTM)'
}
const aiLabels: Record<string, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  perplexity: 'Perplexity',
  copilot: 'Copilot',
  gemini: 'Gemini'
}
const kindLabels: Record<string, string> = {
  human: 'Pessoas',
  suspect: 'Suspeitas',
  ai_crawler: 'Robôs de IA',
  search_bot: 'Buscadores',
  social_preview: 'Prévia de links',
  headless: 'Navegador sem tela',
  script: 'Scripts',
  other_bot: 'Outros robôs'
}
const purposeLabels: Record<string, string> = {
  ai_training: 'treino de IA',
  ai_search: 'busca de IA',
  ai_user: 'a pedido do usuário (IA)',
  search_index: 'indexação',
  seo_tool: 'ferramenta de SEO',
  preview: 'prévia de link',
  testing: 'teste',
  script: 'script',
  unknown: 'desconhecida'
}
const eventLabels: Record<string, string> = {
  service_order_created: 'OS criadas',
  service_order_updated: 'OS editadas',
  service_order_cancelled: 'OS canceladas',
  appointment_created: 'Agendamentos',
  client_created: 'Clientes cadastrados',
  vehicle_created: 'Veículos cadastrados',
  financial_entry_created: 'Lançamentos criados',
  financial_entry_paid: 'Lançamentos pagos',
  installment_paid: 'Parcelas pagas',
  payment_processed: 'Pagamentos de OS',
  commission_paid: 'Comissões pagas',
  bonus_created: 'Bônus criados',
  commission_plan_created: 'Planos de comissão',
  product_created: 'Produtos cadastrados',
  purchase_created: 'Compras',
  purchase_request_created: 'Autorizações de compra',
  purchase_return_created: 'Devoluções de compra',
  catalog_imported: 'Importações de catálogo',
  nfse_issued: 'NFS-e emitidas',
  fiscal_company_synced: 'Empresa fiscal sincronizada',
  employee_created: 'Funcionários cadastrados',
  access_granted: 'Acessos concedidos',
  role_changed: 'Mudanças de permissão',
  report_exported: 'Relatórios exportados'
}
const statusMeta: Record<string, { label: string, color: 'success' | 'warning' | 'error' | 'neutral' | 'info', icon: string }> = {
  active: { label: 'Ativa', color: 'success', icon: 'i-lucide-circle-check' },
  cooling: { label: 'Esfriando', color: 'warning', icon: 'i-lucide-trending-down' },
  stopped: { label: 'Parada', color: 'error', icon: 'i-lucide-circle-pause' },
  never: { label: 'Nunca ativou', color: 'neutral', icon: 'i-lucide-circle-dashed' },
  new: { label: 'Nova', color: 'info', icon: 'i-lucide-sparkles' },
  no_data: { label: 'Sem dados', color: 'neutral', icon: 'i-lucide-circle-minus' }
}

// ── Resumo ──────────────────────────────────────────────────────────────────
const dayCategories = computed(() => (summary.value?.by_day ?? []).map(d => dayLabel(d.day)))
const funnelSteps = computed(() => {
  const c = summary.value?.current
  if (!c) return []
  const steps = [
    { label: 'Visitas de pessoas', value: c.visits_people },
    { label: 'Cadastros', value: c.signups },
    { label: 'Assinaturas iniciadas', value: c.subscriptions_started },
    { label: 'Oficinas criadas', value: c.orgs_created },
    { label: 'Onboarding concluído', value: c.onboarding_completed },
    { label: 'Oficinas que criaram OS', value: c.os_orgs },
    { label: 'Oficinas com pagamento de OS', value: c.payment_orgs }
  ]
  const top = Math.max(steps[0]?.value ?? 0, 1)
  return steps.map((step, index) => ({
    ...step,
    width: Math.max(2, Math.round((step.value / top) * 100)),
    fromPrevious: index === 0 ? null : percent(step.value, steps[index - 1]!.value)
  }))
})

const highlights = computed(() => {
  const s = summary.value
  if (!s) return []
  const items: { tone: 'warning' | 'success' | 'info', text: string }[] = []
  const c = s.current
  const totalVisits = c.visits_people + c.visits_bots + c.visits_suspect
  if (totalVisits > 0 && (c.visits_bots + c.visits_suspect) / totalVisits >= 0.4) {
    items.push({ tone: 'warning', text: `${percent(c.visits_bots + c.visits_suspect, totalVisits)} das visitas parecem robôs ou são suspeitas. Veja a aba Qualidade.` })
  }
  const change = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null)
  const visits = change(c.visits_people, s.previous.visits_people)
  if (visits !== null && Math.abs(visits) >= 20) {
    items.push({ tone: visits > 0 ? 'success' : 'warning', text: `Visitas de pessoas ${visits > 0 ? 'subiram' : 'caíram'} ${Math.abs(Math.round(visits))}% em relação ao período anterior.` })
  }
  const signups = change(c.signups, s.previous.signups)
  if (signups !== null && Math.abs(signups) >= 20) {
    items.push({ tone: signups > 0 ? 'success' : 'warning', text: `Cadastros ${signups > 0 ? 'subiram' : 'caíram'} ${Math.abs(Math.round(signups))}%.` })
  }
  if (s.peak_hour) {
    items.push({ tone: 'info', text: `Pico de uso: ${dowNames[s.peak_hour.dow]} às ${String(s.peak_hour.hour).padStart(2, '0')}h (horário de Brasília).` })
  }
  return items
})

// ── Engajamento ─────────────────────────────────────────────────────────────
const actionGroups = computed(() => {
  const groups = new Map<string, { event: string, count: number, orgs: number }[]>()
  for (const item of engagement.value?.actions ?? []) {
    groups.set(item.group, [...(groups.get(item.group) ?? []), item])
  }
  return [...groups.entries()].map(([group, rows]) => ({
    group,
    total: rows.reduce((sum, row) => sum + row.count, 0),
    rows
  }))
})

const heatmap = computed(() => {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  let max = 0
  for (const cell of engagement.value?.heatmap ?? []) {
    grid[cell.dow]![cell.hour] = cell.visits
    max = Math.max(max, cell.visits)
  }
  return { grid, max }
})

// ── Ativação ────────────────────────────────────────────────────────────────
function windowText(done: number, eligible: number, cohort: number) {
  if (eligible === 0) return 'janela em aberto'
  const open = cohort - eligible
  return `${percent(done, eligible)} (${done}/${eligible})${open > 0 ? ` · ${open} com janela em aberto` : ''}`
}

// ── Qualidade ───────────────────────────────────────────────────────────────
const splitLabels = computed(() => (quality.value?.split ?? []).map(item => kindLabels[item.kind] ?? item.kind))
const splitSeries = computed(() => (quality.value?.split ?? []).map(item => item.visits))
const generatedAt = computed(() => (response.value ? new Date(response.value.generatedAt).toLocaleString('pt-BR') : ''))
</script>

<template>
  <UDashboardPanel>
    <AppPageHeader title="Métricas de uso">
      <template #right>
        <USelect
          v-model="days"
          :items="periods"
          size="sm"
          class="w-32"
          aria-label="Período"
        />
        <USwitch v-model="includeInternal" label="Contas internas" size="sm" />
        <UButton
          icon="i-lucide-refresh-cw"
          size="sm"
          color="neutral"
          variant="outline"
          label="Atualizar"
          :loading="loading"
          @click="reload"
        />
      </template>
    </AppPageHeader>

    <div class="space-y-6 overflow-auto p-4 sm:p-6">
      <p class="text-sm text-muted">
        Telemetria própria, sem cookies de rastreamento. Horários em America/Sao_Paulo.
      </p>

      <UTabs
        v-model="tab"
        :items="tabs"
        :content="false"
        color="neutral"
      />

      <UAlert
        v-if="errorMessage"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Métricas indisponíveis"
        :description="errorMessage"
      />

      <div v-else-if="loading && response?.tab !== tab" class="space-y-4">
        <AdminSkeleton variant="kpis" :cols="4" />
        <div class="grid gap-4 lg:grid-cols-2">
          <AdminSkeleton />
          <AdminSkeleton />
        </div>
      </div>

      <template v-else>
        <!-- ── Resumo ── -->
        <template v-if="summary">
          <AdminMetricsNote v-if="summary.coverage?.total_events === 0">
            Ainda não há eventos. Defina <code>NUXT_PUBLIC_ANALYTICS_ENABLED=true</code> e <code>ANALYTICS_HASH_SECRET</code> em produção e navegue pelo site.
          </AdminMetricsNote>

          <div class="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <AdminMetricsKpi label="Visitas de pessoas" :value="summary.current.visits_people" :previous="summary.previous.visits_people" />
            <AdminMetricsKpi
              label="Oficinas ativas"
              :value="summary.current.active_orgs"
              :previous="summary.previous.active_orgs"
              hint="com ao menos 1 ação"
            />
            <AdminMetricsKpi label="Usuários ativos" :value="summary.current.active_users" :previous="summary.previous.active_users" />
            <AdminMetricsKpi label="Cadastros novos" :value="summary.current.signups" :previous="summary.previous.signups" />
            <AdminMetricsKpi label="Tempo médio por visita" :value="formatDuration(summary.current.avg_visit_ms)" hint="só pessoas" />
            <AdminMetricsKpi label="Assinaturas ativas" :value="summary.subscriptions_active" hint="hoje" />
          </div>

          <AdminMetricsSection v-if="highlights.length" title="Em destaque">
            <ul class="space-y-2">
              <li v-for="(item, index) in highlights" :key="index" class="flex items-start gap-2 text-sm">
                <UIcon
                  :name="item.tone === 'warning' ? 'i-lucide-triangle-alert' : item.tone === 'success' ? 'i-lucide-trending-up' : 'i-lucide-info'"
                  class="mt-0.5 size-4 shrink-0"
                  :class="item.tone === 'warning' ? 'text-warning' : item.tone === 'success' ? 'text-success' : 'text-info'"
                />
                <span>{{ item.text }}</span>
              </li>
            </ul>
          </AdminMetricsSection>

          <div class="grid gap-4 lg:grid-cols-2">
            <AdminMetricsSection title="Visitas por dia" description="Pessoas × robôs (suspeitas ficam de fora).">
              <ChartsArea
                :categories="dayCategories"
                :series="[
                  { name: 'Pessoas', data: summary.by_day.map(d => d.people) },
                  { name: 'Robôs', data: summary.by_day.map(d => d.bots) }
                ]"
                :height="240"
                :colors="['#9333ea', '#94a3b8']"
              />
            </AdminMetricsSection>
            <AdminMetricsSection title="Oficinas e usuários ativos por dia">
              <ChartsBar
                :categories="dayCategories"
                :series="[
                  { name: 'Oficinas', data: summary.by_day.map(d => d.orgs) },
                  { name: 'Usuários', data: summary.by_day.map(d => d.users) }
                ]"
                :height="240"
                :colors="['#9333ea', '#22c55e']"
              />
            </AdminMetricsSection>
            <AdminMetricsSection title="Cadastros por dia">
              <ChartsArea
                :categories="dayCategories"
                :series="[{ name: 'Cadastros', data: summary.by_day.map(d => d.signups) }]"
                :height="240"
                :colors="['#22c55e']"
              />
            </AdminMetricsSection>
            <AdminMetricsSection title="Funil" description="Visitas contam sessões; os demais passos contam contas/oficinas no período.">
              <ol class="space-y-2">
                <li v-for="step in funnelSteps" :key="step.label">
                  <div class="flex items-baseline justify-between text-sm">
                    <span>{{ step.label }}</span>
                    <span class="tabular-nums text-muted">
                      <strong class="text-highlighted">{{ number(step.value) }}</strong>
                      <template v-if="step.fromPrevious"> · {{ step.fromPrevious }} do passo anterior</template>
                    </span>
                  </div>
                  <div class="mt-1 h-2 rounded-full bg-elevated">
                    <div class="h-2 rounded-full bg-primary" :style="{ width: `${step.width}%` }" />
                  </div>
                </li>
              </ol>
            </AdminMetricsSection>
          </div>
        </template>

        <!-- ── Aquisição ── -->
        <template v-else-if="acquisition">
          <AdminMetricsNote>
            "Direto / sem origem" junta quem digitou o endereço e apps que escondem a origem (como WhatsApp). O número de visitas vindas de IA é um piso, não o total.
          </AdminMetricsNote>
          <div class="grid gap-4 lg:grid-cols-2">
            <AdminMetricsSection title="Origem das visitas" description="Só visitas de pessoas.">
              <table class="w-full text-left text-sm">
                <thead>
                  <tr class="border-b border-default text-muted">
                    <th class="py-2 font-medium">
                      Origem
                    </th>
                    <th class="py-2 text-right font-medium">
                      Visitas
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in acquisition.channels" :key="`${row.channel}-${row.ai}`" class="border-b border-default">
                    <td class="py-2">
                      {{ channelLabels[row.channel] ?? row.channel }}<span v-if="row.ai" class="text-muted"> · {{ aiLabels[row.ai] ?? row.ai }}</span>
                    </td>
                    <td class="py-2 text-right tabular-nums">
                      {{ number(row.visits) }}
                    </td>
                  </tr>
                  <tr v-if="!acquisition.channels.length">
                    <td colspan="2">
                      <AdminEmptyState icon="i-lucide-inbox" title="Sem dados no período." />
                    </td>
                  </tr>
                </tbody>
              </table>
            </AdminMetricsSection>
            <AdminMetricsSection title="Campanhas (first touch)" description="Até 20 campanhas, sempre exibidas como texto.">
              <table class="w-full text-left text-sm">
                <thead>
                  <tr class="border-b border-default text-muted">
                    <th class="py-2 font-medium">
                      Campanha
                    </th>
                    <th class="py-2 font-medium">
                      Origem / meio
                    </th>
                    <th class="py-2 text-right font-medium">
                      Visitas
                    </th>
                    <th class="py-2 text-right font-medium">
                      Cadastros
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in acquisition.campaigns" :key="`${row.campaign}-${row.source}-${row.medium}`" class="border-b border-default">
                    <td class="py-2">
                      {{ row.campaign }}
                    </td>
                    <td class="py-2 text-muted">
                      {{ [row.source, row.medium].filter(Boolean).join(' / ') || '—' }}
                    </td>
                    <td class="py-2 text-right tabular-nums">
                      {{ number(row.visits) }}
                    </td>
                    <td class="py-2 text-right tabular-nums">
                      {{ number(row.signups) }}
                    </td>
                  </tr>
                  <tr v-if="!acquisition.campaigns.length">
                    <td colspan="4">
                      <AdminEmptyState icon="i-lucide-inbox" title="Nenhuma campanha com UTM no período." />
                    </td>
                  </tr>
                </tbody>
              </table>
            </AdminMetricsSection>
          </div>
          <AdminMetricsSection title="Países" description="Vem do cabeçalho do CDN; sem ele a coluna fica em “??”.">
            <table class="w-full text-left text-sm">
              <thead>
                <tr class="border-b border-default text-muted">
                  <th class="py-2 font-medium">
                    País
                  </th>
                  <th class="py-2 text-right font-medium">
                    Pessoas
                  </th>
                  <th class="py-2 text-right font-medium">
                    Robôs
                  </th>
                  <th class="py-2 text-right font-medium">
                    Com conta
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in acquisition.countries" :key="row.country" class="border-b border-default">
                  <td class="py-2">
                    {{ row.country }}
                  </td>
                  <td class="py-2 text-right tabular-nums">
                    {{ number(row.people) }}
                  </td>
                  <td class="py-2 text-right tabular-nums">
                    {{ number(row.bots) }}
                  </td>
                  <td class="py-2 text-right tabular-nums">
                    {{ number(row.with_account) }}
                  </td>
                </tr>
                <tr v-if="!acquisition.countries.length">
                  <td colspan="4">
                    <AdminEmptyState icon="i-lucide-inbox" title="Sem dados no período." />
                  </td>
                </tr>
              </tbody>
            </table>
          </AdminMetricsSection>
        </template>

        <!-- ── Engajamento ── -->
        <template v-else-if="engagement">
          <div class="grid gap-4 lg:grid-cols-2">
            <AdminMetricsSection
              v-for="group in actionGroups"
              :key="group.group"
              :title="group.group"
              :description="`${number(group.total)} ações no período`"
            >
              <ul class="space-y-1.5 text-sm">
                <li v-for="row in group.rows" :key="row.event" class="flex items-center justify-between">
                  <span>{{ eventLabels[row.event] ?? row.event }}</span>
                  <span class="tabular-nums text-muted">
                    <strong class="text-highlighted">{{ number(row.count) }}</strong> · {{ number(row.orgs) }} {{ row.orgs === 1 ? 'oficina' : 'oficinas' }}
                  </span>
                </li>
              </ul>
            </AdminMetricsSection>
            <AdminMetricsNote v-if="!actionGroups.length">
              Nenhuma ação de negócio registrada no período.
            </AdminMetricsNote>
          </div>

          <div class="grid gap-4 lg:grid-cols-2">
            <AdminMetricsSection title="Onde passam o tempo" description="Tempo ativo (aba visível) por área, em minutos.">
              <ChartsBar
                v-if="engagement.time_by_area.length"
                :categories="engagement.time_by_area.map(t => t.area)"
                :series="[{ name: 'Minutos', data: engagement.time_by_area.map(t => Math.round(t.ms / 60000)) }]"
                :height="280"
                horizontal
                :colors="['#9333ea']"
              />
              <p v-else class="py-6 text-center text-sm text-muted">
                Sem dados no período.
              </p>
            </AdminMetricsSection>
            <AdminMetricsSection title="Quanto tempo ficam" description="Visitas de pessoas, pelo tempo ativo.">
              <ChartsDonut
                :labels="['Menos de 2 min', '2 a 10 min', 'Mais de 10 min']"
                :series="[engagement.duration_buckets.under_2m, engagement.duration_buckets.from_2_to_10m, engagement.duration_buckets.over_10m]"
                :height="240"
                :colors="['#94a3b8', '#9333ea', '#22c55e']"
              />
            </AdminMetricsSection>
          </div>

          <AdminMetricsSection title="Quando usam" description="Visitas de usuários logados por dia da semana e hora (horário de Brasília).">
            <div class="overflow-x-auto">
              <div class="min-w-[640px] space-y-1">
                <div v-for="(row, dow) in heatmap.grid" :key="dow" class="flex items-center gap-1">
                  <span class="w-8 text-xs text-muted">{{ dowNames[dow] }}</span>
                  <div
                    v-for="(value, hour) in row"
                    :key="hour"
                    class="h-5 flex-1 rounded-sm bg-primary"
                    :style="{ opacity: heatmap.max ? Math.max(0.06, value / heatmap.max) : 0.06 }"
                    :title="`${dowNames[dow]} ${String(hour).padStart(2, '0')}h: ${value} visitas`"
                  />
                </div>
                <div class="flex gap-1 pl-9 text-[10px] text-muted">
                  <span v-for="hour in 24" :key="hour" class="flex-1 text-center">{{ (hour - 1) % 3 === 0 ? hour - 1 : '' }}</span>
                </div>
              </div>
            </div>
          </AdminMetricsSection>

          <AdminMetricsSection title="Plataforma">
            <ul class="flex flex-wrap gap-4 text-sm">
              <li v-for="item in engagement.platforms" :key="item.platform">
                <span class="uppercase text-muted">{{ item.platform }}</span>
                <strong class="ml-2 tabular-nums text-highlighted">{{ number(item.visits) }}</strong>
              </li>
              <li v-if="!engagement.platforms.length" class="text-muted">
                Sem dados no período.
              </li>
            </ul>
          </AdminMetricsSection>
        </template>

        <!-- ── Ativação ── -->
        <template v-else-if="funnel">
          <AdminMetricsNote>
            A ação só conta se veio depois do cadastro. As janelas de 24 h e 7 dias só consideram quem já teve o prazo inteiro; o restante aparece como “janela em aberto”.
          </AdminMetricsNote>
          <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <AdminMetricsKpi label="Cadastros no período" :value="funnel.cohort" />
            <AdminMetricsKpi label="Agiram em 24 h" :value="windowText(funnel.activated_24h, funnel.eligible_24h, funnel.cohort)" />
            <AdminMetricsKpi label="Agiram em 7 dias" :value="windowText(funnel.activated_7d, funnel.eligible_7d, funnel.cohort)" />
            <AdminMetricsKpi
              label="Mediana até a 1ª ação"
              :value="funnel.median_hours_to_first_action === null ? '—' : `${funnel.median_hours_to_first_action} h`"
              :hint="`${funnel.only_explored} só exploraram`"
            />
          </div>
          <div class="grid gap-4 lg:grid-cols-2">
            <AdminMetricsSection title="Primeira ação de quem ativou">
              <ul class="space-y-1.5 text-sm">
                <li v-for="item in funnel.first_actions" :key="item.event" class="flex justify-between">
                  <span>{{ eventLabels[item.event] ?? item.event }}</span>
                  <strong class="tabular-nums">{{ number(item.users) }}</strong>
                </li>
                <li v-if="!funnel.first_actions.length" class="text-muted">
                  Ninguém agiu depois do cadastro no período.
                </li>
              </ul>
            </AdminMetricsSection>
            <AdminMetricsSection title="Retorno após o cadastro" description="Voltou em até N dias, entre quem já teve o prazo inteiro.">
              <ul class="space-y-1.5 text-sm">
                <li v-for="item in funnel.returned" :key="item.days" class="flex justify-between">
                  <span>{{ item.days }} {{ item.days === 1 ? 'dia' : 'dias' }}</span>
                  <span class="tabular-nums text-muted">
                    <template v-if="item.eligible === 0">janela em aberto</template>
                    <template v-else><strong class="text-highlighted">{{ percent(item.returned, item.eligible) }}</strong> ({{ item.returned }}/{{ item.eligible }})</template>
                  </span>
                </li>
              </ul>
            </AdminMetricsSection>
            <AdminMetricsSection title="Onboarding por passo" description="Usuários distintos por passo (0 = empresa, 1 = endereço).">
              <ul class="space-y-1.5 text-sm">
                <li v-for="item in funnel.onboarding" :key="`${item.step}-${item.event}`" class="flex justify-between">
                  <span>Passo {{ item.step }} · {{ item.event === 'onboarding_step' ? 'viram' : item.event === 'onboarding_skip' ? 'pularam' : 'concluíram' }}</span>
                  <strong class="tabular-nums">{{ number(item.users) }}</strong>
                </li>
                <li v-if="!funnel.onboarding.length" class="text-muted">
                  Sem dados no período.
                </li>
              </ul>
            </AdminMetricsSection>
            <AdminMetricsSection title="Coortes semanais">
              <table class="w-full text-left text-sm">
                <thead>
                  <tr class="border-b border-default text-muted">
                    <th class="py-2 font-medium">
                      Semana de
                    </th>
                    <th class="py-2 text-right font-medium">
                      Cadastros
                    </th>
                    <th class="py-2 text-right font-medium">
                      Agiram em 7 d
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in funnel.weekly" :key="row.week" class="border-b border-default">
                    <td class="py-2">
                      {{ dayLabel(row.week) }}
                    </td>
                    <td class="py-2 text-right tabular-nums">
                      {{ number(row.size) }}
                    </td>
                    <td class="py-2 text-right tabular-nums">
                      {{ number(row.activated_7d) }}
                    </td>
                  </tr>
                  <tr v-if="!funnel.weekly.length">
                    <td colspan="3">
                      <AdminEmptyState icon="i-lucide-inbox" title="Sem dados no período." />
                    </td>
                  </tr>
                </tbody>
              </table>
            </AdminMetricsSection>
          </div>
        </template>

        <!-- ── Oficinas ── -->
        <template v-else-if="accounts">
          <AdminMetricsNote>
            Ativa: ação nos últimos 7 dias · Esfriando: sem ação há 7–14 dias · Parada: mais de 14 dias · Nunca ativou: criada há mais de 7 dias sem nenhuma ação · Sem dados: criada antes do início da coleta
            <template v-if="accounts.tracking_since">
              (coleta desde {{ new Date(accounts.tracking_since).toLocaleDateString('pt-BR') }})
            </template>.
          </AdminMetricsNote>
          <AdminMetricsSection title="Saúde das contas" description="Esfriando e paradas aparecem primeiro.">
            <div class="overflow-x-auto">
              <table class="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr class="border-b border-default text-muted">
                    <th class="py-2 font-medium">
                      Oficina
                    </th>
                    <th class="py-2 font-medium">
                      Plano
                    </th>
                    <th class="py-2 text-right font-medium">
                      Última ação
                    </th>
                    <th class="py-2 text-right font-medium">
                      Ações (7 d)
                    </th>
                    <th class="py-2 text-right font-medium">
                      OS (7 d)
                    </th>
                    <th class="py-2 text-right font-medium">
                      Usuários (7 d)
                    </th>
                    <th class="py-2 font-medium">
                      Situação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="org in accounts.organizations" :key="org.id" class="border-b border-default">
                    <td class="py-2 font-medium text-highlighted">
                      {{ org.name }}
                    </td>
                    <td class="py-2 text-muted">
                      {{ org.plan || '—' }}
                    </td>
                    <td class="py-2 text-right tabular-nums">
                      {{ org.days_since_action === null ? '—' : org.days_since_action === 0 ? 'hoje' : `há ${org.days_since_action} d` }}
                    </td>
                    <td class="py-2 text-right tabular-nums">
                      {{ number(org.actions_7d) }}
                    </td>
                    <td class="py-2 text-right tabular-nums">
                      {{ number(org.os_7d) }}
                    </td>
                    <td class="py-2 text-right tabular-nums">
                      {{ number(org.users_7d) }}
                    </td>
                    <td class="py-2">
                      <UBadge
                        :color="statusMeta[org.status]?.color ?? 'neutral'"
                        :icon="statusMeta[org.status]?.icon ?? 'i-lucide-circle-help'"
                        variant="subtle"
                        size="sm"
                      >
                        {{ statusMeta[org.status]?.label ?? org.status }}
                      </UBadge>
                    </td>
                  </tr>
                  <tr v-if="!accounts.organizations.length">
                    <td colspan="7">
                      <AdminEmptyState icon="i-lucide-inbox" title="Nenhuma oficina ativa." />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </AdminMetricsSection>
        </template>

        <!-- ── Qualidade ── -->
        <template v-else-if="quality">
          <div class="grid gap-4 lg:grid-cols-2">
            <AdminMetricsSection title="Pessoas × robôs" description="Cada visita é classificada por sessão. “Suspeitas” é uma estimativa: sem login, sem tempo ativo e sem ação.">
              <ChartsDonut
                v-if="splitSeries.length"
                :labels="splitLabels"
                :series="splitSeries"
                :height="260"
              />
              <p v-else class="py-6 text-center text-sm text-muted">
                Sem dados no período.
              </p>
            </AdminMetricsSection>
            <AdminMetricsSection title="Qualidade dos dados" description="Onde cada recorte é confiável.">
              <ul class="space-y-1.5 text-sm">
                <li class="flex justify-between">
                  <span>Eventos com tráfego classificado</span><strong class="tabular-nums">{{ quality.coverage.pct_traffic }}%</strong>
                </li>
                <li class="flex justify-between">
                  <span>Eventos com plataforma</span><strong class="tabular-nums">{{ quality.coverage.pct_platform }}%</strong>
                </li>
                <li class="flex justify-between">
                  <span>Eventos com país</span><strong class="tabular-nums">{{ quality.coverage.pct_country }}%</strong>
                </li>
                <li class="flex justify-between">
                  <span>Inícios de sessão com origem</span><strong class="tabular-nums">{{ quality.coverage.pct_attribution }}%</strong>
                </li>
                <li class="flex justify-between">
                  <span>Eventos guardados</span><strong class="tabular-nums">{{ number(quality.coverage.total_events) }}</strong>
                </li>
                <li class="flex justify-between">
                  <span>Evento mais antigo</span>
                  <strong>{{ quality.coverage.oldest ? new Date(quality.coverage.oldest).toLocaleDateString('pt-BR') : '—' }}</strong>
                </li>
                <li class="flex justify-between">
                  <span>Retenção</span><strong>{{ quality.coverage.retention_days }} dias</strong>
                </li>
              </ul>
            </AdminMetricsSection>
          </div>
          <AdminMetricsSection title="Quais robôs e o que querem" description="Robôs que não executam JavaScript não aparecem aqui; para esses, use os logs da hospedagem.">
            <div class="overflow-x-auto">
              <table class="w-full min-w-[600px] text-left text-sm">
                <thead>
                  <tr class="border-b border-default text-muted">
                    <th class="py-2 font-medium">
                      Robô
                    </th>
                    <th class="py-2 font-medium">
                      Tipo
                    </th>
                    <th class="py-2 font-medium">
                      Finalidade
                    </th>
                    <th class="py-2 text-right font-medium">
                      Visitas
                    </th>
                    <th class="py-2 font-medium">
                      Áreas vistas
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in quality.bots" :key="`${row.bot}-${row.kind}-${row.purpose}`" class="border-b border-default">
                    <td class="py-2 font-medium text-highlighted">
                      {{ row.bot }}
                    </td>
                    <td class="py-2">
                      {{ kindLabels[row.kind] ?? row.kind }}
                    </td>
                    <td class="py-2 text-muted">
                      {{ purposeLabels[row.purpose ?? 'unknown'] ?? row.purpose }}
                    </td>
                    <td class="py-2 text-right tabular-nums">
                      {{ number(row.visits) }}
                    </td>
                    <td class="py-2 text-muted">
                      {{ row.areas.join(', ') || '—' }}
                    </td>
                  </tr>
                  <tr v-if="!quality.bots.length">
                    <td colspan="5">
                      <AdminEmptyState icon="i-lucide-inbox" title="Nenhum robô identificado no período." />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </AdminMetricsSection>
        </template>

        <p v-if="response" class="text-xs text-muted">
          Atualizado em {{ generatedAt }}<template v-if="response.cached">
            (cache de 60 s; use o botão para recalcular)
          </template>.
        </p>
      </template>
    </div>
  </UDashboardPanel>
</template>
