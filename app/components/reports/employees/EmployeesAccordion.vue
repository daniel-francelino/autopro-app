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
      root: 'flex flex-col gap-4',
      item: 'border border-default rounded-2xl overflow-hidden bg-default',
      header: 'bg-elevated/60 hover:bg-elevated/80 data-[state=open]:bg-elevated/80 transition-colors',
      trigger: 'px-4 py-3.5',
      label: 'font-semibold text-highlighted',
      trailingIcon: 'text-muted',
      body: 'px-4 pt-4 pb-5'
    }"
  >
    <template #leading="{ item }">
      <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <UIcon :name="item.icon" class="size-4 text-primary" />
      </span>
    </template>

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
