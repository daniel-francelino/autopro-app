<script setup lang="ts">
import type { ProductItem } from '~/types/products'

defineProps<{
  product: ProductItem
  canCreate?: boolean
  canUpdate?: boolean
  canDelete?: boolean
  isDeleting?: boolean
}>()

const emit = defineEmits<{
  clone: [product: ProductItem]
  edit: [product: ProductItem]
  delete: [product: ProductItem]
}>()

function getProductTypeLabel(type: ProductItem['type']) {
  return type === 'group' ? 'Grupo' : 'Unitário'
}

function formatCurrency(value: number | null) {
  if (value == null)
    return '-'

  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function getTotalCost(product: ProductItem): number | null {
  if (product.type === 'group') {
    return (product.group_items ?? []).reduce(
      (acc, item) => acc + (item.cost_price ?? 0) * (item.quantity ?? 0),
      0
    )
  }

  return product.unit_cost_price
}

function getTotalSale(product: ProductItem): number | null {
  if (product.type === 'group') {
    return (product.group_items ?? []).reduce(
      (acc, item) => acc + (item.sale_price ?? 0) * (item.quantity ?? 0),
      0
    )
  }

  return product.unit_sale_price
}
</script>

<template>
  <UCard class="border border-default/80 shadow-sm">
    <div class="space-y-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 space-y-2">
          <h3 class="truncate text-base font-semibold text-highlighted">
            {{ product.name }}
          </h3>
          <div class="flex flex-wrap items-center gap-2">
            <UBadge
              :label="getProductTypeLabel(product.type)"
              color="neutral"
              variant="subtle"
              size="xs"
            />
            <UBadge
              v-if="product.type === 'group' && (product.group_items?.length ?? 0) > 1"
              :label="`${product.group_items!.length} itens`"
              color="info"
              variant="subtle"
              size="xs"
            />
            <UBadge
              v-else-if="product.track_inventory"
              label="Estoque controlado"
              color="success"
              variant="subtle"
              size="xs"
            />
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-1">
          <UTooltip v-if="canCreate" text="Clonar produto">
            <UButton
              icon="i-lucide-copy"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="emit('clone', product)"
            />
          </UTooltip>

          <UTooltip v-if="canUpdate" text="Editar produto">
            <UButton
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="emit('edit', product)"
            />
          </UTooltip>

          <UTooltip v-if="canDelete" text="Excluir produto">
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              :loading="isDeleting"
              @click="emit('delete', product)"
            />
          </UTooltip>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-2 text-sm text-muted sm:grid-cols-2">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-scan-line" class="size-4 shrink-0" />
          <span class="truncate">{{ product.code }}</span>
        </div>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-folder-tree" class="size-4 shrink-0" />
          <span class="truncate">{{ product.product_categories?.name || 'Sem categoria' }}</span>
        </div>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-trending-down" class="size-4 shrink-0 text-error" />
          <span class="truncate">{{ formatCurrency(getTotalCost(product)) }}</span>
        </div>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-trending-up" class="size-4 shrink-0 text-success" />
          <span class="truncate font-medium text-highlighted">{{ formatCurrency(getTotalSale(product)) }}</span>
        </div>
      </div>
    </div>
  </UCard>
</template>
