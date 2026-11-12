<script setup lang="ts">
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

type ClientOption = { label: string, value: string }

const props = defineProps<{
  open: boolean
  vehicle: Vehicle | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const toast = useToast()
const isSaving = ref(false)
const isLookingUpPlate = ref(false)

// ─── Clients ──────────────────────────────────────────────────────────────────
const clientOptions = ref<ClientOption[]>([])
const isLoadingClients = ref(false)

async function loadClients() {
  if (clientOptions.value.length > 0) return
  isLoadingClients.value = true
  try {
    const res = await $fetch<{ items: { id: string, name: string }[] }>('/api/clients', {
      query: { page_size: 500 }
    })
    clientOptions.value = (res.items ?? []).map(c => ({ label: c.name, value: c.id }))
  } catch {
    toast.add({ title: 'Erro ao carregar clientes', color: 'error' })
  } finally {
    isLoadingClients.value = false
  }
}

// ─── Fuel options ─────────────────────────────────────────────────────────────
const fuelTypeOptions = [
  { label: 'Gasolina', value: 'gasoline' },
  { label: 'Etanol', value: 'ethanol' },
  { label: 'Flex', value: 'flex' },
  { label: 'Diesel', value: 'diesel' },
  { label: 'GNV', value: 'cng' },
  { label: 'Elétrico', value: 'electric' },
  { label: 'Híbrido', value: 'hybrid' }
]

// ─── Plate mask ───────────────────────────────────────────────────────────────
function formatPlate(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 7)
  if (/^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(clean))
    return clean.replace(/^([A-Z]{3})([0-9][A-Z][0-9]{2})$/, '$1-$2')
  if (/^[A-Z]{3}[0-9]{4}$/.test(clean))
    return clean.replace(/^([A-Z]{3})([0-9]{4})$/, '$1-$2')
  return clean
}

function onPlateInput(e: Event) {
  form.license_plate = formatPlate((e.target as HTMLInputElement).value)
}

