<script setup lang="ts">
import type { OsHistoryCategory } from '~/types/service-order-history'
import { OS_HISTORY_CATEGORY_OPTIONS } from '~/utils/os-history-ui'

defineProps<{
  modelValue: OsHistoryCategory | 'all'
}>()

const emit = defineEmits<{
  'update:modelValue': [value: OsHistoryCategory | 'all']
}>()
</script>

<template>
  <UFormField label="Categoria" size="sm">
    <USelect
      :model-value="modelValue"
      :items="OS_HISTORY_CATEGORY_OPTIONS"
      class="w-full max-xl:min-h-11"
      @update:model-value="emit('update:modelValue', $event as OsHistoryCategory | 'all')"
    />
  </UFormField>
</template>
