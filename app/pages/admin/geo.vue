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
  question_id: number, engine: GeoEngine, search_enabled: boolean, brand_mentioned: boolean, brand_linked: boolean, recommended: boolean
  price_correct: boolean | null, fiscal_correct: boolean | null, competitors: string[] | null, notes: string | null
}

const toast = useToast()
const showApiError = useApiErrorToast()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const { data: summary, error: summaryError } = await useAsyncData('admin-geo-summary', () =>
  requestFetch<Summary>('/api/admin/geo/summary', { headers: requestHeaders }))

const { data: lastRuns, refresh: refreshRuns } = await useAsyncData('admin-geo-runs', () =>
  requestFetch<{ date: string | null, data: Run[] }>('/api/admin/geo/runs', { headers: requestHeaders }))

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
    <UDashboardNavbar title="SEO e GEO" />

    <div class="p-6 overflow-auto space-y-6">
      <UAlert
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        title="O que estes números medem"
        description="Citação e recomendação nas respostas das IAs, registradas à mão toda semana com a bateria fixa de 20 perguntas. Uma citação de página não é recomendação do produto. Tráfego vindo de IA e robôs está em Métricas > Aquisição."
      >
        <template #actions>
          <UButton
            to="/admin/metrics"
            size="xs"
            color="neutral"
            variant="outline"
            label="Abrir métricas"
          />
        </template>
      </UAlert>

      <UAlert
        v-if="summaryError"
        color="warning"
        variant="subtle"
        :title="(summaryError as { statusMessage?: string }).statusMessage || 'Bateria indisponível'"
      />

      <div v-else-if="summary" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <AdminMetricsKpi label="Menção" :value="pct(summary.overall.mention_rate)" :hint="`${summary.overall.total} registros (12 semanas)`" />
        <AdminMetricsKpi label="Link" :value="pct(summary.overall.link_rate)" />
        <AdminMetricsKpi label="Recomendação" :value="pct(summary.overall.recommendation_rate)" />
        <AdminMetricsKpi label="Preço correto" :value="pct(summary.overall.price_accuracy)" hint="entre respostas que citaram preço" />
        <AdminMetricsKpi label="Fiscal correto" :value="pct(summary.overall.fiscal_accuracy)" hint="entre respostas que falaram de fiscal" />
      </div>

      <UPageCard variant="subtle" title="Registrar resposta">
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
        <div class="flex flex-wrap gap-4 mt-3 text-sm">
          <USwitch v-model="form.search_enabled" label="Busca ativa" />
          <USwitch v-model="form.brand_mentioned" label="Marca mencionada" />
          <USwitch v-model="form.brand_linked" label="Com link" />
          <USwitch v-model="form.recommended" label="Recomendou" />
        </div>
        <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-4 mt-3">
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
          class="w-full mt-3"
        />
        <p class="text-xs text-muted mt-2">
          Pergunta: {{ questionText(Number(form.question_id)) }}
        </p>
        <UButton
          class="mt-3"
          :loading="saving"
          label="Salvar e ir para a próxima pergunta"
          @click="save"
        />
      </UPageCard>

      <UPageCard v-if="summary" variant="subtle" title="Semana a semana">
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
        <p v-if="!summary.series.length" class="text-sm text-muted">
          Nenhum registro ainda. Rode a bateria e cadastre acima.
        </p>
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
