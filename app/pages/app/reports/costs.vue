<script setup lang="ts">
import type { SortingState } from '@tanstack/vue-table'
import type { CostCategoryDetailData } from '~/components/reports/costs/CostsCategoryDetailsSlideover.vue'
import { DEFAULT_CATEGORY_COLOR, DEFAULT_CATEGORY_ICON, formatCategoryName } from '~/utils/financial-category-options'

interface CategoryRow {
  categoryKey: string
  category: string
  icon: string
  color: string
  amount: number
  percentage: number
}

interface CategoryOption {
  id: string
  name: string
  icon: string
  color: string
}

interface EvolutionPoint {
  name: string
  cost: number
}

interface CostsSummary {
  totalCosts?: number
  totalRevenue?: number
  netProfit?: number
  profitMargin?: number
}

interface CostsPagination {
  totalItems?: number
}

interface CostsReportResponse {
  data?: {
    costsReport?: {
      availableCategories?: CategoryOption[]
      summary?: CostsSummary
      charts?: {
        categories?: CategoryRow[]
        evolution?: EvolutionPoint[]
      }
      table?: {
        items?: CategoryRow[]
        pagination?: CostsPagination | null
      }
    }
    costsCategoryDetails?: CostCategoryDetailData | null
  }
}

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Relatório de Custos' })

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const toast = useToast()

const { dateFrom, dateTo } = useReportDateRange()
const search = useReportQueryParam('q', '')
const selectedCategories = useReportQueryParam('categories', [] as string[])
const statusFilters = useReportQueryParam('status', [] as string[])
const page = useReportQueryParam('page', 1)
const pageSize = 20
const detailOpen = ref(false)
const detailLoading = ref(false)
const detailData = ref<CostCategoryDetailData | null>(null)
const selectedCategory = ref('')

const sortByParam = useReportQueryParam('sortBy', 'amount')
const sortOrderParam = useReportQueryParam('sortOrder', 'desc')
const sorting = computed<SortingState>({
  get: () => [{ id: sortByParam.value, desc: sortOrderParam.value !== 'asc' }],
  set: (val) => {
    sortByParam.value = val[0]?.id ?? 'amount'
    sortOrderParam.value = val[0]?.desc === false ? 'asc' : 'desc'
    page.value = 1
  }
})

const sortByMap: Record<string, string> = {
  category: 'category',
  amount: 'amount',
  percentage: 'percentage'
}

const sortBy = computed(() => sortByMap[sortByParam.value] ?? 'amount')
const sortOrder = computed(() => sortOrderParam.value)

watch([dateFrom, dateTo, search, selectedCategories, statusFilters, sortBy, sortOrder], () => {
  page.value = 1
})

const queryKey = computed(() =>
  `report-costs-${dateFrom.value}-${dateTo.value}-${page.value}-${search.value}-${selectedCategories.value.join(',')}-${statusFilters.value.join(',')}-${sortBy.value}-${sortOrder.value}`
)

const { data, status } = await useAsyncData(
  () => queryKey.value,
  () => requestFetch<CostsReportResponse>('/api/reports/costs-profit', {
    headers: requestHeaders,
    query: {
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
      categoryIds: selectedCategories.value.length ? selectedCategories.value : undefined,
      status: statusFilters.value.length ? statusFilters.value : undefined,
      searchTerm: search.value || undefined,
      sortBy: sortBy.value,
      sortOrder: sortOrder.value,
      page: page.value,
      pageSize
    }
  }),
  { watch: [queryKey] }
)

const costsReport = computed(() => data.value?.data?.costsReport)
const summary = computed<CostsSummary>(() => costsReport.value?.summary ?? {})
const chartCategories = computed<CategoryRow[]>(() => costsReport.value?.charts?.categories ?? [])
const evolution = computed<EvolutionPoint[]>(() => costsReport.value?.charts?.evolution ?? [])
const items = computed<CategoryRow[]>(() => costsReport.value?.table?.items ?? [])
const pagination = computed<CostsPagination | null>(() => costsReport.value?.table?.pagination ?? null)
const availableCategories = computed<CategoryOption[]>(() => costsReport.value?.availableCategories ?? [])

const columns = [
  { id: 'category', header: 'Categoria', enableSorting: true },
  { accessorKey: 'amount', header: 'Valor total' },
  { accessorKey: 'percentage', header: '% do total' },
  { id: 'actions', header: '', enableSorting: false }
]

