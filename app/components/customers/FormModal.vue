<script setup lang="ts">
import type { Client, PersonType } from '~/types/clients'

type Employee = { id: string, name: string }

const props = defineProps<{
  open: boolean
  client: Client | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const toast = useToast()

const isLoadingCep = ref(false)
const isSaving = ref(false)
const employees = ref<Employee[]>([])
const isLoadingEmployees = ref(false)
const employeeToAdd = ref<string | undefined>(undefined) // value-key="id": o USelectMenu entrega o id, nao o objeto

// ─── Validation errors ──────────────────────────────────────────────────────
const errors = reactive<Record<string, string>>({})

function clearError(field: string) {
  Reflect.deleteProperty(errors, field)
}

function validate() {
  Object.keys(errors).forEach(k => Reflect.deleteProperty(errors, k))

  if (!form.name.trim())
    errors.name = 'Nome é obrigatório'
  else if (form.name.trim().length < 2)
    errors.name = 'Nome deve ter ao menos 2 caracteres'

  if (!form.phone.trim())
    errors.phone = 'Telefone é obrigatório'
  else if (rawPhone.value.length < 10)
    errors.phone = 'Telefone inválido'

  if (form.mobile_phone && rawMobile.value.length > 0 && rawMobile.value.length < 10)
    errors.mobile_phone = 'Celular inválido'

  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
    errors.email = 'E-mail inválido'

  if (form.tax_id) {
    const digits = form.tax_id.replace(/\D/g, '')
    if (form.person_type === 'pf' && digits.length > 0 && digits.length !== 11)
      errors.tax_id = 'CPF deve ter 11 dígitos'
    if (form.person_type === 'pj' && digits.length > 0 && digits.length !== 14)
      errors.tax_id = 'CNPJ deve ter 14 dígitos'
  }

  if (form.zip_code && rawCep.value.length > 0 && rawCep.value.length !== 8)
    errors.zip_code = 'CEP deve ter 8 dígitos'

  return Object.keys(errors).length === 0
}

// ─── Mask helpers ───────────────────────────────────────────────────────────
function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 10)
    return d.replace(/(\d{2})(\d{4})(\d{0,4})/, (_, a, b, c) => c ? `(${a}) ${b}-${c}` : b ? `(${a}) ${b}` : a ? `(${a}` : '')
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, (_, a, b, c) => c ? `(${a}) ${b}-${c}` : `(${a}) ${b}`)
}

