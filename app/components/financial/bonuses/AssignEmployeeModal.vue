<script setup lang="ts">
interface EmployeeOption {
  value: string
  label: string
}

const props = defineProps<{
  open: boolean
  bonusId: string
  excludeEmployeeIds: string[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'assigned': []
}>()

const toast = useToast()
const isSaving = ref(false)
const selectedEmployeeId = ref('')

const { data: employeesData } = await useAsyncData(
  'bonuses-assign-employee-options',
  () => $fetch<{ items: Array<{ id: string, name?: string | null }> }>('/api/employees'),
  { default: () => ({ items: [] }) }
)

const availableOptions = computed<EmployeeOption[]>(() =>
  (employeesData.value?.items ?? [])
    .filter(employee => !props.excludeEmployeeIds.includes(employee.id))
    .map(employee => ({ value: employee.id, label: employee.name || 'Sem nome' }))
    .sort((employeeA, employeeB) => employeeA.label.localeCompare(employeeB.label, 'pt-BR'))
)

watch(() => props.open, (open) => {
  if (open) selectedEmployeeId.value = ''
})

async function save() {
  if (isSaving.value || !selectedEmployeeId.value) return
  isSaving.value = true
  try {
    await $fetch(`/api/bonuses/${props.bonusId}/assignments`, {
      method: 'POST',
      body: { employeeId: selectedEmployeeId.value }
    })
    toast.add({ title: 'Funcionário atribuído', color: 'success' })
    emit('assigned')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível atribuir o funcionário', color: 'error' })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Atribuir funcionário"
    description="O funcionário passa a valer para a meta configurada neste bônus a partir de agora."
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <UFormField label="Funcionário" required>
        <UiAsyncPaginatedSelect
          v-model="selectedEmployeeId"
          :items="availableOptions"
          :get-id="(employee: EmployeeOption) => employee.value"
          :get-label="(employee: EmployeeOption) => employee.label"
          placeholder="Selecione um funcionário"
          search-placeholder="Buscar funcionário..."
          empty-message="Nenhum funcionário disponível"
          icon="i-lucide-user-round"
          item-icon="i-lucide-user-round"
          class="w-full"
        />
      </UFormField>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="Cancelar"
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          :disabled="isSaving"
          @click="emit('update:open', false)"
        />
        <UButton
          label="Atribuir"
          icon="i-lucide-check"
          color="neutral"
          :loading="isSaving"
          :disabled="isSaving || !selectedEmployeeId"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
