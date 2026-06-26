<script setup lang="ts">
const dateFrom = defineModel<string>('dateFrom')
const dateTo = defineModel<string>('dateTo')
const typeFilters = defineModel<string[]>('typeFilters', { default: () => [] })
const statusFilters = defineModel<string[]>('statusFilters', { default: () => [] })
const categoryFilter = defineModel<string>('categoryFilter', { default: '' })

const props = defineProps<{
  categories?: Array<{ id: string, name: string }>
}>()

const typeOptions = [
  { label: 'Todos os tipos', value: '' },
  { label: 'Receita', value: 'income' },
  { label: 'Despesa', value: 'expense' }
]

const statusOptions = [
  { label: 'Todos os status', value: '' },
  { label: 'Pendente', value: 'pending' },
  { label: 'Pago', value: 'paid' }
]

const categoryOptions = computed(() => [
  { label: 'Todas as categorias', value: '' },
  ...(props.categories ?? []).map(c => ({ label: c.name, value: c.id }))
])

// Bridge between string[] models and single-value USelectMenu
const localType = computed({
  get: () => typeFilters.value[0] ?? '',
  set: (v: string | null | undefined) => { typeFilters.value = v ? [v] : [] }
})

const localStatus = computed({
  get: () => statusFilters.value[0] ?? '',
  set: (v: string | null | undefined) => { statusFilters.value = v ? [v] : [] }
})

const activeFiltersCount = computed(() => {
  let count = 0
  if (typeFilters.value.length > 0) count++
  if (statusFilters.value.length > 0) count++
  if (categoryFilter.value) count++
  return count
})
</script>

<template>
  <UPopover>
    <UButton
      icon="i-lucide-sliders-horizontal"
      :label="activeFiltersCount > 0 ? `Filtros (${activeFiltersCount})` : 'Filtros'"
      color="neutral"
      variant="outline"
      size="sm"
    />

    <template #content>
      <div class="w-64 space-y-3 p-3">
        <UFormField label="Período">
          <UiDateRangePicker
            v-model:from="dateFrom"
            v-model:to="dateTo"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Tipo">
          <USelectMenu
            v-model="localType"
            :items="typeOptions"
            value-key="value"
            class="w-full"
            :search-input="false"
            :clear="!!localType"
            @clear="localType = ''"
          />
        </UFormField>

        <UFormField label="Status">
          <USelectMenu
            v-model="localStatus"
            :items="statusOptions"
            value-key="value"
            class="w-full"
            :search-input="false"
            :clear="!!localStatus"
            @clear="localStatus = ''"
          />
        </UFormField>

        <UFormField label="Categoria">
          <USelectMenu
            v-model="categoryFilter"
            :items="categoryOptions"
            value-key="value"
            class="w-full"
            searchable
            :clear="!!categoryFilter"
            @clear="categoryFilter = ''"
          />
        </UFormField>
      </div>
    </template>
  </UPopover>
</template>