function maskCpfCnpj(raw: string, type: PersonType): string {
  const d = raw.replace(/\D/g, '')
  if (type === 'pf') {
    return d.slice(0, 11)
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }
  return d.slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

function maskCep(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  return d.replace(/(\d{5})(\d)/, '$1-$2')
}

// ─── Raw digit extractors ───────────────────────────────────────────────────
const rawPhone = computed(() => form.phone.replace(/\D/g, ''))
const rawMobile = computed(() => form.mobile_phone.replace(/\D/g, ''))
const rawCep = computed(() => form.zip_code.replace(/\D/g, ''))

// ─── Input handlers ─────────────────────────────────────────────────────────
function onPhoneInput(e: Event) {
  const v = (e.target as HTMLInputElement).value
  form.phone = maskPhone(v)
  clearError('phone')
}

function onMobileInput(e: Event) {
  const v = (e.target as HTMLInputElement).value
  form.mobile_phone = maskPhone(v)
  clearError('mobile_phone')
}

function onTaxIdInput(e: Event) {
  const v = (e.target as HTMLInputElement).value
  form.tax_id = maskCpfCnpj(v, form.person_type)
  clearError('tax_id')
}

function onCepInput(e: Event) {
  const v = (e.target as HTMLInputElement).value
  form.zip_code = maskCep(v)
  clearError('zip_code')
}

// Re-mask tax_id when person_type changes
watch(() => form.person_type, () => {
  form.tax_id = maskCpfCnpj(form.tax_id, form.person_type)
})

// ─── Form state ─────────────────────────────────────────────────────────────
const isEditing = computed(() => props.client !== null)
const title = computed(() => isEditing.value ? 'Editar cliente' : 'Novo cliente')

const personTypeOptions = [
  { label: 'Pessoa Física', value: 'pf' },
  { label: 'Pessoa Jurídica', value: 'pj' }
]

function emptyForm() {
  return {
    name: '',
    person_type: 'pf' as PersonType,
    tax_id: '',
    email: '',
    phone: '',
    mobile_phone: '',
    birth_date: '',
    zip_code: '',
    street: '',
    address_number: '',
    address_complement: '',
    neighborhood: '',
    city: '',
    state: '',
    notes: '',
    responsible_employees: [] as { employee_id: string }[]
  }
}

const form = reactive(emptyForm())

// ─── Responsible employees helpers ──────────────────────────────────────────
const responsibleEmployees = computed(() =>
  form.responsible_employees.map(re => employees.value.find(e => e.id === re.employee_id)).filter(Boolean) as Employee[]
)

const employeeOptions = computed(() =>
  employees.value.filter(e => !form.responsible_employees.some(re => re.employee_id === e.id))
)

function addEmployee() {
  if (!employeeToAdd.value) return
  form.responsible_employees.push({ employee_id: employeeToAdd.value })
  employeeToAdd.value = undefined
}

function removeEmployee(id: string) {
  form.responsible_employees = form.responsible_employees.filter(re => re.employee_id !== id)
}

async function loadEmployees() {
  if (employees.value.length > 0) return
  isLoadingEmployees.value = true
  try {
    const res = await $fetch<{ items: Employee[] }>('/api/employees')
    employees.value = res.items
  } catch {
    toast.add({ title: 'Erro ao carregar funcionários', color: 'error' })
  } finally {
    isLoadingEmployees.value = false
  }
}

watch(
  () => props.open,
  (opened) => {
    if (!opened) return

    Object.keys(errors).forEach(k => Reflect.deleteProperty(errors, k))
    loadEmployees()

    if (props.client) {
      Object.assign(form, {
        name: props.client.name ?? '',
        person_type: props.client.person_type ?? 'pf',
        tax_id: props.client.tax_id ? maskCpfCnpj(props.client.tax_id, props.client.person_type ?? 'pf') : '',
        email: props.client.email ?? '',
        phone: props.client.phone ? maskPhone(props.client.phone) : '',
        mobile_phone: props.client.mobile_phone ? maskPhone(props.client.mobile_phone) : '',
        birth_date: props.client.birth_date ? props.client.birth_date.split('T')[0] : '',
        zip_code: props.client.zip_code ? maskCep(props.client.zip_code) : '',
        street: props.client.street ?? '',
        address_number: props.client.address_number ?? '',
        address_complement: props.client.address_complement ?? '',
        neighborhood: props.client.neighborhood ?? '',
        city: props.client.city ?? '',
        state: props.client.state ?? '',
        notes: props.client.notes ?? '',
        responsible_employees: props.client.responsible_employees ? [...props.client.responsible_employees] : []
      })
    } else {
      Object.assign(form, emptyForm())
    }
  },
  { immediate: true }
)

async function save() {
  if (isSaving.value) return
  if (!validate()) {
    toast.add({ title: 'Corrija os erros antes de salvar', color: 'warning' })
    return
  }

  isSaving.value = true
  try {
    const body = {
      name: form.name.trim(),
      person_type: form.person_type,
      tax_id: form.tax_id ? form.tax_id.replace(/\D/g, '') : null,
      email: form.email.trim() || null,
      phone: form.phone ? form.phone.replace(/\D/g, '') : null,
      mobile_phone: form.mobile_phone ? form.mobile_phone.replace(/\D/g, '') : null,
      birth_date: form.birth_date || null,
      zip_code: form.zip_code ? form.zip_code.replace(/\D/g, '') : null,
      street: form.street || null,
      address_number: form.address_number || null,
      address_complement: form.address_complement || null,
      neighborhood: form.neighborhood || null,
      city: form.city || null,
      state: form.state || null,
      notes: form.notes || null,
      responsible_employees: form.responsible_employees.length > 0 ? form.responsible_employees : null
    }

    if (isEditing.value && props.client) {
      await $fetch(`/api/clients/${props.client.id}`, { method: 'PUT', body })
      toast.add({ title: 'Cliente atualizado', color: 'success' })
    } else {
      await $fetch('/api/clients', { method: 'POST', body })
      toast.add({ title: 'Cliente criado', color: 'success' })
    }

    emit('update:open', false)
    emit('saved')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro',
      description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível salvar.',
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}

async function lookupCep() {
  const cep = rawCep.value
  if (cep.length !== 8) return

  isLoadingCep.value = true
  try {
    const res = await $fetch<Record<string, string | boolean>>(`https://viacep.com.br/ws/${cep}/json/`)
    if (res.erro) {
      toast.add({ title: 'CEP não encontrado', color: 'warning' })
      return
    }

    form.street = String(res.logradouro || form.street)
    form.neighborhood = String(res.bairro || form.neighborhood)
    form.city = String(res.localidade || form.city)
    form.state = String(res.uf || form.state)
    clearError('zip_code')
  } catch {
    toast.add({ title: 'Erro ao buscar CEP', color: 'error' })
  } finally {
    isLoadingCep.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="title"
    :ui="{ body: 'overflow-y-auto max-h-[75vh]' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-6">
        <!-- Dados principais -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField
            label="Nome"
            required
            class="sm:col-span-2"
            :error="errors.name"
          >
            <UInput
              v-model="form.name"
              class="w-full"
              placeholder="Nome completo"
              @input="clearError('name')"
            />
          </UFormField>

          <UFormField label="Tipo de pessoa">
            <USelectMenu
              v-model="form.person_type"
              :items="personTypeOptions"
              value-key="value"
              class="w-full"
              :search-input="false"
            />
          </UFormField>

          <UFormField
            :label="form.person_type === 'pf' ? 'CPF' : 'CNPJ'"
            :error="errors.tax_id"
          >
            <UInput
              :model-value="form.tax_id"
              class="w-full"
              :placeholder="form.person_type === 'pf' ? '000.000.000-00' : '00.000.000/0000-00'"
              @input="onTaxIdInput"
            />
          </UFormField>

          <UFormField
            label="Telefone"
            required
            :error="errors.phone"
          >
            <UInput
              :model-value="form.phone"
              class="w-full"
              placeholder="(00) 00000-0000"
              @input="onPhoneInput"
            />
          </UFormField>

          <UFormField
            label="Celular"
            :error="errors.mobile_phone"
          >
            <UInput
              :model-value="form.mobile_phone"
              class="w-full"
              placeholder="(00) 00000-0000"
              @input="onMobileInput"
            />
          </UFormField>

          <UFormField
            label="E-mail"
            :error="errors.email"
            class="sm:col-span-2"
          >
            <UInput
              v-model="form.email"
              type="email"
              class="w-full"
              placeholder="email@exemplo.com"
              @input="clearError('email')"
            />
          </UFormField>

          <UFormField label="Data de nascimento">
            <UInput v-model="form.birth_date" type="date" class="w-full" />
          </UFormField>
        </div>

        <USeparator label="Endereço" />

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField
            label="CEP"
            class="sm:col-span-2"
            :error="errors.zip_code"
          >
            <div class="flex gap-2">
              <UInput
                :model-value="form.zip_code"
                placeholder="00000-000"
                class="flex-1"
                @input="onCepInput"
              />
              <UButton
                label="Buscar"
                color="neutral"
                variant="outline"
                :loading="isLoadingCep"
                :disabled="isLoadingCep || rawCep.length !== 8"
                @click="lookupCep"
              />
            </div>
          </UFormField>

          <UFormField label="Logradouro" class="sm:col-span-2">
            <UInput v-model="form.street" class="w-full" />
          </UFormField>

          <UFormField label="Número">
            <UInput v-model="form.address_number" class="w-full" />
          </UFormField>

          <UFormField label="Complemento">
            <UInput v-model="form.address_complement" class="w-full" />
          </UFormField>

          <UFormField label="Bairro">
            <UInput v-model="form.neighborhood" class="w-full" />
          </UFormField>

          <UFormField label="Cidade">
            <UInput v-model="form.city" class="w-full" />
          </UFormField>

          <UFormField label="UF">
            <UInput
              v-model="form.state"
              maxlength="2"
              class="w-full uppercase"
            />
          </UFormField>
        </div>

        <USeparator label="Outras Informações" />

        <UFormField label="Observações">
          <UTextarea v-model="form.notes" class="w-full" :rows="3" />
        </UFormField>

        <!-- Funcionários Responsáveis -->
        <div>
          <div class="mb-3 flex items-center justify-between">
            <p class="text-sm font-semibold text-highlighted">
              Funcionários Responsáveis
            </p>
            <UPopover>
              <UButton
                label="Adicionar Funcionário"
                icon="i-lucide-plus"
                color="neutral"
                variant="outline"
                size="xs"
                :loading="isLoadingEmployees"
              />
              <template #content>
                <div class="w-64 p-2">
                  <p class="mb-2 text-xs font-medium text-muted">
                    Selecionar funcionário
                  </p>
                  <USelectMenu
                    v-model="employeeToAdd"
                    :items="employeeOptions"
                    label-key="name"
                    value-key="id"
                    placeholder="Buscar funcionário..."
                    class="w-full"
                    :loading="isLoadingEmployees"
                  />
                  <UButton
                    label="Adicionar"
                    color="neutral"
                    class="mt-2 w-full"
                    :disabled="!employeeToAdd"
                    @click="addEmployee"
                  />
                </div>
              </template>
            </UPopover>
          </div>

          <div
            v-if="responsibleEmployees.length > 0"
            class="space-y-2"
          >
            <div
              v-for="emp in responsibleEmployees"
              :key="emp.id"
              class="flex items-center justify-between rounded-lg border border-default px-3 py-2"
            >
              <div class="flex items-center gap-2">
                <div class="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {{ emp.name.charAt(0).toUpperCase() }}
                </div>
                <span class="text-sm font-medium text-highlighted">{{ emp.name }}</span>
              </div>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="removeEmployee(emp.id)"
              />
            </div>
          </div>

          <div
            v-else
            class="rounded-lg border border-dashed border-default/60 py-6 text-center"
          >
            <p class="text-sm font-medium text-primary">
              Nenhum funcionário responsável definido
            </p>
            <p class="mt-1 text-xs text-muted">
              Clique em "Adicionar Funcionário" para definir responsáveis por comissões
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
