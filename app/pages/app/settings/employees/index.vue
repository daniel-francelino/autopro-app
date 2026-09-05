<script setup lang="ts">
import { ActionCode } from '~/constants/action-codes'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Funcionários' })

const toast = useToast()
const workshop = useWorkshopPermissions()
const bootstrap = useWorkshopBootstrap()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server
  ? useRequestHeaders(['cookie'])
  : undefined

const canRead = computed(() => workshop.can(ActionCode.EMPLOYEES_READ))
const canCreate = computed(() => workshop.can(ActionCode.EMPLOYEES_CREATE))
const canUpdate = computed(() => workshop.can(ActionCode.EMPLOYEES_UPDATE))
const canDelete = computed(() => workshop.can(ActionCode.EMPLOYEES_DELETE))

type Employee = Record<string, unknown>

// ─── List ──────────────────────────────────────────────────
const search = ref('')
const includeTerminated = ref(false)

const { data, status, refresh } = await useAsyncData('employees-list', () =>
  requestFetch<{ items: Employee[] }>('/api/employees', {
    headers: requestHeaders,
    query: {
      search: search.value || undefined,
      include_terminated: includeTerminated.value || undefined
    }
  })
)

const employees = computed(() => data.value?.items ?? [])

// ─── License limits ────────────────────────────────────────
const maxEmployees = computed(() => bootstrap.maxEmployees.value)
const activeEmployeeCount = computed(() =>
  employees.value.filter((e) => {
    const t = (e as Record<string, unknown>).termination_date
    if (!t) return true
    return String(t) > new Date().toISOString().split('T')[0]!
  }).length
)
const isAtEmployeeLimit = computed(() =>
  maxEmployees.value !== null && activeEmployeeCount.value >= maxEmployees.value
)
const employeeLimitColor = computed(() => {
  if (maxEmployees.value === null) return 'success'
  const ratio = activeEmployeeCount.value / maxEmployees.value
  if (ratio >= 1) return 'error'
  if (ratio >= 0.8) return 'warning'
  return 'success'
})

watch([search, includeTerminated], () => refresh())

// ─── Form ─────────────────────────────────────────────────
const showModal = ref(false)
const isEditing = ref(false)
const isSaving = ref(false)
const selectedId = ref<string | null>(null)
const isFetchingCep = ref(false)
const isEmailLocked = ref(false)
const editFormHasAuthUser = ref(false)

type Role = {
  id: string
  name: string
  display_name: string
  is_system_role: boolean
}
const availableRoles = ref<Role[]>([])
const isLoadingRoles = ref(false)

async function loadRoles() {
  if (availableRoles.value.length > 0 || isLoadingRoles.value) return
  isLoadingRoles.value = true
  try {
    const res = await $fetch<{ items: Role[] }>('/api/roles')
    availableRoles.value = res?.items ?? []
  } catch {
    // non-critical
  } finally {
    isLoadingRoles.value = false
  }
}

type Installment = { day: number, amount: string }

const emptyForm = () => ({
  name: '',
  role: '',
  person_type: 'pf' as string,
  tax_id: '',
  phone: '',
  email: '',
  // Address
  zip_code: '',
  street: '',
  address_number: '',
  address_complement: '',
  neighborhood: '',
  city: '',
  state: '',
  // Salary
  has_salary: false,
  salary_amount: '' as string,
  payment_day: '5' as string,
  salary_installments: [] as Installment[],
  // Minimum guarantee
  has_minimum_guarantee: false,
  minimum_guarantee_amount: '' as string,
  minimum_guarantee_installments: [] as Installment[],
  // PIX
  pix_key_type: '' as string,
  pix_key: '',
  // Termination
  termination_date: '',
  termination_reason: '',
  // System access role (only relevant when employee has an auth user)
  role_id: undefined as string | undefined
})

const form = reactive(emptyForm())

function openCreate() {
  Object.assign(form, emptyForm())
  isEditing.value = false
  selectedId.value = null
  isEmailLocked.value = false
  showModal.value = true
}

function openDetails(emp: Employee) {
  if (typeof emp.id !== 'string') return
  navigateTo(`/app/settings/employees/${emp.id}`)
}

