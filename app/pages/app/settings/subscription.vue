<script setup lang="ts">
import { ActionCode } from '~/constants/action-codes'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Assinatura' })

const toast = useToast()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { getPlanByPriceId } = usePlans()
const workshop = useWorkshopPermissions()
const canManage = computed(() => workshop.can(ActionCode.SUBSCRIPTION_MANAGE))

function actionErrorMessage(error: unknown, fallback: string): string {
  const err = error as { status?: number, statusCode?: number, data?: { statusMessage?: string }, statusMessage?: string }
  if ((err?.statusCode || err?.status) === 403)
    return 'Você não tem permissão para gerenciar a assinatura. Fale com o administrador da oficina.'
  return err?.data?.statusMessage || err?.statusMessage || fallback
}

// ─── Subscription ─────────────────────────────────────────
type Subscription = {
  stripe_customer_id: string | null
  stripe_subscription_id: string
  status: string
  price_id: string | null
  quantity: number | null
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean | null
  canceled_at: string | null
}

enum StripeSubscriptionStatus {
  Active = 'active',
  Trialing = 'trialing',
  PastDue = 'past_due',
  Canceled = 'canceled',
  Unpaid = 'unpaid',
  Incomplete = 'incomplete',
  IncompleteExpired = 'incomplete_expired',
  Paused = 'paused'
}

type BillingStatusResponse = {
  hasAccess: boolean
  subscription: Subscription | null
}

const { data, status, refresh } = await useAsyncData(
  'billing-subscription',
  () => requestFetch<BillingStatusResponse>('/api/billing/status', { headers: requestHeaders })
)

const sub = computed(() => data.value?.subscription ?? null)
const currentPlan = computed(() => getPlanByPriceId(sub.value?.price_id))

const isActive = computed(() =>
  sub.value?.status === StripeSubscriptionStatus.Active
  || sub.value?.status === StripeSubscriptionStatus.Trialing
)

const isCancelling = ref(false)

async function cancelAtPeriodEnd() {
  if (isCancelling.value) return
  isCancelling.value = true
  try {
    await $fetch('/api/billing/cancel', { method: 'POST' })
    toast.add({ title: 'Cancelamento agendado', description: 'Sua assinatura permanece ativa até o fim do período.', color: 'success' })
    for (let i = 0; i < 3; i++) {
      await refresh()
      if (data.value?.subscription?.cancel_at_period_end) break
      await new Promise(r => setTimeout(r, 1000))
    }
  } catch (error: unknown) {
    toast.add({ title: 'Erro', description: actionErrorMessage(error, 'Não foi possível cancelar'), color: 'error' })
  } finally {
    isCancelling.value = false
  }
}