// ─── Plate lookup ─────────────────────────────────────────────────────────────
async function lookupPlate() {
  const clean = form.license_plate.replace(/[^A-Z0-9]/g, '')
  if (clean.length < 7) {
    toast.add({ title: 'Digite uma placa válida (7 caracteres)', color: 'warning' })
    return
  }

  isLookingUpPlate.value = true
  try {
    const res = await $fetch<{
      brand?: string
      model?: string
      year?: number
      fuel_type?: string
      color?: string
      engine?: string
    }>('/api/vehicles/lookup-plate', { query: { plate: clean } })

    if (res.brand) form.brand = res.brand
    if (res.model) form.model = res.model
    if (res.year) form.year = String(res.year)
    if (res.fuel_type) form.fuel_type = res.fuel_type
    if (res.color) form.color = res.color
    if (res.engine) form.engine = res.engine

    toast.add({ title: 'Dados preenchidos com base na placa', color: 'success' })
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Não foi possível consultar a placa',
      description: err?.data?.statusMessage || err?.statusMessage || 'Verifique a placa e tente novamente.',
      color: 'warning'
    })
  } finally {
    isLookingUpPlate.value = false
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────
const errors = reactive<Record<string, string>>({})

function clearError(field: string) {
  Reflect.deleteProperty(errors, field)
}

function validate() {
  Object.keys(errors).forEach(k => Reflect.deleteProperty(errors, k))
  if (!form.client_id)
    errors.client_id = 'Selecione o cliente proprietário'
  return Object.keys(errors).length === 0
}

// ─── Form state ───────────────────────────────────────────────────────────────
const isEditing = computed(() => props.vehicle !== null)
const title = computed(() => isEditing.value ? 'Editar veículo' : 'Novo veículo')

function emptyForm() {
  return {
    client_id: '',
    license_plate: '',
    brand: '',
    model: '',
    year: '' as string | number,
    color: '',
    mileage: '' as string | number,
    engine: '',
    fuel_type: 'flex',
    notes: ''
  }
}

const form = reactive(emptyForm())

watch(
  () => props.open,
  (opened) => {
    if (!opened) return
    Object.keys(errors).forEach(k => Reflect.deleteProperty(errors, k))
    loadClients()

    if (props.vehicle) {
      Object.assign(form, {
        client_id: props.vehicle.client_id ?? '',
        license_plate: props.vehicle.license_plate ?? '',
        brand: props.vehicle.brand ?? '',
        model: props.vehicle.model ?? '',
        year: props.vehicle.year ?? '',
        color: props.vehicle.color ?? '',
        mileage: props.vehicle.mileage ?? '',
        engine: props.vehicle.engine ?? '',
        fuel_type: props.vehicle.fuel_type ?? 'flex',
        notes: props.vehicle.notes ?? ''
      })
    } else {
      Object.assign(form, emptyForm())
    }
  },
  { immediate: true }
)

async function save() {
  if (isSaving.value) return
  if (!validate()) {
    toast.add({ title: 'Corrija os erros antes de salvar', color: 'warning' })
    return
  }

  isSaving.value = true
  try {
    const body = {
      client_id: form.client_id,
      license_plate: form.license_plate || null,
      brand: form.brand || null,
      model: form.model || null,
      year: form.year !== '' ? Number(form.year) : null,
      color: form.color || null,
      mileage: form.mileage !== '' ? Number(form.mileage) : null,
      engine: form.engine || null,
      fuel_type: form.fuel_type || null,
      notes: form.notes || null
    }

    if (isEditing.value && props.vehicle) {
      await $fetch(`/api/vehicles/${props.vehicle.id}`, { method: 'PUT', body })
      toast.add({ title: 'Veículo atualizado', color: 'success' })
    } else {
      await $fetch('/api/vehicles', { method: 'POST', body })
      toast.add({ title: 'Veículo cadastrado', color: 'success' })
    }

    emit('update:open', false)
    emit('saved')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro',
      description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível salvar.',
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
    :title="title"
    :ui="{ body: 'overflow-y-auto max-h-[70vh]' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <!-- Cliente -->
        <UFormField
          label="Cliente"
          required
          class="sm:col-span-2"
          :error="errors.client_id"
        >
          <USelectMenu
            v-model="form.client_id"
            :items="clientOptions"
            value-key="value"
            searchable
            :loading="isLoadingClients"
            class="w-full"
            placeholder="Selecionar cliente..."
            @update:model-value="clearError('client_id')"
          />
        </UFormField>

        <!-- Placa com lookup -->
        <UFormField label="Placa" class="sm:col-span-2">
          <div class="flex gap-2">
            <UInput
              :model-value="form.license_plate"
              class="flex-1 font-mono uppercase"
              placeholder="Ex: ABC-1234 ou ABC1D23"
              maxlength="8"
              @input="onPlateInput"
            />
            <UTooltip text="Consultar dados pelo número da placa">
              <UButton
                icon="i-lucide-search"
                color="neutral"
                variant="outline"
                :loading="isLookingUpPlate"
                :disabled="isLookingUpPlate || form.license_plate.replace(/[^A-Z0-9]/g, '').length < 7"
                @click="lookupPlate"
              />
            </UTooltip>
          </div>
          <template #hint>
            <span class="text-xs text-muted">
              Digite a placa e clique na lupa para preencher os dados automaticamente
            </span>
          </template>
        </UFormField>

        <!-- Marca -->
        <UFormField label="Marca">
          <UInput v-model="form.brand" class="w-full uppercase" placeholder="Ex: TOYOTA" />
        </UFormField>

        <!-- Modelo -->
        <UFormField label="Modelo">
          <UInput v-model="form.model" class="w-full" placeholder="Ex: Corolla" />
        </UFormField>

        <!-- Ano -->
        <UFormField label="Ano">
          <UInput
            v-model.number="form.year"
            type="number"
            min="1900"
            max="2100"
            class="w-full"
            placeholder="Ex: 2021"
          />
        </UFormField>

        <!-- Cor -->
        <UFormField label="Cor">
          <UInput v-model="form.color" class="w-full" placeholder="Ex: Prata" />
        </UFormField>

        <!-- Motor -->
        <UFormField label="Motor">
          <UInput v-model="form.engine" class="w-full uppercase" placeholder="Ex: 1.0 16V, 2.0 TURBO" />
        </UFormField>

        <!-- Combustível -->
        <UFormField label="Combustível">
          <USelectMenu
            v-model="form.fuel_type"
            :items="fuelTypeOptions"
            value-key="value"
            class="w-full"
            placeholder="Selecionar..."
            :search-input="false"
          />
        </UFormField>

        <!-- Quilometragem -->
        <UFormField label="Quilometragem" class="sm:col-span-2">
          <UInput
            v-model.number="form.mileage"
            type="number"
            min="0"
            class="w-full"
            placeholder="Ex: 45000"
          />
        </UFormField>

        <!-- Observações -->
        <UFormField label="Observações" class="sm:col-span-2">
          <UTextarea v-model="form.notes" class="w-full" :rows="3" />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="Cancelar"
          color="neutral"
          variant="ghost"
          @click="emit('update:open', false)"
        />
        <UButton
          label="Salvar"
          color="neutral"
          :loading="isSaving"
          :disabled="isSaving"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
