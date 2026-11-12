<script setup lang="ts">
export interface CustomerOrder {
  id: string
  number: string | number
  entry_date: string
  status: string
  payment_status: string
  total_amount: number
}

export interface CustomerDetailData {
  client: { name: string, phone?: string, email?: string, document?: string }
  orders: CustomerOrder[]
  stats: { totalSpent: number, totalOrders: number, averageTicket: number }
}

defineProps<{
  open: boolean
  loading: boolean
  data: CustomerDetailData | null
}>()

defineEmits<{
  'update:open': [value: boolean]
}>()

const statusColorMap: Record<string, string> = {
  estimate: 'neutral',
  open: 'info',
  in_progress: 'warning',
  waiting_for_part: 'warning',
  completed: 'success',
  delivered: 'success',
  cancelled: 'error'
}

const statusLabelMap: Record<string, string> = {
  estimate: 'Orçamento',
  open: 'Aberta',
  in_progress: 'Em andamento',
  waiting_for_part: 'Aguard. peça',
  completed: 'Concluída',
  delivered: 'Entregue',
  cancelled: 'Cancelada'
}

const statusIconMap: Record<string, string> = {
  estimate: 'i-lucide-file-text',
  open: 'i-lucide-circle-dot',
  in_progress: 'i-lucide-wrench',
  waiting_for_part: 'i-lucide-package-search',
  completed: 'i-lucide-check-circle-2',
  delivered: 'i-lucide-truck',
  cancelled: 'i-lucide-x-circle'
}

const statusBgMap: Record<string, string> = {
  estimate: 'bg-neutral/10',
  open: 'bg-info/10',
  in_progress: 'bg-warning/10',
  waiting_for_part: 'bg-warning/10',
  completed: 'bg-success/10',
  delivered: 'bg-success/10',
  cancelled: 'bg-error/10'
}

const statusIconColorMap: Record<string, string> = {
  estimate: 'text-muted',
  open: 'text-info',
  in_progress: 'text-warning',
  waiting_for_part: 'text-warning',
  completed: 'text-success',
  delivered: 'text-success',
  cancelled: 'text-error'
}

const paymentColorMap: Record<string, string> = {
  pending: 'warning',
  paid: 'success',
  partial: 'info'
}

const paymentLabelMap: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  partial: 'Parcial'
}

const paymentIconMap: Record<string, string> = {
  pending: 'i-lucide-clock',
  paid: 'i-lucide-circle-check',
  partial: 'i-lucide-split'
}

const amountColorMap: Record<string, string> = {
  paid: 'text-success',
  pending: 'text-warning',
  partial: 'text-info'
}

function formatCurrency(v: number | string) {
  return parseFloat(String(v || 0)).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })
}

function formatDate(v: string) {
  if (!v) return '—'
  const [y, m, d] = v.split('-')
  return `${d}/${m}/${y}`
}

function formatPhone(phone?: string) {
  if (!phone) return '—'
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10)
    return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  if (digits.length === 11)
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  return phone
}

function clientInitial(name?: string) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = (parts[0] ?? '').charAt(0)
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? '').charAt(0) : ''
  return (first + last).toUpperCase()
}
</script>

