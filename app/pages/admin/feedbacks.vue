<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['owner-only']
})
useSeoMeta({ title: 'Feedbacks — Admin' })

type Feedback = {
  id: string, type: string, title: string, description: string | null, status: string, priority: string, created_at: string
  author_name: string | null, author_email: string | null, organization_id: string | null, organization_name: string | null
  feedback_attachments?: Array<{ id: string, file_name: string, file_url: string }>
  feedback_responses?: Array<{ id: string, content: string, is_admin: boolean, created_at: string }> | Array<{ count: number }>
  feedback_entity_links?: Array<{ id: string, entity_type: string, entity_id: string | null, external_url: string | null }>
}

const toast = useToast()
const showApiError = useApiErrorToast()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const TYPES = [{ label: 'Todos os tipos', value: '' }, { label: 'Bug', value: 'bug' }, { label: 'Sugestão', value: 'suggestion' }, { label: 'Melhoria', value: 'improvement' }, { label: 'Elogio', value: 'praise' }]
const STATUSES = [{ label: 'Todos os status', value: '' }, { label: 'Enviado', value: 'submitted' }, { label: 'Em análise', value: 'in_review' }, { label: 'Resolvido', value: 'resolved' }, { label: 'Fechado', value: 'closed' }]
const PRIORITIES = [{ label: 'Todas as prioridades', value: '' }, { label: 'Baixa', value: 'low' }, { label: 'Média', value: 'medium' }, { label: 'Alta', value: 'high' }, { label: 'Crítica', value: 'critical' }]
const STATUS_ONLY = STATUSES.slice(1)
const PRIORITY_ONLY = PRIORITIES.slice(1)

const filters = reactive({ type: '', status: '', priority: '', search: '' })
const page = ref(1)
const pageSize = 20

const { data, status, refresh } = await useAsyncData('admin-feedbacks', () =>
  requestFetch<{ data: Feedback[], total: number }>('/api/admin/feedbacks', {
    headers: requestHeaders,
    query: {
      type: filters.type || undefined,
      status: filters.status || undefined,
      priority: filters.priority || undefined,
      search: filters.search || undefined,
      page: page.value,
      pageSize
    }
  }))

watch(filters, () => { page.value = 1; refresh() }, { deep: true })
watch(page, () => refresh())

const items = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.total ?? 0)

const columns = [
  { accessorKey: 'created_at', header: 'Quando', enableSorting: false },
  { accessorKey: 'title', header: 'Título', enableSorting: false },
  { accessorKey: 'organization_name', header: 'Oficina', enableSorting: false },
  { accessorKey: 'type', header: 'Tipo', enableSorting: false },
  { accessorKey: 'status', header: 'Status', enableSorting: false },
  { accessorKey: 'priority', header: 'Prioridade', enableSorting: false },
  { accessorKey: 'detail', header: '', enableSorting: false }
]
const fmt = (value: string) => new Date(value).toLocaleString('pt-BR')
const priorityColor: Record<string, 'neutral' | 'info' | 'warning' | 'error'> = { low: 'neutral', medium: 'info', high: 'warning', critical: 'error' }

// Detalhe
const open = ref(false)
const detail = ref<Feedback | null>(null)
const reply = ref('')
const busy = ref(false)

async function openDetail(id: string) {
  open.value = true
  detail.value = null
  reply.value = ''
  try {
    detail.value = await $fetch<Feedback>(`/api/admin/feedbacks/${id}`)
  } catch (err) {
    showApiError(err, 'Não foi possível abrir o feedback')
  }
}

async function update(patch: { status?: string, priority?: string }) {
  if (!detail.value) return
  busy.value = true
  try {
    await $fetch(`/api/admin/feedbacks/${detail.value.id}`, { method: 'PUT', body: patch })
    Object.assign(detail.value, patch)
    await refresh()
  } catch (err) {
    showApiError(err, 'Não foi possível atualizar')
  } finally {
    busy.value = false
  }
}

async function sendReply() {
  if (!detail.value || !reply.value.trim()) return
  busy.value = true
  try {
    await $fetch(`/api/admin/feedbacks/${detail.value.id}/respond`, { method: 'POST', body: { content: reply.value } })
    toast.add({ title: 'Resposta enviada', color: 'success' })
    reply.value = ''
    detail.value = await $fetch<Feedback>(`/api/admin/feedbacks/${detail.value.id}`)
  } catch (err) {
    showApiError(err, 'Não foi possível responder')
  } finally {
    busy.value = false
  }
}

const responses = computed(() => (detail.value?.feedback_responses ?? []) as Array<{ id: string, content: string, is_admin: boolean, created_at: string }>)
</script>

