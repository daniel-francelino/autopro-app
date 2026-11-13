<script setup lang="ts">
import RolePermissionsAccordion from '~/components/roles/RolePermissionsAccordion.vue'
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
const selectedUserId = ref<string | undefined>()

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

const changedPermissionIds = computed(() =>
  diffPermissions(
    actions.value,
    originalPermissionState.value,
    permissionState.value
  )
)

const hasPermissionChanges = computed(
  () => changedPermissionIds.value.length > 0
)

const isDirty = computed(
  () =>
    (canEditMetadata.value && hasMetadataChanges.value)
    || (canEditPermissions.value && hasPermissionChanges.value)
)

const dirtyCount = computed(
  () =>
    (canEditPermissions.value ? changedPermissionIds.value.length : 0)
    + (canEditMetadata.value && hasMetadataChanges.value ? 1 : 0)
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

function organizationUserLabel(user: OrganizationUser) {
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

function discardChanges() {
  syncForm()
  toast.add({ title: 'Alterações descartadas', color: 'neutral' })
}

// Guarda de saida (dados do papel + permissoes; vinculo de usuario nao entra).
const showLeaveConfirm = ref(false)
let leaveResolver: ((leave: boolean) => void) | null = null

function confirmLeave(): Promise<boolean> {
  // Chamada repetida: resolve a anterior com "ficar" para nao deixar Promise pendente.
  leaveResolver?.(false)
  leaveResolver = null
  showLeaveConfirm.value = true
  return new Promise((resolve) => {
    leaveResolver = resolve
  })
}

function settleLeave(leave: boolean) {
  const resolve = leaveResolver
  leaveResolver = null
  showLeaveConfirm.value = false
  resolve?.(leave)
}

function guardNavigation() {
  if (!isDirty.value || isSaving.value) return true
  return confirmLeave()
}

onBeforeRouteLeave(guardNavigation)
onBeforeRouteUpdate((to, from) => {
  if (to.params.id === from.params.id) return true
  return guardNavigation()
})

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!isDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() =>
  window.removeEventListener('beforeunload', onBeforeUnload)
)

// Vinculo/desvinculo de usuario e imediato (nao depende de "Salvar alteracoes").
const pendingUnlinkUser = ref<AssignedUser | null>(null)
const showUnlinkConfirm = ref(false)

function askRemoveUserLink(user: AssignedUser) {
  pendingUnlinkUser.value = user
  showUnlinkConfirm.value = true
}

async function confirmRemoveUserLink() {
  const user = pendingUnlinkUser.value
  if (!user) return

  await removeUserLink(user)
  showUnlinkConfirm.value = false
  pendingUnlinkUser.value = null
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

  const linkedUser = organizationUsers.value.find(
    user => user.id === selectedUserId.value
  )
  const success = await updateUserRoleLink(selectedUserId.value, role.value.id)
  if (!success) return

  selectedUserId.value = undefined
  toast.add({
    title: 'Vínculo atualizado',
    description: `${linkedUser ? organizationUserLabel(linkedUser) : 'Usuário'} agora tem o papel ${roleLabel(role.value)}.`,
    color: 'success'
  })
}

async function removeUserLink(user: AssignedUser) {
  if (isUpdatingLink.value) return

  const success = await updateUserRoleLink(user.id, null)
  if (!success) return

  toast.add({
    title: 'Vínculo removido',
    description: `${userLabel(user)} foi removido do papel ${roleLabel(role.value)}.`,
    color: 'success'
  })
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
      const changedIds = new Set(changedPermissionIds.value)
      const changedActions = actions.value.filter(action =>
        changedIds.has(action.id)
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
    syncForm()
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

// Sincroniza so na carga inicial, ao trocar de papel e apos salvar (explicito em saveRole).
// refresh() por vinculo de usuario nao deve apagar edicoes pendentes.
syncForm()
watch(() => role.value?.id, syncForm)

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
                  usuários e marque quais ações ficam liberadas para esse
                  perfil.
                </p>

                <UAlert
                  v-if="role.is_system_role"
                  color="neutral"
                  variant="subtle"
                  icon="i-lucide-lock"
                  title="Papel de sistema: somente leitura"
                  description="Dados e permissões podem ser consultados, mas não alterados. Para um perfil diferente, crie um papel próprio."
                  :actions="
                    workshop.can(ActionCode.ROLES_CREATE)
                      ? [
                        {
                          label: 'Criar novo papel',
                          color: 'neutral',
                          variant: 'outline',
                          size: 'xs',
                          to: '/app/settings/roles'
                        }
                      ]
                      : []
                  "
                />
              </div>

              <div
                class="grid grid-cols-2 gap-3"
              >
                <div
                  class="flex min-w-0 flex-col items-start gap-1 rounded-2xl border border-default/70 bg-default/40 p-3"
                >
                  <p
                    class="flex min-w-0 items-center gap-1.5 text-xs text-muted"
                  >
                    <UIcon name="i-lucide-users" class="size-4 shrink-0 text-primary/80" />
                    <span class="truncate">Usuários</span>
                  </p>
                  <p
                    class="text-2xl font-semibold tabular-nums text-highlighted"
                  >
                    {{ summary.assigned_users_count }}
                  </p>
                </div>
                <div
                  class="flex min-w-0 flex-col items-start gap-1 rounded-2xl border border-default/70 bg-default/40 p-3"
                >
                  <p
                    class="flex min-w-0 items-center gap-1.5 text-xs text-muted"
                  >
                    <UIcon name="i-lucide-badge-check" class="size-4 shrink-0 text-success" />
                    <span class="truncate">Liberadas</span>
                  </p>
                  <p
                    class="text-2xl font-semibold tabular-nums text-highlighted"
                  >
                    {{ summary.granted_actions_count }}
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
              description="Agrupadas por módulo. Use a busca ou marque todas as ações de um módulo."
              variant="subtle"
            >
              <RolePermissionsAccordion
                v-if="actions.length"
                v-model="permissionState"
                :actions="actions"
                :disabled="!canEditPermissions || isSaving"
              />

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
            description="Vincular e desvincular são aplicados imediatamente; não dependem de 'Salvar alterações'."
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

              <UTooltip text="Vincular usuário ao papel (aplicado na hora)">
                <UButton
                  label="Vincular"
                  icon="i-lucide-plus"
                  aria-label="Vincular usuário selecionado ao papel"
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
                        size="sm"
                      />
                    </div>
                  </div>

                  <UTooltip v-if="canManageUserLinks" text="Remover vínculo">
                    <UButton
                      icon="i-lucide-user-minus"
                      color="error"
                      variant="ghost"
                      size="sm"
                      class="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
                      :loading="isUpdatingLink"
                      :aria-label="`Desvincular ${userLabel(user)}`"
                      @click="askRemoveUserLink(user)"
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
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p
                class="min-h-5 text-sm"
                :class="isDirty ? 'font-medium text-highlighted' : 'text-muted'"
                role="status"
                aria-live="polite"
              >
                <template v-if="isDirty">
                  <span
                    class="mr-1.5 inline-block size-2 rounded-full bg-warning align-middle"
                    aria-hidden="true"
                  />
                  Alterações não salvas ({{ dirtyCount }})
                </template>
              </p>
              <div class="flex flex-wrap items-center gap-2">
                <UButton
                  label="Descartar"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-undo-2"
                  :disabled="!isDirty || isSaving"
                  @click="discardChanges"
                />
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
          </div>

          <AppConfirmModal
            :open="showLeaveConfirm"
            title="Sair sem salvar?"
            description="As alterações em dados e permissões serão perdidas."
            confirm-label="Sair sem salvar"
            confirm-color="error"
            @update:open="(value: boolean) => !value && settleLeave(false)"
            @confirm="settleLeave(true)"
          />

          <AppConfirmModal
            :open="showUnlinkConfirm"
            title="Desvincular usuário"
            confirm-label="Desvincular"
            confirm-color="error"
            :loading="isUpdatingLink"
            @update:open="
              (value: boolean) => {
                showUnlinkConfirm = value
                if (!value && !isUpdatingLink) pendingUnlinkUser = null
              }
            "
            @confirm="confirmRemoveUserLink"
          >
            <template #description>
              <p class="text-sm text-muted">
                Remover
                <strong class="text-highlighted">{{
                  pendingUnlinkUser ? userLabel(pendingUnlinkUser) : ''
                }}</strong>
                do papel
                <strong class="text-highlighted">{{ roleLabel(role) }}</strong>?
                A mudança é aplicada na hora, sem depender de "Salvar
                alterações".
              </p>
            </template>
          </AppConfirmModal>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
