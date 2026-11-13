<script setup lang="ts">
const props = defineProps<{
  roleName: string
  canEdit: boolean
  canDelete: boolean
  deleting?: boolean
}>()

const emit = defineEmits<{
  view: []
  edit: []
  delete: []
}>()

const menuItems = computed(() => [
  [
    {
      label: 'Excluir',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onSelect: () => emit('delete')
    }
  ]
])
</script>

<template>
  <div class="flex shrink-0 items-center gap-1" @click.stop>
    <UButton
      :label="canEdit ? 'Editar' : 'Ver'"
      :icon="canEdit ? 'i-lucide-pencil' : 'i-lucide-eye'"
      :aria-label="`${canEdit ? 'Editar' : 'Ver'} papel ${props.roleName}`"
      color="neutral"
      variant="outline"
      size="sm"
      class="min-h-11 md:min-h-0"
      @click="canEdit ? emit('edit') : emit('view')"
    />
    <UButton
      v-if="canEdit"
      icon="i-lucide-eye"
      :aria-label="`Ver detalhes do papel ${props.roleName}`"
      color="neutral"
      variant="ghost"
      size="sm"
      class="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
      @click="emit('view')"
    />
    <UDropdownMenu v-if="canDelete" :items="menuItems">
      <UButton
        icon="i-lucide-ellipsis"
        :aria-label="`Mais ações para o papel ${props.roleName}`"
        color="neutral"
        variant="ghost"
        size="sm"
        class="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
        :loading="deleting"
      />
    </UDropdownMenu>
  </div>
</template>
