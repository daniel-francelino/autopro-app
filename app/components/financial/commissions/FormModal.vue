<script setup lang="ts">
import type { CommissionRuleDraft } from '~/utils/commission-rule-draft'
import {
  commissionRuleDraftsToPayload,
  createEmptyCommissionRuleDraft,
  validateCommissionRuleDrafts
} from '~/utils/commission-rule-draft'

const props = defineProps<{
  open: boolean
}>()

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
  description: '',
  effectiveMonth: currentMonthValue() as string | undefined
})

const rules = ref<CommissionRuleDraft[]>([createEmptyCommissionRuleDraft()])

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const { data: categoriesData } = await useAsyncData(
  'commissions-form-categories',
  () => requestFetch<{ items: Array<{ id: string, name: string }> }>('/api/product-categories', { headers: requestHeaders }),
  { default: () => ({ items: [] }) }
)
const categories = computed(() => categoriesData.value?.items ?? [])

watch(
  () => props.open,
  (open) => {
    if (!open) return
    form.name = ''
    form.description = ''
    form.effectiveMonth = currentMonthValue()
    rules.value = [createEmptyCommissionRuleDraft()]
  }
)

async function save() {
  if (isSaving.value) return
  if (!form.name.trim()) {
    toast.add({ title: 'Informe o nome da configuração', color: 'warning' })
    return
  }
  const validationError = validateCommissionRuleDrafts(rules.value)
  if (validationError) {
    toast.add({ title: validationError, color: 'warning' })
    return
  }
  if (!form.effectiveMonth) {
    toast.add({ title: 'Informe a partir de qual mês a configuração vale', color: 'warning' })
    return
  }

  isSaving.value = true
  try {
    const response = await $fetch<{ item: { id: string } }>('/api/commissions', {
      method: 'POST',
      body: {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        effectiveFrom: `${form.effectiveMonth}-01`,
        rules: commissionRuleDraftsToPayload(rules.value)
      }
    })
    toast.add({ title: 'Configuração de comissão criada', color: 'success' })
    emit('created', response.item.id)
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível criar a configuração', color: 'error' })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Nova comissão"
    description="Configure uma ou mais regras por categoria. Depois, atribua a um ou mais funcionários."
    :ui="{ content: 'max-w-2xl' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Nome" required>
          <UInput v-model="form.name" class="w-full" placeholder="Ex: Comissão mecânicos — padrão" />
        </UFormField>
        <UFormField label="Vale a partir de" required>
          <UiDatePicker v-model="form.effectiveMonth" mode="month" />
        </UFormField>

        <FinancialCommissionsRuleListEditor
          v-model="rules"
          :categories="categories"
        />
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="Cancelar"
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          :disabled="isSaving"
          @click="emit('update:open', false)"
        />
        <UButton
          label="Criar comissão"
          icon="i-lucide-check"
          color="neutral"
          :loading="isSaving"
          :disabled="isSaving"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
