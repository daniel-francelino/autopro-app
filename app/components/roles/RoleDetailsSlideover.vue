<script setup lang="ts">
import {
  filterModulesByName,
  grantedFractionLabel,
  grantedOfTotalLabel,
  modulesToTreeItems,
  modulesWithGranted,
  summarizeModules,
  type PermissionAction
} from '~/utils/role-permissions'

type RoleItem = {
  id: string
  name: string
  display_name: string | null
  description: string | null
  is_system_role: boolean
}

type RoleAction = {
  id: string
  role_id: string
  action_id: string
  is_granted: boolean
}

type AssignedUser = {
  id: string
  email: string | null
  full_name: string | null
  display_name: string | null
  employee_id: string | null
  employee_name: string | null
  active: boolean
}

type RoleDetailResponse = {
  item?: {
    role: RoleItem
    actions: PermissionAction[]
    role_actions: RoleAction[]
    assigned_users: AssignedUser[]
    summary: {
      granted_actions_count: number
      total_actions_count: number
      assigned_users_count: number
    }
  }
}

const props = defineProps<{
  open: boolean
  roleId: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const loading = ref(false)
const detail = ref<RoleDetailResponse['item'] | null>(null)
const activeTab = ref('users')
const moduleQuery = ref('')

const tabItems = [
  { label: 'Usuários', value: 'users', icon: 'i-lucide-users', slot: 'users' as const },
  { label: 'Permissões', value: 'permissions', icon: 'i-lucide-key-round', slot: 'permissions' as const }
]

const modules = computed(() => {
  if (!detail.value)
    return []

  const grantedIds = new Set(detail.value.role_actions
    .filter(roleAction => roleAction.is_granted)
    .map(roleAction => roleAction.action_id))

  return modulesWithGranted(summarizeModules(detail.value.actions, grantedIds))
})

const filteredModules = computed(() => filterModulesByName(modules.value, moduleQuery.value))

const treeItems = computed(() => modulesToTreeItems(filteredModules.value))
const expandedModules = ref<string[]>([])

// Durante a busca, expande os modulos encontrados.
watch(moduleQuery, (query) => {
  expandedModules.value = query.trim() ? filteredModules.value.map(mod => mod.resource) : []
})

// Devolve o foco ao botao que abriu o painel (abertura programatica nao tem trigger).
let opener: HTMLElement | null = null
function restoreFocus(event: Event) {
  event.preventDefault()
  opener?.focus()
  opener = null
}

function roleLabel(role: RoleItem | null) {
  if (!role)
    return 'Detalhes do papel'

  return role.display_name?.trim() || role.name
}

function userLabel(user: AssignedUser) {
  return user.display_name?.trim() || user.full_name?.trim() || user.email || 'Usuário sem identificação'
}

function userInitials(user: AssignedUser) {
  const parts = userLabel(user)
    .split(' ')
    .map(part => part.trim())
    .filter(Boolean)
    .slice(0, 2)

  return parts.map(part => part[0]?.toUpperCase() || '').join('') || 'U'
}

async function loadRoleDetail() {
  if (!props.open || !props.roleId)
    return

  loading.value = true

  try {
    const response = await $fetch<RoleDetailResponse>(`/api/roles/${props.roleId}`)
    detail.value = response.item ?? null
  } catch {
    detail.value = null
  } finally {
    loading.value = false
  }
}

function onClose() {
  emit('update:open', false)
}

watch(() => props.open, (open) => {
  if (!open)
    return

  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  activeTab.value = 'users'
  moduleQuery.value = ''
  expandedModules.value = []
}, { flush: 'sync' })

watch(() => [props.open, props.roleId], loadRoleDetail, { immediate: true })
</script>

<template>
  <USlideover
    :open="props.open"
    title="Detalhes de Papéis"
    :content="{ onCloseAutoFocus: restoreFocus }"
    :ui="{ title: 'text-sm font-normal text-muted', content: 'w-full max-w-md' }"
    @update:open="onClose"
  >
    <template #close>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        aria-label="Fechar detalhes do papel"
        @click="onClose"
      />
    </template>

    <template #body>
      <div v-if="loading" class="space-y-4">
        <USkeleton class="h-14 w-full rounded-2xl" />
        <USkeleton class="h-20 w-full rounded-2xl" />
        <USkeleton class="h-40 w-full rounded-2xl" />
      </div>

      <div v-else-if="detail" class="space-y-5">
        <div class="flex min-w-0 items-center gap-3">
          <div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UIcon name="i-lucide-shield-check" class="size-5" aria-hidden="true" />
          </div>
          <div class="min-w-0 space-y-1">
            <h3 class="break-words text-xl font-semibold text-highlighted">
              {{ roleLabel(detail.role) }}
            </h3>
            <UBadge
              :label="detail.role.is_system_role ? 'Sistema · Somente leitura' : 'Personalizado'"
              color="neutral"
              variant="subtle"
              size="sm"
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-xl border border-default bg-elevated/30 px-4 py-3">
            <p class="text-2xl font-semibold text-highlighted">
              {{ detail.summary.assigned_users_count }}
            </p>
            <p class="text-xs text-muted">
              Usuários vinculados
            </p>
          </div>
          <div class="rounded-xl border border-default bg-elevated/30 px-4 py-3">
            <p class="text-2xl font-semibold text-highlighted">
              <span aria-hidden="true">{{ detail.summary.granted_actions_count }} <span class="text-sm font-normal text-muted">/ {{ detail.summary.total_actions_count }}</span></span>
              <span class="sr-only">{{ grantedOfTotalLabel(detail.summary.granted_actions_count, detail.summary.total_actions_count) }}</span>
            </p>
            <p class="text-xs text-muted">
              Permissões liberadas
            </p>
          </div>
        </div>

        <UTabs
          v-model="activeTab"
          :items="tabItems"
          variant="link"
          color="primary"
          class="w-full"
          :ui="{ content: 'pt-4' }"
        >
          <template #users>
            <ul v-if="detail.assigned_users.length" class="space-y-2">
              <li
                v-for="user in detail.assigned_users"
                :key="user.id"
                class="flex items-center gap-3 rounded-xl border border-default px-3 py-3"
              >
                <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">
                  {{ userInitials(user) }}
                </div>
                <div class="min-w-0 flex-1">
                  <p class="break-words text-sm font-semibold text-highlighted">
                    {{ userLabel(user) }}
                  </p>
                  <p v-if="user.email" class="break-all text-xs text-muted">
                    {{ user.email }}
                  </p>
                </div>
                <UBadge
                  :label="user.active ? 'Ativo' : 'Inativo'"
                  :color="user.active ? 'success' : 'neutral'"
                  variant="subtle"
                  size="sm"
                  class="shrink-0"
                />
              </li>
            </ul>

            <div v-else class="rounded-xl border border-dashed border-default px-4 py-8 text-center">
              <UIcon name="i-lucide-users" class="mx-auto mb-2 size-8 text-muted" aria-hidden="true" />
              <p class="text-sm font-medium text-highlighted">
                Nenhum usuário vinculado
              </p>
            </div>
          </template>

          <template #permissions>
            <div class="space-y-3">
              <UInput
                v-model="moduleQuery"
                icon="i-lucide-search"
                class="w-full"
                placeholder="Buscar módulo"
                aria-label="Buscar módulo"
              >
                <template v-if="moduleQuery" #trailing>
                  <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="link"
                    size="xs"
                    aria-label="Limpar busca"
                    @click="moduleQuery = ''"
                  />
                </template>
              </UInput>

              <UTree
                v-if="filteredModules.length"
                v-model:expanded="expandedModules"
                :items="treeItems"
                size="sm"
                color="neutral"
                aria-label="Módulos e permissões liberadas"
                :ui="{ link: 'min-w-0', linkLabel: 'min-w-0 flex-1 whitespace-normal break-words text-left' }"
              >
                <template #item-trailing="{ item }">
                  <template v-if="item.slot === 'module'">
                    <span class="shrink-0 text-xs tabular-nums text-muted" aria-hidden="true">{{ grantedFractionLabel(item.granted, item.total) }}</span>
                    <span class="sr-only">{{ grantedOfTotalLabel(item.granted, item.total) }} liberadas</span>
                  </template>
                </template>
              </UTree>

              <div v-else class="rounded-xl border border-dashed border-default px-4 py-8 text-center">
                <p class="text-sm text-muted" role="status">
                  {{ modules.length ? 'Nenhum módulo encontrado' : 'Nenhuma permissão liberada' }}
                </p>
              </div>
            </div>
          </template>
        </UTabs>
      </div>

      <div v-else>
        <div class="rounded-xl border border-error/30 bg-error/10 p-4" role="alert">
          <p class="text-sm font-medium text-error">
            Não foi possível carregar os detalhes do papel.
          </p>
        </div>
      </div>
    </template>
  </USlideover>
</template>
