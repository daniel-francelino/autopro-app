<script setup lang='ts'>
import type { Client } from '~/types/clients'
import { ActionCode } from '~/constants/action-codes'

type Vehicle = {
  id: string
  client_id: string
  license_plate: string | null
  brand: string | null
  model: string | null
  year: number | null
  color: string | null
  engine: string | null
  fuel_type: string | null
  mileage: number | null
  notes: string | null
}

const props = defineProps<{
  open: boolean
  client: Client | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const toast = useToast()
const workshop = useWorkshopPermissions()
const canCreate = computed(() => workshop.can(ActionCode.VEHICLES_CREATE))
const canUpdate = computed(() => workshop.can(ActionCode.VEHICLES_UPDATE))
const canDelete = computed(() => workshop.can(ActionCode.VEHICLES_DELETE))

const isOpen = computed({
  get: () => props.open,
  set: val => emit('update:open', val)
})

const vehiclesList = ref<Vehicle[]>([])
const isLoadingVehicles = ref(false)
const showVehicleForm = ref(false)
const isEditingVehicle = ref(false)
const isSavingVehicle = ref(false)
const isDeletingVehicle = ref(false)
const editingVehicleId = ref<string | null>(null)

const emptyVehicleForm = () => ({
  license_plate: '',
  brand: '',
  model: '',
  year: '' as string | number,
  color: '',
  engine: '',
  fuel_type: '' as string,
  mileage: '' as string | number,
  notes: ''
})
const vehicleForm = reactive(emptyVehicleForm())

const fuelTypeOptions = [
  { label: 'Gasolina', value: 'gasoline' },
  { label: 'Etanol', value: 'ethanol' },
  { label: 'Flex', value: 'flex' },
  { label: 'Diesel', value: 'diesel' },
  { label: 'GNV', value: 'cng' },
  { label: 'Elétrico', value: 'electric' },
  { label: 'Híbrido', value: 'hybrid' }
]

const fuelLabelMap: Record<string, string> = {
  gasoline: 'Gasolina',
  ethanol: 'Etanol',
  flex: 'Flex',
  diesel: 'Diesel',
  cng: 'GNV',
  electric: 'Elétrico',
  hybrid: 'Híbrido'
}

const modalTitle = computed(() => {
  if (!showVehicleForm.value)
    return `Veículos de ${props.client?.name ?? ''}`
  return isEditingVehicle.value ? 'Editar veículo' : 'Novo veículo'
})

watch(() => props.open, async (val) => {
  if (val && props.client) {
    showVehicleForm.value = false
    await loadVehicles(props.client.id)
  }
})

async function loadVehicles(clientId: string) {
  isLoadingVehicles.value = true
  try {
    const result = await $fetch<{ items: Vehicle[] }>('/api/vehicles', {
      query: { client_id: clientId, page_size: 100 }
    })
    vehiclesList.value = result.items ?? []
  } catch {
    toast.add({ title: 'Erro ao carregar veículos', color: 'error' })
  } finally {
    isLoadingVehicles.value = false
  }
}

function openNewVehicle() {
  Object.assign(vehicleForm, emptyVehicleForm())
  isEditingVehicle.value = false
  editingVehicleId.value = null
  showVehicleForm.value = true
}

function openEditVehicle(v: Vehicle) {
  Object.assign(vehicleForm, {
    license_plate: v.license_plate ?? '',
    brand: v.brand ?? '',
    model: v.model ?? '',
    year: v.year ?? '',
    color: v.color ?? '',
    engine: v.engine ?? '',
    fuel_type: v.fuel_type ?? '',
    mileage: v.mileage ?? '',
    notes: v.notes ?? ''
  })
  isEditingVehicle.value = true
  editingVehicleId.value = v.id
  showVehicleForm.value = true
}

async function saveVehicle() {
  if (isSavingVehicle.value) return
  isSavingVehicle.value = true
  try {
    const body = {
      client_id: props.client!.id,
      license_plate: vehicleForm.license_plate || null,
      brand: vehicleForm.brand || null,
      model: vehicleForm.model || null,
      year: vehicleForm.year !== '' ? Number(vehicleForm.year) : null,
      color: vehicleForm.color || null,
      engine: vehicleForm.engine || null,
      fuel_type: vehicleForm.fuel_type || null,
      mileage: vehicleForm.mileage !== '' ? Number(vehicleForm.mileage) : null,
      notes: vehicleForm.notes || null
    }
    if (isEditingVehicle.value && editingVehicleId.value) {
      await $fetch(`/api/vehicles/${editingVehicleId.value}`, { method: 'PUT', body })
      toast.add({ title: 'Veículo atualizado', color: 'success' })
    } else {
      await $fetch('/api/vehicles', { method: 'POST', body })
      toast.add({ title: 'Veículo cadastrado', color: 'success' })
    }
    showVehicleForm.value = false
    await loadVehicles(props.client!.id)
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Erro',
      description: err?.data?.statusMessage || 'Não foi possível salvar',
      color: 'error'
    })
  } finally {
    isSavingVehicle.value = false
  }
}

