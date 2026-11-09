<script setup lang="ts">
import { useWorkshopBootstrap } from '~/composables/useWorkshopBootstrap'

definePageMeta({ layout: 'onboarding' })

const bootstrap = useWorkshopBootstrap()
const router = useRouter()
const toast = useToast()

const { track } = useAnalytics()

const loading = ref(false)
const step = ref<'company' | 'address'>('company')

onMounted(() => track('onboarding_step', { step: 0 }))

const form = reactive({
  name: '',
  person_type: 'pj' as 'pf' | 'pj',
  tax_id: '',
  phone: '',
  whatsapp: '',
  email: '',
  zip_code: '',
  street: '',
  address_number: '',
  neighborhood: '',
  city: '',
  state: ''
})

// Pre-fill from existing organization data
onMounted(() => {
  const org = bootstrap.organization.value
  if (!org) return
  if (org.name) form.name = org.name
  if (org.person_type) form.person_type = org.person_type
  if (org.tax_id) form.tax_id = org.tax_id
  if (org.phone) form.phone = org.phone
  if (org.whatsapp) form.whatsapp = org.whatsapp
  if (org.email) form.email = org.email
  if (org.zip_code) form.zip_code = org.zip_code
  if (org.street) form.street = org.street
  if (org.address_number) form.address_number = org.address_number
  if (org.neighborhood) form.neighborhood = org.neighborhood
  if (org.city) form.city = org.city
  if (org.state) form.state = org.state
})

const personTypeOptions = [
  { label: 'Pessoa Jurídica (CNPJ)', value: 'pj' },
  { label: 'Pessoa Física (CPF)', value: 'pf' }
]

const taxIdLabel = computed(() => form.person_type === 'pj' ? 'CNPJ' : 'CPF')
const taxIdPlaceholder = computed(() => form.person_type === 'pj' ? '00.000.000/0001-00' : '000.000.000-00')

function goToAddress() {
  if (!form.name.trim() || form.name.length < 2) {
    toast.add({ title: 'Razão social obrigatória', description: 'Informe ao menos 2 caracteres.', color: 'error' })
    return
  }
  if (!form.phone.trim() || form.phone.length < 8) {
    toast.add({ title: 'Telefone inválido', description: 'Informe um telefone com ao menos 8 dígitos.', color: 'error' })
    return
  }
  step.value = 'address'
  track('onboarding_step', { step: 1 })
}

async function submit() {
  loading.value = true
  try {
    await $fetch('/api/organizations/complete-onboarding', {
      method: 'POST',
      body: {
        name: form.name,
        person_type: form.person_type,
        tax_id: form.tax_id || null,
        phone: form.phone,
        whatsapp: form.whatsapp || null,
        email: form.email || null,
        zip_code: form.zip_code || null,
        street: form.street || null,
        address_number: form.address_number || null,
        neighborhood: form.neighborhood || null,
        city: form.city || null,
        state: form.state || null
      }
    })

    track('onboarding_complete', { step: 1 })
    await bootstrap.fetchBootstrap(true)
    toast.add({ title: 'Empresa configurada!', description: 'Bem-vindo ao sistema.', color: 'success' })
    await router.push('/app')
  } catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao salvar',
      description: e?.data?.statusMessage || e?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="space-y-8 animate-fade-in">
    <!-- Progress indicator -->
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors"
          :class="step === 'company' ? 'bg-primary text-white' : 'bg-primary/20 text-primary'"
        >
          <UIcon v-if="step === 'address'" name="i-lucide-check" class="w-4 h-4" />
          <span v-else>1</span>
        </div>
        <span class="text-sm font-medium" :class="step === 'company' ? 'text-highlighted' : 'text-muted'">
          Dados da empresa
        </span>
      </div>

      <div class="flex-1 h-px bg-border" />

      <div class="flex items-center gap-2">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors"
          :class="step === 'address' ? 'bg-primary text-white' : 'bg-elevated text-muted'"
        >
          2
        </div>
        <span class="text-sm font-medium" :class="step === 'address' ? 'text-highlighted' : 'text-muted'">
          Endereço
        </span>
      </div>
    </div>

    <!-- Card -->
    <UCard class="shadow-lg">
      <template #header>
        <div class="space-y-1">
          <h1 class="text-xl font-semibold text-highlighted">
            {{ step === 'company' ? 'Dados da empresa' : 'Endereço da empresa' }}
          </h1>
          <p class="text-sm text-muted">
            {{ step === 'company'
              ? 'Informe as informações básicas do seu negócio para começar.'
              : 'Opcional — você pode preencher depois nas configurações.' }}
          </p>
        </div>
      </template>

      <!-- Step 1: Company data -->
      <div v-if="step === 'company'" class="space-y-5">
        <UFormField label="Tipo de pessoa" required>
          <USelectMenu
            v-model="form.person_type"
            :items="personTypeOptions"
            value-key="value"
            label-key="label"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Razão social / Nome completo" required>
          <UInput
            v-model="form.name"
            placeholder="Ex: Oficina do João Ltda."
            class="w-full"
          />
        </UFormField>

        <UFormField :label="taxIdLabel">
          <UInput
            v-model="form.tax_id"
            :placeholder="taxIdPlaceholder"
            class="w-full"
          />
        </UFormField>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <UFormField label="Telefone" required>
            <UInput
              v-model="form.phone"
              placeholder="(00) 00000-0000"
              class="w-full"
            />
          </UFormField>

          <UFormField label="WhatsApp">
            <UInput
              v-model="form.whatsapp"
              placeholder="(00) 00000-0000"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField label="E-mail comercial">
          <UInput
            v-model="form.email"
            type="email"
            placeholder="contato@suaempresa.com.br"
            class="w-full"
          />
        </UFormField>
      </div>

      <!-- Step 2: Address -->
      <div v-else class="space-y-5">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <UFormField label="CEP" class="sm:col-span-1">
            <UInput v-model="form.zip_code" placeholder="00000-000" class="w-full" />
          </UFormField>

          <UFormField label="Logradouro" class="sm:col-span-2">
            <UInput v-model="form.street" placeholder="Rua, Avenida..." class="w-full" />
          </UFormField>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <UFormField label="Número" class="sm:col-span-1">
            <UInput v-model="form.address_number" placeholder="123" class="w-full" />
          </UFormField>

          <UFormField label="Bairro" class="sm:col-span-2">
            <UInput v-model="form.neighborhood" placeholder="Centro" class="w-full" />
          </UFormField>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <UFormField label="Cidade" class="sm:col-span-2">
            <UInput v-model="form.city" placeholder="São Paulo" class="w-full" />
          </UFormField>

          <UFormField label="Estado (UF)" class="sm:col-span-1">
            <UInput
              v-model="form.state"
              placeholder="SP"
              maxlength="2"
              class="w-full"
            />
          </UFormField>
        </div>
      </div>

      <template #footer>
        <div class="flex items-center justify-between gap-3">
          <UButton
            v-if="step === 'address'"
            variant="ghost"
            color="neutral"
            leading-icon="i-lucide-arrow-left"
            @click="step = 'company'"
          >
            Voltar
          </UButton>
          <span v-else />

          <UButton
            v-if="step === 'company'"
            color="primary"
            trailing-icon="i-lucide-arrow-right"
            @click="goToAddress"
          >
            Continuar
          </UButton>

          <UButton
            v-else
            color="primary"
            trailing-icon="i-lucide-check"
            :loading="loading"
            @click="submit"
          >
            Concluir configuração
          </UButton>
        </div>
      </template>
    </UCard>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fade-in 0.4s ease both;
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
</style>
