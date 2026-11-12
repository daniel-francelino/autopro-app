<script setup lang="ts">
import type { NfseRow } from '~/types/nfse'
import type { BadgeColor } from '~/types/ui'

type NfseListResponse = { success: boolean, data: NfseRow[] }

const props = defineProps<{
  orderId: string
  orderStatus: string
  canCreate?: boolean
}>()

const emit = defineEmits<{
  'issue-nfse': []
}>()

// ─── Data ───────────────────────────────────────────────────────────────────

const { data, pending, refresh } = useAsyncData(
  `nfse-info-${props.orderId}`,
  () => $fetch<NfseListResponse>(`/api/service-orders/${props.orderId}/nfse`),
  { server: false }
)

const nfseList = computed(() => data.value?.data ?? [])
const latestNfse = computed<NfseRow | null>(() => nfseList.value[0] ?? null)

const isCompleted = computed(
  () => ['completed', 'invoiced', 'delivered'].includes(props.orderStatus)
)

// ─── Status display ─────────────────────────────────────────────────────────

const statusColorMap: Record<string, BadgeColor> = {
  processing_authorization: 'warning',
  authorized: 'success',
  cancelled: 'error',
  authorization_error: 'error'
}
function nfseStatusColor(s: string): BadgeColor {
  return statusColorMap[s] ?? 'neutral'
}
const statusLabelMap: Record<string, string> = {
  processing_authorization: 'Processando',
  authorized: 'Autorizada',
  cancelled: 'Cancelada',
  authorization_error: 'Erro na autorização'
}

const statusIconMap: Record<string, string> = {
  processing_authorization: 'i-lucide-loader-circle',
  authorized: 'i-lucide-circle-check',
  cancelled: 'i-lucide-x-circle',
  authorization_error: 'i-lucide-triangle-alert'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

defineExpose({ refresh })
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-file-badge" class="size-4 text-primary" />
          <h3 class="text-sm font-semibold text-highlighted">
            Nota Fiscal de Serviço (NFS-e)
          </h3>
        </div>

        <!-- Refresh -->
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          size="xs"
          :loading="pending"
          @click="refresh()"
        />
      </div>
    </template>

    <!-- Loading -->
    <div v-if="pending" class="space-y-2">
      <USkeleton class="h-5 w-1/2" />
      <USkeleton class="h-4 w-3/4" />
    </div>

    <!-- Has NFS-e -->
    <div v-else-if="latestNfse" class="space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge
          :color="nfseStatusColor(latestNfse.status)"
          :label="statusLabelMap[latestNfse.status] ?? latestNfse.status"
          :leading-icon="statusIconMap[latestNfse.status] ?? 'i-lucide-circle-dot'"
          variant="subtle"
          size="sm"
        />

        <UBadge
          v-if="latestNfse.environment"
          :label="latestNfse.environment === 'producao' ? 'Produção' : 'Homologação'"
          color="neutral"
          variant="outline"
          size="sm"
        />
      </div>

      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div v-if="latestNfse.nfse_number">
          <dt class="text-muted">
            Número NFS-e
          </dt>
          <dd class="font-medium text-highlighted">
            {{ latestNfse.nfse_number }}
          </dd>
        </div>

        <div v-if="latestNfse.provider_reference">
          <dt class="text-muted">
            Referência
          </dt>
          <dd class="truncate font-mono text-xs text-highlighted">
            {{ latestNfse.provider_reference }}
          </dd>
        </div>

        <div v-if="latestNfse.issued_at">
          <dt class="text-muted">
            Emitida em
          </dt>
          <dd class="font-medium text-highlighted">
            {{ formatDate(latestNfse.issued_at) }}
          </dd>
        </div>

        <div v-if="latestNfse.verification_code">
          <dt class="text-muted">
            Cód. verificação
          </dt>
          <dd class="font-medium text-highlighted">
            {{ latestNfse.verification_code }}
          </dd>
        </div>
      </dl>

      <!-- Error message -->
      <UAlert
        v-if="latestNfse.last_error_message"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Erro na emissão"
        :description="latestNfse.last_error_message"
      />

      <!-- Document link -->
      <div v-if="latestNfse.document_url" class="pt-1">
        <UButton
          :to="latestNfse.document_url"
          target="_blank"
          label="Visualizar documento"
          icon="i-lucide-external-link"
          color="primary"
          variant="outline"
          size="sm"
        />
      </div>
    </div>

    <!-- No NFS-e yet -->
    <div v-else class="space-y-3">
      <p class="text-sm text-muted">
        Nenhuma NF-e emitida para esta ordem de serviço.
      </p>

      <UButton
        v-if="isCompleted && canCreate"
        label="Emitir NF-e"
        icon="i-lucide-file-badge"
        color="primary"
        size="sm"
        @click="emit('issue-nfse')"
      />
    </div>
  </UCard>
</template>
