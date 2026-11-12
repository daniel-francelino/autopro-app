<script setup lang="ts">
import RoleDetailsSlideover from '~/components/roles/RoleDetailsSlideover.vue'
import { ActionCode } from '~/constants/action-codes'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Permissões' })

const toast = useToast()
const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const canView = computed(() => workshop.can(ActionCode.ROLES_READ))
const canCreate = computed(() => workshop.can(ActionCode.ROLES_CREATE))
const canUpdate = computed(() => workshop.can(ActionCode.ROLES_UPDATE))
const canDelete = computed(() => workshop.can(ActionCode.ROLES_DELETE))

type Role = {
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

type RolesResponse = {
  items: Role[]
}

type RoleActionsResponse = {
  actions: ActionItem[]
  role_actions: RoleAction[]
}

const { data, status, refresh } = await useAsyncData(
  'roles-list',
  () => requestFetch<RolesResponse>('/api/roles', { headers: requestHeaders })
)

const roles = computed(() => data.value?.items ?? [])

const showRoleModal = ref(false)
const isEditingRole = ref(false)
const isSavingRole = ref(false)
const selectedRoleId = ref<string | null>(null)

const roleForm = reactive({
  display_name: '',
  description: ''
})

const showDeleteConfirm = ref(false)
const deletingRoleId = ref<string | null>(null)
const pendingDeleteRole = ref<Role | null>(null)

const selectedPermissionsRoleId = ref<string | null>(null)
const actionsData = ref<RoleActionsResponse | null>(null)
const isLoadingActions = ref(false)
const detailsRoleId = ref<string | null>(null)
const detailsSlideoverOpen = ref(false)

function roleLabel(role: Role) {
  return role.display_name?.trim() || role.name
}

function slugifyRoleName(value: string) {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return normalized || 'papel_personalizado'
}

function resetRoleForm() {
  roleForm.display_name = ''
  roleForm.description = ''
}

function openCreateRole() {
  resetRoleForm()
  isEditingRole.value = false
  selectedRoleId.value = null
  showRoleModal.value = true
}

function openEditRole(role: Role) {
  return navigateTo(`/app/settings/roles/${role.id}`)
}

async function saveRole() {
  if (isSavingRole.value)
    return

  const displayName = roleForm.display_name.trim()
  if (!displayName)
    return

  isSavingRole.value = true

  try {
    const body = {
      display_name: displayName,
      description: roleForm.description.trim() || null,
      ...(isEditingRole.value ? {} : { name: slugifyRoleName(displayName) })
    }

    if (isEditingRole.value && selectedRoleId.value) {
      await $fetch(`/api/roles/${selectedRoleId.value}`, { method: 'PUT', body })
      toast.add({ title: 'Papel atualizado', color: 'success' })
    } else {
      await $fetch('/api/roles', { method: 'POST', body })
      toast.add({ title: 'Papel criado', color: 'success' })
    }

    showRoleModal.value = false
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro',
      description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível salvar',
      color: 'error'
    })
  } finally {
    isSavingRole.value = false
  }
}

function requestDeleteRole(role: Role) {
  pendingDeleteRole.value = role
  showDeleteConfirm.value = true
}

async function confirmDeleteRole() {
  if (!pendingDeleteRole.value || deletingRoleId.value)
    return

  deletingRoleId.value = pendingDeleteRole.value.id

  try {
    await $fetch(`/api/roles/${pendingDeleteRole.value.id}`, { method: 'DELETE' })
    toast.add({ title: 'Papel removido', color: 'success' })

    if (selectedPermissionsRoleId.value === pendingDeleteRole.value.id) {
      selectedPermissionsRoleId.value = null
      actionsData.value = null
    }

    showDeleteConfirm.value = false
    pendingDeleteRole.value = null
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro',
      description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível remover',
      color: 'error'
    })
  } finally {
    deletingRoleId.value = null
  }
}

async function fetchRolePermissions(roleId: string) {
  const response = await $fetch<RoleActionsResponse>(`/api/roles/${roleId}/actions`)
  actionsData.value = response
}

async function openPermissions(role: Role) {
  if (selectedPermissionsRoleId.value === role.id) {
    selectedPermissionsRoleId.value = null
    actionsData.value = null
    return
  }

  selectedPermissionsRoleId.value = role.id
  isLoadingActions.value = true

  try {
    await fetchRolePermissions(role.id)
  } catch (error: unknown) {
    selectedPermissionsRoleId.value = null
    actionsData.value = null

    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro',
      description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível carregar permissões',
      color: 'error'
    })
  } finally {
    isLoadingActions.value = false
  }
}

function openRoleDetails(role: Role | null) {
  if (!role)
    return

  detailsRoleId.value = role.id
  detailsSlideoverOpen.value = true
}
</script>

