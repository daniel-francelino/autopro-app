<script setup lang="ts">
import { GEO_ENGINES, GEO_ENGINE_LABEL, GEO_QUESTIONS, type GeoEngine } from '../../../lib/geo/questions'

definePageMeta({
  layout: 'admin',
  middleware: ['owner-only']
})
useSeoMeta({ title: 'SEO e GEO — Admin' })

type Rates = { total: number, mention_rate: number | null, link_rate: number | null, recommendation_rate: number | null, price_accuracy: number | null, fiscal_accuracy: number | null }
type Summary = { overall: Rates, series: Array<Rates & { week: string, mode: 'search' | 'no_search' }>, by_engine: Array<Rates & { engine: string }> }
type Run = {
  question_id: number
  engine: GeoEngine
  search_enabled: boolean
  brand_mentioned: boolean
  brand_linked: boolean
  recommended: boolean
  price_correct: boolean | null
  fiscal_correct: boolean | null
  competitors: string[] | null
  notes: string | null
}

const toast = useToast()
const showApiError = useApiErrorToast()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const { data: summary, error: summaryError } = await useAsyncData('admin-geo-summary', () =>
  requestFetch<Summary>('/api/admin/geo/summary', { headers: requestHeaders }))

const { data: lastRuns, refresh: refreshRuns } = await useAsyncData('admin-geo-runs', () =>
  requestFetch<{ date: string | null, data: Run[] }>('/api/admin/geo/runs', { headers: requestHeaders }))

type SiteItem = { key: string, group: 'seo' | 'geo', label: string, status: 'ok' | 'warning' | 'error', detail: string }
type SiteCheck = { site_url: string, checked_at: string, summary: { ok: number, warning: number, error: number, total: number }, items: SiteItem[] }

// Verificação técnica automática: não depende de ninguém registrar nada.
const { data: site, status: siteStatus, error: siteError, refresh: refreshSite } = await useLazyAsyncData('admin-geo-site', () =>
  requestFetch<SiteCheck>('/api/admin/geo/site-check', { headers: requestHeaders }))
const siteGroups = computed(() => [
  { key: 'seo', title: 'SEO · aparecer nas buscas', icon: 'i-lucide-search', items: (site.value?.items ?? []).filter(i => i.group === 'seo') },
  { key: 'geo', title: 'GEO · ser entendido pelas IAs', icon: 'i-lucide-sparkles', items: (site.value?.items ?? []).filter(i => i.group === 'geo') }
])
const checkIcon = { ok: 'i-lucide-circle-check', warning: 'i-lucide-triangle-alert', error: 'i-lucide-circle-x' } as const
const checkTone = { ok: 'text-success', warning: 'text-warning', error: 'text-error' } as const
const manualOpen = ref(false)

