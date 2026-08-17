<script setup lang="ts">
interface EmployeeRecord {
  id: string
  name?: string | null
}

interface EmployeesListResponse {
  items?: EmployeeRecord[]
}

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Relatório de Funcionários' })

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const { dateFrom, dateTo, orderStatusFilters, paymentStatusFilters, paymentMethodFilters, selectedEmployees } = useReportDateRange()
const paymentMethods = paymentMethodFilters

const commissionStatus = useReportQueryParam('commissionStatus', [] as string[])
const recordType = useReportQueryParam('recordType', [] as string[])

// Lightweight, filter-independent lookup just to populate the employee
// picker — deliberately not the (much heavier) /api/reports/employees
// endpoint, which pulls and aggregates every order/financial record for
// the organization. That endpoint is only called per-employee, lazily,
// once an accordion item is expanded (see ReportsEmployeesAccordion).
const { data: employeesList } = await useAsyncData(
  'report-employees-options',
  () => requestFetch<EmployeesListResponse>('/api/employees', { headers: requestHeaders }),
  { default: () => ({ items: [] }) }
)

const employeeOptions = computed(() =>
  (employeesList.value?.items ?? [])
    .map(employee => ({ value: employee.id, label: employee.name || 'Sem nome' }))
)

const employeeOptionsById = computed(() => new Map(employeeOptions.value.map(option => [option.value, option])))

const selectedEmployeeObjects = computed(() =>
  selectedEmployees.value.map(id => ({
    id,
    name: employeeOptionsById.value.get(id)?.label ?? 'Funcionário'
  }))
)
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Relatório de Funcionários" />
    </template>

    <template #body>
      <div class="space-y-4 p-4">
        <ReportsEmployeesFilters
          v-model:date-from="dateFrom"
          v-model:date-to="dateTo"
          v-model:employee-ids="selectedEmployees"
          v-model:commission-status="commissionStatus"
          v-model:record-type="recordType"
          v-model:order-status-filters="orderStatusFilters"
          v-model:payment-status-filters="paymentStatusFilters"
          v-model:payment-methods="paymentMethods"
          :employees="employeeOptions"
        />

        <UCard v-if="selectedEmployees.length === 0" :ui="{ body: 'p-8' }">
          <div class="flex flex-col items-center justify-center gap-2 text-center">
            <UIcon name="i-lucide-user-round-search" class="size-8 text-muted" />
            <p class="text-sm font-medium text-highlighted">
              Selecione um ou mais funcionários
            </p>
            <p class="text-sm text-muted">
              Escolha um ou mais funcionários no filtro acima para ver o relatório.
            </p>
          </div>
        </UCard>

        <ReportsEmployeesAccordion
          v-else
          :employees="selectedEmployeeObjects"
          :date-from="dateFrom"
          :date-to="dateTo"
          :order-status-filters="orderStatusFilters"
          :payment-status-filters="paymentStatusFilters"
          :payment-methods="paymentMethods"
          :commission-status="commissionStatus"
          :record-type="recordType"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
