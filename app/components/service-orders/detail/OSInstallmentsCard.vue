<script setup lang="ts">
import type { ServiceOrderInstallment, ServiceOrderInstallmentReceipt } from '~/types/service-orders'
import { formatCurrency, formatDate } from '~/utils/service-orders'

type PaymentMethod = 'pix' | 'cash' | 'credit_card' | 'debit_card' | 'bank_slip' | 'transfer' | 'check'
type BankAccountItem = { id: string, account_name: string, bank_name: string | null }
type PaymentTerminalItem = { id: string, terminal_name: string, provider_company: string | null }

const props = defineProps<{
  installments: ServiceOrderInstallment[]
  orderId: string
  canUpdate?: boolean
  canDeleteInstallment?: boolean
}>()

const emit = defineEmits<{ changed: [] }>()

const toast = useToast()

const installmentStatusColor: Record<string, string> = {
  paid: 'success',
  partial: 'info',
  pending: 'warning',
  overdue: 'error'
}

const installmentStatusLabel: Record<string, string> = {
  paid: 'Pago',
  partial: 'Parcial',
  pending: 'Pendente',
  overdue: 'Atrasado'
}

const paymentMethodLabel: Record<string, string> = {
  pix: 'Pix',
  cash: 'Dinheiro',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  bank_slip: 'Boleto',
  transfer: 'Transferência',
  check: 'Cheque'
}

const PAYMENT_METHOD_OPTIONS: { label: string, value: PaymentMethod }[] = [
  { label: 'Pix', value: 'pix' },
  { label: 'Dinheiro', value: 'cash' },
  { label: 'Cartão de crédito', value: 'credit_card' },
  { label: 'Cartão de débito', value: 'debit_card' },
  { label: 'Boleto', value: 'bank_slip' },
  { label: 'Transferência', value: 'transfer' },
  { label: 'Cheque', value: 'check' }
]

const downPaymentTotal = computed(() =>
  props.installments
    .filter(installment => installment.kind === 'down_payment')
    .reduce((sum, installment) => sum + Number(installment.amount || 0), 0)
)

function installmentLabel(installment: ServiceOrderInstallment) {
  if (installment.kind === 'down_payment') return 'Entrada'
  if (installment.kind === 'extra') return 'Avulso'
  return installment.installment_number ? `Parcela ${installment.installment_number}` : 'Parcela'
}

function remainingBalance(installment: ServiceOrderInstallment) {
  return installment.remaining_amount ?? Number(installment.amount || 0)
}

// ─── Pay (full or partial) ──────────────────────────────────────────────────────

const confirmingInstallment = ref<ServiceOrderInstallment | null>(null)
const payAmount = ref(0)
const payBankAccountId = ref('')
const payPaymentMethod = ref<PaymentMethod>('pix')
const payPaymentTerminalId = ref('')
const payingId = ref<string | null>(null)

const bankAccounts = ref<BankAccountItem[]>([])
const paymentTerminals = ref<PaymentTerminalItem[]>([])
const isLoadingPayOptions = ref(false)
let payOptionsLoaded = false

const showTerminalField = computed(() => ['credit_card', 'debit_card'].includes(payPaymentMethod.value))
const bankAccountOptions = computed(() =>
  bankAccounts.value.map(account => ({
    label: `${account.account_name}${account.bank_name ? ` — ${account.bank_name}` : ''}`,
    value: account.id
  }))
)
const paymentTerminalOptions = computed(() =>
  paymentTerminals.value.map(terminal => ({
    label: `${terminal.terminal_name}${terminal.provider_company ? ` — ${terminal.provider_company}` : ''}`,
    value: terminal.id
  }))
)

async function loadPayOptions() {
  if (payOptionsLoaded) return
  isLoadingPayOptions.value = true
  try {
    const [accountsResponse, terminalsResponse] = await Promise.all([
      $fetch<{ items: BankAccountItem[] }>('/api/bank-accounts', { query: { page_size: 100, is_active: true } }),
      $fetch<{ items: PaymentTerminalItem[] }>('/api/payment-terminals', { query: { page_size: 100 } })
    ])
    bankAccounts.value = accountsResponse.items ?? []
    paymentTerminals.value = terminalsResponse.items ?? []
    payOptionsLoaded = true
  } catch {
    toast.add({ title: 'Erro ao carregar contas e maquininhas', color: 'error' })
  } finally {
    isLoadingPayOptions.value = false
  }
}

