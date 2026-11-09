<script setup lang="ts">
// Badge de status do admin: sempre com ícone, rótulo em português e cor coerente.
// Um único lugar define "o que cada status significa" para todas as telas do painel.
type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary'
type Meta = { label: string, color: Tone, icon: string }

const props = withDefaults(defineProps<{
  kind: 'subscription' | 'invoice' | 'webhook' | 'feedback' | 'priority' | 'feedback-type' | 'check' | 'outcome' | 'active' | 'org' | 'enabled' | 'http'
  value?: string | number | boolean | null
  /** Texto extra antes do rótulo (ex.: código HTTP). */
  prefix?: string | number | null
}>(), { value: null, prefix: null })

const TABLES: Record<string, Record<string, Meta>> = {
  subscription: {
    active: { label: 'Ativa', color: 'success', icon: 'i-lucide-circle-check' },
    trialing: { label: 'Em teste', color: 'info', icon: 'i-lucide-hourglass' },
    trial: { label: 'Em teste', color: 'info', icon: 'i-lucide-hourglass' },
    suspended: { label: 'Suspensa', color: 'warning', icon: 'i-lucide-circle-pause' },
    past_due: { label: 'Em atraso', color: 'warning', icon: 'i-lucide-triangle-alert' },
    unpaid: { label: 'Não paga', color: 'error', icon: 'i-lucide-circle-x' },
    incomplete: { label: 'Incompleta', color: 'warning', icon: 'i-lucide-circle-dashed' },
    incomplete_expired: { label: 'Expirada', color: 'neutral', icon: 'i-lucide-circle-slash' },
    paused: { label: 'Pausada', color: 'neutral', icon: 'i-lucide-circle-pause' },
    canceled: { label: 'Cancelada', color: 'neutral', icon: 'i-lucide-circle-x' },
    cancelled: { label: 'Cancelada', color: 'neutral', icon: 'i-lucide-circle-x' }
  },
  invoice: {
    paid: { label: 'Paga', color: 'success', icon: 'i-lucide-circle-check' },
    open: { label: 'Em aberto', color: 'warning', icon: 'i-lucide-clock' },
    pending: { label: 'Pendente', color: 'warning', icon: 'i-lucide-clock' },
    failed: { label: 'Falhou', color: 'error', icon: 'i-lucide-circle-x' },
    uncollectible: { label: 'Incobrável', color: 'error', icon: 'i-lucide-ban' },
    draft: { label: 'Rascunho', color: 'neutral', icon: 'i-lucide-file-pen' },
    void: { label: 'Anulada', color: 'neutral', icon: 'i-lucide-circle-slash' },
    cancelled: { label: 'Cancelada', color: 'neutral', icon: 'i-lucide-circle-x' }
  },
  webhook: {
    received: { label: 'Recebido', color: 'info', icon: 'i-lucide-inbox' },
    processed: { label: 'Processado', color: 'success', icon: 'i-lucide-circle-check' },
    ignored: { label: 'Ignorado', color: 'neutral', icon: 'i-lucide-circle-minus' },
    failed: { label: 'Falhou', color: 'error', icon: 'i-lucide-circle-x' }
  },
  feedback: {
    submitted: { label: 'Enviado', color: 'info', icon: 'i-lucide-send' },
    in_review: { label: 'Em análise', color: 'warning', icon: 'i-lucide-search' },
    resolved: { label: 'Resolvido', color: 'success', icon: 'i-lucide-circle-check' },
    closed: { label: 'Fechado', color: 'neutral', icon: 'i-lucide-archive' }
  },
  priority: {
    low: { label: 'Baixa', color: 'neutral', icon: 'i-lucide-arrow-down' },
    medium: { label: 'Média', color: 'info', icon: 'i-lucide-minus' },
    high: { label: 'Alta', color: 'warning', icon: 'i-lucide-arrow-up' },
    critical: { label: 'Crítica', color: 'error', icon: 'i-lucide-flame' }
  },
  'feedback-type': {
    bug: { label: 'Bug', color: 'error', icon: 'i-lucide-bug' },
    suggestion: { label: 'Sugestão', color: 'info', icon: 'i-lucide-lightbulb' },
    improvement: { label: 'Melhoria', color: 'primary', icon: 'i-lucide-wand-sparkles' },
    praise: { label: 'Elogio', color: 'success', icon: 'i-lucide-heart' }
  },
  check: {
    ok: { label: 'OK', color: 'success', icon: 'i-lucide-circle-check' },
    warning: { label: 'Atenção', color: 'warning', icon: 'i-lucide-triangle-alert' },
    error: { label: 'Falha', color: 'error', icon: 'i-lucide-circle-x' },
    not_configured: { label: 'Não configurado', color: 'neutral', icon: 'i-lucide-circle-dashed' }
  },
  outcome: {
    success: { label: 'Sucesso', color: 'success', icon: 'i-lucide-circle-check' },
    denied: { label: 'Negado', color: 'warning', icon: 'i-lucide-shield-x' },
    invalid: { label: 'Inválido', color: 'neutral', icon: 'i-lucide-circle-alert' },
    error: { label: 'Erro', color: 'error', icon: 'i-lucide-circle-x' }
  },
  org: {
    active: { label: 'Ativa', color: 'success', icon: 'i-lucide-circle-check' },
    suspended: { label: 'Suspensa', color: 'warning', icon: 'i-lucide-circle-pause' },
    inactive: { label: 'Inativa', color: 'neutral', icon: 'i-lucide-circle-slash' }
  }
}

const BOOLEANS: Record<string, [Meta, Meta]> = {
  active: [
    { label: 'Ativo', color: 'success', icon: 'i-lucide-circle-check' },
    { label: 'Inativo', color: 'neutral', icon: 'i-lucide-circle-slash' }
  ],
  enabled: [
    { label: 'Habilitado', color: 'success', icon: 'i-lucide-circle-check' },
    { label: 'Desabilitado', color: 'neutral', icon: 'i-lucide-circle-slash' }
  ]
}

const meta = computed<Meta>(() => {
  const raw = props.value
  if (props.kind in BOOLEANS) {
    const [yes, no] = BOOLEANS[props.kind]!
    return raw ? yes : no
  }
  if (props.kind === 'http') {
    const code = Number(raw)
    if (!Number.isFinite(code) || raw === null || raw === '') return { label: '—', color: 'neutral', icon: 'i-lucide-minus' }
    if (code >= 500) return { label: String(code), color: 'error', icon: 'i-lucide-circle-x' }
    if (code >= 400) return { label: String(code), color: 'warning', icon: 'i-lucide-triangle-alert' }
    return { label: String(code), color: 'success', icon: 'i-lucide-circle-check' }
  }
  const key = String(raw ?? '').toLowerCase()
  return TABLES[props.kind]?.[key] ?? { label: key ? key.replace(/_/g, ' ') : '—', color: 'neutral', icon: 'i-lucide-circle-help' }
})
</script>

<template>
  <UBadge
    :color="meta.color"
    :icon="meta.icon"
    variant="subtle"
    size="sm"
    class="whitespace-nowrap"
  >
    <template v-if="prefix !== null && prefix !== undefined">
      {{ prefix }} ·
    </template>
    {{ meta.label }}
  </UBadge>
</template>
