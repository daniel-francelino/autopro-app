<script setup lang="ts">
import type { ServiceOrder } from '~/types/service-orders'

type PaymentMethod = 'pix' | 'cash' | 'credit_card' | 'debit_card' | 'bank_slip' | 'transfer' | 'check'
type PaymentMethodOption = { label: string, value: PaymentMethod, icon: string }
type BankAccountItem = {
  id: string
  account_name: string
  bank_name: string | null
  preferred_payment_method: string | null
}
type PaymentTerminalItem = {
  id: string
  terminal_name: string
  provider_company: string | null
}
type InstallmentStatus = 'paid' | 'pending'
type PlanRowKind = 'down_payment' | 'installment'
type PlanRow = {
  kind: PlanRowKind
  number: number
  amount: number
  due_date: string
  status: InstallmentStatus
  paymentMethod: PaymentMethod
  bankAccountId: string
  paymentTerminalId: string
}

const props = defineProps<{
  open: boolean
  order: ServiceOrder | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'paid': []
}>()

type DetailInstallment = { kind: string, amount: number | string | null }

const toast = useToast()
const isSaving = ref(false)
const isLoadingOptions = ref(false)
const bankAccounts = ref<BankAccountItem[]>([])
const paymentTerminals = ref<PaymentTerminalItem[]>([])
const priorDownPaymentsTotal = ref(0)

const PAYMENT_METHOD_OPTIONS: PaymentMethodOption[] = [
  { label: 'Pix', value: 'pix', icon: 'i-lucide-qr-code' },
  { label: 'Dinheiro', value: 'cash', icon: 'i-lucide-banknote' },
  { label: 'Cartão de crédito', value: 'credit_card', icon: 'i-lucide-credit-card' },
  { label: 'Cartão de débito', value: 'debit_card', icon: 'i-lucide-credit-card' },
  { label: 'Boleto', value: 'bank_slip', icon: 'i-lucide-file-text' },
  { label: 'Transferência', value: 'transfer', icon: 'i-lucide-arrow-right-left' },
  { label: 'Cheque', value: 'check', icon: 'i-lucide-scroll-text' }
]
const INSTALLMENT_STATUS_OPTIONS = [
  { label: 'Pago', value: 'paid' },
  { label: 'Pendente', value: 'pending' }
] as const
const INSTALLMENT_COUNT_OPTIONS = Array.from({ length: 12 }, (_, index) => {
  const value = index + 1
  return { label: value === 1 ? '1 parcela' : `${value} parcelas`, value }
})

const today = () => new Date().toISOString().split('T')[0]

const form = reactive({
  paymentDate: today(),
  hasDownPayment: false,
  downPaymentAmount: 0,
  installmentCount: 1,
  // Defaults applied when rows are (re)generated — each row can still be
  // overridden individually afterwards.
  paymentMethod: 'pix' as PaymentMethod,
  bankAccountId: '',
  paymentTerminalId: ''
})

const rows = ref<PlanRow[]>([])

const orderTotalAmount = computed(() => Number(props.order?.total_amount || 0))
// Down payments (sinal) received before the order was completed are netted
// out here. The total can still have changed since then, so this can be
// zero (sinal already covers everything) or even negative (scope shrank —
// handled as its own blocking state, see balanceDueIsNegative).
const balanceDue = computed(() => Number((orderTotalAmount.value - priorDownPaymentsTotal.value).toFixed(2)))
const balanceDueIsNegative = computed(() => balanceDue.value < -0.01)
const balanceDueIsSettled = computed(() => !balanceDueIsNegative.value && balanceDue.value <= 0.01)
const downPaymentAmountEffective = computed(() =>
  form.hasDownPayment ? Math.max(0, Number(form.downPaymentAmount || 0)) : 0
)
const remainingAmount = computed(() =>
  Math.max(0, Number((balanceDue.value - downPaymentAmountEffective.value).toFixed(2)))
)
const selectedBankAccount = computed(() =>
  bankAccounts.value.find(account => account.id === form.bankAccountId) ?? null
)
const showTerminalField = computed(() => ['credit_card', 'debit_card'].includes(form.paymentMethod))
const rowsTotal = computed(() => rows.value.reduce((total, row) => total + Number(row.amount || 0), 0))
const rowsMatch = computed(() => Math.abs(rowsTotal.value - balanceDue.value) < 0.01)
const paidRowsCount = computed(() => rows.value.filter(row => row.status === 'paid').length)
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
const conditionLabel = computed(() => {
  const parts: string[] = []
  if (downPaymentAmountEffective.value > 0) parts.push(`Entrada de ${formatCurrency(downPaymentAmountEffective.value)}`)
  if (remainingAmount.value > 0) {
    parts.push(form.installmentCount > 1 ? `${form.installmentCount}x o restante` : 'restante à vista')
  }
  return parts.length > 0 ? parts.join(' + ') : '—'
})