function openEdit(emp: Employee) {
  const toInstallments = (arr: unknown[]): Installment[] =>
    (arr || []).map(p => ({
      day: Number((p as Installment).day) || 1,
      amount: String((p as Installment).amount ?? '')
    }))

  Object.assign(form, {
    name: emp.name ?? '',
    role: emp.role ?? '',
    person_type: emp.person_type ?? 'pf',
    tax_id: emp.tax_id
      ? maskCpfCnpj(String(emp.tax_id), String(emp.person_type ?? 'pf'))
      : '',
    phone: emp.phone ? maskPhone(String(emp.phone)) : '',
    email: emp.email ?? '',
    zip_code: emp.zip_code ? maskCep(String(emp.zip_code)) : '',
    street: emp.street ?? '',
    address_number: emp.address_number ?? '',
    address_complement: emp.address_complement ?? '',
    neighborhood: emp.neighborhood ?? '',
    city: emp.city ?? '',
    state: emp.state ?? '',
    has_salary: emp.has_salary ?? false,
    salary_amount: emp.salary_amount != null ? String(emp.salary_amount) : '',
    payment_day: emp.payment_day != null ? String(emp.payment_day) : '5',
    salary_installments: toInstallments(emp.salary_installments as unknown[]),
    has_minimum_guarantee: emp.has_minimum_guarantee ?? false,
    minimum_guarantee_amount:
      emp.minimum_guarantee_amount != null
        ? String(emp.minimum_guarantee_amount)
        : '',
    minimum_guarantee_installments: toInstallments(
      emp.minimum_guarantee_installments as unknown[]
    ),
    pix_key_type: emp.pix_key_type ?? '',
    pix_key: (() => {
      const raw = String(emp.pix_key ?? '')
      const type = String(emp.pix_key_type ?? '')
      if (type === 'cpf') return maskCpfCnpj(raw, 'pf')
      if (type === 'cnpj') return maskCpfCnpj(raw, 'pj')
      if (type === 'phone') return maskPhone(raw)
      return raw
    })(),
    termination_date: emp.termination_date ? String(emp.termination_date) : '',
    termination_reason: emp.termination_reason ?? ''
  })

  isEditing.value = true
  selectedId.value = emp.id as string
  isEmailLocked.value = false
  editFormHasAuthUser.value = false
  form.role_id = undefined
  showModal.value = true

  loadRoles()

  if (typeof emp.id === 'string') {
    fetchEmployeeAccessStatus(emp.id)
      .then((status) => {
        isEmailLocked.value = status.hasAuthUser
        editFormHasAuthUser.value = status.hasAuthUser
        if (status.hasAuthUser && status.role_id) {
          form.role_id = status.role_id
        }
      })
      .catch(() => {
        isEmailLocked.value = false
        editFormHasAuthUser.value = false
      })
  }
}

watch(
  () => form.pix_key_type,
  () => {
    form.pix_key = ''
  }
)

// ─── Mask helpers ─────────────────────────────────────────
function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 10)
    return d.replace(/(\d{2})(\d{4})(\d{0,4})/, (_, a, b, c) =>
      c ? `(${a}) ${b}-${c}` : b ? `(${a}) ${b}` : a ? `(${a}` : ''
    )
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, (_, a, b, c) =>
    c ? `(${a}) ${b}-${c}` : `(${a}) ${b}`
  )
}

function formatDisplayPhone(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 11)
  if (!digits) return ''
  if (digits.length <= 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{0,4})/, (_, a, b, c) =>
      c ? `(${a}) ${b}-${c}` : b ? `(${a}) ${b}` : a ? `(${a}` : ''
    )
  }
  return digits.replace(/(\d{2})(\d{5})(\d{0,4})/, (_, a, b, c) =>
    c ? `(${a}) ${b}-${c}` : `(${a}) ${b}`
  )
}

