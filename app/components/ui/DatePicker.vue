<script setup lang="ts">
import { CalendarDate, DateFormatter, getLocalTimeZone, parseDate } from '@internationalized/date'

const props = withDefaults(defineProps<{
  modelValue?: string | null
  placeholder?: string
  disabled?: boolean
  /** 'day' (default): full calendar, modelValue is "YYYY-MM-DD". 'month': month/year grid, modelValue is "YYYY-MM". */
  mode?: 'day' | 'month'
}>(), {
  modelValue: undefined,
  placeholder: 'Selecione uma data',
  disabled: false,
  mode: 'day'
})

const emit = defineEmits<{
  'update:modelValue': [value: string | undefined]
}>()

const popoverOpen = ref(false)

const dfShort = new DateFormatter('pt-BR', { dateStyle: 'short' })

// ─── Day mode ───────────────────────────────────────────────────────────────

function isoToCalendarDate(iso: string | null | undefined): CalendarDate | undefined {
  if (!iso) return undefined
  try {
    const parsed = parseDate(iso)
    return new CalendarDate(parsed.year, parsed.month, parsed.day)
  } catch {
    return undefined
  }
}

function calendarDateToISO(date: CalendarDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}

const calendarValue = computed({
  get: () => isoToCalendarDate(props.modelValue),
  set: (val) => {
    emit('update:modelValue', val ? calendarDateToISO(val) : undefined)
    popoverOpen.value = false
  }
})

function setToday() {
  const isoToday = new Date().toISOString().split('T')[0]
  emit('update:modelValue', isoToday)
  popoverOpen.value = false
}

// ─── Month mode ─────────────────────────────────────────────────────────────

const monthLabels = Array.from({ length: 12 }, (_, index) => {
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date(2000, index, 1)).replace('.', '')
  return label.charAt(0).toUpperCase() + label.slice(1)
})

function parseMonthValue(value: string | null | undefined): { year: number, month: number } | null {
  if (!value) return null
  const [year, month] = value.split('-').map(Number)
  if (!year || !month) return null
  return { year, month }
}

const selectedMonth = computed(() => parseMonthValue(props.modelValue))
const viewYear = ref(selectedMonth.value?.year ?? new Date().getFullYear())

watch(() => props.modelValue, () => {
  const parsed = parseMonthValue(props.modelValue)
  if (parsed) viewYear.value = parsed.year
})

function isSelectedMonth(monthIndex: number) {
  return selectedMonth.value?.year === viewYear.value && selectedMonth.value?.month === monthIndex + 1
}

function selectMonth(monthIndex: number) {
  emit('update:modelValue', `${viewYear.value}-${String(monthIndex + 1).padStart(2, '0')}`)
  popoverOpen.value = false
}

function setCurrentMonth() {
  const now = new Date()
  viewYear.value = now.getFullYear()
  emit('update:modelValue', `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  popoverOpen.value = false
}

// ─── Shared ─────────────────────────────────────────────────────────────────

const displayValue = computed(() => {
  if (props.mode === 'month') {
    const parsed = selectedMonth.value
    if (!parsed) return ''
    const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(parsed.year, parsed.month - 1, 1))
    return label.charAt(0).toUpperCase() + label.slice(1)
  }

  const d = isoToCalendarDate(props.modelValue)
  if (!d) return ''
  try {
    return dfShort.format(d.toDate(getLocalTimeZone()))
  } catch {
    return ''
  }
})

function clear() {
  emit('update:modelValue', undefined)
  popoverOpen.value = false
}
</script>

<template>
  <UPopover
    v-model:open="popoverOpen"
    :content="{ align: 'start', side: 'bottom', sideOffset: 8 }"
    :ui="{
      content: 'z-[260] w-[min(92vw,22rem)] rounded-xl border border-default bg-default p-0 shadow-xl'
    }"
    :modal="true"
  >
    <UButton
      color="neutral"
      variant="outline"
      block
      class="h-9 w-full justify-between gap-1.5 rounded-md border border-default bg-default px-3 py-2 text-sm shadow-xs"
      :disabled="disabled"
    >
      <span :class="displayValue ? 'text-highlighted' : 'text-dimmed'">
        {{ displayValue || placeholder }}
      </span>

      <template #trailing>
        <UIcon
          :name="mode === 'month' ? 'i-lucide-calendar-days' : 'i-lucide-calendar'"
          class="size-4 shrink-0 text-dimmed"
        />
      </template>
    </UButton>

    <template #content>
      <div class="overflow-hidden rounded-xl">
        <template v-if="mode === 'month'">
          <div class="flex items-center justify-between border-b border-default px-2 py-2">
            <UButton
              icon="i-lucide-chevron-left"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="viewYear--"
            />
            <span class="text-sm font-medium text-highlighted">{{ viewYear }}</span>
            <UButton
              icon="i-lucide-chevron-right"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="viewYear++"
            />
          </div>

          <div class="grid grid-cols-3 gap-1.5 p-3">
            <UButton
              v-for="(label, index) in monthLabels"
              :key="label"
              :label="label"
              :color="isSelectedMonth(index) ? 'primary' : 'neutral'"
              :variant="isSelectedMonth(index) ? 'solid' : 'ghost'"
              size="sm"
              block
              @click="selectMonth(index)"
            />
          </div>

          <div class="flex items-center gap-1 border-t border-default px-2 py-2">
            <UButton
              label="Mês atual"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="setCurrentMonth"
            />
            <UButton
              label="Limpar"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="clear"
            />
          </div>
        </template>

        <template v-else>
          <div class="p-2">
            <UCalendar
              v-model="calendarValue"
              locale="pt-BR"
              :week-starts-on="0"
              color="primary"
              class="w-full"
            />
          </div>

          <div class="flex items-center gap-1 border-t border-default px-2 py-2">
            <UButton
              label="Hoje"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="setToday"
            />
            <UButton
              label="Limpar"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="clear"
            />
          </div>
        </template>
      </div>
    </template>
  </UPopover>
</template>
