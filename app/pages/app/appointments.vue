<script setup lang="ts">
import { ActionCode } from '~/constants/action-codes'
import type { Appointment } from '~/types/appointments'
import {
  type CalendarView,
  toISO,
  getMonthRange,
  getWeekRange,
  getDayRange,
  buildMonthGrid,
  buildWeekDays,
  formatCalendarTitle
} from '~/utils/calendar'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Agendamentos' })

const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const canRead = computed(() => workshop.can(ActionCode.APPOINTMENTS_READ))
const canCreate = computed(() => workshop.can(ActionCode.APPOINTMENTS_CREATE))

// ─── Calendar navigation ──────────────────────────────────────────────────────

const calendarView = ref<CalendarView>('week')
const currentDate = ref(new Date())

const visibleRange = computed(() => {
  switch (calendarView.value) {
    case 'month': return getMonthRange(currentDate.value)
    case 'week': return getWeekRange(currentDate.value)
    default: return getDayRange(currentDate.value)
  }
})

const calendarTitle = computed(() => formatCalendarTitle(currentDate.value, calendarView.value))
const monthGrid = computed(() => buildMonthGrid(currentDate.value))
const weekDays = computed(() => buildWeekDays(currentDate.value))

function navigate(direction: 'prev' | 'next' | 'today') {
  if (direction === 'today') {
    currentDate.value = new Date()
    return
  }
  const d = new Date(currentDate.value)
  const delta = direction === 'next' ? 1 : -1
  if (calendarView.value === 'month') d.setMonth(d.getMonth() + delta)
  else if (calendarView.value === 'week') d.setDate(d.getDate() + delta * 7)
  else d.setDate(d.getDate() + delta)
  currentDate.value = d
}

// ─── Data fetching ────────────────────────────────────────────────────────────

const ALL_STATUS_VALUE = 'all'
const statusFilter = ref(ALL_STATUS_VALUE)

const { data, status, refresh } = await useAsyncData(
  () => `appointments-cal-${calendarView.value}-${visibleRange.value.from}-${visibleRange.value.to}-${statusFilter.value}`,
  () => requestFetch<{ items: Appointment[], total: number }>('/api/appointments', {
    headers: requestHeaders,
    query: {
      date_from: visibleRange.value.from,
      date_to: visibleRange.value.to,
      status: statusFilter.value !== ALL_STATUS_VALUE ? statusFilter.value : undefined,
      page_size: 500
    }
  }),
  { watch: [visibleRange, statusFilter] }
)

const filteredAppointments = computed(() => data.value?.items ?? [])

// ─── Modal ────────────────────────────────────────────────────────────────────

const showModal = ref(false)
const editingAppointment = ref<Appointment | null>(null)
const formPrefill = ref<{ date?: string, time?: string }>({})

function openCreate(payload?: { date?: Date, time?: string }) {
  editingAppointment.value = null
  formPrefill.value = {
    date: payload?.date ? toISO(payload.date) : toISO(currentDate.value),
    time: payload?.time
  }
  showModal.value = true
}

function openEdit(appt: Appointment) {
  editingAppointment.value = appt
  formPrefill.value = {}
  showModal.value = true
}

function handleCellClick(payload: { date: Date, time?: string }) {
  if (!canCreate.value) return
  openCreate(payload)
}

function handleOverflowClick(date: Date) {
  currentDate.value = date
  calendarView.value = 'day'
}

function handleDayClick(date: Date) {
  currentDate.value = date
  calendarView.value = 'day'
}

// ─── Status options ───────────────────────────────────────────────────────────

const statusOptions = [
  { label: 'Todos', value: ALL_STATUS_VALUE },
  { label: 'Agendado', value: 'scheduled' },
  { label: 'Confirmado', value: 'confirmed' },
  { label: 'Concluído', value: 'completed' },
  { label: 'Cancelado', value: 'cancelled' }
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Agendamentos" />
    </template>

    <template #body>
      <div v-if="!canRead" class="p-6">
        <p class="text-sm text-muted">
          Você não tem permissão para visualizar agendamentos.
        </p>
      </div>

      <div v-else class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.25rem] border border-default/90 bg-default shadow-sm">
        <!-- Calendar toolbar -->
        <AppointmentsCalendarHeader
          :view="calendarView"
          :title="calendarTitle"
          :status-filter="statusFilter"
          :status-options="statusOptions"
          @update:view="calendarView = $event"
          @update:status-filter="statusFilter = $event"
          @prev="navigate('prev')"
          @next="navigate('next')"
          @today="navigate('today')"
        />

        <!-- Loading skeleton -->
        <div v-if="status === 'pending'" class="flex-1 space-y-3 overflow-hidden p-4">
          <USkeleton v-for="i in 8" :key="i" class="h-14 w-full" />
        </div>

        <!-- Month view -->
        <AppointmentsCalendarMonthView
          v-else-if="calendarView === 'month'"
          :current-date="currentDate"
          :month-grid="monthGrid"
          :appointments="filteredAppointments"
          @cell-click="handleCellClick({ date: $event })"
          @event-click="openEdit"
          @overflow-click="handleOverflowClick"
        />

        <!-- Week view -->
        <AppointmentsCalendarWeekView
          v-else-if="calendarView === 'week'"
          :current-date="currentDate"
          :week-days="weekDays"
          :appointments="filteredAppointments"
          @cell-click="handleCellClick"
          @event-click="openEdit"
          @day-click="handleDayClick"
        />

        <!-- Day view -->
        <AppointmentsCalendarDayView
          v-else
          :current-date="currentDate"
          :appointments="filteredAppointments"
          @cell-click="handleCellClick"
          @event-click="openEdit"
        />
      </div>
    </template>
  </UDashboardPanel>

  <!-- Form modal (create / edit / delete) -->
  <AppointmentsFormModal
    v-model:open="showModal"
    :appointment="editingAppointment"
    :prefill="formPrefill"
    @saved="refresh"
  />
</template>