<template>
  <UDashboardPanel>
    <UDashboardNavbar title="Feedbacks" />

    <div class="p-6 overflow-auto space-y-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <USelect
          v-model="filters.type"
          :items="TYPES"
          value-key="value"
          label-key="label"
        />
        <USelect
          v-model="filters.status"
          :items="STATUSES"
          value-key="value"
          label-key="label"
        />
        <USelect
          v-model="filters.priority"
          :items="PRIORITIES"
          value-key="value"
          label-key="label"
        />
        <UInput v-model.trim="filters.search" icon="i-lucide-search" placeholder="Buscar no título ou texto" />
      </div>

      <AppDataTable
        v-model:page="page"
        :columns="columns"
        :data="(items as unknown as Record<string, unknown>[])"
        :loading="status === 'pending'"
        :page-size="pageSize"
        :total="total"
        empty-icon="i-lucide-message-square"
        empty-title="Nenhum feedback"
        empty-description="Nada corresponde aos filtros."
      >
        <template #created_at-cell="{ row }">
          <span class="whitespace-nowrap text-sm">{{ fmt(String(row.original.created_at)) }}</span>
        </template>
        <template #organization_name-cell="{ row }">
          <NuxtLink v-if="row.original.organization_id" :to="`/admin/organizations/${row.original.organization_id}`" class="underline text-sm">
            {{ row.original.organization_name || 'Oficina' }}
          </NuxtLink>
          <span v-else class="text-muted">—</span>
        </template>
        <template #priority-cell="{ row }">
          <UBadge size="sm" variant="subtle" :color="priorityColor[String(row.original.priority)]">
            {{ row.original.priority }}
          </UBadge>
        </template>
        <template #detail-cell="{ row }">
          <UButton
            icon="i-lucide-eye"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Abrir"
            @click="openDetail(String(row.original.id))"
          />
        </template>
      </AppDataTable>
    </div>

    <USlideover v-model:open="open" title="Feedback" :ui="{ content: 'max-w-2xl' }">
      <template #body>
        <div v-if="!detail" class="text-sm text-muted">
          Carregando...
        </div>
        <div v-else class="space-y-4">
          <div>
            <h3 class="font-semibold">
              {{ detail.title }}
            </h3>
            <p class="text-xs text-muted">
              {{ detail.author_name || detail.author_email || 'Autor desconhecido' }}
              <template v-if="detail.organization_name">
                · <NuxtLink :to="`/admin/organizations/${detail.organization_id}`" class="underline">{{ detail.organization_name }}</NuxtLink>
              </template>
              · {{ fmt(detail.created_at) }}
            </p>
            <p class="mt-2 text-sm whitespace-pre-wrap">
              {{ detail.description }}
            </p>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <USelect
              :model-value="detail.status"
              :items="STATUS_ONLY"
              value-key="value"
              label-key="label"
              :disabled="busy"
              @update:model-value="update({ status: String($event) })"
            />
            <USelect
              :model-value="detail.priority"
              :items="PRIORITY_ONLY"
              value-key="value"
              label-key="label"
              :disabled="busy"
              @update:model-value="update({ priority: String($event) })"
            />
          </div>

          <div v-if="detail.feedback_attachments?.length">
            <p class="text-sm font-medium mb-1">
              Anexos
            </p>
            <ul class="text-sm space-y-1">
              <li v-for="file in detail.feedback_attachments" :key="file.id">
                <a
                  :href="file.file_url"
                  target="_blank"
                  rel="noopener"
                  class="underline"
                >{{ file.file_name }}</a>
              </li>
            </ul>
          </div>

          <div v-if="detail.feedback_entity_links?.length">
            <p class="text-sm font-medium mb-1">
              Vínculos
            </p>
            <ul class="text-sm space-y-1">
              <li v-for="link in detail.feedback_entity_links" :key="link.id">
                {{ link.entity_type }} {{ link.entity_id || '' }} <a
                  v-if="link.external_url"
                  :href="link.external_url"
                  target="_blank"
                  rel="noopener"
                  class="underline"
                >abrir</a>
              </li>
            </ul>
          </div>

          <div>
            <p class="text-sm font-medium mb-1">
              Respostas
            </p>
            <ul class="space-y-2">
              <li v-for="r in responses" :key="r.id" class="rounded bg-elevated p-2 text-sm">
                <span class="text-xs text-muted">{{ r.is_admin ? 'Plataforma' : 'Usuário' }} · {{ fmt(r.created_at) }}</span>
                <p class="whitespace-pre-wrap">
                  {{ r.content }}
                </p>
              </li>
            </ul>
            <p v-if="!responses.length" class="text-sm text-muted">
              Sem respostas.
            </p>
            <UTextarea
              v-model="reply"
              class="w-full mt-2"
              :rows="3"
              placeholder="Responder ao usuário"
            />
            <UButton
              class="mt-2"
              :loading="busy"
              :disabled="!reply.trim()"
              label="Enviar resposta"
              @click="sendReply"
            />
          </div>
        </div>
      </template>
    </USlideover>
  </UDashboardPanel>
</template>