async function deleteVehicle(v: Vehicle) {
  if (isDeletingVehicle.value) return
  isDeletingVehicle.value = true
  try {
    await $fetch(`/api/vehicles/${v.id}`, { method: 'DELETE' })
    toast.add({ title: 'Veículo removido', color: 'success' })
    await loadVehicles(props.client!.id)
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Erro',
      description: err?.data?.statusMessage || 'Não foi possível remover',
      color: 'error'
    })
  } finally {
    isDeletingVehicle.value = false
  }
}

function vehicleLabel(v: Vehicle): string {
  return [v.brand, v.model].filter(Boolean).join(' ') || 'Veículo sem nome'
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :title="modalTitle"
    :ui="{ body: 'overflow-y-auto max-h-[70vh]' }"
  >
    <template #body>
      <!-- Lista de veículos -->
      <template v-if="!showVehicleForm">
        <div v-if="isLoadingVehicles" class="space-y-2">
          <USkeleton
            v-for="i in 3"
            :key="i"
            class="h-16 w-full rounded-lg"
          />
        </div>

        <div
          v-else-if="vehiclesList.length > 0"
          class="space-y-2"
        >
          <div
            v-for="v in vehiclesList"
            :key="v.id"
            class="flex items-center justify-between gap-4 rounded-lg border border-default p-3 transition-colors hover:bg-elevated"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate font-semibold text-highlighted">
                {{ vehicleLabel(v) }}
                <span
                  v-if="v.year"
                  class="ml-1 text-sm font-normal text-muted"
                >
                  · {{ v.year }}
                </span>
              </p>
              <div class="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                <span v-if="v.license_plate">Placa: <strong>{{ v.license_plate }}</strong></span>
                <span v-if="v.color">{{ v.color }}</span>
                <span v-if="v.fuel_type">{{ fuelLabelMap[v.fuel_type] ?? v.fuel_type }}</span>
                <span v-if="v.mileage">{{ v.mileage.toLocaleString('pt-BR') }} km</span>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <UButton
                v-if="canUpdate"
                icon="i-lucide-pencil"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="openEditVehicle(v)"
              />
              <UButton
                v-if="canDelete"
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                :loading="isDeletingVehicle"
                @click="deleteVehicle(v)"
              />
            </div>
          </div>
        </div>

        <div
          v-else
          class="space-y-3 py-10 text-center text-muted"
        >
          <UIcon
            name="i-lucide-car"
            class="mx-auto size-12 opacity-30"
          />
          <p class="text-sm">
            Nenhum veículo cadastrado para este cliente
          </p>
        </div>
      </template>

      <!-- Formulário de veículo -->
      <template v-else>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="Placa">
            <UInput
              v-model="vehicleForm.license_plate"
              class="w-full uppercase"
              placeholder="ABC1D23"
            />
          </UFormField>
          <UFormField label="Combustível">
            <USelectMenu
              v-model="vehicleForm.fuel_type"
              :items="fuelTypeOptions"
              value-key="value"
              class="w-full"
              placeholder="Selecionar..."
            />
          </UFormField>
          <UFormField label="Marca">
            <UInput
              v-model="vehicleForm.brand"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Modelo">
            <UInput
              v-model="vehicleForm.model"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Ano">
            <UInput
              v-model="vehicleForm.year"
              type="number"
              min="1900"
              max="2100"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Cor">
            <UInput
              v-model="vehicleForm.color"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Quilometragem">
            <UInput
              v-model="vehicleForm.mileage"
              type="number"
              min="0"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Motor">
            <UInput
              v-model="vehicleForm.engine"
              class="w-full"
              placeholder="Ex: 1.0 Turbo"
            />
          </UFormField>
          <UFormField
            label="Observações"
            class="sm:col-span-2"
          >
            <UTextarea
              v-model="vehicleForm.notes"
              class="w-full"
              :rows="2"
            />
          </UFormField>
        </div>
      </template>
    </template>

    <template #footer>
      <div
        v-if="!showVehicleForm"
        class="flex w-full items-center justify-end"
      >
        <UButton
          v-if="canCreate"
          label="Adicionar veículo"
          icon="i-lucide-plus"
          color="neutral"
          @click="openNewVehicle"
        />
      </div>
      <div
        v-else
        class="flex w-full justify-end gap-2"
      >
        <UButton
          label="Cancelar"
          color="neutral"
          variant="ghost"
          @click="showVehicleForm = false"
        />
        <UButton
          label="Salvar"
          color="neutral"
          :loading="isSavingVehicle"
          :disabled="isSavingVehicle"
          @click="saveVehicle"
        />
      </div>
    </template>
  </UModal>
</template>
