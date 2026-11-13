<script setup lang="ts">
import RoleDetailsSlideover from '~/components/roles/RoleDetailsSlideover.vue'
import RoleRowActions from '~/components/roles/RoleRowActions.vue'
import { ActionCode } from '~/constants/action-codes'
import { rolePermissionsLabel, roleUsersLabel, sortRolesForList } from '~/utils/role-permissions'

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
  assigned_users_count?: number
  granted_actions_count?: number
}

type RolesResponse = {
  items: Role[]
}

const { data, status, refresh } = await useAsyncData(
  'roles-list',
  () => requestFetch<RolesResponse>('/api/roles', { headers: requestHeaders })
)

const sortedRoles = computed(() => sortRolesForList(data.value?.items ?? []))

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

    <div v-if="status === 'pending'" class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <USkeleton v-for="i in 4" :key="i" class="h-32 w-full rounded-xl" />
    </div>

    <ul v-else-if="sortedRoles.length" class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <li
        v-for="role in sortedRoles"
        :key="role.id"
        class="flex min-w-0 flex-col gap-3 rounded-xl border border-default bg-default p-4 shadow-xs"
      >
        <div class="flex min-w-0 items-start gap-3">
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-lg"
            :class="role.is_system_role ? 'bg-elevated text-muted' : 'bg-primary/10 text-primary'"
            aria-hidden="true"
          >
            <UIcon name="i-lucide-shield" class="size-5" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="break-words text-base font-semibold text-highlighted">
              {{ roleLabel(role) }}
            </p>
            <p v-if="role.is_system_role" class="mt-0.5 flex items-center gap-1 text-xs text-muted">
              <UIcon name="i-lucide-lock" class="size-3.5 shrink-0" aria-hidden="true" />
              Sistema · Somente leitura
            </p>
            <UBadge
              v-else
              label="Personalizado"
              color="primary"
              variant="subtle"
              size="sm"
              class="mt-0.5"
            />
          </div>
          <RoleRowActions
            class="shrink-0"
            :role-name="roleLabel(role)"
            :can-edit="canUpdate && !role.is_system_role"
            :can-delete="canDelete && !role.is_system_role"
            :deleting="deletingRoleId === role.id"
            @view="openRoleDetails(role)"
            @edit="openEditRole(role)"
            @delete="requestDeleteRole(role)"
          />
        </div>
        <div class="flex flex-wrap gap-2">
          <span class="inline-flex items-center gap-1.5 rounded-full bg-elevated px-3 py-1 text-sm text-default">
            <UIcon name="i-lucide-users" class="size-4 text-muted" aria-hidden="true" />
            {{ roleUsersLabel(role.assigned_users_count) }}
          </span>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-elevated px-3 py-1 text-sm text-default">
            <UIcon name="i-lucide-key-round" class="size-4 text-muted" aria-hidden="true" />
            {{ rolePermissionsLabel(role.granted_actions_count) }}
          </span>
        </div>
      </li>
    </ul>

    <div v-else class="rounded-lg border border-dashed border-default px-4 py-8 text-center">
      <UIcon name="i-lucide-shield-off" class="mx-auto mb-2 size-8 text-muted" />
      <p class="text-sm font-medium text-highlighted">
        Nenhum papel cadastrado
      </p>
      <p class="mt-1 text-sm text-muted">
        Crie um papel para organizar o acesso da equipe.
      </p>
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
    :confirm-disabled="Boolean(pendingDeleteRole?.assigned_users_count)"
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
      <p
        v-if="pendingDeleteRole?.assigned_users_count"
        class="mt-2 text-sm text-warning"
      >
        Este papel tem {{ pendingDeleteRole.assigned_users_count }}
        usuário(s) vinculado(s). A exclusão só é aceita depois de
        desvinculá-los.
      </p>
    </template>
  </AppConfirmModal>

  <RoleDetailsSlideover
    :open="detailsSlideoverOpen"
    :role-id="detailsRoleId"
    @update:open="detailsSlideoverOpen = $event"
  />
</template>
