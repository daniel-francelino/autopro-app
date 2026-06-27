<script setup lang="ts">
import type { ServiceOrderRaw, ServiceOrderDetailFull, ServiceOrderEmployee } from '~/types/service-orders'
import {
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_ICON,
  PAYMENT_STATUS_COLOR,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_ICON,
  ADVANCE_STATUS_MAP,
  canEditServiceOrder,
  getNextStatus
} from '~/utils/service-orders'

const props = defineProps<{
  order: ServiceOrderRaw
  client?: ServiceOrderDetailFull['client']
  responsibleNames?: ServiceOrderDetailFull['responsibleNames']
  employees?: ServiceOrderEmployee[]
  canUpdate?: boolean
  canCancel?: boolean
  canDelete?: boolean
  canCreate?: boolean
  isAdvancing?: boolean
  isCancellingPayment?: boolean
}>()

const emit = defineEmits<{
  'close': []
  'pay': []
  'down-payment': []
  'extra-payment': []
  'cancel-payment': []
  'advance-status': []
  'cancel': []
  'delete': []
  'duplicate': []
  'quote': []
  'edit': []
}>()

const nextStatus = computed(() => getNextStatus(props.order.status))
const advanceInfo = computed(() => nextStatus.value ? ADVANCE_STATUS_MAP[props.order.status] : null)

const isCancelled = computed(() => props.order.status === 'cancelled')
const isEstimate = computed(() => props.order.status === 'estimate')

const canPay = computed(() =>
  props.canUpdate
  && props.order.payment_status === 'pending'
  && props.order.status === 'completed'
  && !props.order.installment_count
)

const canCancelPayment = computed(() =>
  props.canUpdate
  && (props.order.payment_status === 'paid' || props.order.payment_status === 'partial')
  && !isCancelled.value
)

const canReceiveDownPayment = computed(() =>
  props.canUpdate
  && ['open', 'in_progress', 'waiting_for_part'].includes(props.order.status)
)

const canReceiveExtraPayment = computed(() =>
  props.canUpdate && props.order.status === 'completed'
)

const canAdvance = computed(() =>
  props.canUpdate && !!advanceInfo.value && !isCancelled.value
)

const canEdit = computed(() =>
  props.canUpdate && canEditServiceOrder(props.order.status, props.order.payment_status)
)
</script>

<template>
  <div class="flex w-full justify-between gap-4 p-4 lg:px-6 lg:py-5">
    <div class="min-w-0 flex-1 space-y-4">
      <div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div class="space-y-1.5">
          <p class="font-semibold uppercase tracking-[0.22em] text-primary/80">
            Detalhes da Ordem de Serviço
          </p>
          <h1 class="text-xl font-bold leading-tight text-highlighted lg:text-2xl">
            #{{ order.number ?? '—' }}
          </h1>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <UBadge
            :color="STATUS_COLOR[order.status] ?? 'neutral'"
            :label="STATUS_LABEL[order.status] ?? order.status"
            :leading-icon="STATUS_ICON[order.status]"
            variant="subtle"
            class="px-3 py-1"
          />

          <UBadge
            v-if="order.payment_status"
            :color="PAYMENT_STATUS_COLOR[order.payment_status] ?? 'neutral'"
            :label="PAYMENT_STATUS_LABEL[order.payment_status] ?? order.payment_status"
            :leading-icon="PAYMENT_STATUS_ICON[order.payment_status]"
            variant="soft"
            class="px-3 py-1"
          />

          <UBadge
            v-if="order.is_installment && order.installment_count"
            color="info"
            :label="`${order.installment_count}x`"
            leading-icon="i-lucide-layers"
            variant="outline"
            class="px-3 py-1"
          />
        </div>
      </div>

      <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <!-- Receber pagamento -->
          <UButton
            v-if="canPay"
            label="Receber"
            icon="i-lucide-credit-card"
            color="success"
            size="sm"
            @click="emit('pay')"
          />

          <!-- Receber sinal -->
          <UButton
            v-if="canReceiveDownPayment"
            label="Receber sinal"
            icon="i-lucide-hand-coins"
            color="info"
            variant="outline"
            size="sm"
            @click="emit('down-payment')"
          />

          <!-- Receber avulso -->
          <UButton
            v-if="canReceiveExtraPayment"
            label="Receber avulso"
            icon="i-lucide-banknote"
            color="info"
            variant="outline"
            size="sm"
            @click="emit('extra-payment')"
          />

          <!-- Cancelar pagamento -->
          <UButton
            v-if="canCancelPayment"
            label="Cancelar pagamento"
            icon="i-lucide-credit-card"
            color="error"
            variant="outline"
            size="sm"
            :loading="isCancellingPayment"
            @click="emit('cancel-payment')"
          />

          <!-- Avançar status -->
          <UButton
            v-if="canAdvance && advanceInfo"
            :label="advanceInfo.label"
            :icon="advanceInfo.icon"
            :color="advanceInfo.color"
            variant="outline"
            size="sm"
            :loading="isAdvancing"
            @click="emit('advance-status')"
          />

          <UDivider
            v-if="canEdit || canCreate || (canCancel && !isCancelled) || canDelete"
            orientation="vertical"
            class="hidden h-5 xl:block"
          />

          <UButton
            v-if="isEstimate"
            label="Orçamento"
            icon="i-lucide-file-text"
            color="info"
            variant="outline"
            size="sm"
            @click="emit('quote')"
          />

          <UButton
            v-if="canEdit"
            label="Editar"
            icon="i-lucide-pencil"
            color="info"
            variant="outline"
            size="sm"
            @click="emit('edit')"
          />

          <!-- Duplicar -->
          <UTooltip v-if="canCreate" text="Duplicar OS">
            <UButton
              icon="i-lucide-copy"
              color="neutral"
              variant="ghost"
              size="sm"
              @click="emit('duplicate')"
            />
          </UTooltip>

          <!-- Cancelar OS -->
          <UTooltip v-if="canCancel && !isCancelled" text="Cancelar OS">
            <UButton
              icon="i-lucide-ban"
              color="warning"
              variant="ghost"
              size="sm"
              @click="emit('cancel')"
            />
          </UTooltip>

          <!-- Excluir OS -->
          <UTooltip v-if="canDelete" text="Excluir OS">
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="sm"
              @click="emit('delete')"
            />
          </UTooltip>

          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Fechar"
            class="hidden xl:inline-flex"
            @click="emit('close')"
          />
        </div>
      </div>
    </div>

    <UButton
      icon="i-lucide-x"
      color="neutral"
      variant="ghost"
      square
      class="shrink-0 xl:hidden"
      @click="emit('close')"
    />
  </div>
</template>
