<script setup lang="ts">
import type { BankAccount } from '~/types/financial'
import { ActionCode } from '~/constants/action-codes'

const props = defineProps<{
  open: boolean
  account: BankAccount | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const toast = useToast()
const workshop = useWorkshopPermissions()
const isSaving = ref(false)

const isEditing = computed(() => !!props.account?.id)
// Criar exige bank_accounts.create; editar exige bank_accounts.update.
const canSave = computed(() =>
  workshop.can(isEditing.value ? ActionCode.BANK_ACCOUNTS_UPDATE : ActionCode.BANK_ACCOUNTS_CREATE)
)

const form = reactive({
  account_name: '',
  account_type: 'checking' as string,
  bank_name: '',
  branch: '',
  account_number: '',
  initial_balance: '' as string | number,
  preferred_payment_method: '',
  is_active: true,
  notes: ''
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    if (props.account) {
      Object.assign(form, {
        account_name: props.account.account_name ?? '',
        account_type: props.account.account_type ?? 'checking',
        bank_name: props.account.bank_name ?? '',
        branch: props.account.branch ?? '',
        account_number: props.account.account_number ?? '',
        initial_balance: props.account.initial_balance ?? '',
        preferred_payment_method: props.account.preferred_payment_method ?? '',
        is_active: props.account.is_active ?? true,
        notes: props.account.notes ?? ''
      })
    } else {
      Object.assign(form, {
        account_name: '',
        account_type: 'checking',
        bank_name: '',
        branch: '',
        account_number: '',
        initial_balance: '',
        preferred_payment_method: '',
        is_active: true,
        notes: ''
      })
    }
  },
  { immediate: true }
)

async function save() {
  if (isSaving.value || !canSave.value) return
  if (!form.account_name.trim()) {
    toast.add({ title: 'Nome da conta é obrigatório', color: 'warning' })
    return
  }
  isSaving.value = true
  try {
    const body = {
      account_name: form.account_name.trim(),
      account_type: form.account_type || null,
      bank_name: form.bank_name || null,
      branch: form.branch || null,
      account_number: form.account_number || null,
      initial_balance: form.initial_balance !== '' ? Number(form.initial_balance) : null,
      preferred_payment_method: form.preferred_payment_method || null,
      is_active: form.is_active,
      notes: form.notes || null
    }
    if (isEditing.value) {
      await $fetch(`/api/bank-accounts/${props.account!.id}`, { method: 'PUT', body })
      toast.add({ title: 'Conta atualizada', color: 'success' })
    } else {
      await $fetch('/api/bank-accounts', { method: 'POST', body })
      toast.add({ title: 'Conta criada', color: 'success' })
    }
    emit('update:open', false)
    emit('saved')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível salvar', color: 'error' })
  } finally {
    isSaving.value = false
  }
}

const accountTypeOptions = [
  { label: 'Conta corrente', value: 'checking' },
  { label: 'Poupança', value: 'savings' },
  { label: 'Caixa', value: 'cash' },
  { label: 'Investimento', value: 'investment' },
  { label: 'Outro', value: 'other' }
]
</script>

<template>
  <UModal
    :open="open"
    :title="isEditing ? 'Editar conta' : 'Nova conta bancária'"
    :ui="{ body: 'overflow-y-auto max-h-[70vh]' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Nome da conta" required>
          <UInput v-model="form.account_name" class="w-full" placeholder="Ex: Conta Principal Bradesco" />
        </UFormField>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="Tipo de conta">
            <USelectMenu
              v-model="form.account_type"
              :items="accountTypeOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Banco">
            <UInput v-model="form.bank_name" class="w-full" placeholder="Ex: Bradesco, Itaú" />
          </UFormField>
          <UFormField label="Agência">
            <UInput v-model="form.branch" class="w-full" />
          </UFormField>
          <UFormField label="Número da conta">
            <UInput v-model="form.account_number" class="w-full" />
          </UFormField>
          <UFormField label="Saldo inicial">
            <UInput
              v-model="form.initial_balance"
              type="number"
              min="0"
              step="0.01"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Forma de pagamento preferencial">
            <UInput v-model="form.preferred_payment_method" class="w-full" placeholder="Ex: PIX, TED" />
          </UFormField>
        </div>

        <UFormField label="Observações">
          <UTextarea v-model="form.notes" class="w-full" :rows="3" />
        </UFormField>

        <UCheckbox v-model="form.is_active" label="Conta ativa" />
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="Cancelar"
          color="neutral"
          variant="ghost"
          @click="emit('update:open', false)"
        />
        <UButton
          v-if="canSave"
          label="Salvar"
          color="neutral"
          :loading="isSaving"
          :disabled="isSaving"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