function formatDate(date: string | null): string {
  if (!date) return '-'
  try {
    return new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch {
    return date
  }
}

function getStatusLabel(s: string): string {
  switch (s) {
    case StripeSubscriptionStatus.Active: return 'Ativa'
    case StripeSubscriptionStatus.Trialing: return 'Período de teste'
    case StripeSubscriptionStatus.PastDue: return 'Pagamento pendente'
    case StripeSubscriptionStatus.Canceled: return 'Cancelada'
    case StripeSubscriptionStatus.Unpaid: return 'Não paga'
    case StripeSubscriptionStatus.Incomplete: return 'Incompleta'
    case StripeSubscriptionStatus.IncompleteExpired: return 'Expirada'
    case StripeSubscriptionStatus.Paused: return 'Pausada'
    default: return s
  }
}

function getStatusColor(s: string): 'success' | 'warning' | 'error' | 'neutral' {
  switch (s) {
    case StripeSubscriptionStatus.Active:
    case StripeSubscriptionStatus.Trialing: return 'success'
    case StripeSubscriptionStatus.PastDue:
    case StripeSubscriptionStatus.Incomplete: return 'warning'
    case StripeSubscriptionStatus.Canceled:
    case StripeSubscriptionStatus.Unpaid:
    case StripeSubscriptionStatus.IncompleteExpired: return 'error'
    default: return 'neutral'
  }
}

async function openPortal() {
  try {
    const { url } = await $fetch<{ url: string }>('/api/billing/portal', { method: 'POST' })
    await navigateTo(url, { external: true })
  } catch (error: unknown) {
    toast.add({ title: 'Erro', description: actionErrorMessage(error, 'Não foi possível abrir o portal'), color: 'error' })
  }
}

// ─── Invoices ─────────────────────────────────────────────
type InvoiceItem = {
  stripe_invoice_id: string
  status: string | null
  currency: string | null
  total: number | null
  amount_due: number | null
  amount_paid: number | null
  paid: boolean | null
  due_date: string | null
  hosted_invoice_url: string | null
  invoice_pdf: string | null
  invoice_number: string | null
  created: string | null
  period_start: string | null
  period_end: string | null
}

type InvoicesResponse = {
  items: InvoiceItem[]
  page: number
  pageSize: number
  total: number
}

const invoicePage = ref(1)
const invoicePageSize = 10

const { data: invoicesData, status: invoicesStatus } = await useAsyncData(
  () => `billing-invoices-${invoicePage.value}`,
  () => requestFetch<InvoicesResponse>('/api/billing/invoices', {
    headers: requestHeaders,
    query: { page: invoicePage.value, pageSize: invoicePageSize }
  }),
  { watch: [invoicePage] }
)

const invoiceColumns = [
  { accessorKey: 'invoice_number', header: 'Fatura', enableSorting: false },
  { accessorKey: 'status', header: 'Status', enableSorting: false },
  { accessorKey: 'total', header: 'Total', enableSorting: false },
  { accessorKey: 'created', header: 'Data', enableSorting: false },
  { id: 'actions', header: '', enableSorting: false }
]

function getInvoiceStatusLabel(s: string | null): string {
  switch (s) {
    case 'paid': return 'Pago'
    case 'open': return 'Em aberto'
    case 'void': return 'Cancelada'
    case 'draft': return 'Rascunho'
    case 'uncollectible': return 'Incobrável'
    default: return s || '-'
  }
}

function getInvoiceStatusColor(s: string | null): 'success' | 'warning' | 'error' | 'neutral' {
  switch (s) {
    case 'paid': return 'success'
    case 'open': return 'warning'
    case 'void':
    case 'uncollectible': return 'error'
    default: return 'neutral'
  }
}

function formatMoney(amount: number | null, currency: string | null): string {
  if (amount == null) return '-'
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: (currency || 'brl').toUpperCase()
    }).format(amount / 100)
  } catch {
    return `${amount / 100}`
  }
}

async function openInvoice(url: string | null) {
  if (!url) {
    toast.add({ title: 'Erro', description: 'Link da fatura indisponível', color: 'error' })
    return
  }
  await navigateTo(url, { external: true })
}
</script>

