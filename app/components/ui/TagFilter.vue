<script setup lang="ts">
export interface TagFilterOption {
  value: string
  label: string
  color: 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | `#${string}`
  icon?: string
  initials?: string
}

function isHexColor(color: string) {
  return color.startsWith('#')
}

const props = withDefaults(defineProps<{
  modelValue: string[]
  options: TagFilterOption[]
  placeholder?: string
}>(), {
  placeholder: 'Todos'
})

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const popoverOpen = ref(false)

function toggle(value: string) {
  const current = props.modelValue
  const next = current.includes(value)
    ? current.filter(v => v !== value)
    : [...current, value]
  emit('update:modelValue', next)
}

function clear() {
  emit('update:modelValue', [])
}

const optionsMap = computed(() =>
  new Map(props.options.map(option => [option.value, option]))
)

const selectedOptions = computed(() =>
  props.modelValue
    .map(value => optionsMap.value.get(value))
    .filter((option): option is TagFilterOption => Boolean(option))
)

const hasSelection = computed(() => props.modelValue.length > 0)
const hasResolvedSelection = computed(() => selectedOptions.value.length > 0)
const unresolvedSelectionCount = computed(() => props.modelValue.length - selectedOptions.value.length)
</script>

<template>
  <UPopover
    v-model:open="popoverOpen"
    :content="{ align: 'start', side: 'bottom', sideOffset: 8 }"
    :ui="{ content: 'z-[260] w-(--reka-popper-anchor-width) rounded-xl border border-default bg-default p-1 shadow-xl' }"
  >
    <button
      type="button"
      class="flex h-9 w-full min-w-0 items-center justify-start gap-1.5 rounded-md border border-default bg-default px-2.5 py-1.5 text-left text-sm shadow-xs transition hover:bg-elevated"
      :class="hasSelection ? 'border-primary/40 bg-primary/5' : ''"
    >
      <!-- No selection -->
      <span v-if="!hasSelection" class="text-dimmed">{{ placeholder }}</span>

      <!-- Tags inline (up to 2) -->
      <template v-else-if="hasResolvedSelection && selectedOptions.length <= 2">
        <template v-for="opt in selectedOptions" :key="opt.value">
          <span
            v-if="opt.initials"
            class="inline-flex items-start gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
          >
            <span class="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[9px] font-bold">
              {{ opt.initials }}
            </span>
            {{ opt.label }}
          </span>
          <UBadge
            v-else
            :color="isHexColor(opt.color) ? 'neutral' : opt.color"
            variant="subtle"
            size="xs"
            class="gap-1"
          >
            <UIcon v-if="opt.icon" :name="opt.icon" class="size-3" :style="isHexColor(opt.color) ? { color: opt.color } : undefined" />
            {{ opt.label }}
          </UBadge>
        </template>
      </template>

      <template v-else-if="unresolvedSelectionCount > 0">
        <UBadge color="primary" variant="subtle" size="xs">
          {{ props.modelValue.length }} selecionado{{ props.modelValue.length !== 1 ? 's' : '' }}
        </UBadge>
      </template>

      <!-- Overflow: show count -->
      <template v-else>
        <UBadge color="primary" variant="subtle" size="xs">
          {{ selectedOptions.length }} selecionados
        </UBadge>
      </template>

      <!-- Clear button -->
      <UIcon
        v-if="hasSelection"
        name="i-lucide-x"
        class="ml-auto size-3.5 shrink-0 text-dimmed hover:text-highlighted"
        @click.stop="clear"
      />
      <UIcon
        v-else
        name="i-lucide-chevron-down"
        class="ml-auto size-4 shrink-0 text-dimmed"
      />
    </button>

    <template #content>
      <div class="flex max-h-[min(24rem,calc(100vh-10rem))] flex-col gap-0.5 overflow-y-auto pr-1">
        <button
          v-for="opt in options"
          :key="opt.value"
          type="button"
          class="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition hover:bg-elevated"
          :class="modelValue.includes(opt.value) ? 'bg-elevated' : ''"
          @click="toggle(opt.value)"
        >
          <template v-if="opt.initials">
            <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
              {{ opt.initials }}
            </span>
            <span class="min-w-0 flex-1 text-left text-sm leading-tight">{{ opt.label }}</span>
          </template>
          <UBadge
            v-else
            :color="isHexColor(opt.color) ? 'neutral' : opt.color"
            variant="subtle"
            size="sm"
            class="gap-1 shrink-0"
          >
            <UIcon v-if="opt.icon" :name="opt.icon" class="size-3" :style="isHexColor(opt.color) ? { color: opt.color } : undefined" />
            {{ opt.label }}
          </UBadge>
          <UIcon
            v-if="modelValue.includes(opt.value)"
            name="i-lucide-check"
            class="ml-auto size-3.5 shrink-0 text-primary"
          />
        </button>
      </div>
    </template>
  </UPopover>
</template>
