<script setup lang="ts">
import type { TagFilterOption } from '~/components/ui/TagFilter.vue'

interface EmployeeOption {
  value: string
  label: string
}

export interface EmployeesFiltersProps {
  employees: EmployeeOption[]
  dateLabel?: string
  employeeLabel?: string
  commissionStatusLabel?: string
  recordTypeLabel?: string
  orderStatusLabel?: string
  paymentStatusLabel?: string
  paymentMethodLabel?: string
}

const props = withDefaults(defineProps<EmployeesFiltersProps>(), {
  dateLabel: 'Período',
  employeeLabel: 'Funcionário',
  commissionStatusLabel: 'Status comissão',
  recordTypeLabel: 'Tipo',
  orderStatusLabel: 'Status da OS',
  paymentStatusLabel: 'Pagamento da OS',
  paymentMethodLabel: 'Forma de pagamento'
})

const dateFrom = defineModel<string>('dateFrom')
const dateTo = defineModel<string>('dateTo')
const employeeId = defineModel<string>('employeeId', { default: '' })
const commissionStatus = defineModel<string[]>('commissionStatus', { default: () => [] })
const recordType = defineModel<string[]>('recordType', { default: () => [] })
const orderStatusFilters = defineModel<string[]>('orderStatusFilters', { default: () => [] })
const paymentStatusFilters = defineModel<string[]>('paymentStatusFilters', { default: () => [] })
const paymentMethods = defineModel<string[]>('paymentMethods', { default: () => [] })

const sortedEmployees = computed(() =>
  [...props.employees]
    .filter(employee => employee?.label)
    .sort((employeeA, employeeB) => employeeA.label.localeCompare(employeeB.label, 'pt-BR'))
)

const commissionStatusOptions: TagFilterOption[] = [
  { value: 'paid', label: 'Pagas', color: 'success', icon: 'i-lucide-circle-check' },
  { value: 'pending', label: 'Pendentes', color: 'warning', icon: 'i-lucide-clock' }
]

const recordTypeOptions: TagFilterOption[] = [
  { value: 'commission', label: 'Comissões', color: 'primary', icon: 'i-lucide-badge-percent' },
  { value: 'bonus', label: 'Bônus', color: 'info', icon: 'i-lucide-gift' }
]

const orderStatusOptions: TagFilterOption[] = [
  { value: 'open', label: 'Aberta', color: 'info', icon: 'i-lucide-circle-dot' },
  { value: 'in_progress', label: 'Em andamento', color: 'warning', icon: 'i-lucide-wrench' },
  { value: 'waiting_for_part', label: 'Aguard. peça', color: 'warning', icon: 'i-lucide-package-search' },
  { value: 'completed', label: 'Concluída', color: 'success', icon: 'i-lucide-check-circle-2' },
  { value: 'invoiced', label: 'Faturada', color: 'primary', icon: 'i-lucide-receipt' },
  { value: 'delivered', label: 'Entregue', color: 'success', icon: 'i-lucide-truck' },
  { value: 'estimate', label: 'Orçamento', color: 'neutral', icon: 'i-lucide-file-text' }
]

const paymentStatusOptions: TagFilterOption[] = [
  { value: 'pending', label: 'Pendente', color: 'warning', icon: 'i-lucide-clock' },
  { value: 'paid', label: 'Pago', color: 'success', icon: 'i-lucide-circle-check' },
  { value: 'partial', label: 'Parcial', color: 'info', icon: 'i-lucide-split' }
]

const paymentMethodOptions: TagFilterOption[] = [
  { value: 'cash', label: 'Dinheiro', color: 'neutral', icon: 'i-lucide-banknote' },
  { value: 'pix', label: 'Pix', color: 'success', icon: 'i-lucide-zap' },
  { value: 'credit_card', label: 'Cartão Crédito', color: 'primary', icon: 'i-lucide-credit-card' },
  { value: 'debit_card', label: 'Cartão Débito', color: 'info', icon: 'i-lucide-credit-card' },
  { value: 'bank_transfer', label: 'Transferência', color: 'neutral', icon: 'i-lucide-landmark' },
  { value: 'no_payment_method', label: 'Sem pagamento', color: 'error', icon: 'i-lucide-ban' }
]
</script>

<template>
  <UCard :ui="{ body: 'p-3' }">
    <div class="space-y-3 grid grid-cols-2 gap-3">
      <div class="flex items-center gap-2 text-muted col-span-2">
        <UIcon name="i-lucide-filter" class="size-4" />
        <span class="text-sm font-medium">Filtros</span>
      </div>

      <!-- Row 1: date range + employee -->
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

      <div>
        <p class="mb-1 text-xs font-medium text-muted">
          {{ props.employeeLabel }}
        </p>
        <UiAsyncPaginatedSelect
          v-model="employeeId"
          :items="sortedEmployees"
          :get-id="(employee: EmployeeOption) => employee.value"
          :get-label="(employee: EmployeeOption) => employee.label"
          placeholder="Selecione um funcionário"
          search-placeholder="Buscar funcionário..."
          empty-message="Nenhum funcionário encontrado"
          icon="i-lucide-user-round"
          item-icon="i-lucide-user-round"
          class="w-full"
        />
      </div>

      <!-- Row 2: commission status + record type -->
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 col-span-2">
        <div>
          <p class="mb-1 text-xs font-medium text-muted">
            {{ props.commissionStatusLabel }}
          </p>
          <UiTagFilter
            v-model="commissionStatus"
            :options="commissionStatusOptions"
            placeholder="Todos"
            class="w-full"
          />
        </div>
        <div>
          <p class="mb-1 text-xs font-medium text-muted">
            {{ props.recordTypeLabel }}
          </p>
          <UiTagFilter
            v-model="recordType"
            :options="recordTypeOptions"
            placeholder="Todos"
            class="w-full"
          />
        </div>
      </div>

      <!-- Row 3: OS status + payment status + payment method -->
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3 col-span-2">
        <div>
          <p class="mb-1 text-xs font-medium text-muted">
            {{ props.orderStatusLabel }}
          </p>
          <UiTagFilter
            v-model="orderStatusFilters"
            :options="orderStatusOptions"
            placeholder="Todos"
            class="w-full"
          />
        </div>
        <div>
          <p class="mb-1 text-xs font-medium text-muted">
            {{ props.paymentStatusLabel }}
          </p>
          <UiTagFilter
            v-model="paymentStatusFilters"
            :options="paymentStatusOptions"
            placeholder="Todos"
            class="w-full"
          />
        </div>
        <div>
          <p class="mb-1 text-xs font-medium text-muted">
            {{ props.paymentMethodLabel }}
          </p>
          <UiTagFilter
            v-model="paymentMethods"
            :options="paymentMethodOptions"
            placeholder="Todas"
            class="w-full"
          />
        </div>
      </div>
    </div>
  </UCard>
</template>