<template>
  <!-- Plano atual -->
  <div v-if="status === 'pending'" class="space-y-3">
    <USkeleton class="h-32 w-full rounded-2xl" />
    <USkeleton class="h-10 w-full" />
    <USkeleton class="h-10 w-full" />
  </div>

  <template v-else-if="!sub">
    <UPageCard
      title="Sem assinatura ativa"
      description="Escolha um plano para começar a usar o AutoPro."
      variant="subtle"
    >
      <template #footer>
        <UButton
          label="Ver planos"
          color="neutral"
          to="/pricing"
          icon="i-lucide-arrow-right"
          trailing
        />
      </template>
    </UPageCard>
  </template>

  <template v-else>
    <!-- Card do plano -->
    <div class="rounded-2xl border border-default/80 bg-elevated/30 p-6 space-y-5">
      <!-- Header do plano -->
      <div class="flex items-start justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <UIcon :name="currentPlan?.icon ?? 'i-lucide-credit-card'" class="size-5 text-primary" />
          </div>
          <div>
            <p class="text-xs font-medium uppercase tracking-widest text-muted">
              Seu plano
            </p>
            <h2 class="text-xl font-bold text-highlighted">
              {{ currentPlan?.name ?? 'Plano personalizado' }}
            </h2>
          </div>
        </div>

        <div class="text-right shrink-0">
          <p class="text-2xl font-bold text-highlighted">
            {{ currentPlan?.price ?? '-' }}
          </p>
          <p class="text-xs text-muted">
            por mês
          </p>
        </div>
      </div>

      <!-- Descrição do plano -->
      <p v-if="currentPlan?.description" class="text-sm text-muted leading-relaxed">
        {{ currentPlan.description }}
      </p>

      <!-- Status + período -->
      <div class="flex flex-wrap items-center gap-4 pt-1">
        <div class="flex items-center gap-2">
          <UBadge :color="getStatusColor(sub.status)" variant="subtle" size="sm">
            {{ getStatusLabel(sub.status) }}
          </UBadge>
          <UBadge
            v-if="sub.cancel_at_period_end"
            color="warning"
            variant="subtle"
            size="sm"
          >
            Cancelamento agendado
          </UBadge>
        </div>

        <div v-if="sub.current_period_end" class="flex items-center gap-1.5 text-sm text-muted">
          <UIcon
            :name="sub.cancel_at_period_end ? 'i-lucide-calendar-x' : 'i-lucide-calendar-check'"
            class="size-4 shrink-0"
          />
          <span>
            {{ sub.cancel_at_period_end ? 'Expira em' : 'Renova em' }}
            <strong class="text-highlighted">{{ formatDate(sub.current_period_end) }}</strong>
          </span>
        </div>
      </div>

      <USeparator />

      <!-- Ações -->
      <div v-if="canManage" class="flex flex-wrap items-center gap-2">
        <UButton
          label="Gerenciar assinatura"
          color="neutral"
          variant="outline"
          icon="i-lucide-settings"
          @click="openPortal"
        />
        <UButton
          v-if="isActive && !sub.cancel_at_period_end"
          label="Cancelar no fim do período"
          color="neutral"
          variant="ghost"
          :loading="isCancelling"
          :disabled="isCancelling"
          @click="cancelAtPeriodEnd"
        />
      </div>
    </div>

    <!-- Aviso de cancelamento -->
    <UAlert
      v-if="sub.cancel_at_period_end"
      icon="i-lucide-alert-triangle"
      color="warning"
      variant="subtle"
      title="Cancelamento agendado"
      :description="`Sua assinatura será encerrada em ${formatDate(sub.current_period_end)}. Você pode reativar a qualquer momento pelo portal.`"
    />
  </template>

  <!-- Faturas -->
  <UPageCard
    title="Faturas"
    description="Histórico de cobranças da sua assinatura."
    variant="subtle"
    class="mt-4"
  >
    <AppDataTable
      v-model:page="invoicePage"
      :columns="invoiceColumns"
      :data="(invoicesData?.items ?? []) as Record<string, unknown>[]"
      :loading="invoicesStatus === 'pending'"
      :page-size="invoicePageSize"
      :total="invoicesData?.total ?? 0"
      :show-page-size-selector="false"
      empty-icon="i-lucide-receipt"
      empty-title="Nenhuma fatura encontrada"
      empty-description="Não há faturas registradas para esta assinatura."
    >
      <template #invoice_number-cell="{ row }">
        <span class="font-mono text-sm font-medium">
          {{ row.original.invoice_number || row.original.stripe_invoice_id }}
        </span>
      </template>

      <template #status-cell="{ row }">
        <UBadge
          :color="getInvoiceStatusColor(row.original.status as string | null)"
          variant="subtle"
          size="sm"
        >
          {{ getInvoiceStatusLabel(row.original.status as string | null) }}
        </UBadge>
      </template>

      <template #total-cell="{ row }">
        <span class="font-medium">
          {{ formatMoney(row.original.total as number | null, row.original.currency as string | null) }}
        </span>
      </template>

      <template #created-cell="{ row }">
        {{ row.original.created ? new Date(row.original.created as string).toLocaleDateString('pt-BR') : '-' }}
      </template>

      <template #actions-cell="{ row }">
        <UButton
          label="Abrir"
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-external-link"
          :disabled="!row.original.invoice_pdf && !row.original.hosted_invoice_url"
          @click="openInvoice((row.original.invoice_pdf || row.original.hosted_invoice_url) as string | null)"
        />
      </template>
    </AppDataTable>
  </UPageCard>
</template>
