<script setup lang="ts">
import { CATEGORY_COLOR_PRESETS, DEFAULT_CATEGORY_COLOR, isValidHexColor } from '~/utils/financial-category-options'

const modelValue = defineModel<string>({ default: DEFAULT_CATEGORY_COLOR })

const props = withDefaults(defineProps<{
  size?: 'sm' | 'md' | 'lg'
}>(), {
  size: 'md'
})

const open = ref(false)
const hexInput = ref(modelValue.value)

watch(modelValue, (value) => { hexInput.value = value })

function applyHexInput() {
  const value = hexInput.value.trim()
  const normalized = value.startsWith('#') ? value : `#${value}`
  if (isValidHexColor(normalized)) modelValue.value = normalized
  else hexInput.value = modelValue.value
}

const sizeClass = computed(() => ({
  sm: 'size-8',
  md: 'size-10',
  lg: 'size-12'
}[props.size]))
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ align: 'start', side: 'bottom', sideOffset: 8 }"
    :ui="{ content: 'z-[260]' }"
  >
    <button
      type="button"
      class="shrink-0 rounded-full border border-default/60 shadow-sm transition hover:opacity-80"
      :class="sizeClass"
      :style="{ backgroundColor: modelValue }"
    />

    <template #content>
      <div class="space-y-3 p-3 w-56">
        <UColorPicker v-model="modelValue" class="w-full" />

        <UInput
          v-model="hexInput"
          size="sm"
          class="w-full"
          placeholder="#64748b"
          @blur="applyHexInput"
          @keydown.enter.prevent="applyHexInput"
        >
          <template #leading>
            <span class="size-3 rounded-full border border-default/60" :style="{ backgroundColor: modelValue }" />
          </template>
        </UInput>

        <div class="grid grid-cols-7 gap-1.5">
          <button
            v-for="preset in CATEGORY_COLOR_PRESETS"
            :key="preset"
            type="button"
            class="size-6 rounded-full border transition hover:scale-110"
            :class="modelValue.toLowerCase() === preset ? 'border-highlighted ring-2 ring-primary/40' : 'border-default/60'"
            :style="{ backgroundColor: preset }"
            @click="modelValue = preset"
          />
        </div>
      </div>
    </template>
  </UPopover>
</template>
