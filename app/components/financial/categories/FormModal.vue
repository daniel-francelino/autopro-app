<script setup lang="ts">
import { DEFAULT_CATEGORY_COLOR, DEFAULT_CATEGORY_ICON } from '~/utils/financial-category-options'

type Category = { id: string, name: string, type: 'income' | 'expense', icon: string, color: string, is_default: boolean }

const props = withDefaults(defineProps<{
  open: boolean
  category: Category | null
  activeType?: 'income' | 'expense'
}>(), {
  activeType: 'expense'
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const toast = useToast()
const isSaving = ref(false)

const isEditing = computed(() => Boolean(props.category?.id))

const form = reactive({
  name: '',
  type: 'expense' as 'income' | 'expense',
  icon: DEFAULT_CATEGORY_ICON as string,
  color: DEFAULT_CATEGORY_COLOR as string
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    if (props.category) {
      form.name = props.category.name
      form.type = props.category.type
      form.icon = props.category.icon
      form.color = props.category.color
    } else {
      form.name = ''
      form.type = props.activeType
      form.icon = DEFAULT_CATEGORY_ICON
      form.color = DEFAULT_CATEGORY_COLOR
    }
  },
  { immediate: true }
)

async function save() {
  if (isSaving.value) return
  const name = form.name.trim()
  if (!name) {
    toast.add({ title: 'Nome obrigatório', color: 'warning' })
    return
  }

  isSaving.value = true
  try {
    if (isEditing.value && props.category) {
      await $fetch(`/api/financial/categories/${props.category.id}`, {
        method: 'PUT',
        body: { name, icon: form.icon, color: form.color }
      })
      toast.add({ title: 'Categoria atualizada', color: 'success' })
    } else {
      await $fetch('/api/financial/categories', {
        method: 'POST',
        body: { name, type: form.type, icon: form.icon, color: form.color }
      })
      toast.add({ title: 'Categoria criada', color: 'success' })
    }
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
</script>

<template>
  <UModal
    :open="open"
    :title="isEditing ? 'Editar categoria' : 'Nova categoria'"
    :description="isEditing ? 'Atualize o nome, ícone ou cor da categoria.' : 'Cadastre uma nova categoria personalizada.'"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Nome" required>
          <UInput v-model="form.name" class="w-full" placeholder="Ex: Combustível, Comissões..." />
        </UFormField>

        <UFormField v-if="!isEditing" label="Tipo" required>
          <div class="flex w-full overflow-hidden rounded-lg border border-default">
            <button
              type="button"
              class="flex flex-1 items-center justify-center gap-2 py-2 text-sm font-medium transition-colors focus:outline-none"
              :class="form.type === 'income' ? 'bg-success/10 text-success' : 'text-muted hover:bg-elevated'"
              @click="form.type = 'income'"
            >
              <UIcon name="i-lucide-trending-up" class="size-4" />
              Entrada
            </button>
            <div class="w-px bg-border" />
            <button
              type="button"
              class="flex flex-1 items-center justify-center gap-2 py-2 text-sm font-medium transition-colors focus:outline-none"
              :class="form.type === 'expense' ? 'bg-error/10 text-error' : 'text-muted hover:bg-elevated'"
              @click="form.type = 'expense'"
            >
              <UIcon name="i-lucide-trending-down" class="size-4" />
              Saída
            </button>
          </div>
        </UFormField>

        <div class="flex items-center gap-3 rounded-lg border border-default p-3">
          <FinancialCategoryIconPicker v-model="form.icon" :color="form.color" />
          <FinancialCategoryColorPicker v-model="form.color" />
          <div class="min-w-0 flex-1">
            <p class="text-xs text-muted">
              Pré-visualização
            </p>
            <p class="truncate text-sm font-medium text-highlighted">
              {{ form.name || 'Nome da categoria' }}
            </p>
          </div>
        </div>
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
