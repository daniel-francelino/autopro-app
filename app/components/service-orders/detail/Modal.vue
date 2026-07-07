<script setup lang="ts">
import type { ServiceOrder, ServiceOrderDetailFull, ServiceOrderRaw } from '~/types/service-orders'
import { computeServiceOrderCommissionBreakdown } from '~/utils/service-orders'

const props = defineProps<{
  open: boolean
  order: ServiceOrder | null
  canUpdate?: boolean
  canCancel?: boolean
  canDelete?: boolean
  canCreate?: boolean
}>()

const emit = defineEmits<{
  'update:open': [v: boolean]
  'updated': []
  'deleted': []
  'quote': [orderId: string]
  'edit': [order: ServiceOrderRaw]
  'issue-nfse': [orderId: string]
  'completed': [orderId: string]
}>()

// ─── Data ──────────────────────────────────────────────────────────────────────

const toast = useToast()
const detail = ref<ServiceOrderDetailFull | null>(null)
const isLoading = ref(false)

async function loadDetail() {
  if (!props.order) return
  detail.value = null
  isLoading.value = true
  try {
    const res = await $fetch<{ data: ServiceOrderDetailFull }>(`/api/service-orders/${props.order.id}`)
    detail.value = res.data
  } catch {
    toast.add({ title: 'Erro ao carregar detalhes', color: 'error' })
    emit('update:open', false)
  } finally {
    isLoading.value = false
  }
}

watch(
  () => props.open,
  (opened) => {
    if (opened) loadDetail()
    else detail.value = null
  }
)

function close() {
  emit('update:open', false)
}

function requestEdit() {
  if (!detail.value) return
  emit('edit', detail.value.order)
}

function requestQuote() {
  if (!detail.value) return
  emit('quote', detail.value.order.id)
}

// ─── Advance status ────────────────────────────────────────────────────────────

const isAdvancing = ref(false)

function getNextStatus(status: string): string | null {
  if (status === 'estimate') return 'open'
  if (status === 'open') return 'in_progress'
  if (status === 'in_progress') return 'completed'
  return null
}

async function advanceStatus() {
  if (!detail.value || isAdvancing.value) return
  const nextStatus = getNextStatus(detail.value.order.status)
  if (!nextStatus) return

  isAdvancing.value = true
  const orderId = detail.value.order.id
  try {
    await $fetch('/api/service-orders', {
      method: 'POST',
      body: { orderId, orderData: { status: nextStatus } }
    })
    toast.add({ title: 'Status atualizado', color: 'success' })
    if (nextStatus === 'completed') {
      emit('completed', orderId)
      return
    }
    await loadDetail()
    emit('updated')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Erro ao atualizar status',
      description: err?.data?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isAdvancing.value = false
  }
}

// ─── Payment ───────────────────────────────────────────────────────────────────

const showPaymentModal = ref(false)

function openPaymentModal() {
  showPaymentModal.value = true
}

function onPaymentDone() {
  showPaymentModal.value = false
  loadDetail()
  emit('updated')
}

// ─── Down payment (sinal) ───────────────────────────────────────────────────────

const showDownPaymentModal = ref(false)

function openDownPaymentModal() {
  showDownPaymentModal.value = true
}

function onDownPaymentReceived() {
  showDownPaymentModal.value = false
  loadDetail()
  emit('updated')
}

// ─── Extra payment (avulso) ─────────────────────────────────────────────────────

const showExtraPaymentModal = ref(false)

function openExtraPaymentModal() {
  showExtraPaymentModal.value = true
}

function onExtraPaymentReceived() {
  showExtraPaymentModal.value = false
  loadDetail()
  emit('updated')
}

// ─── Cancel payment ────────────────────────────────────────────────────────────

const isCancellingPayment = ref(false)
const showCancelPaymentModal = ref(false)

async function confirmCancelPayment() {
  if (!detail.value || isCancellingPayment.value) return
  isCancellingPayment.value = true
  try {
    await $fetch(`/api/service-orders/${detail.value.order.id}/payment`, { method: 'DELETE' })
    toast.add({ title: 'Pagamento cancelado', color: 'success' })
    showCancelPaymentModal.value = false
    await loadDetail()
    emit('updated')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Erro ao cancelar pagamento',
      description: err?.data?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isCancellingPayment.value = false
  }
}

// ─── Cancel OS ────────────────────────────────────────────────────────────────

const isCancelling = ref(false)
const showCancelModal = ref(false)

async function confirmCancel() {
  if (!detail.value || isCancelling.value) return
  isCancelling.value = true
  try {
    await $fetch(`/api/service-orders/${detail.value.order.id}/cancel`, { method: 'POST' })
    toast.add({ title: 'OS cancelada', color: 'success' })
    showCancelModal.value = false
    await loadDetail()
    emit('updated')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Erro ao cancelar OS',
      description: err?.data?.statusMessage || 'Não foi possível cancelar.',
      color: 'error'
    })
  } finally {
    isCancelling.value = false
  }
}

