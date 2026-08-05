<script setup lang="ts">
import {
  CalendarDate,
  DateFormatter,
  getLocalTimeZone,
  parseDate,
  today
} from '@internationalized/date'
import type { DateRange, DateValue } from '@internationalized/date'

const props = withDefaults(
  defineProps<{
    from?: string | null
    to?: string | null
    placeholder?: string
    disabled?: boolean
    label?: string
  }>(),
  {
    from: undefined,
    to: undefined,
    placeholder: 'Selecione um período',
    disabled: false,
    label: undefined
  }
)

const emit = defineEmits<{
  'update:from': [value: string | undefined]
  'update:to': [value: string | undefined]
}>()

const popoverOpen = ref(false)
const dfShort = new DateFormatter('pt-BR', { dateStyle: 'short' })
const tz = getLocalTimeZone()

// Staged (pending) selection — only emitted to the parent when the user
// clicks "Confirmar". This avoids the previous behavior where every click
// on the calendar re-emitted the range and triggered a full data reload.
const localFrom = ref<string | undefined>(props.from ?? undefined)
const localTo = ref<string | undefined>(props.to ?? undefined)

watch(popoverOpen, (open) => {
  if (open) {
    localFrom.value = props.from ?? undefined
    localTo.value = props.to ?? undefined
  }
})

function isoToCalendarDate(
  iso: string | null | undefined
): CalendarDate | undefined {
  if (!iso) return undefined
  try {
    const parsed = parseDate(iso)
    return new CalendarDate(parsed.year, parsed.month, parsed.day)
  } catch {
    return undefined
  }
}

function calendarDateToISO(date: DateValue): string {
  const d = date as CalendarDate
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

const calendarValue = computed<DateRange>({
  get: () => ({
    start: isoToCalendarDate(localFrom.value),
    end: isoToCalendarDate(localTo.value)
  }),
  set: (val) => {
    localFrom.value = val?.start ? calendarDateToISO(val.start) : undefined
    localTo.value = val?.end ? calendarDateToISO(val.end) : undefined
  }
})

function formatRange(from: string | undefined, to: string | undefined) {
  const start = isoToCalendarDate(from)
  const end = isoToCalendarDate(to)
  if (!start) return ''
  try {
    const startStr = dfShort.format(start.toDate(tz))
    if (!end) return startStr
    return `${startStr} – ${dfShort.format(end.toDate(tz))}`
  } catch {
    return ''
  }
}

const displayValue = computed(() => formatRange(props.from, props.to))
const pendingDisplayValue = computed(() => formatRange(localFrom.value, localTo.value))

const rangePresets = [
  {
    label: 'Últimos 7 dias',
    getRange: () => {
      const end = today(tz)
      return { start: end.subtract({ days: 7 }), end }
    }
  },
  {
    label: 'Últimos 30 dias',
    getRange: () => {
      const end = today(tz)
      return { start: end.subtract({ days: 30 }), end }
    }
  },
  {
    label: 'Este mês',
    getRange: () => {
      const t = today(tz)
      return { start: t.set({ day: 1 }), end: t }
    }
  },
  {
    label: 'Mês anterior',
    getRange: () => {
      const t = today(tz)
      const firstOfMonth = t.set({ day: 1 })
      const lastDayPrevMonth = firstOfMonth.subtract({ days: 1 })
      return { start: lastDayPrevMonth.set({ day: 1 }), end: lastDayPrevMonth }
    }
  },
  {
    label: 'Últimos 3 meses',
    getRange: () => {
      const end = today(tz)
      return { start: end.subtract({ months: 3 }), end }
    }
  },
  {
    label: 'Este ano',
    getRange: () => {
      const t = today(tz)
      return { start: t.set({ month: 1, day: 1 }), end: t.set({ month: 12, day: 31 }) }
    }
  }
]

function isPresetActive(preset: (typeof rangePresets)[number]): boolean {
  if (!localFrom.value || !localTo.value) return false
  const { start, end } = preset.getRange()
  const fromDate = isoToCalendarDate(localFrom.value)
  const toDate = isoToCalendarDate(localTo.value)
  if (!fromDate || !toDate) return false
  return fromDate.compare(start) === 0 && toDate.compare(end) === 0
}

function selectPreset(preset: (typeof rangePresets)[number]) {
  const { start, end } = preset.getRange()
  localFrom.value = calendarDateToISO(start)
  localTo.value = calendarDateToISO(end)
}

function confirm() {
  emit('update:from', localFrom.value)
  emit('update:to', localTo.value)
  popoverOpen.value = false
}

function clear() {
  localFrom.value = undefined
  localTo.value = undefined
  emit('update:from', undefined)
  emit('update:to', undefined)
  popoverOpen.value = false
}
</script>

<template>
  <UPopover
    v-model:open="popoverOpen"
    :content="{ align: 'start', side: 'bottom', sideOffset: 8 }"
    :ui="{
      content:
        'z-[500] w-auto max-w-[min(95vw,46rem)] rounded-xl border border-default bg-default p-0 shadow-xl overflow-hidden'
    }"
    :modal="true"
  >
    <div class="w-full">
      <p v-if="label" class="mb-1 text-xs font-medium text-muted">
        {{ label }}
      </p>
      <UButton
        color="neutral"
        variant="outline"
        block
        class="h-9 w-full justify-between gap-1.5 rounded-md border border-default bg-default px-3 py-2 text-sm shadow-xs"
        :disabled="disabled"
      >
        <div class="flex min-w-0 items-center gap-2">
          <UIcon
            name="i-lucide-calendar-range"
            class="size-4 shrink-0 text-dimmed"
          />
          <span
            class="truncate"
            :class="displayValue ? 'text-highlighted' : 'text-dimmed'"
          >
            {{ displayValue || placeholder }}
          </span>
        </div>
        <UIcon
          v-if="displayValue"
          name="i-lucide-x"
          class="size-3.5 shrink-0 text-dimmed hover:text-highlighted"
          @click.stop="clear"
        />
        <UIcon
          v-else
          name="i-lucide-chevron-down"
          class="size-4 shrink-0 text-dimmed"
        />
      </UButton>
    </div>

    <template #content>
      <div class="flex items-stretch divide-x divide-default">
        <!-- Preset ranges -->
        <div class="hidden flex-col justify-center py-2 sm:flex">
          <UButton
            v-for="preset in rangePresets"
            :key="preset.label"
            :label="preset.label"
            color="neutral"
            variant="ghost"
            class="rounded-none px-4"
            :class="
              isPresetActive(preset) ? 'bg-elevated' : 'hover:bg-elevated/50'
            "
            truncate
            @click="selectPreset(preset)"
          />
        </div>

        <!-- Calendar -->
        <div class="p-3">
          <UCalendar
            v-model="calendarValue"
            range
            :number-of-months="1"
            color="primary"
          />

          <div
            class="mt-3 flex items-center justify-between border-t border-default pt-3"
          >
            <span class="truncate text-xs text-muted">
              {{ pendingDisplayValue || "—" }}
            </span>
            <div class="flex items-center gap-2">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                label="Limpar"
                @click="clear"
              />
              <UButton
                size="xs"
                color="primary"
                label="Confirmar"
                :disabled="!localFrom || !localTo"
                @click="confirm"
              />
            </div>
          </div>
        </div>
      </div>
    </template>
  </UPopover>
</template>
