<script setup lang="ts">
import { ActionCode } from '~/constants/action-codes'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Editar papel' })

type RoleItem = {
  id: string
  name: string
  display_name: string | null
  description: string | null
  is_system_role: boolean
}

type ActionItem = {
  id: string
  code: string
  name: string | null
  description: string | null
  resource: string | null
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
    actions: ActionItem[]
    role_actions: RoleAction[]
    assigned_users: AssignedUser[]
    summary: {
      granted_actions_count: number
      total_actions_count: number
      assigned_users_count: number
    }
  }
}

type OrganizationUser = {
  id: string
  email: string | null
  full_name: string | null
  display_name: string | null
  employee_id: string | null
  role_id: string | null
  active: boolean
}

type OrganizationUsersResponse = {
  users?: OrganizationUser[]
}

type PermissionTab = {
  label: string
  value: string
  count: number
  icon: string
}

const route = useRoute()
const toast = useToast()
const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server
  ? useRequestHeaders(['cookie'])
  : undefined

const canView = computed(() => workshop.can(ActionCode.ROLES_READ))
const canUpdate = computed(() => workshop.can(ActionCode.ROLES_UPDATE))
const canManagePermissions = computed(() =>
  workshop.can(ActionCode.ROLES_MANAGE_PERMISSIONS)
)
const canAccessEditPage = computed(
  () => canUpdate.value || canManagePermissions.value
)
const roleId = computed(() => String(route.params.id || ''))
const activePermissionTab = ref('')
const selectedUserId = ref<string | undefined>()

const { getResourceIcon, formatResourceLabel } = useRoleResources()

const { data, status, error, refresh } = await useAsyncData(
  () => `role-detail-${roleId.value}`,
  () =>
    requestFetch<RoleDetailResponse>(`/api/roles/${roleId.value}`, {
      headers: requestHeaders
    }),
  {
    watch: [roleId],
    server: true
  }
)

const { data: usersData, refresh: refreshUsers } = await useAsyncData(
  'organization-users-for-roles',
  () =>
    requestFetch<OrganizationUsersResponse>('/api/users/list-organization', {
      method: 'POST',
      headers: requestHeaders
    }),
  { server: true }
)

const role = computed(() => data.value?.item?.role ?? null)
const actions = computed(() => data.value?.item?.actions ?? [])
const roleActions = computed(() => data.value?.item?.role_actions ?? [])
const assignedUsers = computed(() => data.value?.item?.assigned_users ?? [])
const organizationUsers = computed(() => usersData.value?.users ?? [])
const summary = computed(
  () =>
    data.value?.item?.summary ?? {
      granted_actions_count: 0,
      total_actions_count: 0,
      assigned_users_count: 0
    }
)

const roleForm = reactive({
  display_name: '',
  description: ''
})

const permissionState = ref<Record<string, boolean>>({})
const isSaving = ref(false)
const isUpdatingLink = ref(false)

const groupedActions = computed<Record<string, ActionItem[]>>(() => {
  if (!actions.value.length) return {}

  return actions.value.reduce<Record<string, ActionItem[]>>(
    (groups, action) => {
      const groupName = action.resource || 'Geral'
      if (!groups[groupName]) groups[groupName] = []

      groups[groupName].push(action)
      return groups
    },
    {}
  )
})

const permissionTabs = computed<PermissionTab[]>(() =>
  Object.entries(groupedActions.value).map(([resource, groupItems]) => ({
    label: formatResourceLabel(resource),
    value: resource,
    count: groupItems.length,
    icon: getResourceIcon(resource)
  }))
)

const activeTabActions = computed(() => {
  if (!activePermissionTab.value) return []

  return groupedActions.value[activePermissionTab.value] ?? []
})

const originalPermissionState = computed<Record<string, boolean>>(() => {
  const grantedIds = new Set(
    roleActions.value
      .filter(action => action.is_granted)
      .map(action => action.action_id)
  )

  return actions.value.reduce<Record<string, boolean>>((result, action) => {
    result[action.id] = grantedIds.has(action.id)
    return result
  }, {})
})