// ─── Delete OS ────────────────────────────────────────────────────────────────

const isDeleting = ref(false)
const showDeleteModal = ref(false)

async function confirmDelete() {
  if (!detail.value || isDeleting.value) return
  isDeleting.value = true
  try {
    await $fetch(`/api/service-orders/${detail.value.order.id}`, { method: 'DELETE' })
    toast.add({ title: 'OS removida', color: 'success' })
    showDeleteModal.value = false
    close()
    emit('deleted')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Erro ao excluir OS',
      description: err?.data?.statusMessage || 'Não foi possível remover.',
      color: 'error'
    })
  } finally {
    isDeleting.value = false
  }
}

// ─── Duplicate ────────────────────────────────────────────────────────────────

const isDuplicating = ref(false)

async function duplicate() {
  if (!detail.value || isDuplicating.value) return
  isDuplicating.value = true
  try {
    const orig = detail.value.order
    await $fetch('/api/service-orders', {
      method: 'POST',
      body: {
        orderData: {
          client_id: orig.client_id ?? null,
          vehicle_id: orig.vehicle_id ?? null,
          master_product_id: orig.master_product_id ?? null,
          employee_responsible_id: orig.employee_responsible_id ?? null,
          responsible_employees: orig.responsible_employees ?? [],
          reported_defect: orig.reported_defect ?? null,
          diagnosis: orig.diagnosis ?? null,
          status: 'open',
          payment_status: 'pending',
          entry_date: new Date().toISOString().split('T')[0],
          items: orig.items ?? [],
          apply_taxes: orig.apply_taxes ?? false,
          total_amount: orig.total_amount ?? 0,
          discount: orig.discount ?? 0,
          notes: orig.notes ?? null
        }
      }
    })
    toast.add({ title: 'OS duplicada com sucesso', color: 'success' })
    emit('updated')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Erro ao duplicar OS',
      description: err?.data?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isDuplicating.value = false
  }
}

// ─── Build ServiceOrder proxy for PaymentModal (needs ServiceOrder shape) ─────

const orderProxy = computed<ServiceOrder | null>(() => {
  if (!detail.value) return props.order
  const o = detail.value.order
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    payment_status: o.payment_status,
    is_installment: o.is_installment,
    client_id: o.client_id,
    client_name: detail.value.client?.name ?? null,
    vehicle_id: o.vehicle_id,
    vehicle_label: null,
    entry_date: o.entry_date,
    reported_defect: o.reported_defect,
    total_amount: o.total_amount,
    master_product_name: detail.value.masterProduct?.name ?? null,
    responsible_name: null,
    responsible_names: detail.value.responsibleNames.map(r => r.name).filter((n): n is string => n !== null),
    has_commissions: detail.value.commissions.length > 0,
    installments_progress: null,
    commission_release_mode: o.commission_release_mode ?? 'proportional'
  }
})

const estimatedCommissionAmount = computed(() => {
  if (!detail.value) return 0
  return computeServiceOrderCommissionBreakdown(detail.value.order, detail.value.employees).total
})

// ─── NFS-e ────────────────────────────────────────────────────────────────────

type NfseInfoCardRef = { refresh: () => void }
const nfseInfoCardRef = ref<NfseInfoCardRef | null>(null)

function requestIssueNfse() {
  if (!detail.value) return
  emit('issue-nfse', detail.value.order.id)
}

function refreshNfseCard() {
  nfseInfoCardRef.value?.refresh()
}

defineExpose({ refreshNfseCard })
</script>

