<script setup lang="ts">
defineProps<{ open: boolean }>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': [id: string]
}>()

const toast = useToast()
const isSaving = ref(false)

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const form = reactive({
  name: '',
  commissionBase: 'revenue' as 'revenue' | 'profit',
  goalAmount: '' as number | string,
  bonusAmount: '' as number | string,
  effectiveMonth: currentMonthValue() as string | undefined
})

function resetForm() {
  form.name = ''
  form.commissionBase = 'revenue'
  form.goalAmount = ''
  form.bonusAmount = ''
  form.effectiveMonth = currentMonthValue()
}

const commissionBaseOptions = [
  { label: 'Faturamento (valor bruto)', value: 'revenue' },
  { label: 'Lucro (receita − custos)', value: 'profit' }
]

async function save() {
  if (isSaving.value) return

  const name = form.name.trim()
  if (!name) {
    toast.add({ title: 'Nome obrigatório', color: 'warning' })
    return
  }
  const goalAmount = Number(form.goalAmount)
  const bonusAmount = Number(form.bonusAmount)
  if (!goalAmount || goalAmount <= 0) {
    toast.add({ title: 'Informe a meta a bater', color: 'warning' })
    return
  }
  if (!bonusAmount || bonusAmount <= 0) {
    toast.add({ title: 'Informe o valor do bônus', color: 'warning' })
    return
  }
  if (!form.effectiveMonth) {
    toast.add({ title: 'Informe a partir de qual mês o bônus vale', color: 'warning' })
    return
  }

  isSaving.value = true
  try {
    const response = await $fetch<{ item: { id: string } }>('/api/bonuses', {
      method: 'POST',
      body: {
        name,
        commissionBase: form.commissionBase,
        goalAmount,
        bonusAmount,
        effectiveFrom: `${form.effectiveMonth}-01`
      }
    })
    toast.add({ title: 'Bônus criado', color: 'success' })
    resetForm()
    emit('created', response.item.id)
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível criar o bônus', color: 'error' })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Novo bônus"
    description="Configure a meta e o valor — funcionários são atribuídos depois, na tela de detalhes."
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Nome" required>
          <UInput v-model="form.name" class="w-full" placeholder="Ex: Meta de vendas — Peças" />
        </UFormField>

        <UFormField label="Base de cálculo" required>
          <USelectMenu
            v-model="form.commissionBase"
            :items="commissionBaseOptions"
            value-key="value"
            class="w-full"
          />
        </UFormField>

        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Meta a bater" required>
            <UiCurrencyInput v-model="form.goalAmount" />
          </UFormField>
          <UFormField label="Valor do bônus" required>
            <UiCurrencyInput v-model="form.bonusAmount" />
          </UFormField>
        </div>

        <UFormField label="Vale a partir de" required>
          <UiDatePicker v-model="form.effectiveMonth" mode="month" />
        </UFormField>
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
          label="Criar bônus"
          color="neutral"
          :loading="isSaving"
          :disabled="isSaving"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
