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

const props = defineProps<{
  open: boolean
  order: ServiceOrder | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'received': []
}>()

const toast = useToast()
const isSaving = ref(false)
const isLoadingOptions = ref(false)
const bankAccounts = ref<BankAccountItem[]>([])
const paymentTerminals = ref<PaymentTerminalItem[]>([])

const PAYMENT_METHOD_OPTIONS: PaymentMethodOption[] = [
  { label: 'Pix', value: 'pix', icon: 'i-lucide-qr-code' },
  { label: 'Dinheiro', value: 'cash', icon: 'i-lucide-banknote' },
  { label: 'Cartão de crédito', value: 'credit_card', icon: 'i-lucide-credit-card' },
  { label: 'Cartão de débito', value: 'debit_card', icon: 'i-lucide-credit-card' },
  { label: 'Boleto', value: 'bank_slip', icon: 'i-lucide-file-text' },
  { label: 'Transferência', value: 'transfer', icon: 'i-lucide-arrow-right-left' },
  { label: 'Cheque', value: 'check', icon: 'i-lucide-scroll-text' }
]

const today = () => new Date().toISOString().split('T')[0]

const form = reactive({
  amount: 0,
  paymentDate: today(),
  paymentMethod: 'pix' as PaymentMethod,
  bankAccountId: '',
  paymentTerminalId: ''
})

const showTerminalField = computed(() => ['credit_card', 'debit_card'].includes(form.paymentMethod))
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
  form.amount = 0
  form.paymentDate = today()
  form.paymentMethod = 'pix'
  form.bankAccountId = ''
  form.paymentTerminalId = ''
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
  await loadReferenceData()
})

watch(() => form.paymentMethod, () => {
  if (!showTerminalField.value)
    form.paymentTerminalId = ''
})

async function save() {
  if (!props.order || isSaving.value) return
  if (!form.bankAccountId) {
    toast.add({ title: 'Selecione a conta bancária', color: 'warning' })
    return
  }
  if (!form.amount || form.amount <= 0) {
    toast.add({ title: 'Informe um valor de sinal maior que zero', color: 'warning' })
    return
  }

  isSaving.value = true
  try {
    await $fetch(`/api/service-orders/${props.order.id}/down-payment`, {
      method: 'POST',
      body: {
        amount: form.amount,
        paymentDate: form.paymentDate,
        paymentMethod: form.paymentMethod,
        bankAccountId: form.bankAccountId,
        paymentTerminalId: form.paymentTerminalId || null
      }
    })
    toast.add({ title: 'Sinal registrado com sucesso', color: 'success' })
    emit('update:open', false)
    emit('received')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao registrar sinal',
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
    title="Receber sinal"
    :description="order ? `#${order.number}` : ''"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          Registra um adiantamento recebido agora, antes da OS estar concluída. O saldo final é calculado automaticamente quando o pagamento for processado.
        </p>

        <div v-if="isLoadingOptions" class="flex items-center gap-2 rounded-xl border border-default px-4 py-3 text-sm text-muted">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
          Carregando contas e maquininhas...
        </div>

        <UFormField label="Valor do sinal" required>
          <UiCurrencyInput v-model="form.amount" class="w-full" />
        </UFormField>

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

          <UFormField label="Data do recebimento" required>
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
          label="Registrar sinal"
          color="success"
          :loading="isSaving"
          :disabled="isSaving || isLoadingOptions"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