<template>
  <UModal
    :open="open"
    :ui="{
      overlay: 'bg-default/90 backdrop-blur-sm',
      content: 'sm:max-h-[100dvh] max-h-[100dvh] max-w-none w-screen h-dvh rounded-none flex flex-col overflow-hidden',
      body: 'flex-1 min-h-0 overflow-y-auto p-0',
      header: 'p-0 shrink-0 border-b border-default'
    }"
    @update:open="emit('update:open', $event)"
  >
    <template #header>
      <!-- Loading header skeleton -->
      <div v-if="isLoading" class="flex items-center gap-4 p-4 lg:px-6 lg:py-5">
        <USkeleton class="size-8 rounded-lg" />
        <div class="space-y-1.5">
          <USkeleton class="h-5 w-32" />
          <USkeleton class="h-4 w-48" />
        </div>
      </div>

      <!-- Real header -->
      <ServiceOrdersDetailOSHeader
        v-else-if="detail"
        :order="detail.order"
        :client="detail.client"
        :responsible-names="detail.responsibleNames"
        :employees="detail.employees"
        :can-update="canUpdate"
        :can-cancel="canCancel"
        :can-delete="canDelete"
        :can-create="canCreate"
        :is-advancing="isAdvancing"
        :is-cancelling-payment="isCancellingPayment"
        @close="close"
        @pay="openPaymentModal"
        @down-payment="openDownPaymentModal"
        @extra-payment="openExtraPaymentModal"
        @cancel-payment="showCancelPaymentModal = true"
        @advance-status="advanceStatus"
        @cancel="showCancelModal = true"
        @delete="showDeleteModal = true"
        @duplicate="duplicate"
        @quote="requestQuote"
        @edit="requestEdit"
      />
    </template>

    <template #body>
      <!-- Initial loading -->
      <div v-if="isLoading" class="space-y-4 p-6">
        <USkeleton class="h-28 w-full rounded-xl" />
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <USkeleton class="h-48 rounded-xl" />
          <USkeleton class="col-span-2 h-48 rounded-xl" />
        </div>
        <USkeleton class="h-40 w-full rounded-xl" />
        <USkeleton class="h-28 w-full rounded-xl" />
      </div>

      <!-- Content -->
      <div v-else-if="detail" class="space-y-6 p-4 lg:p-6">
        <!-- Row 1: client/vehicle + info -->
        <div class="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <ServiceOrdersDetailOSClientVehicleCard
            :client="detail.client"
            :vehicle="detail.vehicle"
          />
          <div class="min-w-0">
            <ServiceOrdersDetailOSInfoCard
              :order="detail.order"
              :master-product="detail.masterProduct"
            />
          </div>
        </div>

        <!-- Items -->
        <ServiceOrdersDetailOSItemsCard
          :order="detail.order"
          :employees="detail.employees"
        />

        <!-- Financial -->
        <ServiceOrdersDetailOSFinancialCard
          :order="detail.order"
          :calculated-commission-amount="estimatedCommissionAmount"
        />

        <!-- Installments -->
        <ServiceOrdersDetailOSInstallmentsCard
          :installments="detail.installments"
          :order-id="detail.order.id"
          :can-update="canUpdate"
          @changed="() => { loadDetail(); emit('updated') }"
        />

        <!-- Commissions -->
        <ServiceOrdersDetailOSCommissionsCard
          :commissions="detail.commissions"
          :employees="detail.employees"
          :can-update="canUpdate"
          :release-mode="detail.order.commission_release_mode"
          @paid="loadDetail"
        />

        <!-- Responsibles -->
        <ServiceOrdersDetailOSResponsiblesCard
          :order="detail.order"
          :responsible-names="detail.responsibleNames"
          :employees="detail.employees"
          :commissions="detail.commissions"
        />

        <!-- NFS-e -->
        <ServiceOrdersNfseInfoCard
          ref="nfseInfoCardRef"
          :order-id="detail.order.id"
          :order-status="detail.order.status"
          :can-create="canCreate"
          @issue-nfse="requestIssueNfse"
        />
      </div>
    </template>
  </UModal>

  <!-- Payment Modal -->
  <ServiceOrdersPaymentModal
    v-model:open="showPaymentModal"
    :order="orderProxy"
    @paid="onPaymentDone"
  />

  <!-- Down Payment (sinal) Modal -->
  <ServiceOrdersDownPaymentModal
    v-model:open="showDownPaymentModal"
    :order="orderProxy"
    @received="onDownPaymentReceived"
  />

  <!-- Extra Payment (avulso) Modal -->
  <ServiceOrdersExtraPaymentModal
    v-model:open="showExtraPaymentModal"
    :order="orderProxy"
    @received="onExtraPaymentReceived"
  />

  <!-- Cancel Payment Confirm -->
  <AppConfirmModal
    v-model:open="showCancelPaymentModal"
    title="Cancelar pagamento"
    confirm-label="Cancelar pagamento"
    confirm-color="error"
    :loading="isCancellingPayment"
    @confirm="confirmCancelPayment"
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja cancelar o pagamento da
        <strong class="text-highlighted">OS #{{ detail?.order.number ?? '' }}</strong>?
        Os registros financeiros relacionados serão removidos.
      </p>
    </template>
  </AppConfirmModal>

  <!-- Cancel OS Confirm -->
  <AppConfirmModal
    v-model:open="showCancelModal"
    title="Cancelar OS"
    confirm-label="Cancelar OS"
    confirm-color="warning"
    :loading="isCancelling"
    @confirm="confirmCancel"
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja cancelar a
        <strong class="text-highlighted">OS #{{ detail?.order.number ?? '' }}</strong>?
        Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>

  <!-- Delete OS Confirm -->
  <AppConfirmModal
    v-model:open="showDeleteModal"
    title="Excluir OS"
    confirm-label="Excluir OS"
    confirm-color="error"
    :loading="isDeleting"
    @confirm="confirmDelete"
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir a
        <strong class="text-highlighted">OS #{{ detail?.order.number ?? '' }}</strong>?
        Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>
</template>