function maskCpfCnpj(raw: string, type: string): string {
  const d = raw.replace(/\D/g, '')
  if (type === 'pf') {
    return d
      .slice(0, 11)
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }
  return d
    .slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

function maskCep(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  return d.replace(/(\d{5})(\d)/, '$1-$2')
}

function onPhoneInput(e: Event) {
  form.phone = maskPhone((e.target as HTMLInputElement).value)
}

function onTaxIdInput(e: Event) {
  form.tax_id = maskCpfCnpj(
    (e.target as HTMLInputElement).value,
    form.person_type
  )
}

function onCepInput(e: Event) {
  form.zip_code = maskCep((e.target as HTMLInputElement).value)
}

function onPixKeyInput(e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (form.pix_key_type === 'cpf') form.pix_key = maskCpfCnpj(v, 'pf')
  else if (form.pix_key_type === 'cnpj') form.pix_key = maskCpfCnpj(v, 'pj')
  else if (form.pix_key_type === 'phone') form.pix_key = maskPhone(v)
  else form.pix_key = v
}

watch(
  () => form.person_type,
  () => {
    form.tax_id = maskCpfCnpj(form.tax_id, form.person_type)
  }
)

// ─── CEP lookup ───────────────────────────────────────────
async function lookupCep() {
  const cep = form.zip_code.replace(/\D/g, '')
  if (cep.length !== 8 || isFetchingCep.value) return
  isFetchingCep.value = true
  try {
    const res = await $fetch<Record<string, unknown>>(
      `https://viacep.com.br/ws/${cep}/json/`
    )
    if (res && !res.erro) {
      form.street = String(res.logradouro || '')
      form.neighborhood = String(res.bairro || '')
      form.city = String(res.localidade || '')
      form.state = String(res.uf || '')
    }
  } catch {
    // optional
  } finally {
    isFetchingCep.value = false
  }
}

// ─── Installment helpers ──────────────────────────────────
function addSalaryInstallment() {
  form.salary_installments.push({ day: 5, amount: '' })
}
function removeSalaryInstallment(i: number) {
  form.salary_installments.splice(i, 1)
}
function addMinGuaranteeInstallment() {
  form.minimum_guarantee_installments.push({ day: 5, amount: '' })
}
function removeMinGuaranteeInstallment(i: number) {
  form.minimum_guarantee_installments.splice(i, 1)
}

// ─── Save ─────────────────────────────────────────────────
async function save() {
  if (isSaving.value) return
  isSaving.value = true
  try {
    const toPayload = (arr: Installment[]) =>
      arr.map(p => ({
        day: Number(p.day) || 1,
        amount: parseFloat(p.amount) || 0
      }))

    const cleanPixKey = (key: string, type: string) =>
      ['cpf', 'cnpj', 'phone'].includes(type) ? key.replace(/\D/g, '') : key

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      role: form.role || null,
      person_type: form.person_type,
      tax_id: form.tax_id.replace(/\D/g, '') || null,
      phone: form.phone.replace(/\D/g, '') || null,
      email: form.email || null,
      zip_code: form.zip_code.replace(/\D/g, '') || null,
      street: form.street || null,
      address_number: form.address_number || null,
      address_complement: form.address_complement || null,
      neighborhood: form.neighborhood || null,
      city: form.city || null,
      state: form.state || null,
      has_salary: form.has_salary,
      salary_amount:
        form.has_salary && form.salary_amount !== ''
          ? parseFloat(String(form.salary_amount))
          : null,
      payment_day:
        form.has_salary && form.payment_day !== ''
          ? Number(String(form.payment_day))
          : null,
      salary_installments: form.has_salary
        ? toPayload(form.salary_installments)
        : [],
      has_minimum_guarantee: form.has_minimum_guarantee,
      minimum_guarantee_amount:
        form.has_minimum_guarantee && form.minimum_guarantee_amount !== ''
          ? parseFloat(String(form.minimum_guarantee_amount))
          : null,
      minimum_guarantee_installments: form.has_minimum_guarantee
        ? toPayload(form.minimum_guarantee_installments)
        : [],
      pix_key_type: form.pix_key_type || null,
      pix_key: form.pix_key_type
        ? cleanPixKey(form.pix_key, form.pix_key_type)
        : null,
      termination_date: form.termination_date || null,
      termination_reason: form.termination_reason || null,
      role_id:
        isEditing.value && editFormHasAuthUser.value
          ? form.role_id || null
          : undefined
    }

    if (isEditing.value && selectedId.value) {
      await $fetch(`/api/employees/${selectedId.value}`, {
        method: 'PUT',
        body
      })
      toast.add({ title: 'Funcionário atualizado', color: 'success' })
    } else {
      await $fetch('/api/employees', { method: 'POST', body })
      toast.add({ title: 'Funcionário criado', color: 'success' })
    }

    showModal.value = false
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
        || 'Não foi possível salvar',
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}

// ─── Delete ───────────────────────────────────────────────
const showConfirm = ref(false)
const isDeleting = ref(false)
const pendingDelete = ref<Employee | null>(null)

function askDelete(emp: Employee) {
  pendingDelete.value = emp
  showConfirm.value = true
}

async function confirmDelete() {
  if (!pendingDelete.value || isDeleting.value) return
  isDeleting.value = true
  try {
    await $fetch(`/api/employees/${pendingDelete.value.id}`, {
      method: 'DELETE'
    })
    toast.add({ title: 'Funcionário removido', color: 'success' })
    showConfirm.value = false
    pendingDelete.value = null
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
        || 'Não foi possível remover',
      color: 'error'
    })
  } finally {
    isDeleting.value = false
  }
}

// ─── Grant access modal ───────────────────────────────────
const showAccessModal = ref(false)
const accessEmployee = ref<Employee | null>(null)
const accessStatus = ref<{ hasAuthUser: boolean, active?: boolean } | null>(
  null
)
const isLoadingAccessStatus = ref(false)
const isLinkingAccess = ref(false)

async function fetchEmployeeAccessStatus(employeeId: string) {
  return await $fetch<{
    hasAuthUser: boolean
    active?: boolean
    role_id?: string | null
  }>('/api/users/employee-auth-status', {
    method: 'POST',
    body: { employee_id: employeeId }
  })
}