const pct = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${value}%`)

// Formulário: uma linha por pergunta × motor × modo
const today = new Date().toISOString().slice(0, 10)
const tri = [{ label: 'Não se aplica', value: 'na' }, { label: 'Sim', value: 'yes' }, { label: 'Não', value: 'no' }]
const form = reactive({
  run_date: today,
  question_id: 1,
  engine: 'chatgpt' as GeoEngine,
  search_enabled: true,
  brand_mentioned: false,
  brand_linked: false,
  recommended: false,
  price_correct: 'na',
  fiscal_correct: 'na',
  competitors: '',
  notes: ''
})
const saving = ref(false)

const fromTri = (value: string) => (value === 'na' ? null : value === 'yes')
const lines = (value: string) => value.split(/[,\n]/).map(v => v.trim()).filter(Boolean)

async function save() {
  saving.value = true
  try {
    await $fetch('/api/admin/geo/runs', {
      method: 'POST',
      body: {
        run_date: form.run_date,
        question_id: Number(form.question_id),
        engine: form.engine,
        search_enabled: form.search_enabled,
        brand_mentioned: form.brand_mentioned,
        brand_linked: form.brand_linked,
        recommended: form.recommended,
        price_correct: fromTri(form.price_correct),
        fiscal_correct: fromTri(form.fiscal_correct),
        competitors: lines(form.competitors),
        notes: form.notes || null
      }
    })
    toast.add({ title: 'Registro salvo', color: 'success' })
    // Próxima pergunta da mesma rodada
    form.question_id = form.question_id >= 20 ? 1 : Number(form.question_id) + 1
    Object.assign(form, { brand_mentioned: false, brand_linked: false, recommended: false, price_correct: 'na', fiscal_correct: 'na', competitors: '', notes: '' })
    await Promise.all([refreshRuns(), refreshNuxtData('admin-geo-summary')])
  } catch (err) {
    showApiError(err, 'Não foi possível salvar')
  } finally {
    saving.value = false
  }
}

const questionItems = GEO_QUESTIONS.map(q => ({ label: `${q.id}. ${q.text}`, value: q.id }))
const engineItems = GEO_ENGINES.map(e => ({ label: GEO_ENGINE_LABEL[e], value: e }))
const questionText = (id: number) => GEO_QUESTIONS.find(q => q.id === id)?.text ?? ''
const yesNo = (value: boolean | null) => (value === null ? '—' : value ? 'sim' : 'não')
</script>

<template>
  <UDashboardPanel>
    <AppPageHeader title="SEO e GEO">
      <template #right>
        <UButton
          icon="i-lucide-refresh-cw"
          size="sm"
          color="neutral"
          variant="outline"
          label="Verificar de novo"
          :loading="siteStatus === 'pending'"
          @click="refreshSite()"
        />
      </template>
    </AppPageHeader>

    <div class="p-6 overflow-auto space-y-6">
      <!-- 1. Saúde técnica (automática) -->
      <section class="space-y-3">
        <div class="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 class="text-base font-semibold text-highlighted">
              Saúde técnica do site
            </h2>
            <p class="text-sm text-muted">
              Verificação automática de {{ site?.site_url || 'seu site' }}: nada para preencher.
            </p>
          </div>
          <div v-if="site" class="flex flex-wrap items-center gap-2 text-xs">
            <UBadge
              color="success"
              variant="subtle"
              icon="i-lucide-circle-check"
              size="sm"
            >
              {{ site.summary.ok }} ok
            </UBadge>
            <UBadge
              color="warning"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              size="sm"
            >
              {{ site.summary.warning }} atenção
            </UBadge>
            <UBadge
              color="error"
              variant="subtle"
              icon="i-lucide-circle-x"
              size="sm"
            >
              {{ site.summary.error }} falha
            </UBadge>
          </div>
        </div>

        <div v-if="siteStatus === 'pending' && !site" class="grid gap-4 lg:grid-cols-2">
          <AdminSkeleton variant="list" :rows="5" />
          <AdminSkeleton variant="list" :rows="5" />
        </div>

        <UAlert
          v-else-if="siteError"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="(siteError as { statusMessage?: string }).statusMessage || 'Não foi possível verificar o site'"
          description="Confira se NUXT_PUBLIC_SITE_URL aponta para o site publicado."
        />

        <div v-else-if="site" class="grid gap-4 lg:grid-cols-2">
          <UPageCard
            v-for="group in siteGroups"
            :key="group.key"
            variant="subtle"
          >
            <template #title>
              <span class="flex items-center gap-2">
                <UIcon :name="group.icon" class="size-4 text-primary" />
                {{ group.title }}
              </span>
            </template>
            <ul class="divide-y divide-default">
              <li
                v-for="item in group.items"
                :key="item.key"
                class="flex items-start gap-3 py-2.5 text-sm"
              >
                <UIcon
                  :name="checkIcon[item.status]"
                  class="mt-0.5 size-4 shrink-0"
                  :class="checkTone[item.status]"
                />
                <div class="min-w-0">
                  <p class="font-medium text-highlighted">
                    {{ item.label }}
                  </p>
                  <p class="break-words text-xs text-muted">
                    {{ item.detail }}
                  </p>
                </div>
              </li>
            </ul>
          </UPageCard>
        </div>
      </section>

      <!-- 2. Bateria de perguntas (referência fixa) -->
      <UPageCard variant="subtle">
        <template #title>
          <span class="flex items-center gap-2">
            <UIcon name="i-lucide-list-checks" class="size-4 text-primary" />
            Bateria fixa de 20 perguntas
          </span>
        </template>
        <template #description>
          As mesmas perguntas, todo mês, nas principais IAs. É o roteiro para medir citação e recomendação.
        </template>
        <ol class="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          <li
            v-for="q in GEO_QUESTIONS"
            :key="q.id"
            class="flex gap-2"
          >
            <span class="w-5 shrink-0 text-right tabular-nums text-muted">{{ q.id }}.</span>
            <span>{{ q.text }}</span>
          </li>
        </ol>
      </UPageCard>

      <!-- 3. Medição manual (opcional) -->
      <UPageCard variant="subtle">
        <template #title>
          <span class="flex items-center gap-2">
            <UIcon name="i-lucide-clipboard-pen-line" class="size-4 text-primary" />
            Medição nas IAs (opcional)
          </span>
        </template>
        <template #description>
          Citação e recomendação nas respostas das IAs, registradas à mão com a bateria acima. Tráfego vindo de IA e robôs está em
          <NuxtLink to="/admin/metrics" class="underline">
            Métricas &gt; Aquisição
          </NuxtLink>.
        </template>

        <UAlert
          v-if="summaryError"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="(summaryError as { statusMessage?: string }).statusMessage || 'Medição indisponível'"
        />

        <div v-else-if="summary && summary.overall.total > 0" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <AdminMetricsKpi label="Menção" :value="pct(summary.overall.mention_rate)" :hint="`${summary.overall.total} registros (12 semanas)`" />
          <AdminMetricsKpi label="Link" :value="pct(summary.overall.link_rate)" />
          <AdminMetricsKpi label="Recomendação" :value="pct(summary.overall.recommendation_rate)" />
          <AdminMetricsKpi label="Preço correto" :value="pct(summary.overall.price_accuracy)" hint="entre respostas que citaram preço" />
          <AdminMetricsKpi label="Fiscal correto" :value="pct(summary.overall.fiscal_accuracy)" hint="entre respostas que falaram de fiscal" />
        </div>

        <AdminEmptyState
          v-else
          icon="i-lucide-bot-message-square"
          title="Nenhuma medição registrada"
          description="Sem pressa: o diagnóstico técnico acima já funciona sozinho. Quando quiser medir como as IAs citam a marca, registre as respostas."
        />

        <div class="mt-3 flex justify-end">
          <UButton
            :icon="manualOpen ? 'i-lucide-chevron-up' : 'i-lucide-plus'"
            size="sm"
            color="neutral"
            variant="outline"
            :label="manualOpen ? 'Ocultar formulário' : 'Registrar resposta'"
            @click="manualOpen = !manualOpen"
          />
        </div>

        <div v-if="manualOpen" class="mt-3 space-y-3 border-t border-default pt-4">
          <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <UInput v-model="form.run_date" type="date" />
            <USelect
              v-model="form.question_id"
              :items="questionItems"
              value-key="value"
              label-key="label"
              class="lg:col-span-2"
            />
            <USelect
              v-model="form.engine"
              :items="engineItems"
              value-key="value"
              label-key="label"
            />
          </div>
          <div class="flex flex-wrap gap-4 text-sm">
            <USwitch v-model="form.search_enabled" label="Busca ativa" />
            <USwitch v-model="form.brand_mentioned" label="Marca mencionada" />
            <USwitch v-model="form.brand_linked" label="Com link" />
            <USwitch v-model="form.recommended" label="Recomendou" />
          </div>
          <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <USelect
              v-model="form.price_correct"
              :items="tri"
              value-key="value"
              label-key="label"
            />
            <USelect
              v-model="form.fiscal_correct"
              :items="tri"
              value-key="value"
              label-key="label"
            />
            <UInput v-model="form.competitors" placeholder="Concorrentes citados (vírgula)" class="lg:col-span-2" />
          </div>
          <UTextarea
            v-model="form.notes"
            :rows="2"
            placeholder="Observações / URLs citadas"
            class="w-full"
          />
          <p class="text-xs text-muted">
            Pergunta: {{ questionText(Number(form.question_id)) }}
          </p>
          <UButton
            icon="i-lucide-save"
            size="sm"
            :loading="saving"
            label="Salvar e ir para a próxima"
            @click="save"
          />
        </div>
      </UPageCard>

      <UPageCard v-if="summary?.series.length" variant="subtle" title="Semana a semana">
        <table class="w-full text-sm">
          <thead class="text-left text-muted">
            <tr>
              <th class="py-1">
                Semana
              </th><th>Modo</th><th>Registros</th><th>Menção</th><th>Link</th><th>Recomendação</th><th>Preço</th><th>Fiscal</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in summary.series" :key="`${row.week}${row.mode}`" class="border-t border-default tabular-nums">
              <td class="py-2">
                {{ row.week }}
              </td>
              <td>{{ row.mode === 'search' ? 'com busca' : 'sem busca' }}</td>
              <td>{{ row.total }}</td><td>{{ pct(row.mention_rate) }}</td><td>{{ pct(row.link_rate) }}</td>
              <td>{{ pct(row.recommendation_rate) }}</td><td>{{ pct(row.price_accuracy) }}</td><td>{{ pct(row.fiscal_accuracy) }}</td>
            </tr>
          </tbody>
        </table>
      </UPageCard>

      <UPageCard v-if="summary?.by_engine.length" variant="subtle" title="Por motor">
        <table class="w-full text-sm">
          <thead class="text-left text-muted">
            <tr>
              <th class="py-1">
                Motor
              </th><th>Registros</th><th>Menção</th><th>Link</th><th>Recomendação</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in summary.by_engine" :key="row.engine" class="border-t border-default tabular-nums">
              <td class="py-2">
                {{ GEO_ENGINE_LABEL[row.engine as GeoEngine] ?? row.engine }}
              </td>
              <td>{{ row.total }}</td><td>{{ pct(row.mention_rate) }}</td><td>{{ pct(row.link_rate) }}</td><td>{{ pct(row.recommendation_rate) }}</td>
            </tr>
          </tbody>
        </table>
      </UPageCard>

      <UPageCard v-if="lastRuns?.data.length" variant="subtle" :title="`Última rodada (${lastRuns.date})`">
        <table class="w-full text-sm">
          <thead class="text-left text-muted">
            <tr>
              <th class="py-1">
                #
              </th><th>Motor</th><th>Busca</th><th>Menção</th><th>Link</th><th>Recomendou</th><th>Preço</th><th>Fiscal</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in lastRuns.data" :key="`${r.question_id}${r.engine}${r.search_enabled}`" class="border-t border-default">
              <td class="py-2" :title="questionText(r.question_id)">
                {{ r.question_id }}
              </td>
              <td>{{ GEO_ENGINE_LABEL[r.engine] }}</td><td>{{ r.search_enabled ? 'sim' : 'não' }}</td>
              <td>{{ yesNo(r.brand_mentioned) }}</td><td>{{ yesNo(r.brand_linked) }}</td><td>{{ yesNo(r.recommended) }}</td>
              <td>{{ yesNo(r.price_correct) }}</td><td>{{ yesNo(r.fiscal_correct) }}</td>
            </tr>
          </tbody>
        </table>
      </UPageCard>
    </div>
  </UDashboardPanel>
</template>
