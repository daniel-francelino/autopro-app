<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { ActionCode } from '~/constants/action-codes'
import { PLAN_LICENSES, type PlanKey } from '~/composables/usePlans'
import type { SyncStatusResponse } from '~/types/nfse'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Empresa' })

const toast = useToast()
const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server
  ? useRequestHeaders(['cookie'])
  : undefined

const canView = computed(() => workshop.can(ActionCode.SETTINGS_VIEW))
const canUpdate = computed(() => workshop.can(ActionCode.SETTINGS_UPDATE))

type ViaCepResponse = {
  erro?: boolean | string
  logradouro?: string
  bairro?: string
  localidade?: string
  uf?: string
}

type OrgData = Record<string, unknown>

const schema = z.object({
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  trade_name: z.string().optional().nullable(),
  tax_id: z.string().optional().nullable(),
  email: z
    .string()
    .email('E-mail inválido')
    .optional()
    .nullable()
    .or(z.literal('')),
  phone: z.string().optional().nullable(),
  mobile_phone: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  address_zip_code: z.string().optional().nullable(),
  address_street: z.string().optional().nullable(),
  address_number: z.string().optional().nullable(),
  address_complement: z.string().optional().nullable(),
  address_neighborhood: z.string().optional().nullable(),
  address_city: z.string().optional().nullable(),
  address_state: z.string().max(2).optional().nullable(),
  address_country: z.string().optional().nullable(),
  municipal_registration: z.string().optional().nullable(),
  state_registration: z.string().optional().nullable(),
  fiscal_regime: z.string().optional().nullable(),
  logo_url: z.string().optional().nullable(),
  initial_service_order_number: z.number().int().min(1).optional().nullable()
})

type Schema = z.output<typeof schema>

const {
  data: orgData,
  status,
  refresh
} = await useAsyncData('company-org', () =>
  requestFetch<OrgData>('/api/organizations', { headers: requestHeaders })
)

const form = reactive<Partial<Schema>>({})

function fillForm(data: OrgData | null) {
  if (!data) return
  Object.assign(form, {
    name: data.name ?? '',
    trade_name: data.trade_name ?? '',
    tax_id: data.tax_id ?? '',
    email: data.email ?? '',
    phone: data.phone ?? '',
    mobile_phone: data.mobile_phone ?? '',
    website: data.website ?? '',
    description: data.description ?? '',
    address_zip_code: data.address_zip_code ?? '',
    address_street: data.address_street ?? '',
    address_number: data.address_number ?? '',
    address_complement: data.address_complement ?? '',
    address_neighborhood: data.address_neighborhood ?? '',
    address_city: data.address_city ?? '',
    address_state: data.address_state ?? '',
    address_country: data.address_country ?? 'BR',
    municipal_registration: data.municipal_registration ?? '',
    state_registration: data.state_registration ?? '',
    fiscal_regime: data.fiscal_regime ?? '',
    logo_url: data.logo_url ?? null,
    initial_service_order_number: data.initial_service_order_number ?? 1
  })
}

watch(orgData, fillForm, { immediate: true })

const isSaving = ref(false)
const isLoadingCep = ref(false)
const isUploadingLogo = ref(false)
const logoFileRef = ref<HTMLInputElement>()

async function onLogoFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  const file = input.files[0]!
  isUploadingLogo.value = true
  try {
    const body = new FormData()
    body.append('file', file)
    const result = await $fetch<{ logo_url: string }>(
      '/api/organizations/logo',
      {
        method: 'POST',
        body
      }
    )
    form.logo_url = result.logo_url
    toast.add({ title: 'Logo atualizado', color: 'success' })
  } catch (error: unknown) {
    const err = error as {
      data?: { statusMessage?: string }
      statusMessage?: string
    }
    toast.add({
      title: 'Erro ao enviar logo',
      description:
        err?.data?.statusMessage
        || err?.statusMessage
        || 'Não foi possível enviar',
      color: 'error'
    })
  } finally {
    isUploadingLogo.value = false
    if (input) input.value = ''
  }
}