async function openGrantAccess(emp: Employee) {
  accessEmployee.value = emp
  accessStatus.value = null
  isLoadingAccessStatus.value = true
  showAccessModal.value = true
  try {
    const res = await fetchEmployeeAccessStatus(String(emp.id))
    accessStatus.value = res
  } catch {
    accessStatus.value = null
  } finally {
    isLoadingAccessStatus.value = false
  }
}

async function grantAccess() {
  if (!accessEmployee.value || isLinkingAccess.value) return
  isLinkingAccess.value = true
  try {
    await $fetch(`/api/employees/${accessEmployee.value.id}/grant-access`, {
      method: 'POST' as const
    })
    accessStatus.value = { hasAuthUser: true, active: true }
    if (accessEmployee.value.id === selectedId.value) {
      editFormHasAuthUser.value = true
    }
    toast.add({
      title: 'Acesso criado!',
      description: `${accessEmployee.value.name} receberá um email para definir a senha.`,
      color: 'success'
    })
  } catch (error: unknown) {
    const err = error as {
      data?: { statusMessage?: string }
      statusMessage?: string
    }
    toast.add({
      title: 'Erro ao vincular acesso',
      description:
        err?.data?.statusMessage
        || err?.statusMessage
        || 'Não foi possível vincular',
      color: 'error'
    })
  } finally {
    isLinkingAccess.value = false
  }
}

// ─── Status helpers ───────────────────────────────────────
function getEmployeeStatus(emp: Employee): {
  label: string
  color: 'success' | 'warning' | 'neutral'
} {
  if (!emp.termination_date) return { label: 'Ativo', color: 'success' }
  const today = new Date().toISOString().split('T')[0]!
  if (String(emp.termination_date) <= today)
    return { label: 'Demitido', color: 'neutral' }
  return { label: 'Demissão agendada', color: 'warning' }
}

function getInitials(name: string) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return (parts[0]?.charAt(0) ?? '?').toUpperCase()
  return (
    (parts[0]?.charAt(0) ?? '') + (parts[parts.length - 1]?.charAt(0) ?? '')
  ).toUpperCase()
}

// ─── Select options ────────────────────────────────────────
const personTypeOptions = [
  { label: 'Pessoa Física (PF)', value: 'pf' },
  { label: 'Pessoa Jurídica (PJ)', value: 'pj' }
]

const pixKeyTypeOptions = [
  { label: 'CPF', value: 'cpf' },
  { label: 'CNPJ', value: 'cnpj' },
  { label: 'E-mail', value: 'email' },
  { label: 'Telefone', value: 'phone' },
  { label: 'Chave aleatória', value: 'random_key' }
]

// ─── Table columns ─────────────────────────────────────────
const columns = [
  { accessorKey: 'name', header: 'Funcionário', enableSorting: false },
  { accessorKey: 'role', header: 'Cargo', enableSorting: false },
  { accessorKey: 'phone', header: 'Telefone', enableSorting: false },
  { accessorKey: 'status_col', header: 'Status', enableSorting: false },
  { id: 'actions', header: '', enableSorting: false }
]
</script>