<template>
  <div v-if="!canView" class="rounded-xl border border-default/60 bg-elevated/30 p-6">
    <p class="text-sm text-muted">
      Você não tem permissão para visualizar papéis.
    </p>
  </div>

  <template v-else>
    <UPageCard
      title="Papéis e permissões"
      description="Gerencie os perfis da equipe e o acesso de cada um no sistema."
      variant="naked"
      orientation="horizontal"
      class="mb-4"
    >
      <UButton
        v-if="canCreate"
        label="Novo papel"
        icon="i-lucide-plus"
        color="neutral"
        class="w-fit lg:ms-auto"
        @click="openCreateRole"
      />
    </UPageCard>

    <div class="grid grid-cols-1 gap-4">
      <UPageCard variant="subtle">
        <div v-if="status === 'pending'" class="space-y-3">
          <USkeleton v-for="i in 5" :key="i" class="h-16 w-full rounded-lg" />
        </div>

        <div v-else-if="roles.length" class="space-y-2">
          <div
            v-for="role in roles"
            :key="role.id"
            role="button"
            tabindex="0"
            class="flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-3 text-left transition-colors"
            :class="selectedPermissionsRoleId === role.id ? 'border-primary bg-primary/5' : 'border-default hover:bg-elevated/60'"
            @click="openPermissions(role)"
            @keydown.enter.prevent="openPermissions(role)"
            @keydown.space.prevent="openPermissions(role)"
          >
            <div class="min-w-0 space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-sm font-medium text-highlighted">
                  {{ roleLabel(role) }}
                </p>
                <UBadge
                  v-if="role.is_system_role"
                  label="Sistema"
                  color="neutral"
                  variant="subtle"
                  size="xs"
                />
              </div>

              <p v-if="role.description" class="text-xs text-muted">
                {{ role.description }}
              </p>

              <p v-else class="text-xs text-muted">
                -
              </p>
            </div>

            <div class="flex shrink-0 items-center gap-1">
              <UTooltip text="Ver detalhes">
                <UButton
                  icon="i-lucide-eye"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click.stop="openRoleDetails(role)"
                />
              </UTooltip>
              <UTooltip v-if="canUpdate && !role.is_system_role" text="Editar papel">
                <UButton
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click.stop="openEditRole(role)"
                />
              </UTooltip>
              <UTooltip v-if="canDelete && !role.is_system_role" text="Remover papel">
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :loading="deletingRoleId === role.id"
                  @click.stop="requestDeleteRole(role)"
                />
              </UTooltip>
            </div>
          </div>
        </div>

        <div v-else class="rounded-lg border border-dashed border-default px-4 py-8 text-center">
          <UIcon name="i-lucide-shield-off" class="mx-auto mb-2 size-8 text-muted" />
          <p class="text-sm font-medium text-highlighted">
            Nenhum papel cadastrado
          </p>
          <p class="mt-1 text-sm text-muted">
            Crie um papel para organizar o acesso da equipe.
          </p>
        </div>
      </UPageCard>
    </div>
  </template>

  <UModal
    v-model:open="showRoleModal"
    :title="isEditingRole ? 'Editar papel' : 'Novo papel'"
    :description="isEditingRole ? 'Atualize o nome exibido e a descrição do perfil.' : 'Crie um novo perfil para organizar o acesso da equipe.'"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField
          label="Nome exibido"
          description="Esse nome aparece na seleção de perfis e nas configurações da equipe."
          required
        >
          <UInput
            v-model="roleForm.display_name"
            class="w-full"
            placeholder="Ex: Consultor técnico"
          />
        </UFormField>

        <UFormField label="Descrição" description="Opcional. Use para explicar quando esse papel deve ser usado.">
          <UTextarea
            v-model="roleForm.description"
            class="w-full"
            :rows="3"
            placeholder="Ex: Perfil para atendimento, abertura de OS e acompanhamento de clientes."
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancelar"
          color="neutral"
          variant="ghost"
          @click="showRoleModal = false"
        />
        <UButton
          :label="isEditingRole ? 'Salvar alterações' : 'Criar papel'"
          color="neutral"
          :loading="isSavingRole"
          :disabled="isSavingRole || !roleForm.display_name.trim()"
          @click="saveRole"
        />
      </div>
    </template>
  </UModal>

  <AppConfirmModal
    :open="showDeleteConfirm"
    title="Remover papel"
    confirm-label="Remover"
    confirm-color="error"
    :loading="Boolean(deletingRoleId)"
    @update:open="
      (value: boolean) => {
        showDeleteConfirm = value
        if (!value && !deletingRoleId) pendingDeleteRole = null
      }
    "
    @confirm="confirmDeleteRole"
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja remover o papel
        <strong class="text-highlighted">{{ pendingDeleteRole ? roleLabel(pendingDeleteRole) : 'selecionado' }}</strong>?
        Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>

  <RoleDetailsSlideover
    :open="detailsSlideoverOpen"
    :role-id="detailsRoleId"
    @update:open="detailsSlideoverOpen = $event"
  />
</template>
