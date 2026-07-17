<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    description?: string
    confirmLabel?: string
    confirmColor?: string
    loading?: boolean
    confirmDisabled?: boolean
  }>(),
  {
    title: 'Confirmar exclusão',
    description:
      'Tem certeza que deseja realizar esta ação? Ela não pode ser desfeita.',
    confirmLabel: 'Confirmar',
    confirmColor: 'error',
    loading: false,
    confirmDisabled: false
  }
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  'confirm': []
}>()

function close() {
  if (props.loading) return
  emit('update:open', false)
}
</script>

<template>
  <UModal
    :open="open"
    :title="title"
    :ui="{ overlay: 'z-30', content: 'z-40' }"
    @update:open="(value) => !value && close()"
  >
    <template #body>
      <div class="space-y-4">
        <slot name="description">
          <p class="text-sm text-muted">
            {{ description }}
          </p>
        </slot>

        <div class="flex justify-end gap-3">
          <UButton
            label="Cancelar"
            color="neutral"
            variant="ghost"
            :disabled="loading"
            @click="close"
          />
          <UButton
            :label="confirmLabel"
            :color="confirmColor"
            :loading="loading"
            :disabled="confirmDisabled"
            @click="emit('confirm')"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
