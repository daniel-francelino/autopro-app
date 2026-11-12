<script setup lang="ts">
import type { ProductItem, ProductCategory, GroupItem } from '~/types/products'

const props = defineProps<{
  open: boolean
  product: ProductItem | null
  cloneFrom: ProductItem | null
  categories: ProductCategory[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const toast = useToast()
const isSaving = ref(false)
const isLoadingNextCode = ref(false)
let nextCodeRequestId = 0

const productTypeOptions = [
  { label: 'Unitário', value: 'unit' },
  { label: 'Grupo', value: 'group' }
]

const categoryOptions = computed(() =>
  (props.categories ?? []).map(c => ({ label: c.name, value: c.id }))
)

const form = reactive({
  name: '',
  code: '' as number | string,
  type: 'unit' as ProductItem['type'],
  category_id: '',
  track_inventory: true,
  initial_stock_quantity: 0,
  unit_sale_price: '' as number | string,
  unit_cost_price: '' as number | string,
  notes: ''
})

const groupItems = ref<GroupItem[]>([])

const isEditMode = computed(() => Boolean(props.product?.id))
const isCloneMode = computed(() => Boolean(props.cloneFrom?.id) && !isEditMode.value)

const modalTitle = computed(() => {
  if (isEditMode.value) return 'Editar produto'
  if (isCloneMode.value) return 'Clonar produto'
  return 'Novo produto'
})

const modalSubtitle = computed(() => {
  if (form.type === 'group')
    return `${groupItems.value.length || 0} item(ns) no grupo`

  return form.track_inventory ? 'Produto unitário com estoque controlado' : 'Produto unitário sem controle de estoque'
})

const typeMeta = computed(() =>
  form.type === 'group'
    ? {
        label: 'Grupo',
        icon: 'i-lucide-layers-3',
        color: 'info' as const
      }
    : {
        label: 'Unitário',
        icon: 'i-lucide-package',
        color: 'neutral' as const
      }
)

const categoryLabel = computed(() =>
  props.categories.find(category => category.id === form.category_id)?.name ?? 'Sem categoria'
)

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

const unitSalePrice = computed(() => toNumber(form.unit_sale_price))
const unitCostPrice = computed(() => toNumber(form.unit_cost_price))

const groupTotalSale = computed(() =>
  groupItems.value.reduce((acc, item) => acc + toNumber(item.sale_price) * toNumber(item.quantity), 0)
)

const groupTotalCost = computed(() =>
  groupItems.value.reduce((acc, item) => acc + toNumber(item.cost_price) * toNumber(item.quantity), 0)
)

const salePreview = computed(() =>
  form.type === 'group' ? groupTotalSale.value : unitSalePrice.value
)

const costPreview = computed(() =>
  form.type === 'group' ? groupTotalCost.value : unitCostPrice.value
)

const marginPreview = computed(() => salePreview.value - costPreview.value)

function createEmptyGroupItem(): GroupItem {
  return {
    description: '',
    quantity: 1,
    unit: 'un',
    cost_price: 0,
    sale_price: 0,
    track_inventory: false,
    initial_stock_quantity: 0
  }
}

async function loadNextCode() {
  const requestId = ++nextCodeRequestId
  isLoadingNextCode.value = true

  try {
    const res = await $fetch<{ code: number }>('/api/products/next-code')
    if (requestId !== nextCodeRequestId || !props.open)
      return

    if (String(form.code).trim())
      return

    form.code = res.code || 1
  } catch {
    if (requestId === nextCodeRequestId && props.open) {
      toast.add({
        title: 'Não foi possível sugerir o próximo código',
        description: 'Preencha um número manualmente para continuar.',
        color: 'warning'
      })
    }
  } finally {
    if (requestId === nextCodeRequestId)
      isLoadingNextCode.value = false
  }
}

function resetForm() {
  Object.assign(form, {
    name: '',
    code: '',
    type: 'unit',
    category_id: '',
    track_inventory: true,
    initial_stock_quantity: 0,
    unit_sale_price: '',
    unit_cost_price: '',
    notes: ''
  })
  groupItems.value = []
}

async function populateFromProduct(source: ProductItem, clone = false) {
  Object.assign(form, {
    name: clone ? `${source.name} (Cópia)` : (source.name ?? ''),
    code: clone ? '' : (source.code ?? ''),
    type: source.type ?? 'unit',
    category_id: source.category_id ?? '',
    track_inventory: source.track_inventory ?? false,
    initial_stock_quantity: source.initial_stock_quantity ?? 0,
    unit_sale_price: source.unit_sale_price ?? '',
    unit_cost_price: source.unit_cost_price ?? '',
    notes: source.notes ?? ''
  })
  groupItems.value = source.group_items ? [...source.group_items] : []

  if (clone)
    await loadNextCode()
}

watch(
  () => form.type,
  (type, previousType) => {
    if (type === previousType)
      return

    if (type === 'group') {
      if (!groupItems.value.length)
        groupItems.value = [createEmptyGroupItem()]
      return
    }

    groupItems.value = []
  }
)

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      nextCodeRequestId += 1
      isLoadingNextCode.value = false
      return
    }

    if (props.product) {
      await populateFromProduct(props.product)
    } else if (props.cloneFrom) {
      await populateFromProduct(props.cloneFrom, true)
    } else {
      resetForm()
      await loadNextCode()
    }
  }
)

