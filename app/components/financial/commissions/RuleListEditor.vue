<script setup lang="ts">
import type { CommissionRuleDraft } from '~/utils/commission-rule-draft'
import { createEmptyCommissionRuleDraft } from '~/utils/commission-rule-draft'

const props = defineProps<{
  modelValue: CommissionRuleDraft[]
  categories: Array<{ id: string, name: string }>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: CommissionRuleDraft[]]
}>()

const commissionTypeOptions = [
  { label: 'Percentual', value: 'percentage' },
  { label: 'Valor fixo', value: 'fixed_amount' }
]

const commissionBaseOptions = [
  { label: 'Faturamento', value: 'revenue' },
  { label: 'Lucro', value: 'profit' }
]

function addRule() {
  emit('update:modelValue', [...props.modelValue, createEmptyCommissionRuleDraft()])
}

function removeRule(key: string) {
  emit('update:modelValue', props.modelValue.filter(rule => rule.key !== key))
}

function updateRule(key: string, patch: Partial<CommissionRuleDraft>) {
  emit('update:modelValue', props.modelValue.map(rule => (rule.key === key ? { ...rule, ...patch } : rule)))
}

function toggleCategory(rule: CommissionRuleDraft, categoryId: string, checked: boolean) {
  const categoryIds = checked
    ? [...new Set([...rule.categoryIds, categoryId])]
    : rule.categoryIds.filter(id => id !== categoryId)
  updateRule(rule.key, { categoryIds })
}

// Categories already used by ANOTHER rule in this same draft list — excluded
// from that rule's picker, client-side mirror of the server's per-version
// "no repeated category" validation.
function disabledCategoryIdsFor(rule: CommissionRuleDraft) {
  return new Set(
    props.modelValue
      .filter(other => other.key !== rule.key)
      .flatMap(other => other.categoryIds)
  )
}

const hasDefaultRule = computed(() => props.modelValue.some(rule => rule.isDefault))
</script>

<template>
  <div class="space-y-3">
    <div v-for="(rule, index) in modelValue" :key="rule.key" class="space-y-3 rounded-lg border border-default p-3">
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs font-semibold uppercase tracking-widest text-muted">
          Regra {{ index + 1 }}
        </p>
        <UButton
          v-if="modelValue.length > 1"
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          size="xs"
          @click="removeRule(rule.key)"
        />
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <UFormField label="Tipo de comissão" required>
          <USelectMenu
            :model-value="rule.commissionType"
            :items="commissionTypeOptions"
            value-key="value"
            class="w-full"
            @update:model-value="(value: 'percentage' | 'fixed_amount') => updateRule(rule.key, { commissionType: value })"
          />
        </UFormField>
        <UFormField :label="rule.commissionType === 'percentage' ? 'Taxa (%)' : 'Valor fixo (R$)'" required>
          <UInput
            v-if="rule.commissionType === 'percentage'"
            :model-value="rule.commissionAmount"
            type="number"
            min="0"
            max="100"
            step="0.01"
            class="w-full"
            placeholder="0"
            @update:model-value="(value: string) => updateRule(rule.key, { commissionAmount: value })"
          />
          <UiCurrencyInput
            v-else
            :model-value="rule.commissionAmount"
            class="w-full"
            @update:model-value="(value: string) => updateRule(rule.key, { commissionAmount: value })"
          />
        </UFormField>
      </div>

      <UFormField label="Base de cálculo" required>
        <USelectMenu
          :model-value="rule.commissionBase"
          :items="commissionBaseOptions"
          value-key="value"
          class="w-full"
          @update:model-value="(value: 'revenue' | 'profit') => updateRule(rule.key, { commissionBase: value })"
        />
      </UFormField>

      <UCheckbox
        :model-value="rule.isDefault"
        label="Regra padrão"
        color="neutral"
        :disabled="!rule.isDefault && hasDefaultRule"
        @update:model-value="(value: boolean) => updateRule(rule.key, { isDefault: value, categoryIds: value ? [] : rule.categoryIds })"
      />
      <p class="-mt-2 text-xs text-muted">
        Aplica-se a qualquer item cuja categoria não esteja coberta por outra regra desta versão. No máximo uma regra padrão.
      </p>

      <div v-if="!rule.isDefault">
        <p class="mb-2 text-xs font-medium text-muted">
          Categorias desta regra
        </p>
        <p v-if="props.categories.length === 0" class="text-xs text-muted">
          Nenhuma categoria cadastrada em Produtos &gt; Categorias.
        </p>
        <div v-else class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <UCheckbox
            v-for="category in props.categories"
            :key="category.id"
            :label="category.name"
            :model-value="rule.categoryIds.includes(category.id)"
            :disabled="disabledCategoryIdsFor(rule).has(category.id) && !rule.categoryIds.includes(category.id)"
            color="neutral"
            @update:model-value="(checked: boolean) => toggleCategory(rule, category.id, checked)"
          />
        </div>
      </div>
    </div>

    <UButton
      label="Regra"
      icon="i-lucide-plus"
      size="xs"
      color="neutral"
      variant="ghost"
      @click="addRule"
    />
  </div>
</template>