function formatCurrency(v: number | string) {
  return parseFloat(String(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatPercent(v: number | string) {
  return `${parseFloat(String(v || 0)).toFixed(1)}%`
}

function normalizePercent(v: number | string) {
  const value = Number.parseFloat(String(v || 0))
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

async function loadCategoryDetails() {
  if (!selectedCategory.value) return

  detailLoading.value = true
  try {
    const res = await $fetch<CostsReportResponse>('/api/reports/costs-profit', {
      query: {
        dateFrom: dateFrom.value,
        dateTo: dateTo.value,
        categoryIds: selectedCategories.value.length ? selectedCategories.value : undefined,
        status: statusFilters.value.length ? statusFilters.value : undefined,
        searchTerm: search.value || undefined,
        includeCategoryDetails: 'true',
        selectedCategory: selectedCategory.value
      }
    })
    detailData.value = res.data?.costsCategoryDetails ?? null
  } catch {
    toast.add({ title: 'Erro ao carregar detalhes da categoria', color: 'error' })
    detailOpen.value = false
  } finally {
    detailLoading.value = false
  }
}

async function openCategoryDetails(categoryKey: string) {
  selectedCategory.value = categoryKey
  detailData.value = null
  detailOpen.value = true
  await loadCategoryDetails()
}

watch([dateFrom, dateTo, search, selectedCategories, statusFilters], async () => {
  if (detailOpen.value && selectedCategory.value) {
    await loadCategoryDetails()
  }
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Relatório de Custos" />
    </template>

    <template #body>
      <div class="space-y-4 p-4">
        <ReportsCostsFilters
          v-model:date-from="dateFrom"
          v-model:date-to="dateTo"
          v-model:selected-categories="selectedCategories"
          v-model:status-filters="statusFilters"
          :categories="availableCategories"
        />

        <ReportsCostsSummary
          :summary="summary"
          :category-count="pagination?.totalItems ?? items.length"
        />

        <ReportsCostsCharts
          :categories="chartCategories"
          :evolution="evolution"
        />

        <AppDataTable
          v-model:page="page"
          v-model:sorting="sorting"
          v-model:search-term="search"
          :columns="columns"
          :data="items as Record<string, unknown>[]"
          :loading="status === 'pending'"
          :page-size="pageSize"
          :total="pagination?.totalItems ?? items.length"
          :show-page-size-selector="false"
          show-search
          search-placeholder="Buscar categoria ou descrição..."
          empty-icon="i-lucide-wallet-cards"
          empty-title="Nenhum custo encontrado"
          empty-description="Não há categorias de custo para o período e filtros selecionados."
          @search-change="page = 1"
        >
          <template #toolbar-right>
            <p class="text-xs text-muted">
              {{ pagination?.totalItems ?? items.length }} categoria{{ (pagination?.totalItems ?? items.length) !== 1 ? 's' : '' }}
            </p>
          </template>

          <template #category-cell="{ row }">
            <button
              type="button"
              class="flex items-center gap-3 text-left transition-opacity hover:opacity-80"
              @click="openCategoryDetails(String(row.original.categoryKey ?? ''))"
            >
              <div
                class="flex size-8 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
                :style="{ backgroundColor: String(row.original.color || DEFAULT_CATEGORY_COLOR) }"
              >
                <UIcon :name="String(row.original.icon || DEFAULT_CATEGORY_ICON)" class="size-4" />
              </div>
              <div>
                <p class="font-medium text-highlighted">
                  {{ formatCategoryName(String(row.original.category ?? '')) }}
                </p>
                <p class="text-xs text-muted">
                  {{ formatPercent(Number(row.original.percentage ?? 0)) }} do total
                </p>
              </div>
            </button>
          </template>

          <template #amount-cell="{ row }">
            <span class="font-medium text-highlighted">
              {{ formatCurrency(Number(row.original.amount ?? 0)) }}
            </span>
          </template>

          <template #percentage-cell="{ row }">
            <div class="flex min-w-[180px] items-center gap-3">
              <UProgress
                :model-value="normalizePercent(Number(row.original.percentage ?? 0))"
                :max="100"
                size="sm"
                class="flex-1"
              />
              <span class="w-12 shrink-0 text-right text-sm font-medium text-highlighted">
                {{ formatPercent(Number(row.original.percentage ?? 0)) }}
              </span>
            </div>
          </template>

          <template #actions-cell="{ row }">
            <UButton
              icon="i-lucide-eye"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="openCategoryDetails(String(row.original.categoryKey ?? ''))"
            />
          </template>
        </AppDataTable>
      </div>

      <ReportsCostsCategoryDetailsSlideover
        :open="detailOpen"
        :loading="detailLoading"
        :data="detailData"
        @update:open="detailOpen = $event"
      />
    </template>
  </UDashboardPanel>
</template>
