<script setup lang="ts">
import type { NfseRow, NfseDetail } from '~/types/nfse'

const props = defineProps<{
  open: boolean
  row: NfseRow | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'cancel': [row: NfseRow]
  'email': [row: NfseRow]
}>()

const toast = useToast()
const detailData = ref<NfseDetail | null>(null)
const isLoading = ref(false)

watch(() => props.open, async (val) => {
  if (val && props.row) {
    await loadDetail(props.row)
  } else {
    detailData.value = null
  }
})

async function loadDetail(row: NfseRow) {
  detailData.value = null
  isLoading.value = true
  try {
    const res = await $fetch<{ success: boolean, data: NfseDetail }>(
      `/api/fiscal/nfse/${encodeURIComponent(row.provider_reference)}`
    )
    detailData.value = res.data
  } catch {
    toast.add({ title: 'Erro ao carregar detalhes da NFS-e', color: 'error' })
  } finally {
    isLoading.value = false
  }
}

const STATUS_LABEL: Record<string, string> = {
  authorized: 'Autorizada',
  processing_authorization: 'Processando',
  authorization_error: 'Erro',
  cancelled: 'Cancelada'
}

const STATUS_COLOR: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  authorized: 'success',
  processing_authorization: 'warning',
  authorization_error: 'error',
  cancelled: 'neutral'
}

function statusLabel(s: string) {
  return STATUS_LABEL[s] ?? s
}
function statusColor(s: string) {
  return STATUS_COLOR[s] ?? 'neutral' as const
}
function formatDate(val: string | null) {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('pt-BR')
}
</script>

<template>
  <USlideover
    :open="open"
    side="right"
    :ui="{ content: 'max-w-xl' }"
    @update:open="(v) => !v && $emit('update:open', false)"
  >
    <template #header>
      <div>
        <h2 class="text-lg font-bold text-highlighted">
          Detalhes da NFS-e
        </h2>
        <p v-if="row" class="mt-0.5 font-mono text-xs text-muted">
          {{ row.provider_reference }}
        </p>
      </div>
    </template>

    <template #body>
      <div v-if="isLoading" class="space-y-4 p-4">
        <USkeleton v-for="i in 6" :key="i" class="h-8 rounded" />
      </div>

      <div v-else-if="detailData" class="space-y-6 p-4">
        <!-- Status + actions -->
        <div class="flex items-center justify-between gap-3">
          <UBadge
            :label="statusLabel(detailData.status)"
            :color="statusColor(detailData.status)"
            variant="subtle"
            size="md"
            class="font-semibold"
          />
          <div class="flex gap-2">
            <UButton
              v-if="detailData.status !== 'cancelled'"
              label="Reenviar e-mail"
              icon="i-lucide-mail"
              size="xs"
              color="neutral"
              variant="outline"
              @click="row && $emit('email', row)"
            />
            <UButton
              v-if="detailData.status !== 'cancelled'"
              label="Cancelar NFS-e"
              icon="i-lucide-x-circle"
              size="xs"
              color="error"
              variant="outline"
              @click="row && $emit('cancel', row)"
            />
          </div>
        </div>

        <!-- Info grid -->
        <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt class="text-xs font-medium text-muted">
              Número NFS-e
            </dt>
            <dd class="mt-0.5 font-semibold text-highlighted">
              {{ detailData.nfse_number ?? '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-xs font-medium text-muted">
              Cód. Verificação
            </dt>
            <dd class="mt-0.5 font-mono text-xs text-highlighted">
              {{ detailData.verification_code ?? '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-xs font-medium text-muted">
              Emissão
            </dt>
            <dd class="mt-0.5">
              {{ formatDate(detailData.issued_at) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs font-medium text-muted">
              Ambiente
            </dt>
            <dd class="mt-0.5">
              <UBadge
                :label="detailData.environment === 'production' ? 'Produção' : 'Homologação'"
                :color="detailData.environment === 'production' ? 'success' : 'warning'"
                variant="subtle"
                size="xs"
              />
            </dd>
          </div>
          <div class="col-span-2">
            <dt class="text-xs font-medium text-muted">
              Tomador
            </dt>
            <dd class="mt-0.5 font-semibold text-highlighted">
              {{ detailData.taker_name ?? '—' }}
            </dd>
            <dd v-if="detailData.taker_id" class="font-mono text-xs text-muted">
              {{ detailData.taker_id }}
            </dd>
            <dd v-if="detailData.taker_email" class="text-xs text-muted">
              {{ detailData.taker_email }}
            </dd>
          </div>
          <div>
            <dt class="text-xs font-medium text-muted">
              Valor serviços
            </dt>
            <dd class="mt-0.5 font-semibold text-highlighted">
              {{ detailData.services_amount != null ? detailData.services_amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-xs font-medium text-muted">
              ISS retido
            </dt>
            <dd class="mt-0.5">
              {{ detailData.iss_amount != null ? detailData.iss_amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—' }}
            </dd>
          </div>
          <div v-if="detailData.services_description" class="col-span-2">
            <dt class="text-xs font-medium text-muted">
              Descrição dos serviços
            </dt>
            <dd class="mt-0.5 whitespace-pre-line text-sm">
              {{ detailData.services_description }}
            </dd>
          </div>
        </dl>

        <!-- Document link -->
        <div v-if="detailData.document_url">
          <UButton
            :to="detailData.document_url"
            target="_blank"
            rel="noopener noreferrer"
            label="Abrir documento PDF"
            icon="i-lucide-external-link"
            color="primary"
            variant="outline"
            size="sm"
            class="w-full justify-center"
          />
        </div>

        <!-- Errors -->
        <div v-if="detailData.errors?.length" class="space-y-2">
          <p class="text-xs font-semibold uppercase tracking-wide text-error">
            Erros
          </p>
          <div
            v-for="(e, i) in detailData.errors"
            :key="i"
            class="rounded-md border border-error/30 bg-error/5 p-3 text-sm"
          >
            <p class="font-semibold text-error">
              {{ e.code }}: {{ e.message }}
            </p>
            <p v-if="e.correction" class="mt-1 text-xs text-muted">
              {{ e.correction }}
            </p>
          </div>
        </div>
      </div>

      <div v-else class="flex h-32 items-center justify-center text-sm text-muted">
        Nenhum detalhe disponível.
      </div>
    </template>
  </USlideover>
</template>
