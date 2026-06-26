<script setup lang="ts">
import type { TagFilterOption } from '~/components/ui/TagFilter.vue'

type CategoryOption = { id: string, name: string, icon: string, color: string }

const props = withDefaults(
  defineProps<{
    categories: CategoryOption[]
    dateLabel?: string
    categoriesLabel?: string
    statusLabel?: string
  }>(),
  {
    dateLabel: 'Período',
    categoriesLabel: 'Categorias',
    statusLabel: 'Status'
  }
)

const dateFrom = defineModel<string>('dateFrom')
const dateTo = defineModel<string>('dateTo')
const selectedCategories = defineModel<string[]>('selectedCategories', {
  default: () => []
})
const statusFilters = defineModel<string[]>('statusFilters', {
  default: () => []
})

const statusOptions: TagFilterOption[] = [
  {
    value: 'paid',
    label: 'Pagos',
    color: 'success',
    icon: 'i-lucide-circle-check'
  },
  {
    value: 'pending',
    label: 'Pendentes',
    color: 'warning',
    icon: 'i-lucide-clock'
  }
]

const categoryOptions = computed<TagFilterOption[]>(() =>
  [...props.categories]
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
    .map(category => ({
      value: category.id,
      label: category.name,
      color: category.color,
      icon: category.icon
    }))
)
</script>

<template>
  <UCard :ui="{ body: 'p-3' }">
    <div class="space-y-3 grid grid-cols-2 gap-3">
      <div class="flex items-center gap-2 text-muted col-span-2">
        <UIcon name="i-lucide-filter" class="size-4" />
        <span class="text-sm font-medium">Filtros</span>
      </div>

      <div>
        <p class="mb-1 text-xs font-medium text-muted">
          {{ props.dateLabel }}
        </p>
        <UiDateRangePicker
          v-model:from="dateFrom"
          v-model:to="dateTo"
          class="w-full"
        />
      </div>

      <div />

      <div>
        <p class="mb-1 text-xs font-medium text-muted">
          {{ props.categoriesLabel }}
        </p>
        <UiTagFilter
          v-model="selectedCategories"
          :options="categoryOptions"
          placeholder="Todas"
          class="w-full"
        />
      </div>

      <div>
        <p class="mb-1 text-xs font-medium text-muted">
          {{ props.statusLabel }}
        </p>
        <UiTagFilter
          v-model="statusFilters"
          :options="statusOptions"
          placeholder="Todos"
          class="w-full"
        />
      </div>
    </div>
  </UCard>
</template>
