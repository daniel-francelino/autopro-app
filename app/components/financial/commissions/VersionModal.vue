<script setup lang="ts">
import type { CommissionRuleDraft } from '~/utils/commission-rule-draft'
import {
  commissionRuleDraftFromRule,
  commissionRuleDraftsToPayload,
  createEmptyCommissionRuleDraft,
  validateCommissionRuleDrafts
} from '~/utils/commission-rule-draft'

interface CurrentRule {
  name: string | null
  commission_type: 'percentage' | 'fixed_amount'
  commission_amount: number
  commission_base: 'revenue' | 'profit' | null
  is_default: boolean
  category_ids: string[]
}

const props = defineProps<{
  open: boolean
  planId: string
  currentRules: CurrentRule[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const toast = useToast()
const isSaving = ref(false)

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const effectiveMonth = ref<string | undefined>(currentMonthValue())
const notes = ref('')
const rules = ref<CommissionRuleDraft[]>([])

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const { data: categoriesData } = await useAsyncData(
  'commissions-version-categories',
  () => requestFetch<{ items: Array<{ id: string, name: string }> }>('/api/product-categories', { headers: requestHeaders }),
  { default: () => ({ items: [] }) }
)
const categories = computed(() => categoriesData.value?.items ?? [])

watch(
  () => props.open,
  (open) => {
    if (!open) return
    effectiveMonth.value = currentMonthValue()
    notes.value = ''
    rules.value = props.currentRules.length > 0
      ? props.currentRules.map(commissionRuleDraftFromRule)
      : [createEmptyCommissionRuleDraft()]
  },
  { immediate: true }
)

async function save() {
  if (isSaving.value) return
  const validationError = validateCommissionRuleDrafts(rules.value)
  if (validationError) {
    toast.add({ title: validationError, color: 'warning' })
    return
  }
  if (!effectiveMonth.value) {
    toast.add({ title: 'Informe a partir de qual mês esta alteração vale', color: 'warning' })
    return
  }

  isSaving.value = true
  try {
    await $fetch(`/api/commissions/${props.planId}/versions`, {
      method: 'POST',
      body: {
        effectiveFrom: `${effectiveMonth.value}-01`,
        notes: notes.value.trim() || undefined,
        rules: commissionRuleDraftsToPayload(rules.value)
      }
    })
    toast.add({ title: 'Nova versão de regras criada', color: 'success' })
    emit('saved')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível salvar as novas regras', color: 'error' })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Alterar regras de comissão"
    description="Isso cria uma nova versão — o histórico das regras anteriores é preservado, nunca sobrescrito."
    :ui="{ content: 'max-w-2xl' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Vale a partir de" required>
          <UiDatePicker v-model="effectiveMonth" mode="month" />
        </UFormField>
        <UFormField label="Notas">
          <UTextarea
            v-model="notes"
            class="w-full"
            :rows="2"
            placeholder="Opcional — por que essa mudança, por exemplo"
          />
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
          label="Salvar nova versão"
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
