<script setup lang="ts">
import { CATEGORY_ICON_OPTIONS, DEFAULT_CATEGORY_ICON } from '~/utils/financial-category-options'

const modelValue = defineModel<string>({ default: DEFAULT_CATEGORY_ICON })

const props = withDefaults(defineProps<{
  color?: string
  size?: 'sm' | 'md' | 'lg'
}>(), {
  color: '#64748b',
  size: 'md'
})

const open = ref(false)

const sizeClass = computed(() => ({
  sm: 'size-8',
  md: 'size-10',
  lg: 'size-12'
}[props.size]))

function select(value: string) {
  modelValue.value = value
  open.value = false
}
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ align: 'start', side: 'bottom', sideOffset: 8 }"
    :ui="{ content: 'z-[260]' }"
  >
    <button
      type="button"
      class="flex shrink-0 items-center justify-center rounded-full border border-default/60 shadow-sm transition hover:opacity-80"
      :class="sizeClass"
      :style="{ backgroundColor: `${color}1A` }"
    >
      <UIcon :name="modelValue" class="size-1/2" :style="{ color }" />
    </button>

    <template #content>
      <div class="grid grid-cols-6 gap-1 p-2 max-w-72">
        <UTooltip
          v-for="option in CATEGORY_ICON_OPTIONS"
          :key="option.value"
          :text="option.label"
        >
          <button
            type="button"
            class="flex size-9 items-center justify-center rounded-lg border transition hover:bg-elevated"
            :class="modelValue === option.value ? 'border-primary bg-primary/10' : 'border-transparent'"
            @click="select(option.value)"
          >
            <UIcon :name="option.value" class="size-4" :class="modelValue === option.value ? 'text-primary' : 'text-muted'" />
          </button>
        </UTooltip>
      </div>
    </template>
  </UPopover>
</template>
