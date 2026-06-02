<script setup lang="ts">
import type { ProductCategory } from '~/types/products'

type ProductTypeFilter = 'all' | 'unit' | 'group'
type InventoryFilter = 'all' | 'tracked' | 'not_tracked'

const props = defineProps<{
  typeFilter: ProductTypeFilter
  inventoryFilter: InventoryFilter
  categoryFilter: string
  categories: ProductCategory[]
}>()

const emit = defineEmits<{
  'update:typeFilter': [value: ProductTypeFilter]
  'update:inventoryFilter': [value: InventoryFilter]
  'update:categoryFilter': [value: string]
}>()

const typeFilterOptions = [
  { label: 'Todos os tipos', value: 'all' },
  { label: 'Unitário', value: 'unit' },
  { label: 'Grupo', value: 'group' }
]

const inventoryFilterOptions = [
  { label: 'Todo o catálogo', value: 'all' },
  { label: 'Com estoque', value: 'tracked' },
  { label: 'Sem estoque', value: 'not_tracked' }
]

const categoryOptions = computed(() => [
  { label: 'Todas as categorias', value: 'all' },
  ...(props.categories ?? []).map(c => ({ label: c.name, value: c.id }))
])

const activeFiltersCount = computed(() => {
  let count = 0
  if (props.typeFilter !== 'all') count++
  if (props.inventoryFilter !== 'all') count++
  if (props.categoryFilter !== 'all') count++
  return count
})

const localType = computed({
  get: () => props.typeFilter,
  set: v => emit('update:typeFilter', v)
})

const localInventory = computed({
  get: () => props.inventoryFilter,
  set: v => emit('update:inventoryFilter', v)
})

const localCategory = computed({
  get: () => props.categoryFilter,
  set: v => emit('update:categoryFilter', v)
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
        <UFormField label="Tipo">
          <USelectMenu
            v-model="localType"
            :items="typeFilterOptions"
            value-key="value"
            class="w-full"
            :search-input="false"
            :clear="localType !== 'all'"
            @clear="localType = 'all'"
          />
        </UFormField>

        <UFormField label="Estoque">
          <USelectMenu
            v-model="localInventory"
            :items="inventoryFilterOptions"
            value-key="value"
            class="w-full"
            :search-input="false"
            :clear="localInventory !== 'all'"
            @clear="localInventory = 'all'"
          />
        </UFormField>

        <UFormField label="Categoria">
          <USelectMenu
            v-model="localCategory"
            :items="categoryOptions"
            value-key="value"
            class="w-full"
            searchable
            :clear="localCategory !== 'all'"
            @clear="localCategory = 'all'"
          />
        </UFormField>
      </div>
    </template>
  </UPopover>
</template>