function rowShowsTerminal(row: PlanRow) {
  return ['credit_card', 'debit_card'].includes(row.paymentMethod)
}

function addMonthsToDate(value: string, months: number) {
  const baseDate = new Date(`${value}T00:00:00`)
  baseDate.setMonth(baseDate.getMonth() + months)
  return baseDate.toISOString().split('T')[0]
}

function distributeInstallments(count: number, totalAmount: number, paymentDate: string, firstPaid: boolean) {
  if (!count || count < 1 || totalAmount <= 0) return []

  const baseAmount = Math.floor((totalAmount / count) * 100) / 100
  const generated = Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    amount: baseAmount,
    due_date: addMonthsToDate(paymentDate, index),
    status: (firstPaid && index === 0 ? 'paid' : 'pending') as InstallmentStatus
  }))
  const difference = Number((totalAmount - (baseAmount * count)).toFixed(2))

  if (generated.length > 0) {
    generated[0].amount = Number((generated[0].amount + difference).toFixed(2))
  }

  return generated
}

function rebuildRows() {
  const defaults = {
    paymentMethod: form.paymentMethod,
    bankAccountId: form.bankAccountId,
    paymentTerminalId: form.paymentTerminalId
  }

  const next: PlanRow[] = []

  if (form.hasDownPayment && downPaymentAmountEffective.value > 0) {
    next.push({
      kind: 'down_payment',
      number: 1,
      amount: downPaymentAmountEffective.value,
      due_date: form.paymentDate,
      status: 'paid',
      ...defaults
    })
  }

  const remainder = remainingAmount.value
  if (remainder > 0) {
    const count = Math.max(1, form.installmentCount)
    // If there's already a down payment received today, the remainder is
    // entirely future installments — none of them are paid yet. Without a
    // down payment, the first one is paid now (mirrors registering a
    // same-day cash/à-vista payment).
    const firstPaid = downPaymentAmountEffective.value === 0
    const generated = distributeInstallments(count, remainder, form.paymentDate, firstPaid)
    generated.forEach((installment) => {
      next.push({ kind: 'installment', ...installment, ...defaults })
    })
  }

  rows.value = next
}

function normalizePaymentMethod(value: string | null | undefined): PaymentMethod | null {
  if (!value) return null

  const normalized = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')

  const aliasMap: Record<string, PaymentMethod> = {
    pix: 'pix',
    cash: 'cash',
    dinheiro: 'cash',
    credit_card: 'credit_card',
    cartao_credito: 'credit_card',
    debit_card: 'debit_card',
    cartao_debito: 'debit_card',
    bank_slip: 'bank_slip',
    boleto: 'bank_slip',
    transfer: 'transfer',
    transferencia: 'transfer',
    check: 'check',
    cheque: 'check'
  }

  return aliasMap[normalized] ?? null
}

function resetForm() {
  form.paymentDate = today()
  form.hasDownPayment = false
  form.downPaymentAmount = 0
  form.installmentCount = 1
  form.paymentMethod = 'pix'
  form.bankAccountId = ''
  form.paymentTerminalId = ''
  rebuildRows()
}

async function loadPriorDownPayments() {
  if (!props.order) return

  try {
    const res = await $fetch<{ data: { installments: DetailInstallment[] } }>(`/api/service-orders/${props.order.id}`)
    priorDownPaymentsTotal.value = (res.data.installments || [])
      .filter(installment => installment.kind === 'down_payment')
      .reduce((sum, installment) => sum + Number(installment.amount || 0), 0)
  } catch {
    priorDownPaymentsTotal.value = 0
  }
}

