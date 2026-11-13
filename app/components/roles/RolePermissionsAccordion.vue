<script setup lang="ts">
import type {
  PermissionAction,
  PermissionState
} from '~/utils/role-permissions'

const props = defineProps<{
  actions: PermissionAction[]
  modelValue: PermissionState
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: PermissionState]
}>()

const query = ref('')
const onlyGranted = ref(false)
const openManual = ref<string[]>([])

// Congela o conjunto "so marcadas" ao ligar o filtro/mudar a busca (evita salto de layout).
const frozenState = ref<PermissionState>({})
function freeze() {
  frozenState.value = { ...props.modelValue }
}
watch([onlyGranted, query, () => props.actions], freeze, { immediate: true })

const groups = computed(() => groupActionsByResource(props.actions))
const filterActive = computed(
  () => Boolean(query.value.trim()) || onlyGranted.value
)

const visibleGroups = computed(() =>
  groups.value
    .map(group => ({
      ...group,
      visible: filterActions(
        group.actions,
        query.value,
        onlyGranted.value,
        frozenState.value
      ),
      granted: countGranted(group.actions, props.modelValue)
    }))
    .filter(group => !filterActive.value || group.visible.length > 0)
)

const totalGranted = computed(() =>
  countGranted(props.actions, props.modelValue)
)

function isOpen(resource: string) {
  return query.value.trim() !== '' || openManual.value.includes(resource)
}

function toggle(resource: string) {
  if (query.value.trim()) return
  openManual.value = openManual.value.includes(resource)
    ? openManual.value.filter(r => r !== resource)
    : [...openManual.value, resource]
}

function groupChecked(visible: PermissionAction[]): boolean | 'indeterminate' {
  const n = countGranted(visible, props.modelValue)
  if (n === 0) return false
  return n === visible.length ? true : 'indeterminate'
}

function toggleGroup(visible: PermissionAction[]) {
  const all = countGranted(visible, props.modelValue) === visible.length
  emit('update:modelValue', setGroup(props.modelValue, visible, !all))
}

function toggleAction(id: string, value: boolean | 'indeterminate') {
  emit('update:modelValue', { ...props.modelValue, [id]: Boolean(value) })
}

function actionDescription(action: PermissionAction) {
  const description = action.description?.trim()
  if (
    description
    && normalizeSearchText(description) !== normalizeSearchText(action.name)
  ) return description

  return action.code
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <UInput
        v-model="query"
        icon="i-lucide-search"
        class="w-full sm:max-w-sm"
        placeholder="Buscar ação ou código"
        aria-label="Buscar permissões"
      >
        <template v-if="query" #trailing>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="link"
            size="xs"
            aria-label="Limpar busca"
            @click="query = ''"
          />
        </template>
      </UInput>

      <USwitch v-model="onlyGranted" label="Só marcadas" />

      <UBadge
        :label="`${totalGranted} de ${actions.length} permissões`"
        color="neutral"
        variant="subtle"
        class="sm:ml-auto"
        aria-live="polite"
      />
    </div>

    <div
      v-if="!visibleGroups.length"
      class="rounded-xl border border-dashed border-default px-4 py-8 text-center"
    >
      <p class="text-sm text-muted">
        Nenhuma ação encontrada<template v-if="query.trim()">
          para "{{ query.trim() }}"
        </template>.
      </p>
      <UButton
        v-if="filterActive"
        label="Limpar filtros"
        color="neutral"
        variant="ghost"
        class="mt-2"
        @click="query = ''; onlyGranted = false"
      />
    </div>

    <div
      v-else
      class="divide-y divide-default/60 rounded-xl border border-default/70"
    >
      <section v-for="group in visibleGroups" :key="group.resource">
        <div class="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            class="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg text-left text-sm font-medium text-highlighted hover:bg-elevated/60"
            :aria-expanded="isOpen(group.resource)"
            :aria-controls="`perm-group-${group.resource}`"
            @click="toggle(group.resource)"
          >
            <UIcon
              name="i-lucide-chevron-down"
              class="size-4 shrink-0 text-muted transition-transform"
              :class="isOpen(group.resource) ? 'rotate-180' : ''"
            />
            <UIcon :name="group.icon" class="size-4 shrink-0 text-primary" />
            <span class="truncate">{{ group.label }}</span>
            <UBadge
              :label="`${group.granted}/${group.actions.length}`"
              :aria-label="`${group.granted} de ${group.actions.length} permissões liberadas`"
              color="neutral"
              variant="subtle"
              size="sm"
            />
          </button>

          <UCheckbox
            :model-value="groupChecked(group.visible)"
            :disabled="disabled || !group.visible.length"
            color="neutral"
            :label="filterActive ? 'Marcar resultados' : 'Marcar todas'"
            :aria-label="
              filterActive
                ? `Marcar resultados de ${group.label}`
                : `Marcar todas as permissões de ${group.label}`
            "
            :ui="{ label: 'text-xs text-muted' }"
            @update:model-value="toggleGroup(group.visible)"
          />
        </div>

        <div
          v-if="isOpen(group.resource)"
          :id="`perm-group-${group.resource}`"
          class="divide-y divide-default/40 border-t border-default/40 bg-elevated/20"
        >
          <div
            v-for="action in group.visible"
            :key="action.id"
            class="flex min-h-11 items-center px-4 py-2"
            :title="action.code"
          >
            <UCheckbox
              :model-value="Boolean(modelValue[action.id])"
              :disabled="disabled"
              color="neutral"
              :label="action.name || action.code"
              :description="actionDescription(action)"
              class="w-full"
              @update:model-value="toggleAction(action.id, $event)"
            />
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
