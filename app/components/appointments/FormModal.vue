<script setup lang="ts">
import type { Appointment } from '~/types/appointments'
import { ActionCode } from '~/constants/action-codes'

const props = defineProps<{
  open: boolean
  appointment: Appointment | null
  prefill?: { date?: string, time?: string }
}>()

const emit = defineEmits<{
  'update:open': [v: boolean]
  'saved': []
}>()

const toast = useToast()
const isSaving = ref(false)
const isDeleting = ref(false)

// ─── Options ──────────────────────────────────────────────────────────────────
const clientOptions = ref<{ label: string, value: string }[]>([])
const vehicleOptions = ref<{ label: string, value: string }[]>([])
const isLoadingClients = ref(false)
const isLoadingVehicles = ref(false)

async function loadOptions() {
  if (!clientOptions.value.length) {
    isLoadingClients.value = true
    try {
      const res = await $fetch<{ items: { id: string, name: string }[] }>('/api/clients', {
        query: { page_size: 500 }
      })
      clientOptions.value = (res.items ?? []).map(c => ({ label: c.name, value: c.id }))
    } catch { /* silent */ } finally { isLoadingClients.value = false }
  }

  if (!vehicleOptions.value.length) {
    isLoadingVehicles.value = true
    try {
      const res = await $fetch<{ items: { id: string, brand: string | null, model: string | null, license_plate: string | null }[] }>('/api/vehicles', {
        query: { page_size: 500 }
      })
      vehicleOptions.value = (res.items ?? []).map(v => ({
        label: [v.brand, v.model, v.license_plate].filter(Boolean).join(' - '),
        value: v.id
      }))
    } catch { /* silent */ } finally { isLoadingVehicles.value = false }
  }
}

// ─── Form ─────────────────────────────────────────────────────────────────────
const NO_PRIORITY = 'none'
const isEditing = computed(() => props.appointment !== null)
const workshop = useWorkshopPermissions()
const canUpdate = computed(() => workshop.can(ActionCode.APPOINTMENTS_UPDATE))
const canDelete = computed(() => workshop.can(ActionCode.APPOINTMENTS_DELETE))
const title = computed(() => isEditing.value ? 'Editar agendamento' : 'Novo agendamento')

const statusFormOptions = [
  { label: 'Agendado', value: 'scheduled' },
  { label: 'Confirmado', value: 'confirmed' },
  { label: 'Concluído', value: 'completed' },
  { label: 'Cancelado', value: 'cancelled' }
]

const priorityOptions = [
  { label: 'Sem prioridade', value: NO_PRIORITY },
  { label: 'Baixa', value: 'low' },
  { label: 'Média', value: 'medium' },
  { label: 'Alta', value: 'high' }
]

function emptyForm() {
  return {
    client_id: '',
    vehicle_id: '',
    appointment_date: '',
    time: '',
    service_type: '',
    priority: NO_PRIORITY,
    status: 'scheduled',
    notes: ''
  }
}

const form = reactive(emptyForm())

// ─── BR date/time display helpers ────────────────────────────────────────────
const dateDisplay = ref('')
const timeDisplay = ref('')

