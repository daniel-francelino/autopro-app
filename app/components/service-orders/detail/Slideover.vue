<script setup lang="ts">
import type { ServiceOrder, ServiceOrderDetail } from '~/types/service-orders'
import type { BadgeColor } from '~/types/ui'

const props = defineProps<{
  open: boolean
  order: ServiceOrder | null
  canCancel?: boolean
  isCancelling?: boolean
}>()

const emit = defineEmits<{
  'update:open': [v: boolean]
  'cancel': [order: ServiceOrder]
}>()

const toast = useToast()
const detail = ref<ServiceOrderDetail | null>(null)
const isLoading = ref(false)

watch(
  () => props.open,
  async (opened) => {
    if (!opened || !props.order) {
      detail.value = null
      return
    }
    detail.value = null
    isLoading.value = true
    try {
      const res = await $fetch<{ data: ServiceOrderDetail }>(`/api/service-orders/${props.order.id}`)
      detail.value = res.data
    } catch {
      toast.add({ title: 'Erro ao carregar detalhes', color: 'error' })
      emit('update:open', false)
    } finally {
      isLoading.value = false
    }
  }
)

const statusColorMap: Record<string, BadgeColor> = {
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
const paymentStatusColorMap: Record<string, BadgeColor> = {
  pending: 'warning',
  paid: 'success',
  partial: 'info'
}
const paymentStatusLabelMap: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  partial: 'Parcial'
}

function formatCurrency(value: number | string | null | undefined) {
  return parseFloat(String(value || 0)).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const [y, m, d] = value.split('-')
  return `${d}/${m}/${y}`
}
</script>

<template>
  <USlideover
    :open="open"
    side="right"
    :ui="{ content: 'max-w-2xl' }"
    @update:open="emit('update:open', $event)"
  >
    <template #header>
      <div v-if="detail">
        <h2 class="text-lg font-bold text-highlighted">
          OS #{{ detail.order.number }}
        </h2>
        <div class="mt-1 flex flex-wrap items-center gap-2">
          <UBadge
            :color="statusColorMap[detail.order.status] ?? 'neutral'"
            :label="statusLabelMap[detail.order.status] ?? detail.order.status"
            variant="subtle"
          />
          <UBadge
            v-if="detail.order.payment_status"
            :color="paymentStatusColorMap[detail.order.payment_status] ?? 'neutral'"
            :label="paymentStatusLabelMap[detail.order.payment_status] ?? detail.order.payment_status"
            variant="soft"
          />
        </div>
      </div>
      <div v-else-if="isLoading">
        <USkeleton class="h-6 w-32" />
        <USkeleton class="mt-1 h-4 w-24" />
      </div>
    </template>

    <template #body>
      <!-- Loading -->
      <div v-if="isLoading" class="space-y-4 p-6">
        <USkeleton class="h-8 w-48" />
        <USkeleton class="h-4 w-full" />
        <USkeleton class="h-4 w-3/4" />
        <USkeleton class="h-32 w-full" />
      </div>

      <div v-else-if="detail" class="space-y-5 p-4">
        <!-- Entry date -->
        <p class="text-sm text-muted">
          Entrada: {{ formatDate(detail.order.entry_date) }}
        </p>

        <!-- Client + Vehicle -->
        <UPageCard title="Cliente e Veículo" variant="subtle">
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt class="text-muted">
                Cliente
              </dt>
              <dd class="font-medium text-highlighted">
                {{ detail.client?.name ?? '—' }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Telefone
              </dt>
              <dd>{{ detail.client?.phone ?? '—' }}</dd>
            </div>
            <div>
              <dt class="text-muted">
                Veículo
              </dt>
              <dd class="font-medium text-highlighted">
                {{ detail.vehicle ? [detail.vehicle.brand, detail.vehicle.model].filter(Boolean).join(' ') : '—' }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Placa
              </dt>
              <dd>{{ detail.vehicle?.license_plate ?? '—' }}</dd>
            </div>
          </dl>
        </UPageCard>

        <!-- Financial -->
        <UPageCard title="Financeiro" variant="subtle">
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt class="text-muted">
                Total
              </dt>
              <dd class="text-base font-bold text-highlighted">
                {{ formatCurrency(detail.order.total_amount) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Desconto
              </dt>
              <dd>{{ formatCurrency(detail.order.discount) }}</dd>
            </div>
            <div>
              <dt class="text-muted">
                Forma de pagamento
              </dt>
              <dd>{{ detail.order.payment_method ?? '—' }}</dd>
            </div>
            <div>
              <dt class="text-muted">
                Parcelas
              </dt>
              <dd>{{ detail.installments?.length ?? 0 }}</dd>
            </div>
          </dl>
        </UPageCard>

        <!-- Diagnosis -->
        <UPageCard
          v-if="detail.order.reported_defect || detail.order.diagnosis"
          title="Diagnóstico"
          variant="subtle"
        >
          <div class="space-y-2 text-sm">
            <div v-if="detail.order.reported_defect">
              <p class="text-xs text-muted">
                Defeito relatado
              </p>
              <p>{{ detail.order.reported_defect }}</p>
            </div>
            <div v-if="detail.order.diagnosis">
              <p class="text-xs text-muted">
                Diagnóstico técnico
              </p>
              <p>{{ detail.order.diagnosis }}</p>
            </div>
          </div>
        </UPageCard>

        <!-- Items -->
        <UPageCard v-if="detail.order.items?.length" title="Itens" variant="subtle">
          <div class="space-y-2">
            <div
              v-for="(item, i) in detail.order.items"
              :key="i"
              class="flex items-center justify-between border-b border-default pb-1 text-sm last:border-0 last:pb-0"
            >
              <div>
                <span class="font-medium">{{ item.name ?? item.description }}</span>
                <span class="ml-1 text-muted">× {{ item.quantity }}</span>
              </div>
              <span>{{ formatCurrency((item.unit_price ?? 0) * (item.quantity ?? 1)) }}</span>
            </div>
          </div>
        </UPageCard>

        <!-- Notes -->
        <UPageCard v-if="detail.order.notes" title="Observações" variant="subtle">
          <p class="text-sm">
            {{ detail.order.notes }}
          </p>
        </UPageCard>

        <!-- Actions -->
        <div
          v-if="order && canCancel && !['cancelled', 'delivered'].includes(detail.order.status)"
          class="flex flex-wrap gap-2 pt-2"
        >
          <UButton
            label="Cancelar OS"
            icon="i-lucide-ban"
            color="warning"
            variant="outline"
            :loading="isCancelling"
            @click="emit('cancel', order)"
          />
        </div>
      </div>
    </template>
  </USlideover>
</template>
