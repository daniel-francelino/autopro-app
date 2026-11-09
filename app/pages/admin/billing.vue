<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['owner-only']
})
useSeoMeta({ title: 'Cobrança — Admin' })

type Summary = {
  mrr: number, active_subscriptions: number, trial_subscriptions: number, missing_amount: number
  by_plan: Array<{ plan: string, subscriptions: number, mrr: number }>
  current_month: { month: string, new: number, cancelled: number, active_at_start: number, churn_rate: number | null } | null
  series: Array<{ month: string, new: number, cancelled: number, active_at_start: number, churn_rate: number | null }>
  invoices_needing_action: Array<{ id: string, organization_id: string | null, invoice_number: string | null, amount: number | null, status: string, due_date: string | null, attempt_count: number | null, hosted_invoice_url: string | null, user_email: string | null }>
}
type WebhookEvent = { id: string, type: string, received_at: string, processed_at: string | null, status: string, error_message: string | null }

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const { data: summary, error } = await useAsyncData('admin-billing-summary', () =>
  requestFetch<Summary>('/api/admin/billing/summary', { headers: requestHeaders }))

const webhookStatus = ref('')
const { data: webhooks, error: webhookError, refresh: refreshWebhooks } = await useAsyncData('admin-billing-webhooks', () =>
  requestFetch<{ data: WebhookEvent[], total: number }>('/api/admin/billing/webhooks', {
    headers: requestHeaders,
    query: { status: webhookStatus.value || undefined }
  }))
watch(webhookStatus, () => refreshWebhooks())

const money = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmt = (value: string | null) => (value ? new Date(value).toLocaleString('pt-BR') : '—')
const statusColor: Record<string, 'neutral' | 'success' | 'warning' | 'error'> = { received: 'neutral', processed: 'success', ignored: 'neutral', failed: 'error' }

const categories = computed(() => (summary.value?.series ?? []).map(s => s.month))
const chartSeries = computed(() => [
  { name: 'Novas', data: (summary.value?.series ?? []).map(s => s.new) },
  { name: 'Canceladas', data: (summary.value?.series ?? []).map(s => s.cancelled) }
])
</script>

<template>
  <UDashboardPanel>
    <UDashboardNavbar title="Cobrança" />

    <div class="p-6 overflow-auto space-y-6">
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        title="Não foi possível carregar a cobrança"
      />

      <template v-else-if="summary">
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AdminMetricsKpi label="MRR" :value="money(summary.mrr)" :hint="`${summary.active_subscriptions} assinaturas ativas`" />
          <AdminMetricsKpi label="Em teste" :value="summary.trial_subscriptions" />
          <AdminMetricsKpi label="Novas no mês" :value="summary.current_month?.new ?? 0" />
          <AdminMetricsKpi label="Churn do mês" :value="summary.current_month?.churn_rate === null || summary.current_month?.churn_rate === undefined ? '—' : `${summary.current_month.churn_rate}%`" :hint="`${summary.current_month?.cancelled ?? 0} canceladas`" />
        </div>

        <UAlert
          v-if="summary.missing_amount"
          color="warning"
          variant="subtle"
          :title="`${summary.missing_amount} assinatura(s) ativa(s) sem valor mensal`"
          description="O MRR está subestimado: o webhook do Stripe não gravou monthly_amount nessas assinaturas."
        />

        <div class="grid gap-4 lg:grid-cols-2">
          <UPageCard variant="subtle" title="MRR por plano">
            <table class="w-full text-sm">
              <thead class="text-left text-muted">
                <tr>
                  <th class="py-1">
                    Plano
                  </th><th>Assinaturas</th><th class="text-right">
                    MRR
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in summary.by_plan" :key="p.plan" class="border-t border-default">
                  <td class="py-2">
                    {{ p.plan }}
                  </td><td>{{ p.subscriptions }}</td><td class="text-right tabular-nums">
                    {{ money(p.mrr) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </UPageCard>

          <UPageCard variant="subtle" title="Novas × canceladas (12 meses)">
            <ChartsBar :categories="categories" :series="chartSeries" :height="240" />
          </UPageCard>
        </div>

        <UPageCard variant="subtle" title="Faturas que pedem ação">
          <table class="w-full text-sm">
            <thead class="text-left text-muted">
              <tr>
                <th class="py-1">
                  Fatura
                </th><th>Cliente</th><th>Valor</th><th>Status</th><th>Vencimento</th><th>Tentativas</th><th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="inv in summary.invoices_needing_action" :key="inv.id" class="border-t border-default">
                <td class="py-2">
                  {{ inv.invoice_number || inv.id.slice(0, 8) }}
                </td>
                <td>
                  <NuxtLink v-if="inv.organization_id" :to="`/admin/organizations/${inv.organization_id}`" class="underline">{{ inv.user_email || 'Oficina' }}</NuxtLink>
                  <span v-else>{{ inv.user_email || '—' }}</span>
                </td>
                <td class="tabular-nums">
                  {{ money(inv.amount) }}
                </td>
                <td>
                  <UBadge size="sm" variant="subtle" color="warning">
                    {{ inv.status }}
                  </UBadge>
                </td>
                <td>{{ fmt(inv.due_date) }}</td>
                <td>{{ inv.attempt_count ?? '—' }}</td>
                <td>
                  <a
                    v-if="inv.hosted_invoice_url"
                    :href="inv.hosted_invoice_url"
                    target="_blank"
                    rel="noopener"
                    class="underline"
                  >abrir</a>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!summary.invoices_needing_action.length" class="text-sm text-muted">
            Nenhuma fatura pendente ou com falha.
          </p>
        </UPageCard>
      </template>

      <UPageCard variant="subtle" title="Webhooks do Stripe">
        <USelect
          v-model="webhookStatus"
          class="w-56 mb-3"
          :items="[{ label: 'Todos', value: '' }, { label: 'Falhas', value: 'failed' }, { label: 'Processados', value: 'processed' }, { label: 'Ignorados', value: 'ignored' }, { label: 'Recebidos', value: 'received' }]"
          value-key="value"
          label-key="label"
        />
        <UAlert
          v-if="webhookError"
          color="warning"
          variant="subtle"
          :title="(webhookError as { statusMessage?: string }).statusMessage || 'Eventos indisponíveis'"
        />
        <table v-else class="w-full text-sm">
          <thead class="text-left text-muted">
            <tr>
              <th class="py-1">
                Recebido
              </th><th>Evento</th><th>Status</th><th>Erro</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ev in webhooks?.data ?? []" :key="ev.id" class="border-t border-default">
              <td class="py-2 whitespace-nowrap">
                {{ fmt(ev.received_at) }}
              </td>
              <td>{{ ev.type }}<span class="block text-xs text-muted">{{ ev.id }}</span></td>
              <td>
                <UBadge size="sm" variant="subtle" :color="statusColor[ev.status]">
                  {{ ev.status }}
                </UBadge>
              </td>
              <td class="text-xs text-error">
                {{ ev.error_message || '' }}
              </td>
            </tr>
          </tbody>
        </table>
      </UPageCard>
    </div>
  </UDashboardPanel>
</template>