const canEditMetadata = computed(() =>
  Boolean(role.value && canUpdate.value && !role.value.is_system_role)
)
const canEditPermissions = computed(() =>
  Boolean(
    role.value && canManagePermissions.value && !role.value.is_system_role
  )
)
const canManageUserLinks = computed(() =>
  Boolean(
    role.value
    && !role.value.is_system_role
    && (canUpdate.value || canManagePermissions.value)
  )
)

const availableUsers = computed(() => {
  if (!role.value) return []

  const currentRoleId = role.value.id
  return organizationUsers.value.filter(
    user => user.role_id !== currentRoleId
  )
})

const userOptions = computed(() =>
  availableUsers.value
    .map(user => ({
      label:
        user.display_name?.trim()
        || user.full_name?.trim()
        || user.email
        || 'Usuário sem identificação',
      value: user.id
    }))
    .sort((first, second) => first.label.localeCompare(second.label, 'pt-BR'))
)

const hasMetadataChanges = computed(() => {
  if (!role.value) return false

  return (
    roleForm.display_name.trim()
    !== (role.value.display_name ?? role.value.name)
    || roleForm.description.trim() !== (role.value.description ?? '')
  )
})

const hasPermissionChanges = computed(() =>
  actions.value.some(
    action =>
      Boolean(permissionState.value[action.id])
      !== Boolean(originalPermissionState.value[action.id])
  )
)

const isSaveDisabled = computed(() => {
  if (isSaving.value || !role.value || role.value.is_system_role) return true

  if (!canEditMetadata.value && !canEditPermissions.value) return true

  if (canEditMetadata.value && !roleForm.display_name.trim()) return true

  return !hasMetadataChanges.value && !hasPermissionChanges.value
})

function roleLabel(roleItem: RoleItem | null) {
  if (!roleItem) return 'Papel'

  return roleItem.display_name?.trim() || roleItem.name
}

function userLabel(user: AssignedUser) {
  return (
    user.display_name?.trim()
    || user.full_name?.trim()
    || user.email
    || 'Usuário sem identificação'
  )
}

function syncForm() {
  if (!role.value) return

  roleForm.display_name = role.value.display_name ?? role.value.name
  roleForm.description = role.value.description ?? ''
  permissionState.value = { ...originalPermissionState.value }
}

function updatePermission(actionId: string, value: boolean | 'indeterminate') {
  permissionState.value = {
    ...permissionState.value,
    [actionId]: Boolean(value)
  }
}

function retryLoad() {
  return refresh()
}

async function updateUserRoleLink(userId: string, nextRoleId: string | null) {
  isUpdatingLink.value = true

  try {
    await $fetch('/api/users/update-fields', {
      method: 'POST',
      body: {
        user_id: userId,
        role_id: nextRoleId
      }
    })

    await Promise.all([refresh(), refreshUsers()])
    return true
  } catch (error: unknown) {
    const err = error as {
      data?: { statusMessage?: string }
      statusMessage?: string
    }

    toast.add({
      title: 'Erro',
      description:
        err?.data?.statusMessage
        || err?.statusMessage
        || 'Não foi possível atualizar o vínculo do usuário',
      color: 'error'
    })
    return false
  } finally {
    isUpdatingLink.value = false
  }
}

async function addUserLink() {
  if (!role.value || !selectedUserId.value || isUpdatingLink.value) return

  const success = await updateUserRoleLink(selectedUserId.value, role.value.id)
  if (!success) return

  selectedUserId.value = undefined
  toast.add({ title: 'Vínculo atualizado', color: 'success' })
}

async function removeUserLink(userId: string) {
  if (isUpdatingLink.value) return

  const success = await updateUserRoleLink(userId, null)
  if (!success) return

  toast.add({ title: 'Vínculo removido', color: 'success' })
}

