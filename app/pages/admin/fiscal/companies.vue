<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['owner-only']
})
useSeoMeta({ title: 'Fiscal — Empresas Focus NFe' })

const toast = useToast()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server
  ? useRequestHeaders(['cookie'])
  : undefined

// ─── List ──────────────────────────────────────────────────────────────────────

const searchCnpj = ref('')
const page = ref(1)
const PAGE_SIZE = 50

const { data, status, refresh } = await useAsyncData(
  'admin-focusnfe-companies',
  () =>
    requestFetch<{ success: boolean, data: any[], total?: number }>(
      '/api/admin/fiscal/companies',
      {
        headers: requestHeaders,
        query: {
          offset: (page.value - 1) * PAGE_SIZE,
          business_id: searchCnpj.value || undefined
        }
      }
    )
)

watch(searchCnpj, () => {
  page.value = 1
  refresh()
})
watch(page, () => refresh())

const companies = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.total ?? companies.value.length)

// ─── Form helpers ──────────────────────────────────────────────────────────────

const TAX_REGIME_OPTIONS = [
  { value: 1, label: 'Simples Nacional' },
  { value: 2, label: 'Simples Nacional - excesso sublimite' },
  { value: 3, label: 'Regime Normal' }
]

const STATE_OPTIONS = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO'
].map(s => ({ value: s, label: s }))

function defaultForm() {
  return {
    name: '',
    trade_name: '',
    business_id: '',
    individual_id: '',
    state_registration: '' as string | number,
    municipal_registration: '' as string | number,
    tax_regime: undefined as number | undefined,
    street: '',
    address_number: '' as string | number,
    complement: '',
    neighborhood: '',
    municipality: '',
    state: '',
    zip_code: '' as string | number,
    email: '',
    phone: '',
    nfse_enabled: false
  }
}

// ─── Create / Edit modal ───────────────────────────────────────────────────────

const showFormModal = ref(false)
const editingCompany = ref<any>(null)
const formLoading = ref(false)
const form = ref(defaultForm())

function openCreate() {
  editingCompany.value = null
  form.value = defaultForm()
  showFormModal.value = true
}

function openEdit(company: any) {
  editingCompany.value = company
  form.value = {
    name: company.name ?? '',
    trade_name: company.trade_name ?? '',
    business_id: company.business_id ?? '',
    individual_id: company.individual_id ?? '',
    state_registration: company.state_registration ?? '',
    municipal_registration: company.municipal_registration ?? '',
    tax_regime: company.tax_regime ? Number(company.tax_regime) : undefined,
    street: company.street ?? '',
    address_number: company.address_number ?? '',
    complement: company.complement ?? '',
    neighborhood: company.neighborhood ?? '',
    municipality: company.municipality ?? '',
    state: company.state ?? '',
    zip_code: company.zip_code ?? '',
    email: company.email ?? '',
    phone: company.phone ?? '',
    nfse_enabled: company.nfse_enabled ?? false
  }
  showFormModal.value = true
}

async function submitForm() {
  if (!form.value.name?.trim()) {
    toast.add({ title: 'Razão social é obrigatória', color: 'error' })
    return
  }
  if (
    !form.value.business_id?.toString().trim()
    && !form.value.individual_id?.toString().trim()
  ) {
    toast.add({ title: 'CNPJ ou CPF é obrigatório', color: 'error' })
    return
  }

  formLoading.value = true
  try {
    const payload: Record<string, any> = {
      name: form.value.name,
      nfse_enabled: form.value.nfse_enabled
    }

    if (form.value.trade_name) payload.trade_name = form.value.trade_name
    if (form.value.business_id)
      payload.business_id = String(form.value.business_id).replace(/\D/g, '')
    if (form.value.individual_id)
      payload.individual_id = String(form.value.individual_id).replace(
        /\D/g,
        ''
      )
    if (form.value.state_registration)
      payload.state_registration = Number(form.value.state_registration)
    if (form.value.municipal_registration)
      payload.municipal_registration = Number(
        form.value.municipal_registration
      )
    if (form.value.tax_regime)
      payload.tax_regime = Number(form.value.tax_regime)
    if (form.value.street) payload.street = form.value.street
    if (form.value.address_number)
      payload.address_number = Number(form.value.address_number)
    if (form.value.complement) payload.complement = form.value.complement
    if (form.value.neighborhood) payload.neighborhood = form.value.neighborhood
    if (form.value.municipality) payload.municipality = form.value.municipality
    if (form.value.state) payload.state = form.value.state
    if (form.value.zip_code)
      payload.zip_code = Number(String(form.value.zip_code).replace(/\D/g, ''))
    if (form.value.email) payload.email = form.value.email
    if (form.value.phone) payload.phone = form.value.phone

    if (editingCompany.value) {
      await $fetch(`/api/admin/fiscal/companies/${editingCompany.value.id}`, {
        method: 'PUT',
        body: payload
      })
      toast.add({ title: 'Empresa atualizada com sucesso', color: 'success' })
    } else {
      await $fetch('/api/admin/fiscal/companies', {
        method: 'POST',
        body: payload
      })
      toast.add({ title: 'Empresa criada com sucesso', color: 'success' })
    }

    showFormModal.value = false
    refresh()
  } catch (e: any) {
    const detail
      = e?.data?.data?.error
        ?? e?.data?.message
        ?? e?.message
        ?? 'Erro desconhecido'
    toast.add({
      title: 'Erro ao salvar empresa',
      description: detail,
      color: 'error'
    })
  } finally {
    formLoading.value = false
  }
}