function requestPay(installment: ServiceOrderInstallment) {
  confirmingInstallment.value = installment
  payAmount.value = remainingBalance(installment)
  payBankAccountId.value = installment.bank_account_id || ''
  payPaymentMethod.value = (installment.payment_method as PaymentMethod) || 'pix'
  payPaymentTerminalId.value = installment.payment_terminal_id || ''
  loadPayOptions()
}

async function confirmPay() {
  if (!confirmingInstallment.value) return
  const installment = confirmingInstallment.value
  const amount = payAmount.value
  payingId.value = installment.id
  confirmingInstallment.value = null

  try {
    await $fetch(
      `/api/service-orders/${props.orderId}/installments/${installment.id}/pay`,
      {
        method: 'POST',
        body: {
          amount,
          bank_account_id: payBankAccountId.value || undefined,
          payment_method: payPaymentMethod.value || undefined,
          payment_terminal_id: payPaymentTerminalId.value || undefined
        }
      }
    )
    toast.add({ title: 'Pagamento registrado com sucesso', color: 'success' })
    emit('changed')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Erro ao pagar parcela',
      description: err?.data?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    payingId.value = null
  }
}

// ─── Edit a pending line (reschedule / renegotiate) ─────────────────────────────

const editingInstallment = ref<ServiceOrderInstallment | null>(null)
const editDueDate = ref('')
const editAmount = ref(0)
const isSavingEdit = ref(false)

function requestEdit(installment: ServiceOrderInstallment) {
  editingInstallment.value = installment
  editDueDate.value = installment.due_date || ''
  editAmount.value = Number(installment.amount || 0)
}

async function confirmEdit() {
  if (!editingInstallment.value || isSavingEdit.value) return
  isSavingEdit.value = true

  try {
    await $fetch(`/api/service-orders/${props.orderId}/installments/${editingInstallment.value.id}`, {
      method: 'PATCH',
      body: { due_date: editDueDate.value, amount: editAmount.value }
    })
    toast.add({ title: 'Parcela atualizada', color: 'success' })
    editingInstallment.value = null
    emit('changed')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Erro ao atualizar parcela',
      description: err?.data?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isSavingEdit.value = false
  }
}

// ─── Delete a line (any status) — always requires a reason ─────────────────────

const deletingInstallment = ref<ServiceOrderInstallment | null>(null)
const deletionReason = ref('')
const deletionReasonValid = computed(() => deletionReason.value.trim().length > 0)
const isDeletingInstallment = ref(false)

function requestDelete(installment: ServiceOrderInstallment) {
  deletingInstallment.value = installment
  deletionReason.value = ''
}

async function confirmDelete() {
  if (!deletingInstallment.value || isDeletingInstallment.value || !deletionReasonValid.value) return
  isDeletingInstallment.value = true

  try {
    await $fetch(`/api/service-orders/${props.orderId}/installments/${deletingInstallment.value.id}`, {
      method: 'DELETE',
      body: { reason: deletionReason.value.trim() }
    })
    toast.add({ title: 'Parcela excluída', color: 'success' })
    deletingInstallment.value = null
    deletionReason.value = ''
    emit('changed')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Erro ao excluir parcela',
      description: err?.data?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isDeletingInstallment.value = false
  }
}

// ─── Undo a specific receipt ─────────────────────────────────────────────────────

const expandedInstallmentId = ref<string | null>(null)
const undoingReceipt = ref<{ installment: ServiceOrderInstallment, receipt: ServiceOrderInstallmentReceipt } | null>(null)
const isUndoingReceipt = ref(false)

function toggleReceipts(installment: ServiceOrderInstallment) {
  expandedInstallmentId.value = expandedInstallmentId.value === installment.id ? null : installment.id
}

function requestUndoReceipt(installment: ServiceOrderInstallment, receipt: ServiceOrderInstallmentReceipt) {
  undoingReceipt.value = { installment, receipt }
}

async function confirmUndoReceipt() {
  if (!undoingReceipt.value || isUndoingReceipt.value) return
  const { receipt } = undoingReceipt.value
  isUndoingReceipt.value = true

  try {
    await $fetch(`/api/service-orders/${props.orderId}/financial-transactions/${receipt.id}`, {
      method: 'DELETE'
    })
    toast.add({ title: 'Recebimento cancelado', color: 'success' })
    undoingReceipt.value = null
    emit('changed')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Erro ao cancelar recebimento',
      description: err?.data?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isUndoingReceipt.value = false
  }
}
</script>

