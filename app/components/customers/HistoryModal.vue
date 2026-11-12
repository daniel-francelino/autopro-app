<script setup lang='ts'>
import type { Client } from '~/types/clients'
import type { BadgeColor } from '~/types/ui'

type HistoryOrder = {
  id: string
  number: string
  status: string
  payment_status: string | null
  entry_date: string
  total_amount: number | null
  reported_defect: string | null
}

const props = defineProps<{
  open: boolean
  client: Client | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const toast = useToast()

const isOpen = computed({
  get: () => props.open,
  set: val => emit('update:open', val)
})

const historyOrders = ref<HistoryOrder[]>([])
const isLoadingHistory = ref(false)

watch(() => props.open, async (val) => {
  if (val && props.client) {
    historyOrders.value = []
    isLoadingHistory.value = true
    try {
      const result = await $fetch<{ data: { items: HistoryOrder[] } }>('/api/service-orders', {
        query: { clientId: props.client.id, limit: 50 }
      })
      historyOrders.value = result.data?.items ?? []
    } catch {
      toast.add({ title: 'Erro ao carregar histórico', color: 'error' })
    } finally {
      isLoadingHistory.value = false
    }
  }
})

const historyStats = computed(() => {
  const orders = historyOrders.value
  const billed = orders.filter(o => ['completed', 'invoiced', 'delivered'].includes(o.status))
  const totalRevenue = billed.reduce((sum, o) => sum + (o.total_amount ?? 0), 0)
  return {
    totalOrders: orders.length,
    totalRevenue,
    avgTicket: billed.length > 0 ? totalRevenue / billed.length : 0
  }
})

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(date: string) {
  if (!date) return '—'
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}

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
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :title="`Histórico Financeiro — ${client?.name ?? ''}`"
    :ui="{ body: 'overflow-y-auto max-h-[70vh]' }"
  >
    <template #body>
      <div
        v-if="isLoadingHistory"
        class="space-y-3"
      >
        <div class="grid grid-cols-3 gap-3">
          <USkeleton
            v-for="i in 3"
            :key="i"
            class="h-20 rounded-xl"
          />
        </div>
        <USkeleton
          v-for="i in 4"
          :key="i"
          class="h-14 w-full"
        />
      </div>

      <template v-else>
        <!-- Cards de resumo -->
        <div class="mb-5 grid grid-cols-3 gap-3">
          <div class="rounded-xl border border-info/30 bg-info/5 p-4">
            <p class="mb-1 text-xs font-medium text-info">
              Total de OS
            </p>
            <p class="text-2xl font-bold text-highlighted">
              {{ historyStats.totalOrders }}
            </p>
          </div>
          <div class="rounded-xl border border-success/30 bg-success/5 p-4">
            <p class="mb-1 text-xs font-medium text-success">
              Total Faturado
            </p>
            <p class="text-2xl font-bold text-highlighted">
              {{ formatCurrency(historyStats.totalRevenue) }}
            </p>
          </div>
          <div class="rounded-xl border border-primary/30 bg-primary/5 p-4">
            <p class="mb-1 text-xs font-medium text-primary">
              Ticket Médio
            </p>
            <p class="text-2xl font-bold text-highlighted">
              {{ formatCurrency(historyStats.avgTicket) }}
            </p>
          </div>
        </div>

        <!-- Lista de OS -->
        <h4 class="mb-2 text-sm font-semibold text-highlighted">
          Ordens de Serviço
        </h4>

        <div
          v-if="historyOrders.length > 0"
          class="space-y-2"
        >
          <div
            v-for="order in historyOrders"
            :key="order.id"
            class="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-default p-3 transition-colors hover:bg-elevated"
            @click="navigateTo(`/app/service-orders?id=${order.id}`)"
          >
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold text-highlighted">
                OS #{{ order.number }}
              </p>
              <p
                v-if="order.reported_defect"
                class="mt-0.5 truncate text-xs text-muted"
              >
                {{ order.reported_defect }}
              </p>
              <p class="mt-0.5 text-xs text-muted">
                {{ formatDate(order.entry_date) }}
              </p>
            </div>
            <div class="shrink-0 text-right">
              <p class="text-sm font-bold text-success">
                {{ formatCurrency(order.total_amount ?? 0) }}
              </p>
              <UBadge
                :color="statusColorMap[order.status] ?? 'neutral'"
                variant="subtle"
                :label="statusLabelMap[order.status] ?? order.status"
                size="xs"
                class="mt-1"
              />
            </div>
          </div>
        </div>

        <div
          v-else
          class="space-y-2 py-10 text-center text-muted"
        >
          <UIcon
            name="i-lucide-history"
            class="mx-auto size-12 opacity-30"
          />
          <p class="text-sm">
            Nenhuma ordem de serviço encontrada
          </p>
        </div>
      </template>
    </template>
  </UModal>
</template>
