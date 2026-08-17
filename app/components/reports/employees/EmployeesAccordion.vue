<script setup lang="ts">
/**
 * One accordion item per selected employee. Each item's report (stats +
 * OS/comissões/itens table, see EmployeesAccordionPanel) is only fetched
 * once the user actually expands that employee — selecting 10 employees in
 * the filter above does not fire 10 requests, only expanding does.
 *
 * `unmount-on-hide="false"` on UAccordion keeps a panel's Vue instance (and
 * its already-fetched data) alive after it's collapsed again, so toggling
 * an employee open/closed/open never re-fetches — only a change to one of
 * the shared filters does (see the watcher inside the panel).
 */

interface EmployeeOption {
  id: string
  name: string
}

const props = defineProps<{
  employees: EmployeeOption[]
  dateFrom?: string
  dateTo?: string
  orderStatusFilters: string[]
  paymentStatusFilters: string[]
  paymentMethods: string[]
  commissionStatus: string[]
  recordType: string[]
}>()

const openValues = ref<string[]>([])
const renderedIds = ref<Set<string>>(new Set())

watch(openValues, (values) => {
  if (values.some(value => !renderedIds.value.has(value))) {
    renderedIds.value = new Set([...renderedIds.value, ...values])
  }
}, { immediate: true })

const items = computed(() => props.employees.map(employee => ({
  label: employee.name,
  value: employee.id,
  icon: 'i-lucide-user-round'
})))
</script>

<template>
  <UAccordion
    v-model="openValues"
    type="multiple"
    :items="items"
    :unmount-on-hide="false"
    :ui="{
      root: 'flex flex-col gap-3',
      item: 'border border-default rounded-xl px-3 bg-default',
      trigger: 'py-3',
      label: 'font-semibold text-highlighted',
      body: 'pb-4'
    }"
  >
    <template #body="{ item }">
      <ReportsEmployeesAccordionPanel
        v-if="renderedIds.has(item.value)"
        :employee-id="item.value"
        :employee-name="item.label"
        :date-from="dateFrom"
        :date-to="dateTo"
        :order-status-filters="orderStatusFilters"
        :payment-status-filters="paymentStatusFilters"
        :payment-methods="paymentMethods"
        :commission-status="commissionStatus"
        :record-type="recordType"
      />
    </template>
  </UAccordion>
</template>