<template>
  <div
    v-if="!canRead"
    class="rounded-xl border border-default/60 bg-elevated/30 p-6"
  >
    <p class="text-sm text-muted">
      Você não tem permissão para visualizar funcionários.
    </p>
  </div>

  <template v-else>
    <UPageCard
      title="Funcionários"
      description="Gerencie a equipe da oficina."
      variant="naked"
      orientation="horizontal"
      class="mb-4"
    >
      <div class="flex flex-wrap items-center gap-3 lg:ms-auto">
        <div
          v-if="maxEmployees !== null"
          class="flex items-center gap-2"
        >
          <span class="text-sm text-muted">
            {{ activeEmployeeCount }} / {{ maxEmployees }} funcionários
          </span>
          <UProgress
            :value="activeEmployeeCount"
            :max="maxEmployees"
            :color="employeeLimitColor"
            size="sm"
            class="w-20"
          />
        </div>
        <UTooltip
          v-if="canCreate"
          :text="isAtEmployeeLimit ? `Limite do plano atingido (${maxEmployees} funcionários). Faça upgrade para adicionar mais.` : ''"
          :disabled="!isAtEmployeeLimit"
        >
          <UButton
            label="Novo funcionário"
            icon="i-lucide-plus"
            color="neutral"
            :disabled="isAtEmployeeLimit"
            @click="openCreate"
          />
        </UTooltip>
      </div>
    </UPageCard>

    <AppDataTable
      v-model:search-term="search"
      :columns="columns"
      :data="employees as Record<string, unknown>[]"
      :loading="status === 'pending'"
      :show-footer="false"
      show-search
      search-placeholder="Buscar por nome, CPF ou cargo..."
      empty-icon="i-lucide-users-round"
      empty-title="Nenhum funcionário encontrado"
      empty-description="Adicione funcionários para gerenciar sua equipe."
    >
      <template #filters>
        <UCheckbox
          v-model="includeTerminated"
          label="Incluir demitidos"
          color="neutral"
        />
      </template>

      <!-- Name cell with avatar -->
      <template #name-cell="{ row }">
        <div class="flex items-center gap-3">
          <img
            v-if="row.original.photo_url"
            :src="String(row.original.photo_url)"
            :alt="String(row.original.name ?? '')"
            class="size-8 shrink-0 rounded-full object-cover"
          >
          <div
            v-else
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10"
          >
            <span class="text-xs font-bold text-primary">
              {{ getInitials(String(row.original.name ?? "")) }}
            </span>
          </div>
          <div class="min-w-0">
            <p class="truncate font-medium text-highlighted">
              {{ row.original.name }}
            </p>
            <p v-if="row.original.email" class="truncate text-xs text-muted">
              {{ row.original.email }}
            </p>
          </div>
        </div>
      </template>

      <template #role-cell="{ row }">
        <span v-if="row.original.role" class="text-sm">{{
          row.original.role
        }}</span>
        <span v-else class="text-sm text-muted">—</span>
      </template>

      <template #phone-cell="{ row }">
        <span v-if="row.original.phone" class="font-mono text-sm">{{
          formatDisplayPhone(row.original.phone)
        }}</span>
        <span v-else class="text-sm text-muted">—</span>
      </template>

      <template #status_col-cell="{ row }">
        <UBadge
          :color="getEmployeeStatus(row.original).color"
          variant="subtle"
          size="sm"
        >
          {{ getEmployeeStatus(row.original).label }}
        </UBadge>
      </template>

      <template #actions-cell="{ row }">
        <div class="flex items-center justify-end gap-1">
          <UTooltip text="Ver detalhes">
            <UButton
              icon="i-lucide-eye"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="openDetails(row.original)"
            />
          </UTooltip>
          <UTooltip v-if="row.original.email" text="Gerenciar acesso">
            <UButton
              icon="i-lucide-key-round"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="openGrantAccess(row.original)"
            />
          </UTooltip>
          <UTooltip v-if="canUpdate" text="Editar">
            <UButton
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="openEdit(row.original)"
            />
          </UTooltip>
          <UTooltip v-if="canDelete" text="Remover">
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              @click="askDelete(row.original)"
            />
          </UTooltip>
        </div>
      </template>
    </AppDataTable>
  </template>

  <!-- ══════════════════════════════════════
       MODAL: criar / editar
  ═══════════════════════════════════════ -->
  <UModal
    v-model:open="showModal"
    :title="isEditing ? 'Editar funcionário' : 'Novo funcionário'"
    :description="
      isEditing
        ? 'Atualize os dados do funcionário.'
        : 'Preencha os dados para adicionar um novo membro à equipe.'
    "
    :ui="{ body: 'overflow-y-auto max-h-[72vh]' }"
  >
    <template #body>
      <div class="space-y-6">
        <!-- ── Dados pessoais ── -->
        <div>
          <p
            class="mb-3 text-xs font-semibold uppercase tracking-widest text-muted"
          >
            Dados pessoais
          </p>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField label="Nome completo" required class="sm:col-span-2">
              <UInput
                v-model="form.name"
                class="w-full"
                placeholder="Ex: João da Silva"
              />
            </UFormField>
            <UFormField label="Cargo">
              <UInput
                v-model="form.role"
                class="w-full"
                placeholder="Ex: Mecânico, Balconista"
              />
            </UFormField>
            <UFormField label="Tipo">
              <USelectMenu
                v-model="form.person_type"
                :items="personTypeOptions"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField
              :label="form.person_type === 'pj' ? 'CNPJ' : 'CPF'"
              required
            >
              <UInput
                :model-value="form.tax_id"
                class="w-full"
                :placeholder="
                  form.person_type === 'pj'
                    ? '00.000.000/0000-00'
                    : '000.000.000-00'
                "
                @input="onTaxIdInput"
              />
            </UFormField>
          </div>
        </div>

        <USeparator />

        <!-- ── Contato ── -->
        <div>
          <p
            class="mb-3 text-xs font-semibold uppercase tracking-widest text-muted"
          >
            Contato
          </p>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField label="Telefone / WhatsApp" required>
              <UInput
                :model-value="form.phone"
                class="w-full"
                placeholder="(00) 90000-0000"
                @input="onPhoneInput"
              />
            </UFormField>
            <UFormField label="E-mail">
              <UInput
                v-model="form.email"
                type="email"
                class="w-full"
                placeholder="joao@email.com"
                :disabled="isEmailLocked"
              />
              <p v-if="isEmailLocked" class="mt-1 text-xs text-muted">
                O e-mail não pode ser alterado após o funcionário já possuir um
                usuário vinculado.
              </p>
            </UFormField>
          </div>
        </div>

        <USeparator />

        <!-- ── Endereço ── -->
        <div>
          <p
            class="mb-3 text-xs font-semibold uppercase tracking-widest text-muted"
          >
            Endereço
          </p>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <UFormField label="CEP" class="sm:col-span-1">
              <div class="relative">
                <UInput
                  :model-value="form.zip_code"
                  class="w-full"
                  placeholder="00000-000"
                  maxlength="9"
                  @input="onCepInput"
                  @blur="lookupCep"
                />
                <UIcon
                  v-if="isFetchingCep"
                  name="i-lucide-loader-circle"
                  class="absolute right-2 top-2.5 size-4 animate-spin text-muted"
                />
              </div>
            </UFormField>
            <UFormField label="Logradouro" class="sm:col-span-3">
              <UInput
                v-model="form.street"
                class="w-full"
                placeholder="Rua, Av., Travessa..."
                :disabled="isFetchingCep"
              />
            </UFormField>
            <UFormField label="Número" class="sm:col-span-1">
              <UInput
                v-model="form.address_number"
                class="w-full"
                placeholder="S/N"
              />
            </UFormField>
            <UFormField label="Complemento" class="sm:col-span-3">
              <UInput
                v-model="form.address_complement"
                class="w-full"
                placeholder="Apto, Sala..."
              />
            </UFormField>
            <UFormField label="Bairro" class="sm:col-span-2">
              <UInput
                v-model="form.neighborhood"
                class="w-full"
                :disabled="isFetchingCep"
              />
            </UFormField>
            <UFormField label="Cidade" class="sm:col-span-1">
              <UInput
                v-model="form.city"
                class="w-full"
                :disabled="isFetchingCep"
              />
            </UFormField>
            <UFormField label="UF" class="sm:col-span-1">
              <UInput
                v-model="form.state"
                class="w-full"
                maxlength="2"
                :disabled="isFetchingCep"
                placeholder="SP"
              />
            </UFormField>
          </div>
        </div>

        <USeparator />

        <!-- ── Remuneração ── -->
        <div class="space-y-4">
          <p class="text-xs font-semibold uppercase tracking-widest text-muted">
            Remuneração
          </p>

          <!-- Salário fixo -->
          <div class="rounded-lg border border-default p-4 space-y-4">
            <UCheckbox
              v-model="form.has_salary"
              label="Possui salário fixo"
              color="neutral"
            />

            <template v-if="form.has_salary">
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <UFormField label="Valor do salário (R$)">
                  <UiCurrencyInput
                    v-model="form.salary_amount"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="Dia do pagamento">
                  <UInput
                    v-model="form.payment_day"
                    type="number"
                    min="1"
                    max="31"
                    class="w-full"
                    placeholder="5"
                  />
                </UFormField>
              </div>

              <!-- Parcelas do salário -->
              <div class="rounded-md bg-elevated/40 p-3 space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium text-muted">Dividir em parcelas
                    <span class="font-normal">(opcional)</span></span>
                  <UButton
                    label="+ Parcela"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    @click="addSalaryInstallment"
                  />
                </div>
                <p
                  v-if="form.salary_installments.length === 0"
                  class="text-xs text-muted"
                >
                  Adicione parcelas para dividir o pagamento em múltiplas datas
                  no mês.
                </p>
                <div
                  v-for="(inst, i) in form.salary_installments"
                  :key="i"
                  class="flex items-end gap-2"
                >
                  <UFormField label="Dia" class="w-20">
                    <UInput
                      v-model.number="inst.day"
                      type="number"
                      min="1"
                      max="31"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField label="Valor (R$)" class="flex-1">
                    <UiCurrencyInput v-model="inst.amount" class="w-full" />
                  </UFormField>
                  <UTooltip text="Remover parcela">
                    <UButton
                      icon="i-lucide-x"
                      color="error"
                      variant="ghost"
                      size="xs"
                      class="mb-0.5"
                      @click="removeSalaryInstallment(i)"
                    />
                  </UTooltip>
                </div>
              </div>
            </template>
          </div>

          <!-- Mínimo garantido -->
          <div class="rounded-lg border border-default p-4 space-y-4">
            <UCheckbox
              v-model="form.has_minimum_guarantee"
              label="Mínimo salarial garantido"
              color="neutral"
            />

            <template v-if="form.has_minimum_guarantee">
              <UFormField label="Valor mínimo garantido (R$)">
                <UiCurrencyInput
                  v-model="form.minimum_guarantee_amount"
                  class="w-full"
                />
              </UFormField>
              <p class="text-xs text-muted">
                Se comissões + salário não atingirem este valor no mês, será
                gerado um complemento automaticamente.
              </p>

              <!-- Parcelas do mínimo -->
              <div class="rounded-md bg-elevated/40 p-3 space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium text-muted">Dividir em parcelas
                    <span class="font-normal">(opcional)</span></span>
                  <UButton
                    label="+ Parcela"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    @click="addMinGuaranteeInstallment"
                  />
                </div>
                <div
                  v-for="(inst, i) in form.minimum_guarantee_installments"
                  :key="i"
                  class="flex items-end gap-2"
                >
                  <UFormField label="Dia" class="w-20">
                    <UInput
                      v-model.number="inst.day"
                      type="number"
                      min="1"
                      max="31"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField label="Valor (R$)" class="flex-1">
                    <UiCurrencyInput v-model="inst.amount" class="w-full" />
                  </UFormField>
                  <UTooltip text="Remover parcela">
                    <UButton
                      icon="i-lucide-x"
                      color="error"
                      variant="ghost"
                      size="xs"
                      class="mb-0.5"
                      @click="removeMinGuaranteeInstallment(i)"
                    />
                  </UTooltip>
                </div>
              </div>
            </template>
          </div>

          <!-- Comissão -->
          <div class="rounded-lg border border-default bg-elevated/40 p-4">
            <div class="flex items-start gap-3">
              <UIcon
                name="i-lucide-badge-percent"
                class="mt-0.5 size-5 shrink-0 text-primary"
              />
              <div class="min-w-0 space-y-2">
                <p class="text-sm font-medium text-highlighted">
                  Comissão
                </p>
                <p class="text-sm text-muted">
                  A configuração de comissão saiu daqui — agora fica em
                  <strong class="text-highlighted">Financeiro &gt; Comissões</strong>,
                  onde é possível criar planos com múltiplas regras por categoria
                  e atribuir a um ou mais funcionários.
                </p>
                <UButton
                  label="Ir para Comissões"
                  icon="i-lucide-arrow-right"
                  size="xs"
                  color="neutral"
                  variant="outline"
                  to="/app/financial/commissions"
                />
              </div>
            </div>
          </div>
        </div>

        <USeparator />

        <!-- ── Chave PIX ── -->
        <div>
          <p
            class="mb-3 text-xs font-semibold uppercase tracking-widest text-muted"
          >
            Chave PIX
          </p>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField label="Tipo de chave">
              <USelectMenu
                v-model="form.pix_key_type"
                :items="pixKeyTypeOptions"
                value-key="value"
                placeholder="Sem chave PIX"
                class="w-full"
              />
            </UFormField>
            <UFormField v-if="form.pix_key_type" label="Chave PIX">
              <UInput
                :model-value="form.pix_key"
                class="w-full"
                :placeholder="
                  form.pix_key_type === 'cpf'
                    ? '000.000.000-00'
                    : form.pix_key_type === 'cnpj'
                      ? '00.000.000/0000-00'
                      : form.pix_key_type === 'phone'
                        ? '(11) 99999-9999'
                        : form.pix_key_type === 'email'
                          ? 'email@exemplo.com'
                          : 'Chave aleatória gerada pelo banco'
                "
                @input="onPixKeyInput"
              />
            </UFormField>
          </div>
        </div>

        <!-- ── Acesso ao sistema (somente ao editar) ── -->
        <template v-if="isEditing">
          <USeparator />
          <div>
            <p
              class="mb-3 text-xs font-semibold uppercase tracking-widest text-muted"
            >
              Acesso ao sistema
            </p>
            <UFormField label="Perfil de permissão">
              <USelectMenu
                :model-value="form.role_id ?? undefined"
                :items="availableRoles"
                value-key="id"
                label-key="display_name"
                :disabled="!editFormHasAuthUser || isLoadingRoles"
                :loading="isLoadingRoles"
                placeholder="Selecionar perfil..."
                class="w-full"
                @update:model-value="form.role_id = $event ?? undefined"
              />
              <p class="mt-1.5 text-xs text-muted">
                <template v-if="!editFormHasAuthUser">
                  Gere o acesso ao sistema para este funcionário antes de
                  definir o perfil.
                </template>
                <template v-else>
                  Define as permissões de acesso do funcionário ao sistema.
                </template>
              </p>
            </UFormField>
          </div>
        </template>

        <!-- ── Demissão (somente ao editar) ── -->
        <template v-if="isEditing">
          <USeparator />
          <div>
            <p
              class="mb-3 text-xs font-semibold uppercase tracking-widest text-muted"
            >
              Demissão
            </p>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <UFormField label="Data de demissão">
                <UiDatePicker v-model="form.termination_date" class="w-full" />
              </UFormField>
              <UFormField label="Motivo" class="sm:col-span-2">
                <UTextarea
                  v-model="form.termination_reason"
                  class="w-full"
                  placeholder="Opcional"
                  :rows="2"
                />
              </UFormField>
            </div>
            <p v-if="form.termination_date" class="mt-2 text-xs text-muted">
              O acesso ao sistema será bloqueado após esta data.
            </p>
          </div>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancelar"
          color="neutral"
          variant="ghost"
          @click="showModal = false"
        />
        <UButton
          :label="isEditing ? 'Salvar alterações' : 'Criar funcionário'"
          color="neutral"
          :loading="isSaving"
          :disabled="isSaving || !form.name || !form.phone"
          @click="save"
        />
      </div>
    </template>
  </UModal>

  <!-- ══════════════════════════════════════
       MODAL: Gerenciar acesso
  ═══════════════════════════════════════ -->
  <UModal
    v-model:open="showAccessModal"
    title="Acesso ao sistema"
    :description="
      accessEmployee?.name
        ? `Gerencie o acesso de ${accessEmployee.name} ao sistema.`
        : ''
    "
  >
    <template #body>
      <!-- Carregando status -->
      <div
        v-if="isLoadingAccessStatus"
        class="flex items-center justify-center gap-2 py-8 text-muted"
      >
        <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
        <span class="text-sm">Verificando status...</span>
      </div>

      <!-- Sem e-mail cadastrado -->
      <div
        v-else-if="!accessEmployee?.email"
        class="rounded-lg border border-warning/40 bg-warning/10 p-4"
      >
        <p class="text-sm font-medium">
          E-mail não cadastrado
        </p>
        <p class="mt-1 text-sm text-muted">
          Edite o cadastro do funcionário e adicione um e-mail para poder gerar
          acesso.
        </p>
      </div>

      <!-- Já tem acesso -->
      <div v-else-if="accessStatus?.hasAuthUser" class="space-y-3">
        <div
          class="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 p-4"
        >
          <UIcon
            name="i-lucide-shield-check"
            class="mt-0.5 size-5 shrink-0 text-success"
          />
          <div>
            <p class="font-medium text-success">
              Funcionário já possui acesso
            </p>
            <p class="mt-1 text-sm text-muted">
              {{ accessEmployee?.name }} pode fazer login com o e-mail
              <strong class="text-highlighted">{{
                accessEmployee?.email
              }}</strong>.
            </p>
            <UBadge
              :color="accessStatus.active ? 'success' : 'neutral'"
              variant="subtle"
              size="sm"
              class="mt-2"
            >
              {{ accessStatus.active ? "Conta ativa" : "Conta inativa" }}
            </UBadge>
          </div>
        </div>
      </div>

      <!-- Criar acesso automaticamente -->
      <div v-else class="space-y-3">
        <div class="rounded-lg border border-default bg-elevated/40 p-4">
          <div class="flex items-start gap-3">
            <UIcon
              name="i-lucide-mail-check"
              class="mt-0.5 size-5 shrink-0 text-primary"
            />
            <div class="space-y-2">
              <p class="text-sm font-medium text-highlighted">
                Criar acesso do funcionário
              </p>
              <p class="text-sm text-muted">
                O sistema vai criar o usuário de
                <strong class="text-highlighted">{{
                  accessEmployee?.name
                }}</strong>, vincular automaticamente à organização e enviar um email para
                <strong class="text-highlighted">{{
                  accessEmployee?.email
                }}</strong>
                definir a senha.
              </p>
              <p class="text-xs text-muted">
                Garanta apenas que o e-mail informado está correto e acessível
                pelo funcionário.
              </p>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-between">
        <UButton
          label="Fechar"
          color="neutral"
          variant="ghost"
          @click="showAccessModal = false"
        />
        <UButton
          v-if="!isLoadingAccessStatus && !!accessEmployee?.email && !accessStatus?.hasAuthUser"
          label="Criar acesso e enviar email"
          icon="i-lucide-user-round-plus"
          color="neutral"
          :loading="isLinkingAccess"
          :disabled="isLinkingAccess"
          @click="grantAccess"
        />
      </div>
    </template>
  </UModal>

  <!-- Confirmar exclusão -->
  <AppConfirmModal
    :open="showConfirm"
    title="Remover funcionário"
    :description="`Tem certeza que deseja remover ${pendingDelete?.name ?? 'este funcionário'}? Esta ação não pode ser desfeita.`"
    confirm-label="Remover"
    confirm-color="error"
    :loading="isDeleting"
    @update:open="showConfirm = $event"
    @confirm="confirmDelete"
  />
</template>