// ─── Delete modal ──────────────────────────────────────────────────────────────

const showDeleteModal = ref(false)
const deletingCompany = ref<any>(null)
const deleteLoading = ref(false)

function openDelete(company: any) {
  deletingCompany.value = company
  showDeleteModal.value = true
}

async function confirmDelete() {
  if (!deletingCompany.value) return
  deleteLoading.value = true
  try {
    await $fetch(`/api/admin/fiscal/companies/${deletingCompany.value.id}`, {
      method: 'DELETE'
    })
    toast.add({ title: 'Empresa excluída com sucesso', color: 'success' })
    showDeleteModal.value = false
    deletingCompany.value = null
    refresh()
  } catch (e: any) {
    const detail
      = e?.data?.data?.error
        ?? e?.data?.message
        ?? e?.message
        ?? 'Erro desconhecido'
    toast.add({
      title: 'Erro ao excluir empresa',
      description: detail,
      color: 'error'
    })
  } finally {
    deleteLoading.value = false
  }
}

// ─── Table ─────────────────────────────────────────────────────────────────────

const columns = [
  { accessorKey: 'id', header: 'ID', enableSorting: false },
  { id: 'document', header: 'CNPJ/CPF', enableSorting: false },
  { accessorKey: 'name', header: 'Razão Social', enableSorting: false },
  { accessorKey: 'email', header: 'E-mail', enableSorting: false },
  { accessorKey: 'nfse_enabled', header: 'NFS-e', enableSorting: false },
  {
    accessorKey: 'certificate_valid_until',
    header: 'Certificado',
    enableSorting: false
  },
  { id: 'actions', header: '', enableSorting: false }
]

function formatDocument(company: any) {
  return company.business_id || company.individual_id || '—'
}

function formatCertificate(val: string | null) {
  if (!val) return null
  const d = new Date(val)
  if (isNaN(d.getTime())) return val
  return d.toLocaleDateString('pt-BR')
}

function certificateColor(val: string | null) {
  if (!val) return 'neutral'
  const d = new Date(val)
  const now = new Date()
  const diffDays = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  if (diffDays < 0) return 'error'
  if (diffDays < 30) return 'warning'
  return 'success'
}
</script>