async function removeLogo() {
  if (!canUpdate.value) return
  try {
    await $fetch('/api/organizations', {
      method: 'PUT',
      body: { logo_url: null }
    })
    form.logo_url = null
    toast.add({ title: 'Logo removido', color: 'success' })
  } catch {
    toast.add({ title: 'Erro ao remover logo', color: 'error' })
  }
}

async function onSubmit(_event: FormSubmitEvent<Schema>) {
  if (isSaving.value || !canUpdate.value) return
  isSaving.value = true
  try {
    await $fetch('/api/organizations', {
      method: 'PUT',
      body: form
    })
    await refresh()
    toast.add({
      title: 'Empresa atualizada',
      description: 'Dados salvos com sucesso.',
      color: 'success'
    })
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

async function lookupCep() {
  const cep = (form.address_zip_code ?? '').replace(/\D/g, '')
  if (cep.length !== 8) return
  isLoadingCep.value = true
  try {
    const res = await $fetch<ViaCepResponse>(`https://viacep.com.br/ws/${cep}/json/`)
    if (res.erro) {
      toast.add({ title: 'CEP não encontrado', color: 'warning' })
      return
    }
    form.address_street = res.logradouro || form.address_street
    form.address_neighborhood = res.bairro || form.address_neighborhood
    form.address_city = res.localidade || form.address_city
    form.address_state = res.uf || form.address_state
  } catch {
    toast.add({ title: 'Erro ao buscar CEP', color: 'error' })
  } finally {
    isLoadingCep.value = false
  }
}

const fiscalRegimeOptions = [
  { label: 'Simples Nacional', value: 'simples_nacional' },
  { label: 'Lucro Presumido', value: 'lucro_presumido' },
  { label: 'Lucro Real', value: 'lucro_real' },
  { label: 'MEI', value: 'mei' }
]

// ─── Integração Fiscal ────────────────────────────────────────────────────────

const canEmitNfse = computed(() => {
  const planK = workshop.planKey.value as PlanKey | null
  return !!(planK && PLAN_LICENSES[planK]?.nfseEmission)
})

const {
  data: fiscalSyncStatus,
  refresh: refreshFiscalStatus
} = useAsyncData(
  'company-fiscal-sync-status',
  () => canEmitNfse.value
    ? requestFetch<SyncStatusResponse>('/api/fiscal/company/sync-status', { headers: requestHeaders })
    : Promise.resolve(null as SyncStatusResponse | null),
  { lazy: true, default: () => null as SyncStatusResponse | null }
)

const isFiscalSynced = computed(() => fiscalSyncStatus.value?.is_synced === true)
const fiscalSyncErrorMsg = computed(() => fiscalSyncStatus.value?.sync?.sync_error_message ?? null)
const lastFiscalSync = computed(() => fiscalSyncStatus.value?.sync?.last_synced_at ?? null)

// regime_tributario: 1=Simples Nacional, 2=SN Excesso Sublimite, 3=Regime Normal, 4=MEI
const FISCAL_TAX_REGIME_MAP: Record<string, number> = {
  simples_nacional: 1,
  mei: 4,
  lucro_presumido: 3,
  lucro_real: 3
}

type FiscalCompanyInfo = {
  nfse_enabled?: boolean
  certificate_valid_until?: string | null
  certificate_valid_from?: string | null
  certificate_business_id?: string | null
}

type FiscalSyncResult = {
  success: boolean
  action: string
  data: FiscalCompanyInfo
}

const fiscalCompanyInfo = ref<FiscalCompanyInfo | null>(null)
const isSyncingFiscal = ref(false)

const contactName = ref('')
const contactCpf = ref('')

watch(fiscalSyncStatus, (val) => {
  if (val?.sync?.contact_name) contactName.value = val.sync.contact_name
  if (val?.sync?.contact_cpf) contactCpf.value = val.sync.contact_cpf
}, { immediate: true })

const certFileRef = ref<HTMLInputElement>()
const certBase64 = ref<string | null>(null)
const certPassword = ref('')
const certFileName = ref<string | null>(null)

async function onCertFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  const file = input.files[0]!
  certFileName.value = file.name
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  certBase64.value = btoa(binary)
  if (input) input.value = ''
}

function clearCert() {
  certBase64.value = null
  certPassword.value = ''
  certFileName.value = null
}

async function syncFiscalCompany(overrides: Record<string, unknown> = {}) {
  if (isSyncingFiscal.value) return
  isSyncingFiscal.value = true
  try {
    const orgId = workshop.organizationId.value
    if (!orgId) throw new Error('Organização não identificada')

    const taxId = (form.tax_id ?? '').replace(/\D/g, '')
    const zipCode = (form.address_zip_code ?? '').replace(/\D/g, '')

    const payload: Record<string, unknown> = {
      organization_id: orgId,
      name: form.name?.trim() || undefined,
      trade_name: form.trade_name?.trim() || undefined,
      business_id: taxId || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      state: form.address_state ? form.address_state.toUpperCase() : undefined,
      state_registration: form.state_registration
        ? Number(String(form.state_registration).replace(/\D/g, '')) || undefined
        : undefined,
      municipal_registration: form.municipal_registration
        ? Number(String(form.municipal_registration).replace(/\D/g, '')) || undefined
        : undefined,
      tax_regime: form.fiscal_regime
        ? FISCAL_TAX_REGIME_MAP[form.fiscal_regime]
        : undefined,
      street: form.address_street || undefined,
      address_number: form.address_number
        ? Number(form.address_number) || undefined
        : undefined,
      complement: form.address_complement || undefined,
      neighborhood: form.address_neighborhood || undefined,
      municipality: form.address_city || undefined,
      zip_code: zipCode ? Number(zipCode) || undefined : undefined,
      contact_name: contactName.value.trim() || undefined,
      contact_id: contactCpf.value.replace(/\D/g, '') || undefined,
      ...overrides
    }

    if (certBase64.value) {
      payload.certificate_base64 = certBase64.value
      payload.certificate_password = certPassword.value || ''
    }

    const result = await $fetch<FiscalSyncResult>('/api/fiscal/company/sync', {
      method: 'POST',
      body: payload
    })

    if (result.data) {
      fiscalCompanyInfo.value = result.data
    }

    clearCert()
    await refreshFiscalStatus()
    toast.add({ title: 'Dados sincronizados com sucesso', color: 'success' })
  } catch (error: unknown) {
    const err = error as {
      data?: { statusMessage?: string }
      statusMessage?: string
    }
    toast.add({
      title: 'Erro ao sincronizar dados',
      description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível sincronizar',
      color: 'error'
    })
  } finally {
    isSyncingFiscal.value = false
  }
}
</script>

<template>
  <div
    v-if="!canView"
    class="rounded-xl border border-default/60 bg-elevated/30 p-6"
  >
    <p class="text-sm text-muted">
      Você não tem permissão para visualizar as configurações da empresa.
    </p>
  </div>

  <UForm
    v-else
    id="company-form"
    :schema="schema"
    :state="form"
    @submit="onSubmit"
  >
    <UPageCard
      title="Empresa"
      description="Dados cadastrais, contato e endereço da sua oficina."
      variant="naked"
      orientation="horizontal"
      class="mb-4"
    >
      <UButton
        v-if="canUpdate"
        form="company-form"
        label="Salvar alterações"
        color="neutral"
        type="submit"
        :loading="isSaving"
        :disabled="isSaving"
        class="w-fit lg:ms-auto"
      />
    </UPageCard>

    <div v-if="status === 'pending'" class="space-y-4">
      <USkeleton v-for="i in 8" :key="i" class="h-14 w-full" />
    </div>

    <template v-else>
      <!-- Logo -->
      <UPageCard variant="subtle" class="mb-4">
        <UFormField
          name="logo_url"
          label="Logo da oficina"
          description="JPEG, PNG ou WebP. Máx. 5 MB. Recomendado 200×200 px."
          class="grid gap-4"
        >
          <div class="flex flex-wrap items-center gap-3">
            <div class="relative shrink-0">
              <img
                v-if="form.logo_url"
                :src="form.logo_url"
                alt="Logo"
                class="size-32 rounded-xl object-contain border border-default bg-white p-1"
              >
              <div
                v-else
                class="size-32 rounded-xl border-2 border-dashed border-default/70 flex items-center justify-center bg-elevated/40"
              >
                <UIcon name="i-lucide-building-2" class="size-20 text-muted" />
              </div>
            </div>
            <div class="flex flex-col flex-wrap gap-2">
              <UTooltip text="Enviar logo">
                <UButton
                  color="neutral"
                  icon="i-lucide-upload"
                  :loading="isUploadingLogo"
                  :disabled="!canUpdate || isUploadingLogo"
                  @click="logoFileRef?.click()"
                />
              </UTooltip>

              <UTooltip text="Remover">
                <UButton
                  v-if="form.logo_url && canUpdate"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  @click="removeLogo"
                />
              </UTooltip>
            </div>
            <input
              ref="logoFileRef"
              type="file"
              class="hidden"
              accept=".jpg,.jpeg,.png,.webp"
              @change="onLogoFileChange"
            >
          </div>
        </UFormField>
      </UPageCard>

      <!-- Identificação -->
      <UPageCard variant="subtle" class="mb-4">
        <p
          class="text-xs font-semibold uppercase tracking-widest text-muted mb-4"
        >
          Identificação
        </p>

        <div class="grid gap-4 grid-cols-2">
          <UFormField
            name="name"
            label="Razão social"
            description="Nome jurídico registrado da empresa."
            required
            class="grid gap-2"
          >
            <UInput
              v-model="form.name"
              :disabled="!canUpdate"
              class="w-full"
              placeholder="Ex: Oficina Silva LTDA"
            />
          </UFormField>

          <UFormField
            name="trade_name"
            label="Nome fantasia"
            description="Como a oficina é conhecida pelos clientes."
            class="grid gap-2"
          >
            <UInput
              v-model="form.trade_name"
              :disabled="!canUpdate"
              class="w-full"
              placeholder="Ex: Oficina do Silva"
            />
          </UFormField>

          <UFormField
            name="tax_id"
            label="CNPJ / CPF"
            description="Documento de identificação fiscal."
            class="grid gap-2"
          >
            <UInput
              v-model="form.tax_id"
              :disabled="!canUpdate"
              class="w-full"
              placeholder="00.000.000/0001-00"
            />
          </UFormField>

          <UFormField
            name="description"
            label="Descrição"
            description="Breve apresentação da oficina"
            class="grid gap-2"
          >
            <UTextarea
              v-model="form.description"
              :disabled="!canUpdate"
              class="w-full"
              :rows="3"
              placeholder="Ex: Especializada em veículos leves e pesados desde 2005."
            />
          </UFormField>
        </div>
      </UPageCard>

      <!-- Contato -->
      <UPageCard variant="subtle" class="mb-4">
        <p
          class="text-xs font-semibold uppercase tracking-widest text-muted mb-4"
        >
          Contato
        </p>

        <div class="gap-4 grid grid-cols-2">
          <UFormField name="email" label="E-mail" class="grid gap-2">
            <UInput
              v-model="form.email"
              type="email"
              :disabled="!canUpdate"
              class="w-full"
              placeholder="contato@oficina.com.br"
            />
          </UFormField>

          <UFormField name="phone" label="Telefone fixo" class="grid gap-2">
            <UInput
              v-model="form.phone"
              :disabled="!canUpdate"
              class="w-full"
              placeholder="(00) 0000-0000"
            />
          </UFormField>

          <UFormField
            name="mobile_phone"
            label="Celular / WhatsApp"
            class="grid gap-2"
          >
            <UInput
              v-model="form.mobile_phone"
              :disabled="!canUpdate"
              class="w-full"
              placeholder="(00) 90000-0000"
            />
          </UFormField>

          <UFormField name="website" label="Website" class="grid gap-2">
            <UInput
              v-model="form.website"
              :disabled="!canUpdate"
              class="w-full"
              placeholder="https://suaoficina.com.br"
            />
          </UFormField>
        </div>
      </UPageCard>

      <!-- Endereço -->
      <UPageCard variant="subtle" class="mb-4">
        <p
          class="text-xs font-semibold uppercase tracking-widest text-muted mb-4"
        >
          Endereço
        </p>

        <div class="gap-4 grid grid-cols-2">
          <UFormField name="address_zip_code" label="CEP" class="grid gap-2 col-span-2">
            <div class="flex gap-2 w-full">
              <UInput
                v-model="form.address_zip_code"
                :disabled="!canUpdate"
                placeholder="00000-000"
                class="flex-1"
              />
              <UButton
                v-if="canUpdate"
                label="Buscar CEP"
                color="neutral"
                variant="outline"
                icon="i-lucide-search"
                :loading="isLoadingCep"
                :disabled="isLoadingCep"
                @click="lookupCep"
              />
            </div>
          </UFormField>

          <UFormField
            name="address_street"
            label="Logradouro"
            class="grid gap-2"
          >
            <UInput
              v-model="form.address_street"
              :disabled="!canUpdate"
              class="w-full"
              placeholder="Rua, Avenida..."
            />
          </UFormField>

          <div class="grid gap-4 grid-cols-2">
            <UFormField name="address_number" label="Número" class="grid gap-2">
              <UInput
                v-model="form.address_number"
                :disabled="!canUpdate"
                class="w-full"
                placeholder="Nº"
              />
            </UFormField>

            <UFormField
              name="address_complement"
              label="Complemento"
              class="grid gap-2"
            >
              <UInput
                v-model="form.address_complement"
                :disabled="!canUpdate"
                class="w-full"
                placeholder="Apto, sala..."
              />
            </UFormField>
          </div>

          <UFormField
            name="address_neighborhood"
            label="Bairro"
            class="grid gap-2"
          >
            <UInput
              v-model="form.address_neighborhood"
              :disabled="!canUpdate"
              class="w-full"
            />
          </UFormField>

          <div class="grid gap-4 grid-cols-2">
            <UFormField name="address_city" label="Cidade" class="grid gap-2">
              <UInput
                v-model="form.address_city"
                :disabled="!canUpdate"
                class="w-full"
                placeholder="Cidade"
              />
            </UFormField>

            <UFormField name="address_state" label="Estado" class="grid gap-2">
              <UInput
                v-model="form.address_state"
                :disabled="!canUpdate"
                maxlength="2"
                class="w-full uppercase"
                placeholder="UF"
              />
            </UFormField>
          </div>
        </div>
      </UPageCard>

      <!-- Fiscal -->
      <UPageCard variant="subtle" class="mb-4">
        <p
          class="text-xs font-semibold uppercase tracking-widest text-muted mb-4"
        >
          Fiscal
        </p>

        <div class="gap-4 grid grid-cols-2">
          <UFormField
            name="fiscal_regime"
            label="Regime tributário"
            class="grid gap-2"
          >
            <USelectMenu
              v-model="form.fiscal_regime"
              :items="fiscalRegimeOptions"
              value-key="value"
              :disabled="!canUpdate"
              class="w-full"
              placeholder="Selecionar..."
            />
          </UFormField>

          <UFormField
            name="municipal_registration"
            label="Inscrição municipal"
            class="grid gap-2"
          >
            <UInput
              v-model="form.municipal_registration"
              :disabled="!canUpdate"
              class="w-full"
            />
          </UFormField>

          <UFormField
            name="state_registration"
            label="Inscrição estadual"
            class="grid gap-2"
          >
            <UInput
              v-model="form.state_registration"
              :disabled="!canUpdate"
              class="w-full"
            />
          </UFormField>
        </div>
      </UPageCard>

      <!-- Sistema -->
      <UPageCard variant="subtle" class="mb-4">
        <p
          class="text-xs font-semibold uppercase tracking-widest text-muted mb-4"
        >
          Sistema
        </p>

        <UFormField
          name="initial_service_order_number"
          label="Número inicial de OS"
          description="As novas ordens de serviço serão numeradas a partir deste valor."
          class="grid gap-2"
        >
          <UInput
            v-model.number="form.initial_service_order_number"
            type="number"
            min="1"
            :disabled="!canUpdate"
            class="w-full sm:max-w-32"
          />
        </UFormField>
      </UPageCard>

      <!-- Integração Fiscal -->
      <UPageCard v-if="canEmitNfse" variant="subtle" class="mb-4">
        <p class="text-xs font-semibold uppercase tracking-widest text-muted mb-4">
          Integração Fiscal
        </p>

        <!-- Status da sincronização -->
        <div class="mb-6">
          <div
            v-if="isFiscalSynced"
            class="flex items-center gap-3 rounded-lg border border-success/30 bg-success/5 px-4 py-3"
          >
            <UIcon name="i-lucide-check-circle-2" class="size-5 shrink-0 text-success" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-highlighted">
                Empresa habilitada para emissão fiscal
              </p>
              <p v-if="lastFiscalSync" class="text-xs text-muted mt-0.5">
                Última sincronização: {{ new Date(lastFiscalSync).toLocaleString('pt-BR') }}
              </p>
            </div>
            <UBadge color="success" variant="subtle" label="Ativo" />
          </div>

          <div
            v-else-if="fiscalSyncErrorMsg"
            class="flex items-start gap-3 rounded-lg border border-error/30 bg-error/5 px-4 py-3"
          >
            <UIcon name="i-lucide-alert-circle" class="mt-0.5 size-5 shrink-0 text-error" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-highlighted">
                Erro na última sincronização
              </p>
              <p class="text-xs text-muted mt-0.5">
                {{ fiscalSyncErrorMsg }}
              </p>
            </div>
          </div>

          <div
            v-else
            class="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3"
          >
            <UIcon name="i-lucide-alert-triangle" class="mt-0.5 size-5 shrink-0 text-warning" />
            <div>
              <p class="text-sm font-medium text-highlighted">
                Configuração pendente
              </p>
              <p class="text-xs text-muted mt-0.5">
                Preencha os dados cadastrais (CNPJ, regime tributário e endereço) nas seções
                acima, faça o upload do certificado digital e clique em
                <strong>Sincronizar dados</strong>.
              </p>
            </div>
          </div>
        </div>

        <!-- Guia de etapas (apenas quando não sincronizado) -->
        <div v-if="!isFiscalSynced" class="mb-6 grid sm:grid-cols-3 gap-3">
          <div class="flex items-start gap-2 rounded-lg border border-default/50 bg-elevated/20 p-3">
            <span
              class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary"
            >1</span>
            <div>
              <p class="text-xs font-semibold">
                Dados cadastrais
              </p>
              <p class="text-xs text-muted mt-0.5">
                Complete CNPJ, regime tributário e endereço nas seções acima.
              </p>
            </div>
          </div>
          <div class="flex items-start gap-2 rounded-lg border border-default/50 bg-elevated/20 p-3">
            <span
              class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary"
            >2</span>
            <div>
              <p class="text-xs font-semibold">
                Certificado digital
              </p>
              <p class="text-xs text-muted mt-0.5">
                Envie o certificado A1 (.pfx ou .p12) no campo abaixo.
              </p>
            </div>
          </div>
          <div class="flex items-start gap-2 rounded-lg border border-default/50 bg-elevated/20 p-3">
            <span
              class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary"
            >3</span>
            <div>
              <p class="text-xs font-semibold">
                Sincronizar
              </p>
              <p class="text-xs text-muted mt-0.5">
                Clique em <strong>Sincronizar dados</strong> para ativar a emissão.
              </p>
            </div>
          </div>
        </div>

        <!-- Certificado Digital A1 -->
        <div class="mb-6 border-t border-default/60 pt-5">
          <p class="text-sm font-medium mb-0.5">
            Certificado Digital A1
          </p>
          <p class="text-xs text-muted mb-4">
            Utilizado para assinar eletronicamente as notas fiscais. Formatos aceitos: .pfx ou .p12.
          </p>

          <!-- Certificado ativo (retornado após sync) -->
          <div
            v-if="fiscalCompanyInfo?.certificate_valid_until && !certFileName"
            class="mb-4 flex items-center gap-3 rounded-lg border border-success/20 bg-success/5 px-4 py-3"
          >
            <UIcon name="i-lucide-shield-check" class="size-4 shrink-0 text-success" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium">
                Certificado ativo
              </p>
              <p class="text-xs text-muted">
                Válido até
                {{ new Date(fiscalCompanyInfo.certificate_valid_until).toLocaleDateString('pt-BR') }}
                <template v-if="fiscalCompanyInfo.certificate_business_id">
                  · CNPJ: {{ fiscalCompanyInfo.certificate_business_id }}
                </template>
              </p>
            </div>
          </div>

          <!-- Arquivo selecionado -->
          <div
            v-if="certFileName"
            class="mb-4 flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3"
          >
            <UIcon name="i-lucide-file-key-2" class="size-4 shrink-0 text-primary" />
            <span class="flex-1 text-sm truncate">{{ certFileName }}</span>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-x"
              @click="clearCert"
            />
          </div>

          <div class="flex flex-wrap items-end gap-3">
            <UButton
              v-if="canUpdate"
              color="neutral"
              variant="outline"
              icon="i-lucide-upload"
              size="sm"
              :label="certFileName ? 'Trocar certificado' : 'Selecionar certificado (.pfx / .p12)'"
              @click="certFileRef?.click()"
            />
            <input
              ref="certFileRef"
              type="file"
              class="hidden"
              accept=".pfx,.p12"
              @change="onCertFileChange"
            >
            <UFormField
              v-if="certFileName"
              name="_cert_password"
              label="Senha do certificado"
            >
              <UInput
                v-model="certPassword"
                type="password"
                placeholder="••••••••"
                size="sm"
                class="w-full"
              />
            </UFormField>
          </div>
        </div>

        <!-- Responsável pela empresa -->
        <div class="mb-6 border-t border-default/60 pt-5">
          <p class="text-sm font-medium mb-0.5">
            Responsável pela empresa
          </p>

          <div class="grid gap-4 grid-cols-2">
            <UFormField
              name="_contact_name"
              label="Nome"
              class="grid gap-2"
            >
              <UInput
                v-model="contactName"
                :disabled="!canUpdate"
                class="w-full"
                placeholder="Nome completo"
              />
            </UFormField>

            <UFormField
              name="_contact_cpf"
              label="CPF"
              class="grid gap-2"
            >
              <UInput
                v-model="contactCpf"
                :disabled="!canUpdate"
                class="w-full"
                placeholder="000.000.000-00"
              />
            </UFormField>
          </div>
        </div>

        <!-- Ação de sincronização -->
        <div class="border-t border-default/60 pt-5 flex items-center justify-between gap-4">
          <p class="text-xs text-muted">
            Os dados cadastrais serão enviados para o sistema de emissão fiscal.
            Se a empresa já estiver cadastrada, as informações serão atualizadas automaticamente.
          </p>
          <UButton
            v-if="canUpdate"
            color="neutral"
            icon="i-lucide-refresh-cw"
            :label="isFiscalSynced ? 'Sincronizar novamente' : 'Sincronizar dados'"
            :loading="isSyncingFiscal"
            :disabled="isSyncingFiscal"
            class="shrink-0"
            @click="syncFiscalCompany()"
          />
        </div>
      </UPageCard>
    </template>
  </UForm>
</template>
