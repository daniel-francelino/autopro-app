<script setup lang="ts">
const props = defineProps<{
  statusFilter: string
  clientIdFilter: string
  vehicleIdFilter: string
  responsibleIdFilter: string
  dateFrom: string
  dateTo: string
}>()

const emit = defineEmits<{
  'update:statusFilter': [v: string]
  'update:clientIdFilter': [v: string]
  'update:vehicleIdFilter': [v: string]
  'update:responsibleIdFilter': [v: string]
  'update:dateFrom': [v: string]
  'update:dateTo': [v: string]
}>()

// ─── Options ──────────────────────────────────────────────────────────────────

const statusOptions = [
  { label: 'Todos os status', value: 'all' },
  { label: 'Orçamento', value: 'estimate' },
  { label: 'Aberta', value: 'open' },
  { label: 'Em andamento', value: 'in_progress' },
  { label: 'Aguard. peça', value: 'waiting_for_part' },
  { label: 'Concluída', value: 'completed' },
  { label: 'Faturada', value: 'invoiced' },
  { label: 'Entregue', value: 'delivered' },
  { label: 'Cancelada', value: 'cancelled' }
]

interface SelectOption {
  label: string
  value: string
}

interface ClientItem {
  id: string
  name: string
}

interface VehicleItem {
  id: string
  brand: string | null
  model: string | null
  license_plate: string | null
}

interface EmployeeItem {
  id: string
  name: string
}

const clientOptions = ref<SelectOption[]>([])
const vehicleOptions = ref<SelectOption[]>([])
const employeeOptions = ref<SelectOption[]>([])
const isLoaded = ref(false)
const isLoading = ref(false)

async function loadOptions() {
  if (isLoaded.value || isLoading.value) return
  isLoading.value = true
  try {
    const [clientsRes, vehiclesRes, employeesRes] = await Promise.all([
      $fetch<{ items: ClientItem[] }>('/api/clients', { query: { page_size: 500 } }),
      $fetch<{ items: VehicleItem[] }>('/api/vehicles', { query: { page_size: 500 } }),
      $fetch<{ items: EmployeeItem[] }>('/api/employees')
    ])
    clientOptions.value = (clientsRes.items ?? []).map(c => ({ label: c.name, value: c.id }))
    vehicleOptions.value = (vehiclesRes.items ?? []).map(v => ({
      label: [v.brand, v.model, v.license_plate].filter(Boolean).join(' - ') || v.license_plate || '—',
      value: v.id
    }))
    employeeOptions.value = (employeesRes.items ?? []).map(e => ({ label: e.name, value: e.id }))
  } catch {
    // silent - filters still work with empty options
  } finally {
    isLoading.value = false
    isLoaded.value = true
  }
}

// ─── Active count ─────────────────────────────────────────────────────────────

const activeCount = computed(() => {
  let count = 0
  if (props.statusFilter !== 'all') count++
  if (props.clientIdFilter !== 'all') count++
  if (props.vehicleIdFilter !== 'all') count++
  if (props.responsibleIdFilter !== 'all') count++
  if (props.dateFrom || props.dateTo) count++
  return count
})

// ─── Local v-models ───────────────────────────────────────────────────────────

const localStatus = computed({
  get: () => props.statusFilter,
  set: v => emit('update:statusFilter', v)
})

const localClient = computed({
  get: () => props.clientIdFilter,
  set: v => emit('update:clientIdFilter', v)
})

const localVehicle = computed({
  get: () => props.vehicleIdFilter,
  set: v => emit('update:vehicleIdFilter', v)
})

const localResponsible = computed({
  get: () => props.responsibleIdFilter,
  set: v => emit('update:responsibleIdFilter', v)
})

const localDateFrom = computed({
  get: () => props.dateFrom,
  set: v => emit('update:dateFrom', v)
})

const localDateTo = computed({
  get: () => props.dateTo,
  set: v => emit('update:dateTo', v)
})

function clearAll() {
  emit('update:statusFilter', 'all')
  emit('update:clientIdFilter', 'all')
  emit('update:vehicleIdFilter', 'all')
  emit('update:responsibleIdFilter', 'all')
  emit('update:dateFrom', '')
  emit('update:dateTo', '')
}
</script>

<template>
  <UPopover @update:open="(v) => v && loadOptions()">
    <UButton
      icon="i-lucide-sliders-horizontal"
      :label="activeCount > 0 ? `Filtros (${activeCount})` : 'Filtros'"
      color="neutral"
      variant="outline"
      size="sm"
      :class="activeCount > 0 ? 'text-primary border-primary/50' : ''"
    />
    <template #content>
      <div class="w-72 space-y-3 p-3">
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold text-highlighted">Filtros</span>
          <UButton
            v-if="activeCount > 0"
            label="Limpar"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="clearAll"
          />
        </div>

        <!-- Status -->
        <UFormField label="Status">
          <USelectMenu
            v-model="localStatus"
            :items="statusOptions"
            value-key="value"
            class="w-full"
            :search-input="false"
            :clear="localStatus !== 'all'"
            @clear="localStatus = 'all'"
          />
        </UFormField>

        <!-- Cliente -->
        <UFormField label="Cliente">
          <USelectMenu
            v-model="localClient"
            :items="[{ label: 'Todos os clientes', value: 'all' }, ...clientOptions]"
            value-key="value"
            class="w-full"
            :loading="isLoading"
            searchable
            :clear="localClient !== 'all'"
            @clear="localClient = 'all'"
          />
        </UFormField>

        <!-- Veículo -->
        <UFormField label="Veículo">
          <USelectMenu
            v-model="localVehicle"
            :items="[{ label: 'Todos os veículos', value: 'all' }, ...vehicleOptions]"
            value-key="value"
            class="w-full"
            :loading="isLoading"
            searchable
            :clear="localVehicle !== 'all'"
            @clear="localVehicle = 'all'"
          />
        </UFormField>

        <!-- Responsável -->
        <UFormField label="Responsável">
          <USelectMenu
            v-model="localResponsible"
            :items="[{ label: 'Todos os responsáveis', value: 'all' }, ...employeeOptions]"
            value-key="value"
            class="w-full"
            :loading="isLoading"
            searchable
            :clear="localResponsible !== 'all'"
            @clear="localResponsible = 'all'"
          />
        </UFormField>

        <!-- Data de entrada -->
        <UFormField label="Data de entrada">
          <UiDateRangePicker
            :from="localDateFrom"
            :to="localDateTo"
            placeholder="Selecione um período"
            class="w-full"
            @update:from="v => emit('update:dateFrom', v ?? '')"
            @update:to="v => emit('update:dateTo', v ?? '')"
          />
        </UFormField>
      </div>
    </template>
  </UPopover>
</template>