<template>
  <UDashboardPanel>
    <UDashboardNavbar title="Empresas Focus NFe" />
    <div class="p-6 space-y-8 overflow-auto">
      <AppDataTable
        v-model:search-term="searchCnpj"
        v-model:page="page"
        :columns="columns"
        :data="companies as Record<string, unknown>[]"
        :loading="status === 'pending'"
        :page-size="PAGE_SIZE"
        :total="total"
        show-search
        search-placeholder="Buscar por CNPJ..."
        empty-icon="i-lucide-building"
        empty-title="Nenhuma empresa encontrada"
        empty-description="Nenhuma empresa Focus NFe foi cadastrada ainda."
      >
        <template #toolbar-right>
          <UButton icon="i-lucide-plus" @click="openCreate">
            Nova empresa
          </UButton>
        </template>

        <template #document-cell="{ row }">
          <span class="font-mono text-sm">{{
            formatDocument(row.original)
          }}</span>
        </template>

        <template #nfse_enabled-cell="{ row }">
          <UBadge
            :color="row.original.nfse_enabled ? 'success' : 'neutral'"
            variant="subtle"
            size="sm"
          >
            {{ row.original.nfse_enabled ? "Habilitado" : "Desabilitado" }}
          </UBadge>
        </template>

        <template #certificate_valid_until-cell="{ row }">
          <UBadge
            v-if="row.original.certificate_valid_until"
            :color="
              certificateColor(String(row.original.certificate_valid_until))
            "
            variant="subtle"
            size="sm"
          >
            {{
              formatCertificate(String(row.original.certificate_valid_until))
            }}
          </UBadge>
          <span v-else class="text-xs text-muted">—</span>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex items-center justify-end gap-1">
            <UButton
              variant="ghost"
              size="xs"
              icon="i-lucide-pencil"
              @click="openEdit(row.original)"
            />
            <UButton
              variant="ghost"
              size="xs"
              color="error"
              icon="i-lucide-trash-2"
              @click="openDelete(row.original)"
            />
          </div>
        </template>
      </AppDataTable>
    </div>
  </UDashboardPanel>

  <!-- ─── Create / Edit Modal ──────────────────────────────────────────────── -->
  <UModal
    v-model:open="showFormModal"
    :title="editingCompany ? 'Editar empresa' : 'Nova empresa'"
    size="xl"
  >
    <template #body>
      <div class="space-y-6">
        <!-- Identification -->
        <div>
          <p
            class="text-xs font-semibold text-muted uppercase tracking-wide mb-3"
          >
            Identificação
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UFormField label="Razão Social" required>
              <UInput v-model="form.name" placeholder="Nome empresarial" />
            </UFormField>
            <UFormField label="Nome Fantasia">
              <UInput v-model="form.trade_name" placeholder="Nome fantasia" />
            </UFormField>
            <UFormField label="CNPJ">
              <UInput
                v-model="form.business_id"
                placeholder="00.000.000/0000-00"
              />
            </UFormField>
            <UFormField label="CPF (pessoa física)">
              <UInput
                v-model="form.individual_id"
                placeholder="000.000.000-00"
              />
            </UFormField>
            <UFormField label="Inscrição Estadual">
              <UInput v-model="form.state_registration" placeholder="Número" />
            </UFormField>
            <UFormField label="Inscrição Municipal">
              <UInput
                v-model="form.municipal_registration"
                placeholder="Número"
              />
            </UFormField>
            <UFormField label="Regime Tributário">
              <USelect
                v-model="form.tax_regime"
                :items="TAX_REGIME_OPTIONS"
                value-key="value"
                label-key="label"
                placeholder="Selecione..."
              />
            </UFormField>
          </div>
        </div>

        <!-- Address -->
        <div>
          <p
            class="text-xs font-semibold text-muted uppercase tracking-wide mb-3"
          >
            Endereço
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UFormField label="Logradouro" class="sm:col-span-2">
              <UInput v-model="form.street" placeholder="Rua, Avenida, etc." />
            </UFormField>
            <UFormField label="Número">
              <UInput v-model="form.address_number" placeholder="Nº" />
            </UFormField>
            <UFormField label="Complemento">
              <UInput v-model="form.complement" placeholder="Apto, Sala..." />
            </UFormField>
            <UFormField label="Bairro">
              <UInput v-model="form.neighborhood" placeholder="Bairro" />
            </UFormField>
            <UFormField label="Município">
              <UInput v-model="form.municipality" placeholder="Cidade" />
            </UFormField>
            <UFormField label="UF">
              <USelect
                v-model="form.state"
                :items="STATE_OPTIONS"
                value-key="value"
                label-key="label"
                placeholder="Estado"
              />
            </UFormField>
            <UFormField label="CEP">
              <UInput v-model="form.zip_code" placeholder="00000-000" />
            </UFormField>
          </div>
        </div>

        <!-- Contact -->
        <div>
          <p
            class="text-xs font-semibold text-muted uppercase tracking-wide mb-3"
          >
            Contato
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UFormField label="E-mail">
              <UInput
                v-model="form.email"
                type="email"
                placeholder="email@empresa.com"
              />
            </UFormField>
            <UFormField label="Telefone">
              <UInput v-model="form.phone" placeholder="(00) 00000-0000" />
            </UFormField>
          </div>
        </div>

        <!-- Features -->
        <div>
          <p
            class="text-xs font-semibold text-muted uppercase tracking-wide mb-3"
          >
            Configurações
          </p>
          <UFormField label="Habilitar NFS-e">
            <UToggle v-model="form.nfse_enabled" />
          </UFormField>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton variant="ghost" @click="showFormModal = false">
          Cancelar
        </UButton>
        <UButton :loading="formLoading" @click="submitForm">
          {{ editingCompany ? "Salvar alterações" : "Criar empresa" }}
        </UButton>
      </div>
    </template>
  </UModal>

  <!-- ─── Delete Confirmation Modal ────────────────────────────────────────── -->
  <UModal v-model:open="showDeleteModal" title="Excluir empresa" size="sm">
    <template #body>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir a empresa
        <strong class="text-default">{{ deletingCompany?.name }}</strong>
        da Focus NFe? Esta operação não é reversível.
      </p>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton variant="ghost" @click="showDeleteModal = false">
          Cancelar
        </UButton>
        <UButton color="error" :loading="deleteLoading" @click="confirmDelete">
          Excluir
        </UButton>
      </div>
    </template>
  </UModal>
</template>