async function saveRole() {
  if (isSaveDisabled.value || !role.value) return

  const roleId = role.value.id
  isSaving.value = true

  try {
    if (canEditMetadata.value && hasMetadataChanges.value) {
      await $fetch(`/api/roles/${role.value.id}`, {
        method: 'PUT',
        body: {
          display_name: roleForm.display_name.trim(),
          description: roleForm.description.trim() || null
        }
      })
    }

    if (canEditPermissions.value && hasPermissionChanges.value) {
      const changedActions = actions.value.filter(
        action =>
          Boolean(permissionState.value[action.id])
          !== Boolean(originalPermissionState.value[action.id])
      )

      await Promise.all(
        changedActions.map(action =>
          $fetch(`/api/roles/${roleId}/actions`, {
            method: 'POST',
            body: {
              action_id: action.id,
              is_granted: Boolean(permissionState.value[action.id])
            }
          })
        )
      )
    }

    toast.add({ title: 'Papel atualizado', color: 'success' })
    await refresh()
  } catch (error: unknown) {
    const err = error as {
      data?: { statusMessage?: string }
      statusMessage?: string
    }
    toast.add({
      title: 'Erro',
      description:
        err?.data?.statusMessage
        || err?.statusMessage
        || 'Não foi possível salvar as alterações',
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}

watch([role, actions, roleActions], syncForm, { immediate: true })

watch(
  permissionTabs,
  (tabs) => {
    if (!tabs.length) {
      activePermissionTab.value = ''
      return
    }

    if (!tabs.some(tab => tab.value === activePermissionTab.value))
      activePermissionTab.value = tabs[0]!.value
  },
  { immediate: true }
)

watch(
  userOptions,
  (options) => {
    if (!selectedUserId.value) return

    if (!options.some(option => option.value === selectedUserId.value))
      selectedUserId.value = undefined
  },
  { immediate: true }
)
</script>

<template>
  <UDashboardPanel>
    <template #body>
      <div v-if="!canView" class="p-4">
        <div class="rounded-xl border border-default/60 bg-elevated/30 p-6">
          <p class="text-sm text-muted">
            Você não tem permissão para visualizar papéis.
          </p>
        </div>
      </div>

      <div v-else-if="!canAccessEditPage" class="p-4">
        <div class="rounded-xl border border-default/60 bg-elevated/30 p-6">
          <p class="text-sm text-muted">
            Você não tem permissão para editar papéis ou gerenciar permissões.
          </p>
        </div>
      </div>

      <div v-else class="space-y-4 p-4">
        <template v-if="status === 'pending' && !role">
          <USkeleton class="h-36 w-full rounded-2xl" />
          <USkeleton class="h-96 w-full rounded-2xl" />
        </template>

        <template v-else-if="error || !role">
          <div class="rounded-2xl border border-error/30 bg-error/10 p-6">
            <p class="text-sm font-medium text-error">
              Não foi possível carregar este papel.
            </p>
            <div class="mt-4 flex gap-2">
              <UButton
                label="Tentar novamente"
                color="neutral"
                @click="retryLoad"
              />
              <UButton
                label="Voltar para papéis"
                color="neutral"
                variant="ghost"
                to="/app/settings/roles"
              />
            </div>
          </div>
        </template>

        <template v-else>
          <div
            class="overflow-hidden rounded-3xl border border-default bg-linear-to-br from-primary/10 via-elevated to-success/10"
          >
            <div
              class="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]"
            >
              <div class="space-y-3">
                <div class="flex flex-wrap items-center gap-2">
                  <div
                    class="flex size-11 items-center justify-center rounded-2xl bg-primary/12 text-primary"
                  >
                    <UIcon name="i-lucide-shield-check" class="size-5" />
                  </div>
                  <h1
                    class="text-2xl font-semibold text-highlighted sm:text-3xl"
                  >
                    {{ roleLabel(role) }}
                  </h1>
                  <UBadge
                    :label="role.is_system_role ? 'Sistema' : 'Personalizado'"
                    :color="role.is_system_role ? 'warning' : 'neutral'"
                    variant="subtle"
                    size="sm"
                  />
                </div>

                <p class="max-w-2xl text-sm text-muted">
                  Ajuste os dados principais do papel, organize os vínculos com
                  usuários e marque nas abas quais ações ficam liberadas para
                  esse perfil.
                </p>

                <div
                  v-if="role.is_system_role"
                  class="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-muted"
                >
                  Este é um papel de sistema. Os dados e as permissões podem ser
                  consultados, mas não podem ser alterados.
                </div>
              </div>

              <div
                class="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3"
              >
                <div
                  class="rounded-2xl border border-default/70 bg-default/40 p-4"
                >
                  <UIcon
                    name="i-lucide-users"
                    class="mb-2 size-4 text-primary/80"
                  />
                  <p class="text-xs uppercase tracking-widest text-muted">
                    Usuários vinculados
                  </p>
                  <p class="mt-2 text-2xl font-semibold text-highlighted">
                    {{ summary.assigned_users_count }}
                  </p>
                </div>
                <div
                  class="rounded-2xl border border-default/70 bg-default/40 p-4"
                >
                  <UIcon
                    name="i-lucide-badge-check"
                    class="mb-2 size-4 text-success"
                  />
                  <p class="text-xs uppercase tracking-widest text-muted">
                    Permissões liberadas
                  </p>
                  <p class="mt-2 text-2xl font-semibold text-highlighted">
                    {{ summary.granted_actions_count }}
                  </p>
                </div>
                <div
                  class="rounded-2xl border border-default/70 bg-default/40 p-4"
                >
                  <UIcon
                    name="i-lucide-grid-2x2"
                    class="mb-2 size-4 text-primary/80"
                  />
                  <p class="text-xs uppercase tracking-widest text-muted">
                    Total de ações
                  </p>
                  <p class="mt-2 text-2xl font-semibold text-highlighted">
                    {{ summary.total_actions_count }}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div class="grid gap-4">
            <UPageCard
              title="Dados do papel"
              description="Atualize o nome exibido e a descrição usada pela equipe."
              variant="subtle"
            >
              <div class="space-y-4">
                <UFormField label="Nome" required>
                  <UInput
                    v-model="roleForm.display_name"
                    class="w-full"
                    :disabled="!canEditMetadata"
                    placeholder="Ex: Consultor técnico"
                  />
                </UFormField>

                <UFormField label="Descrição">
                  <UTextarea
                    v-model="roleForm.description"
                    class="w-full"
                    :rows="4"
                    :disabled="!canEditMetadata"
                    placeholder="Explique quando este papel deve ser usado."
                  />
                </UFormField>
              </div>
            </UPageCard>

            <UPageCard
              title="Permissões"
              description="As permissões foram agrupadas por abas para deixar a edição mais compacta."
              variant="subtle"
            >
              <div v-if="permissionTabs.length" class="space-y-4">
                <div
                  class="rounded-2xl border border-default/70 bg-default/20 p-2"
                >
                  <div class="flex flex-wrap gap-2">
                    <button
                      v-for="tab in permissionTabs"
                      :key="tab.value"
                      type="button"
                      class="inline-flex bg-default/60 text-muted max-w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors"
                      :class="
                        activePermissionTab === tab.value
                          ? 'border-primary  shadow-sm'
                          : 'border-default  hover:bg-elevated'
                      "
                      @click="activePermissionTab = tab.value"
                    >
                      <UIcon :name="tab.icon" class="size-4 shrink-0" />
                      <span class="break-all">
                        {{ tab.label }}
                      </span>
                      <span
                        class="rounded-full bg-black/8 px-1.5 py-0.5 text-[11px] font-semibold leading-none"
                      >
                        {{ tab.count }}
                      </span>
                    </button>
                  </div>
                </div>

                <div class="rounded-xl border border-default/70">
                  <div class="divide-y divide-default/60">
                    <div
                      v-for="action in activeTabActions"
                      :key="action.id"
                      class="flex items-start gap-3 px-4 py-3"
                    >
                      <UCheckbox
                        :model-value="Boolean(permissionState[action.id])"
                        :disabled="!canEditPermissions || isSaving"
                        color="neutral"
                        @update:model-value="
                          updatePermission(action.id, $event)
                        "
                      />

                      <div class="flex min-w-0 flex-1 items-start gap-3">
                        <div
                          class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
                        >
                          <UIcon
                            :name="
                              getResourceIcon(
                                action.resource || activePermissionTab
                              )
                            "
                            class="size-4"
                          />
                        </div>

                        <div class="min-w-0">
                          <div class="flex flex-wrap items-center gap-2">
                            <p class="text-sm font-medium text-highlighted">
                              {{ action.name || action.code }}
                            </p>
                            <UBadge
                              :label="
                                permissionState[action.id]
                                  ? 'Permitido'
                                  : 'Bloqueado'
                              "
                              :color="
                                permissionState[action.id]
                                  ? 'success'
                                  : 'neutral'
                              "
                              variant="subtle"
                              size="xs"
                            />
                          </div>
                          <p
                            v-if="action.description"
                            class="mt-1 text-xs text-muted"
                          >
                            {{ action.description }}
                          </p>
                          <p v-else class="mt-1 text-xs text-muted">
                            Código: {{ action.code }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-else
                class="rounded-xl border border-dashed border-default px-4 py-8 text-center"
              >
                <UIcon
                  name="i-lucide-ban"
                  class="mx-auto mb-2 size-8 text-muted"
                />
                <p class="text-sm font-medium text-highlighted">
                  Nenhuma ação cadastrada
                </p>
                <p class="mt-1 text-sm text-muted">
                  Ainda não existem ações disponíveis para este papel.
                </p>
              </div>
            </UPageCard>
          </div>

          <UPageCard
            title="Usuários vinculados"
            description="Adicione um vínculo com um usuário ou remova quem não deve mais usar este papel."
            variant="subtle"
          >
            <div class="mb-4 flex gap-3">
              <USelectMenu
                v-model="selectedUserId"
                :items="userOptions"
                value-key="value"
                label-key="label"
                search-placeholder="Buscar usuário..."
                placeholder="Selecione um usuário para vincular"
                class="w-full"
                :disabled="
                  !canManageUserLinks || isUpdatingLink || !userOptions.length
                "
              />

              <UTooltip text="Adicionar vínculo">
                <UButton
                  icon="i-lucide-plus"
                  color="neutral"
                  :loading="isUpdatingLink"
                  :disabled="!canManageUserLinks || !selectedUserId"
                  @click="addUserLink"
                />
              </UTooltip>
            </div>

            <div
              v-if="assignedUsers.length"
              class="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
            >
              <div
                v-for="user in assignedUsers"
                :key="user.id"
                class="rounded-xl border border-default/70 px-4 py-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="space-y-1">
                    <p class="text-sm font-medium text-highlighted">
                      {{ userLabel(user) }}
                    </p>
                    <div class="flex flex-wrap items-center gap-2">
                      <UBadge
                        :label="user.active ? 'Ativo' : 'Inativo'"
                        :color="user.active ? 'success' : 'neutral'"
                        variant="subtle"
                        size="xs"
                      />
                    </div>
                  </div>

                  <UTooltip v-if="canManageUserLinks" text="Remover vínculo">
                    <UButton
                      icon="i-lucide-user-minus"
                      color="error"
                      variant="ghost"
                      size="xs"
                      :loading="isUpdatingLink"
                      @click="removeUserLink(user.id)"
                    />
                  </UTooltip>
                </div>

                <p v-if="user.email" class="mt-1 text-xs text-muted">
                  {{ user.email }}
                </p>
                <p v-if="user.employee_name" class="mt-1 text-xs text-muted">
                  Funcionário: {{ user.employee_name }}
                </p>
              </div>
            </div>

            <div
              v-else
              class="rounded-xl border border-dashed border-default px-4 py-8 text-center"
            >
              <UIcon
                name="i-lucide-users"
                class="mx-auto mb-2 size-8 text-muted"
              />
              <p class="text-sm font-medium text-highlighted">
                Nenhum usuário vinculado
              </p>
              <p class="mt-1 text-sm text-muted">
                Quando alguém receber este papel, o usuário aparecerá aqui.
              </p>
            </div>
          </UPageCard>

          <div
            class="sticky bottom-0 z-10 -mx-4 border-t border-default/70 bg-default/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-default/80"
          >
            <div class="flex flex-wrap items-center justify-end gap-2">
              <UButton
                label="Voltar"
                color="neutral"
                variant="ghost"
                icon="i-lucide-arrow-left"
                to="/app/settings/roles"
              />
              <UButton
                label="Salvar alterações"
                color="neutral"
                icon="i-lucide-save"
                :loading="isSaving"
                :disabled="isSaveDisabled"
                @click="saveRole"
              />
            </div>
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