<template>
  <UCard v-if="installments.length" variant="subtle">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-credit-card" class="size-4 text-primary" />
        <h3 class="font-semibold text-highlighted">
          Parcelas ({{ installments.length }})
        </h3>
      </div>
    </template>

    <div
      v-if="downPaymentTotal > 0"
      class="mb-3 flex items-center gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-sm"
    >
      <UIcon name="i-lucide-hand-coins" class="size-4 shrink-0 text-info" />
      <span class="text-muted">Adiantamento recebido: <strong class="text-highlighted">{{ formatCurrency(downPaymentTotal) }}</strong></span>
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="installment in installments"
        :key="installment.id"
        class="rounded-lg border p-3"
        :class="
          installment.status === 'paid'
            ? 'border-success/30 bg-success/5'
            : installment.status === 'overdue'
              ? 'border-error/30 bg-error/5'
              : installment.status === 'partial'
                ? 'border-info/30 bg-info/5'
                : 'border-default bg-elevated'
        "
      >
        <div class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
            <UIcon :name="installment.kind === 'down_payment' ? 'i-lucide-hand-coins' : 'i-lucide-hash'" class="size-3.5" />
            {{ installmentLabel(installment) }}
          </span>
          <UBadge
            :color="installmentStatusColor[installment.status] ?? 'neutral'"
            :label="
              installmentStatusLabel[installment.status] ?? installment.status
            "
            variant="soft"
            size="xs"
          />
        </div>

        <div class="mt-2 flex items-center justify-between gap-2">
          <span class="font-semibold text-highlighted">
            {{ formatCurrency(installment.amount) }}
          </span>
        </div>

        <p v-if="installment.status === 'partial'" class="mt-1 text-xs text-info">
          Recebido {{ formatCurrency(installment.received_amount ?? 0) }} — falta {{ formatCurrency(remainingBalance(installment)) }}
        </p>

        <div class="mt-2 grid grid-cols-2">
          <div class="space-y-1 text-xs text-muted">
            <p>Venc.: {{ formatDate(installment.due_date) }}</p>
            <p v-if="installment.payment_date">
              Pago: {{ formatDate(installment.payment_date) }}
            </p>
          </div>

          <div
            v-if="canUpdate && installment.status !== 'paid'"
            class="mt-3 flex items-center justify-end"
          >
            <UButton
              size="xs"
              color="success"
              variant="soft"
              icon="i-lucide-check"
              :label="installment.status === 'partial' ? 'Receber restante' : 'Pagar'"
              :loading="payingId === installment.id"
              :disabled="!!payingId"
              @click="requestPay(installment)"
            />
          </div>
        </div>

        <!-- Pending lines can be rescheduled/renegotiated; any line can be deleted -->
        <div v-if="(canUpdate && installment.status === 'pending') || canDeleteInstallment" class="mt-2 flex items-center justify-end gap-1">
          <UTooltip v-if="canUpdate && installment.status === 'pending'" text="Editar vencimento/valor">
            <UButton
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="requestEdit(installment)"
            />
          </UTooltip>
          <UTooltip v-if="canDeleteInstallment" text="Excluir parcela">
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              @click="requestDelete(installment)"
            />
          </UTooltip>
        </div>

        <!-- Receipts already settled against this line, each cancellable on its own -->
        <div v-if="installment.receipts?.length" class="mt-2">
          <button
            type="button"
            class="text-xs text-muted underline-offset-2 hover:underline"
            @click="toggleReceipts(installment)"
          >
            {{ expandedInstallmentId === installment.id ? 'Ocultar' : 'Ver' }} recebimentos ({{ installment.receipts.length }})
          </button>

          <div v-if="expandedInstallmentId === installment.id" class="mt-2 space-y-1.5">
            <div
              v-for="receipt in installment.receipts"
              :key="receipt.id"
              class="flex items-center justify-between gap-2 rounded border border-default bg-default px-2 py-1.5 text-xs"
            >
              <div class="min-w-0">
                <p class="font-medium text-highlighted">
                  {{ formatCurrency(receipt.amount) }}
                </p>
                <p class="text-muted">
                  {{ formatDate(receipt.due_date) }} · {{ paymentMethodLabel[receipt.payment_method || ''] || receipt.payment_method || '—' }}
                </p>
              </div>
              <UTooltip v-if="canUpdate" text="Desfazer este recebimento">
                <UButton
                  icon="i-lucide-undo-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  @click="requestUndoReceipt(installment, receipt)"
                />
              </UTooltip>
            </div>
          </div>
        </div>
      </div>
    </div>
  </UCard>

  <!-- Pay (full or partial) -->
  <AppConfirmModal
    :open="!!confirmingInstallment"
    title="Confirmar pagamento"
    confirm-label="Confirmar"
    confirm-color="success"
    :loading="!!payingId"
    @update:open="confirmingInstallment = null"
    @confirm="confirmPay"
  >
    <template #description>
      <div v-if="confirmingInstallment" class="space-y-3">
        <p class="text-sm text-muted">
          Saldo restante desta linha: <strong class="text-highlighted">{{ formatCurrency(remainingBalance(confirmingInstallment)) }}</strong>.
          Informe quanto está sendo recebido agora — pode ser menos que o saldo, e o restante fica pendente pra depois.
        </p>

        <UFormField label="Valor recebido agora">
          <UiCurrencyInput v-model="payAmount" class="w-full" />
        </UFormField>

        <div v-if="isLoadingPayOptions" class="flex items-center gap-2 text-xs text-muted">
          <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
          Carregando contas e maquininhas...
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UFormField label="Conta bancária">
            <USelectMenu
              v-model="payBankAccountId"
              :items="bankAccountOptions"
              value-key="value"
              placeholder="Conta bancária"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Forma de pagamento">
            <USelectMenu
              v-model="payPaymentMethod"
              :items="PAYMENT_METHOD_OPTIONS"
              value-key="value"
              label-key="label"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField v-if="showTerminalField" label="Maquininha">
          <USelectMenu
            v-model="payPaymentTerminalId"
            :items="paymentTerminalOptions"
            value-key="value"
            placeholder="Selecionar maquininha"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>
  </AppConfirmModal>

  <!-- Edit a pending line -->
  <AppConfirmModal
    :open="!!editingInstallment"
    title="Editar parcela"
    confirm-label="Salvar"
    confirm-color="primary"
    :loading="isSavingEdit"
    @update:open="editingInstallment = null"
    @confirm="confirmEdit"
  >
    <template #description>
      <div v-if="editingInstallment" class="space-y-3">
        <p class="text-sm text-muted">
          Só dá pra editar enquanto a parcela ainda não recebeu nenhum pagamento.
        </p>
        <UFormField label="Vencimento">
          <UiDatePicker v-model="editDueDate" class="w-full" />
        </UFormField>
        <UFormField label="Valor esperado">
          <UiCurrencyInput v-model="editAmount" class="w-full" />
        </UFormField>
      </div>
    </template>
  </AppConfirmModal>

  <!-- Delete a line (any status) — reason always required -->
  <AppConfirmModal
    :open="!!deletingInstallment"
    title="Excluir parcela"
    confirm-label="Excluir parcela"
    confirm-color="error"
    :loading="isDeletingInstallment"
    :confirm-disabled="!deletionReasonValid"
    @update:open="(v) => { if (!v && !isDeletingInstallment) { deletingInstallment = null; deletionReason = '' } }"
    @confirm="confirmDelete"
  >
    <template #description>
      <div v-if="deletingInstallment" class="space-y-3">
        <p class="text-sm text-muted">
          <template v-if="deletingInstallment.status === 'paid' || deletingInstallment.status === 'partial'">
            Isso reverte o(s) recebimento(s) ligados a esta parcela (o valor volta pro saldo da conta bancária) e remove a linha do plano de pagamento.
          </template>
          <template v-else>
            Remove esta linha do plano de pagamento.
          </template>
          Não pode ser desfeito.
        </p>
        <UFormField label="Motivo da exclusão" required>
          <UTextarea v-model="deletionReason" class="w-full" :rows="2" />
        </UFormField>
      </div>
    </template>
  </AppConfirmModal>

  <!-- Undo a specific receipt -->
  <AppConfirmModal
    :open="!!undoingReceipt"
    title="Cancelar recebimento"
    confirm-label="Cancelar recebimento"
    confirm-color="error"
    :loading="isUndoingReceipt"
    @update:open="undoingReceipt = null"
    @confirm="confirmUndoReceipt"
  >
    <template #description>
      <p v-if="undoingReceipt" class="text-sm text-muted">
        Desfaz o recebimento de <strong class="text-highlighted">{{ formatCurrency(undoingReceipt.receipt.amount) }}</strong> e devolve o valor pro saldo da conta bancária. Os outros recebimentos desta OS não são afetados.
      </p>
    </template>
  </AppConfirmModal>
</template>