async function loadReferenceData() {
  isLoadingOptions.value = true
  try {
    const [accountsResponse, terminalsResponse] = await Promise.all([
      $fetch<{ items: BankAccountItem[] }>('/api/bank-accounts', {
        query: { page_size: 100, is_active: true }
      }),
      $fetch<{ items: PaymentTerminalItem[] }>('/api/payment-terminals', {
        query: { page_size: 100 }
      })
    ])

    bankAccounts.value = accountsResponse.items ?? []
    paymentTerminals.value = terminalsResponse.items ?? []

    const defaultAccount = bankAccounts.value[0] ?? null
    form.bankAccountId = defaultAccount?.id ?? ''

    const preferredPaymentMethod = normalizePaymentMethod(defaultAccount?.preferred_payment_method)
    if (preferredPaymentMethod)
      form.paymentMethod = preferredPaymentMethod
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao carregar dados do pagamento',
      description: err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isLoadingOptions.value = false
  }
}

watch(() => props.open, async (open) => {
  if (!open) return

  resetForm()
  priorDownPaymentsTotal.value = 0
  await Promise.all([loadReferenceData(), loadPriorDownPayments()])
  rebuildRows()
})

watch(() => form.paymentDate, rebuildRows)
watch(() => form.hasDownPayment, rebuildRows)
watch(() => form.downPaymentAmount, rebuildRows)
watch(() => form.installmentCount, rebuildRows)

watch(() => form.paymentMethod, () => {
  if (!showTerminalField.value)
    form.paymentTerminalId = ''
})

watch(() => form.bankAccountId, (bankAccountId, previousId) => {
  if (!bankAccountId || bankAccountId === previousId) return

  const preferredPaymentMethod = normalizePaymentMethod(selectedBankAccount.value?.preferred_payment_method)
  if (preferredPaymentMethod)
    form.paymentMethod = preferredPaymentMethod
})

function formatCurrency(value: number | string | null | undefined) {
  return parseFloat(String(value || 0)).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })
}