<template>
  <USlideover
    :open="open"
    side="right"
    :ui="{ content: 'max-w-xl' }"
    @update:open="$emit('update:open', $event)"
  >
    <template #header>
      <div class="flex items-center justify-between gap-3 w-full">
        <div v-if="loading" class="flex flex-1 items-center gap-3">
          <USkeleton class="h-10 w-10 shrink-0 rounded-full" />
          <div class="space-y-1.5">
            <USkeleton class="h-5 w-36" />
            <USkeleton class="h-3.5 w-24" />
          </div>
        </div>
        <div v-else-if="data" class="flex min-w-0 flex-1 items-center gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-sm font-bold text-white shadow-sm">
            {{ clientInitial(data.client?.name) }}
          </div>
          <div>
            <h2 class="text-base font-bold text-highlighted leading-tight">
              {{ data.client?.name ?? '—' }}
            </h2>
            <p class="mt-0.5 text-xs text-muted">
              {{ data.client?.email ?? formatPhone(data.client?.phone) }}
            </p>
          </div>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          class="shrink-0"
          @click="$emit('update:open', false)"
        />
      </div>
    </template>

    <template #body>
      <!-- Loading skeleton -->
      <div v-if="loading" class="space-y-4 p-4">
        <USkeleton class="h-28 w-full rounded-xl" />
        <div class="grid grid-cols-3 gap-3">
          <USkeleton class="h-24 w-full rounded-xl" />
          <USkeleton class="h-24 w-full rounded-xl" />
          <USkeleton class="h-24 w-full rounded-xl" />
        </div>
        <USkeleton class="h-48 w-full rounded-xl" />
      </div>

      <div v-else-if="data" class="space-y-4 p-4">
        <!-- Contact info -->
        <UCard :ui="{ body: 'p-4' }">
          <div class="flex items-center gap-2 mb-3">
            <UIcon name="i-lucide-contact" class="size-4 text-primary" />
            <p class="text-sm font-semibold text-highlighted">
              Informações de contato
            </p>
          </div>
          <div class="space-y-3">
            <div v-if="data.client?.phone" class="flex items-center gap-3 text-sm">
              <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info/10">
                <UIcon name="i-lucide-phone" class="size-4 text-info" />
              </div>
              <div>
                <p class="text-xs text-muted leading-none mb-0.5">
                  Telefone
                </p>
                <p class="font-medium text-highlighted">
                  {{ formatPhone(data.client.phone) }}
                </p>
              </div>
            </div>
            <div v-if="data.client?.email" class="flex items-center gap-3 text-sm">
              <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <UIcon name="i-lucide-mail" class="size-4 text-primary" />
              </div>
              <div>
                <p class="text-xs text-muted leading-none mb-0.5">
                  E-mail
                </p>
                <p class="font-medium text-highlighted">
                  {{ data.client.email }}
                </p>
              </div>
            </div>
            <div v-if="data.client?.document" class="flex items-center gap-3 text-sm">
              <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral/10">
                <UIcon name="i-lucide-id-card" class="size-4 text-muted" />
              </div>
              <div>
                <p class="text-xs text-muted leading-none mb-0.5">
                  Documento
                </p>
                <p class="font-medium text-highlighted">
                  {{ data.client.document }}
                </p>
              </div>
            </div>
            <p
              v-if="!data.client?.phone && !data.client?.email && !data.client?.document"
              class="text-sm text-muted"
            >
              Nenhum contato cadastrado.
            </p>
          </div>
        </UCard>

        <!-- KPI stats -->
        <div class="grid grid-cols-3 gap-3">
          <div class="rounded-xl border border-default bg-gradient-to-b from-elevated/50 to-default p-3 text-center">
            <div class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-success/15">
              <UIcon name="i-lucide-banknote" class="size-4 text-success" />
            </div>
            <p class="text-sm font-bold text-highlighted leading-tight">
              {{ formatCurrency(data.stats.totalSpent) }}
            </p>
            <p class="text-xs text-muted mt-0.5">
              Total gasto
            </p>
          </div>
          <div class="rounded-xl border border-default bg-gradient-to-b from-elevated/50 to-default p-3 text-center">
            <div class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-info/15">
              <UIcon name="i-lucide-clipboard-list" class="size-4 text-info" />
            </div>
            <p class="text-sm font-bold text-highlighted leading-tight">
              {{ data.stats.totalOrders }}
            </p>
            <p class="text-xs text-muted mt-0.5">
              Ordens
            </p>
          </div>
          <div class="rounded-xl border border-default bg-gradient-to-b from-elevated/50 to-default p-3 text-center">
            <div class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-warning/15">
              <UIcon name="i-lucide-receipt" class="size-4 text-warning" />
            </div>
            <p class="text-sm font-bold text-highlighted leading-tight">
              {{ formatCurrency(data.stats.averageTicket) }}
            </p>
            <p class="text-xs text-muted mt-0.5">
              Ticket médio
            </p>
          </div>
        </div>

        <!-- Order history -->
        <UCard v-if="data.orders.length" :ui="{ body: 'p-0 sm:p-2' }">
          <div class="flex items-center gap-2 border-b border-default px-4 py-3">
            <UIcon name="i-lucide-history" class="size-4 text-primary" />
            <p class="text-sm font-semibold text-highlighted">
              Histórico de OS
            </p>
            <UBadge
              :label="String(data.orders.length)"
              color="neutral"
              variant="subtle"
              size="xs"
              class="ml-auto"
            />
          </div>
          <div class="divide-y divide-default/70">
            <div
              v-for="order in data.orders"
              :key="order.id"
              class="flex items-start gap-3 px-4 py-3 text-sm hover:bg-elevated/40 transition-colors duration-100"
            >
              <!-- Status icon -->
              <div
                :class="[statusBgMap[order.status] ?? 'bg-neutral/10', 'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg']"
              >
                <UIcon
                  :name="statusIconMap[order.status] ?? 'i-lucide-file'"
                  :class="[statusIconColorMap[order.status] ?? 'text-muted', 'size-3.5']"
                />
              </div>

              <!-- Content -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <p class="font-semibold text-highlighted leading-tight">
                    OS #{{ order.number }}
                  </p>
                  <UBadge
                    :color="(statusColorMap[order.status] as 'neutral' | 'info' | 'warning' | 'success' | 'error') ?? 'neutral'"
                    :label="statusLabelMap[order.status] ?? order.status"
                    variant="subtle"
                    size="xs"
                  />
                </div>
                <div class="mt-1.5 flex items-center gap-3 flex-wrap">
                  <span class="flex items-center gap-1 text-xs text-muted">
                    <UIcon name="i-lucide-calendar" class="size-3" />
                    {{ formatDate(order.entry_date) }}
                  </span>
                  <UBadge
                    v-if="order.payment_status"
                    :color="(paymentColorMap[order.payment_status] as 'warning' | 'success' | 'info') ?? 'neutral'"
                    variant="soft"
                    size="xs"
                    class="gap-0.5"
                  >
                    <UIcon :name="paymentIconMap[order.payment_status] ?? 'i-lucide-credit-card'" class="size-3" />
                    {{ paymentLabelMap[order.payment_status] ?? order.payment_status }}
                  </UBadge>
                </div>
              </div>

              <!-- Amount -->
              <p
                class="shrink-0 text-sm font-bold"
                :class="amountColorMap[order.payment_status] ?? 'text-highlighted'"
              >
                {{ formatCurrency(order.total_amount) }}
              </p>
            </div>
          </div>
        </UCard>

        <p v-else class="text-center text-sm text-muted py-6">
          Nenhuma ordem encontrada para este cliente no período.
        </p>
      </div>
    </template>
  </USlideover>
</template>