async function save() {
  if (isSaving.value)
    return

  const productCode = Number(form.code)
  if (!form.name.trim() || !Number.isSafeInteger(productCode) || productCode <= 0) {
    toast.add({ title: 'Preencha nome e código do produto', color: 'warning' })
    return
  }

  isSaving.value = true

  try {
    const body = {
      name: form.name.trim(),
      code: productCode,
      type: form.type,
      category_id: form.category_id || null,
      track_inventory: form.type === 'unit' ? form.track_inventory : false,
      initial_stock_quantity:
        form.type === 'unit' && form.track_inventory
          ? Number(form.initial_stock_quantity || 0)
          : 0,
      unit_sale_price:
        form.type === 'unit'
          ? (form.unit_sale_price === '' ? null : Number(form.unit_sale_price))
          : null,
      unit_cost_price:
        form.type === 'unit'
          ? (form.unit_cost_price === '' ? null : Number(form.unit_cost_price))
          : null,
      group_items: form.type === 'group' ? groupItems.value : null,
      notes: form.notes || null
    }

    if (props.product?.id) {
      await $fetch(`/api/products/${props.product.id}`, { method: 'PUT', body })
      toast.add({ title: 'Produto atualizado', color: 'success' })
    } else {
      await $fetch('/api/products', { method: 'POST', body })
      toast.add({ title: 'Produto criado', color: 'success' })
    }

    emit('update:open', false)
    emit('saved')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao salvar produto',
      description: err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :ui="{
      overlay: 'bg-default/90 backdrop-blur-sm',
      content: 'max-w-none w-screen h-dvh rounded-none flex flex-col overflow-hidden sm:max-h-[100dvh] max-h-[100dvh]',
      header: 'p-0 shrink-0 border-b border-default',
      body: 'flex-1 min-h-0 overflow-y-auto p-0',
      footer: 'p-0 shrink-0 border-t border-default bg-default/95 backdrop-blur'
    }"
    @update:open="emit('update:open', $event)"
  >
    <template #header>
      <div class="flex w-full items-start justify-between gap-4 p-4 lg:px-6 lg:py-5">
        <div class="min-w-0 flex-1 space-y-3">
          <div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div class="min-w-0 space-y-1.5">
              <p class="font-semibold uppercase tracking-[0.22em] text-primary/80">
                {{ modalTitle }}
              </p>
              <div class="flex min-w-0 items-center gap-3">
                <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <UIcon name="i-lucide-package-plus" class="size-5" />
                </div>
                <div class="min-w-0">
                  <h2 class="truncate text-lg font-semibold text-highlighted sm:text-xl">
                    {{ form.name || 'Produto sem nome' }}
                  </h2>
                  <p class="truncate text-sm text-muted">
                    {{ modalSubtitle }}
                  </p>
                </div>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <UBadge
                :label="typeMeta.label"
                :leading-icon="typeMeta.icon"
                :color="typeMeta.color"
                variant="subtle"
                class="px-3 py-1"
              />
              <UBadge
                :label="categoryLabel"
                leading-icon="i-lucide-tags"
                color="neutral"
                variant="outline"
                class="max-w-56 px-3 py-1"
              />
              <UBadge
                v-if="form.type === 'unit' && form.track_inventory"
                label="Estoque ativo"
                leading-icon="i-lucide-boxes"
                color="success"
                variant="outline"
                class="px-3 py-1"
              />
            </div>
          </div>
        </div>

        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          square
          @click="emit('update:open', false)"
        />
      </div>
    </template>

    <template #body>
      <form id="products-form" class="space-y-6 p-4 lg:p-6" @submit.prevent="save">
        <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div class="space-y-6">
            <section class="rounded-lg border border-default bg-default shadow-sm">
              <div class="flex items-center gap-3 border-b border-default p-4">
                <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <UIcon name="i-lucide-clipboard-pen" class="size-4" />
                </div>
                <div>
                  <h3 class="text-sm font-semibold text-highlighted">
                    Identificação
                  </h3>
                  <p class="text-xs text-muted">
                    Nome, código e classificação do produto
                  </p>
                </div>
              </div>

              <div class="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                <UFormField label="Nome" required class="sm:col-span-2">
                  <UInput
                    v-model="form.name"
                    icon="i-lucide-package"
                    class="w-full"
                    placeholder="Ex: Kit revisão básica"
                  />
                </UFormField>

                <UFormField
                  label="Código"
                  required
                >
                  <UInput
                    v-model.number="form.code"
                    icon="i-lucide-scan-barcode"
                    :trailing-icon="isLoadingNextCode ? 'i-lucide-loader-circle' : undefined"
                    type="number"
                    min="1"
                    step="1"
                    inputmode="numeric"
                    class="w-full"
                    placeholder="Ex: 81"
                  />
                </UFormField>

                <UFormField label="Tipo">
                  <USelectMenu
                    v-model="form.type"
                    :items="productTypeOptions"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>

                <UFormField label="Categoria" class="sm:col-span-2">
                  <USelectMenu
                    v-model="form.category_id"
                    :items="categoryOptions"
                    value-key="value"
                    class="w-full"
                    searchable
                    placeholder="Sem categoria"
                  />
                </UFormField>
              </div>
            </section>

            <section v-if="form.type === 'unit'" class="rounded-lg border border-default bg-default shadow-sm">
              <div class="flex items-center gap-3 border-b border-default p-4">
                <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
                  <UIcon name="i-lucide-badge-dollar-sign" class="size-4" />
                </div>
                <div>
                  <h3 class="text-sm font-semibold text-highlighted">
                    Preços e estoque
                  </h3>
                  <p class="text-xs text-muted">
                    Valores usados em vendas e ordens de serviço
                  </p>
                </div>
              </div>

              <div class="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                <UFormField label="Preço de venda">
                  <UiCurrencyInput v-model="form.unit_sale_price" />
                </UFormField>

                <UFormField label="Preço de custo">
                  <UiCurrencyInput v-model="form.unit_cost_price" />
                </UFormField>

                <div class="sm:col-span-2 rounded-lg border border-default bg-elevated/40 p-4">
                  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div class="flex items-start gap-3">
                      <UIcon name="i-lucide-boxes" class="mt-0.5 size-5 shrink-0 text-primary" />
                      <div>
                        <p class="text-sm font-medium text-highlighted">
                          Controlar estoque
                        </p>
                        <p class="text-xs text-muted">
                          Mostra saldo inicial e permite acompanhar quantidade disponível
                        </p>
                      </div>
                    </div>
                    <USwitch v-model="form.track_inventory" />
                  </div>

                  <UFormField
                    v-if="form.track_inventory"
                    label="Estoque inicial"
                    class="mt-4"
                  >
                    <UInput
                      v-model="form.initial_stock_quantity"
                      icon="i-lucide-warehouse"
                      type="number"
                      min="0"
                      step="1"
                      class="w-full"
                    />
                  </UFormField>
                </div>
              </div>
            </section>

            <section v-else class="rounded-lg border border-default bg-default p-4 shadow-sm">
              <ProductsGroupItems v-model="groupItems" />
            </section>
          </div>

          <aside class="space-y-6">
            <section class="rounded-lg border border-default bg-default shadow-sm">
              <div class="flex items-center gap-3 border-b border-default p-4">
                <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
                  <UIcon name="i-lucide-calculator" class="size-4" />
                </div>
                <div>
                  <h3 class="text-sm font-semibold text-highlighted">
                    Resumo
                  </h3>
                  <p class="text-xs text-muted">
                    Prévia rápida do cadastro
                  </p>
                </div>
              </div>

              <div class="space-y-3 p-4">
                <div class="flex items-center justify-between gap-3 rounded-lg bg-elevated/50 px-3 py-2.5">
                  <span class="flex items-center gap-2 text-sm text-muted">
                    <UIcon name="i-lucide-trending-down" class="size-4 text-error" />
                    Custo
                  </span>
                  <span class="text-sm font-semibold text-highlighted">
                    {{ formatCurrency(costPreview) }}
                  </span>
                </div>

                <div class="flex items-center justify-between gap-3 rounded-lg bg-elevated/50 px-3 py-2.5">
                  <span class="flex items-center gap-2 text-sm text-muted">
                    <UIcon name="i-lucide-trending-up" class="size-4 text-success" />
                    Venda
                  </span>
                  <span class="text-sm font-semibold text-highlighted">
                    {{ formatCurrency(salePreview) }}
                  </span>
                </div>

                <div class="flex items-center justify-between gap-3 rounded-lg bg-primary/10 px-3 py-2.5">
                  <span class="flex items-center gap-2 text-sm text-primary">
                    <UIcon name="i-lucide-line-chart" class="size-4" />
                    Margem
                  </span>
                  <span class="text-sm font-semibold text-primary">
                    {{ formatCurrency(marginPreview) }}
                  </span>
                </div>
              </div>
            </section>

            <section class="rounded-lg border border-default bg-default shadow-sm">
              <div class="flex items-center gap-3 border-b border-default p-4">
                <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
                  <UIcon name="i-lucide-notebook-pen" class="size-4" />
                </div>
                <div>
                  <h3 class="text-sm font-semibold text-highlighted">
                    Observações
                  </h3>
                  <p class="text-xs text-muted">
                    Detalhes internos sobre o produto
                  </p>
                </div>
              </div>

              <div class="p-4">
                <UFormField label="Notas">
                  <UTextarea
                    v-model="form.notes"
                    class="w-full"
                    :rows="7"
                    placeholder="Aplicação, compatibilidade, fornecedor preferencial..."
                  />
                </UFormField>
              </div>
            </section>
          </aside>
        </div>
      </form>
    </template>

    <template #footer>
      <div class="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div class="flex items-center justify-end gap-3">
          <UButton
            label="Cancelar"
            icon="i-lucide-x"
            color="neutral"
            variant="outline"
            @click="emit('update:open', false)"
          />
          <UButton
            :label="isEditMode ? 'Salvar alterações' : 'Criar produto'"
            :icon="isEditMode ? 'i-lucide-save' : 'i-lucide-plus'"
            :loading="isSaving"
            :disabled="isSaving"
            type="submit"
            form="products-form"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