async function save() {
  if (!props.order || isSaving.value) return

  if (balanceDueIsNegative.value) {
    toast.add({ title: 'O adiantamento recebido é maior que o valor final da OS', description: 'Cancele o pagamento registrado e devolva a diferença ao cliente antes de continuar.', color: 'error' })
    return
  }

  if (!balanceDueIsSettled.value) {
    if (rows.value.length === 0) {
      toast.add({ title: 'Defina ao menos uma forma de receber o pagamento', color: 'warning' })
      return
    }
    if (rows.value.some(row => !row.bankAccountId)) {
      toast.add({ title: 'Selecione a conta bancária em todas as linhas', color: 'warning' })
      return
    }
    if (!rowsMatch.value) {
      toast.add({ title: 'O total das linhas precisa bater com o saldo restante da OS', color: 'warning' })
      return
    }
  }

  isSaving.value = true
  try {
    const body = balanceDueIsSettled.value
      ? {}
      : {
          paymentMethod: form.paymentMethod,
          paymentDate: form.paymentDate,
          bankAccountId: form.bankAccountId,
          paymentTerminalId: form.paymentTerminalId || null,
          installments: rows.value.map(row => ({
            kind: row.kind,
            amount: Number(row.amount || 0),
            due_date: row.due_date,
            status: row.status,
            payment_method: row.paymentMethod,
            bank_account_id: row.bankAccountId,
            payment_terminal_id: row.paymentTerminalId || null
          }))
        }

    await $fetch(`/api/service-orders/${props.order.id}/process-payment`, {
      method: 'POST',
      body
    })
    toast.add({ title: 'Pagamento registrado com sucesso', color: 'success' })
    emit('update:open', false)
    emit('paid')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao registrar pagamento',
      description: err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Processar pagamento"
    :description="order ? `#${order.number}` : ''"
    :ui="{ content: 'sm:max-w-5xl lg:max-w-6xl', body: 'overflow-y-auto max-h-[82vh]' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-5">
        <div class="rounded-2xl border border-success/20 bg-gradient-to-br from-success/10 via-success/5 to-transparent p-4">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div class="space-y-1">
              <div class="flex items-center gap-2 text-sm font-medium text-success">
                <UIcon name="i-lucide-wallet-cards" class="size-4" />
                Configuração do Pagamento
              </div>
              <p class="text-xl font-semibold text-highlighted">
                {{ formatCurrency(order?.total_amount) }}
              </p>
              <p class="text-sm text-muted">
                {{ order?.client_name || 'Cliente não informado' }}
              </p>
            </div>

            <div class="grid grid-cols-1 gap-2 text-xs sm:min-w-[220px]">
              <div v-if="priorDownPaymentsTotal > 0" class="rounded-xl border border-default bg-default px-3 py-2">
                <p class="text-[11px] uppercase tracking-wide text-muted">
                  Adiantamento já recebido
                </p>
                <p class="mt-1 font-medium text-highlighted">
                  {{ formatCurrency(priorDownPaymentsTotal) }}
                </p>
              </div>
              <div class="rounded-xl border border-default bg-default px-3 py-2">
                <p class="text-[11px] uppercase tracking-wide text-muted">
                  {{ priorDownPaymentsTotal > 0 ? 'Saldo a receber' : 'Condição' }}
                </p>
                <p class="mt-1 font-medium text-highlighted">
                  {{ priorDownPaymentsTotal > 0 ? formatCurrency(balanceDue) : conditionLabel }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div v-if="balanceDueIsNegative" class="rounded-xl border border-error/30 bg-error/5 p-4 text-sm text-error">
          <p class="font-medium">
            O adiantamento recebido ({{ formatCurrency(priorDownPaymentsTotal) }}) é maior que o valor final da OS ({{ formatCurrency(orderTotalAmount) }}).
          </p>
          <p class="mt-1">
            Cancele o pagamento registrado nesta OS e devolva a diferença ao cliente antes de continuar.
          </p>
        </div>

        <div v-else-if="balanceDueIsSettled" class="rounded-xl border border-success/30 bg-success/5 p-4 text-sm text-success">
          O adiantamento já recebido cobre o valor total da OS. Confirme para concluir o pagamento — nenhum valor adicional será cobrado.
        </div>

        <template v-else>
          <div v-if="isLoadingOptions" class="flex items-center gap-2 rounded-xl border border-default px-4 py-3 text-sm text-muted">
            <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
            Carregando contas e maquininhas...
          </div>

          <div class="rounded-xl border border-default p-4 space-y-4">
            <p class="text-sm font-medium text-highlighted">
              Valores padrão das linhas
            </p>
            <p class="text-xs text-muted">
              Usados ao gerar a entrada e as parcelas — cada linha pode ser ajustada individualmente depois.
            </p>

            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <UFormField label="Conta bancária" required>
                <USelectMenu
                  v-model="form.bankAccountId"
                  :items="bankAccountOptions"
                  value-key="value"
                  placeholder="Selecione a conta bancária"
                  class="w-full"
                />
              </UFormField>

              <UFormField label="Data do pagamento" required>
                <UiDatePicker v-model="form.paymentDate" class="w-full" />
              </UFormField>
            </div>

            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <UFormField label="Forma de pagamento" required>
                <USelectMenu
                  v-model="form.paymentMethod"
                  :items="PAYMENT_METHOD_OPTIONS"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                />
              </UFormField>

              <UFormField v-if="showTerminalField" label="Maquininha">
                <USelectMenu
                  v-model="form.paymentTerminalId"
                  :items="paymentTerminalOptions"
                  value-key="value"
                  placeholder="Selecionar maquininha"
                  class="w-full"
                />
              </UFormField>
            </div>
          </div>

          <div class="rounded-xl border border-default p-4 space-y-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p class="text-sm font-medium text-highlighted">
                  Entrada
                </p>
                <p class="text-xs text-muted">
                  Valor recebido agora, antes de parcelar o restante.
                </p>
              </div>
              <USwitch v-model="form.hasDownPayment" label="Receber entrada" />
            </div>

            <UFormField v-if="form.hasDownPayment" label="Valor da entrada" required>
              <UiCurrencyInput v-model="form.downPaymentAmount" class="w-full" />
            </UFormField>
          </div>

          <div v-if="remainingAmount > 0" class="rounded-xl border border-default p-4 space-y-4">
            <div>
              <p class="text-sm font-medium text-highlighted">
                Parcelamento do restante
              </p>
              <p class="text-xs text-muted">
                {{ formatCurrency(remainingAmount) }} a dividir.
              </p>
            </div>

            <UFormField label="Número de parcelas" required>
              <USelectMenu
                v-model="form.installmentCount"
                :items="INSTALLMENT_COUNT_OPTIONS"
                value-key="value"
                class="w-full max-w-xs"
              />
            </UFormField>
          </div>

          <div class="rounded-xl border border-default p-4 space-y-4">
            <div
              class="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm"
              :class="rowsMatch ? 'border-success/30 bg-success/5' : 'border-error/30 bg-error/5'"
            >
              <div class="flex flex-wrap items-center gap-4">
                <span class="text-muted">Saldo a receber: <strong class="text-highlighted">{{ formatCurrency(balanceDue) }}</strong></span>
                <span class="text-muted">Total das linhas: <strong :class="rowsMatch ? 'text-success' : 'text-error'">{{ formatCurrency(rowsTotal) }}</strong></span>
                <span class="text-muted">Pago agora: <strong class="text-highlighted">{{ paidRowsCount }}</strong></span>
              </div>
              <UIcon
                :name="rowsMatch ? 'i-lucide-circle-check-big' : 'i-lucide-circle-alert'"
                class="size-4 shrink-0"
                :class="rowsMatch ? 'text-success' : 'text-error'"
              />
            </div>

            <div class="space-y-2">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Linhas do plano de pagamento
              </p>
              <div class="overflow-hidden rounded-xl border border-default">
                <div
                  v-for="row in rows"
                  :key="`${row.kind}-${row.number}`"
                  class="space-y-2 border-b border-default p-3 last:border-b-0"
                >
                  <div class="grid grid-cols-1 gap-2 md:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_140px]">
                    <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
                      <UIcon :name="row.kind === 'down_payment' ? 'i-lucide-hand-coins' : 'i-lucide-hash'" class="size-4 text-primary" />
                      {{ row.kind === 'down_payment' ? 'Entrada' : `${row.number}ª parcela` }}
                    </div>

                    <UiCurrencyInput v-model="row.amount" class="w-full" />

                    <UiDatePicker v-model="row.due_date" class="w-full" />

                    <USelectMenu
                      v-if="row.kind === 'installment'"
                      v-model="row.status"
                      :items="INSTALLMENT_STATUS_OPTIONS"
                      value-key="value"
                      class="w-full"
                    />
                  </div>

                  <div class="grid grid-cols-1 gap-2 md:grid-cols-3">
                    <USelectMenu
                      v-model="row.paymentMethod"
                      :items="PAYMENT_METHOD_OPTIONS"
                      value-key="value"
                      label-key="label"
                      class="w-full"
                    />
                    <USelectMenu
                      v-model="row.bankAccountId"
                      :items="bankAccountOptions"
                      value-key="value"
                      placeholder="Conta bancária"
                      class="w-full"
                    />
                    <USelectMenu
                      v-if="rowShowsTerminal(row)"
                      v-model="row.paymentTerminalId"
                      :items="paymentTerminalOptions"
                      value-key="value"
                      placeholder="Maquininha"
                      class="w-full"
                    />
                  </div>
                </div>
                <p v-if="rows.length === 0" class="p-4 text-sm text-muted">
                  Defina uma entrada ou um número de parcelas para montar o plano de pagamento.
                </p>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="Cancelar"
          color="neutral"
          variant="ghost"
          :disabled="isSaving"
          @click="emit('update:open', false)"
        />
        <UButton
          :label="balanceDueIsSettled ? 'Confirmar' : 'Registrar pagamento'"
          color="success"
          :loading="isSaving"
          :disabled="isSaving || isLoadingOptions || balanceDueIsNegative"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