function isoToDisplay(iso: string): string {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

function displayToIso(display: string): string {
  const m = display?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}

function handleDateInput(val: string | number) {
  const raw = String(val).replace(/\D/g, '').slice(0, 8)
  let formatted = ''
  if (raw.length > 0) formatted = raw.slice(0, 2)
  if (raw.length > 2) formatted += '/' + raw.slice(2, 4)
  if (raw.length > 4) formatted += '/' + raw.slice(4, 8)
  dateDisplay.value = formatted
  form.appointment_date = displayToIso(formatted)
}

function handleTimeInput(val: string | number) {
  const raw = String(val).replace(/\D/g, '').slice(0, 4)
  let formatted = ''
  if (raw.length > 0) formatted = raw.slice(0, 2)
  if (raw.length > 2) formatted += ':' + raw.slice(2, 4)
  timeDisplay.value = formatted
  form.time = formatted.length === 5 ? formatted : ''
}

watch(
  () => props.open,
  (opened) => {
    if (!opened) return
    loadOptions()

    if (props.appointment) {
      Object.assign(form, {
        client_id: props.appointment.client_id ?? '',
        vehicle_id: props.appointment.vehicle_id ?? '',
        appointment_date: props.appointment.appointment_date ?? '',
        time: props.appointment.time ?? '',
        service_type: props.appointment.service_type ?? '',
        priority: props.appointment.priority || NO_PRIORITY,
        status: props.appointment.status ?? 'scheduled',
        notes: props.appointment.notes ?? ''
      })
    } else {
      Object.assign(form, emptyForm())
      if (props.prefill?.date) form.appointment_date = props.prefill.date
      if (props.prefill?.time) form.time = props.prefill.time
    }
    dateDisplay.value = isoToDisplay(form.appointment_date)
    timeDisplay.value = form.time || ''
  }
)

async function save() {
  if (isSaving.value) return
  if (!form.client_id) {
    toast.add({ title: 'Cliente obrigatório', color: 'warning' })
    return
  }
  if (!form.vehicle_id) {
    toast.add({ title: 'Veículo obrigatório', color: 'warning' })
    return
  }
  if (!form.appointment_date) {
    toast.add({ title: 'Data obrigatória', color: 'warning' })
    return
  }
  if (!form.time) {
    toast.add({ title: 'Horário obrigatório', color: 'warning' })
    return
  }
  if (!form.service_type) {
    toast.add({ title: 'Tipo de serviço obrigatório', color: 'warning' })
    return
  }

  isSaving.value = true
  try {
    const body = {
      client_id: form.client_id,
      vehicle_id: form.vehicle_id,
      appointment_date: form.appointment_date,
      time: form.time,
      service_type: form.service_type,
      priority: form.priority !== NO_PRIORITY ? form.priority : null,
      status: form.status,
      notes: form.notes || null
    }

    if (isEditing.value && props.appointment) {
      await $fetch(`/api/appointments/${props.appointment.id}`, { method: 'PUT', body })
      toast.add({ title: 'Agendamento atualizado', color: 'success' })
    } else {
      await $fetch('/api/appointments', { method: 'POST', body })
      toast.add({ title: 'Agendamento criado', color: 'success' })
    }

    emit('update:open', false)
    emit('saved')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro',
      description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível salvar',
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}

async function remove() {
  if (!props.appointment || isDeleting.value) return
  isDeleting.value = true
  try {
    await $fetch(`/api/appointments/${props.appointment.id}`, { method: 'DELETE' })
    toast.add({ title: 'Agendamento removido', color: 'success' })
    emit('update:open', false)
    emit('saved')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro',
      description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível remover',
      color: 'error'
    })
  } finally {
    isDeleting.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="title"
    :ui="{ body: 'overflow-y-auto max-h-[75vh]' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="Cliente" required class="sm:col-span-2">
            <USelectMenu
              v-model="form.client_id"
              :items="clientOptions"
              value-key="value"
              searchable
              :loading="isLoadingClients"
              placeholder="Selecione o cliente"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Veículo" required class="sm:col-span-2">
            <USelectMenu
              v-model="form.vehicle_id"
              :items="vehicleOptions"
              value-key="value"
              searchable
              :loading="isLoadingVehicles"
              placeholder="Selecione o veículo"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Data" required>
            <UInput
              :model-value="dateDisplay"
              type="text"
              placeholder="DD/MM/AAAA"
              maxlength="10"
              inputmode="numeric"
              class="w-full"
              @update:model-value="handleDateInput"
            />
          </UFormField>

          <UFormField label="Horário" required>
            <UInput
              :model-value="timeDisplay"
              type="text"
              placeholder="HH:MM"
              maxlength="5"
              inputmode="numeric"
              class="w-full"
              @update:model-value="handleTimeInput"
            />
          </UFormField>

          <UFormField label="Tipo de serviço" required class="sm:col-span-2">
            <UInput
              v-model="form.service_type"
              placeholder="Ex: Troca de óleo, Revisão..."
              class="w-full"
            />
          </UFormField>

          <UFormField label="Prioridade">
            <USelectMenu
              v-model="form.priority"
              :items="priorityOptions"
              value-key="value"
              class="w-full"
              :search-input="false"
            />
          </UFormField>

          <UFormField label="Status">
            <USelectMenu
              v-model="form.status"
              :items="statusFormOptions"
              value-key="value"
              class="w-full"
              :search-input="false"
            />
          </UFormField>
        </div>

        <UFormField label="Observações">
          <UTextarea v-model="form.notes" class="w-full" :rows="3" />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between gap-2">
        <UButton
          v-if="isEditing && canDelete"
          label="Excluir"
          color="error"
          variant="ghost"
          :loading="isDeleting"
          @click="remove"
        />
        <div class="ml-auto flex gap-2">
          <UButton
            label="Cancelar"
            color="neutral"
            variant="ghost"
            @click="emit('update:open', false)"
          />
          <UButton
            v-if="!isEditing || canUpdate"
            label="Salvar"
            color="neutral"
            :loading="isSaving"
            :disabled="isSaving"
            @click="save"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
