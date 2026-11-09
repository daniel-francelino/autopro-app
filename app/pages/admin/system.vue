<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['owner-only']
})
useSeoMeta({ title: 'Sistema — Admin' })

type Check = { key: string, label: string, status: 'ok' | 'warning' | 'error' | 'not_configured', detail: string | null, duration_ms: number | null }
type Failing = { http_method: string, route_pattern: string, status_code: number, total: number, last_at: string }
type SystemInfo = {
  checks: Check[]
  version: { app: string | null, commit: string | null, environment: string | null, site_url: string | null }
  errors_24h: Failing[]
  errors_7d: Failing[]
  owners: Array<{ id: string, email: string | null, display_name: string | null }>
  owner_alert: string | null
}

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const { data, status, error, refresh } = await useAsyncData('admin-system', () =>
  requestFetch<SystemInfo>('/api/admin/system', { headers: requestHeaders }))

const range = ref<'errors_24h' | 'errors_7d'>('errors_24h')
const failing = computed(() => data.value?.[range.value] ?? [])

const fmt = (value: string) => new Date(value).toLocaleString('pt-BR')
</script>

<template>
  <UDashboardPanel>
    <AppPageHeader title="Sistema">
      <template #right>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          size="sm"
          :loading="status === 'pending'"
          label="Verificar de novo"
          @click="refresh()"
        />
      </template>
    </AppPageHeader>

    <div class="p-6 overflow-auto space-y-6">
      <template v-if="status === 'pending' && !data">
        <AdminSkeleton variant="table" :rows="6" :cols="2" />
        <div class="grid gap-4 lg:grid-cols-2">
          <AdminSkeleton />
          <AdminSkeleton />
        </div>
      </template>

      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-x"
        title="Não foi possível carregar o status do sistema"
        description="Tente verificar de novo em alguns instantes."
      />

      <template v-else-if="data">
        <UAlert
          v-if="data.owner_alert"
          color="warning"
          variant="subtle"
          icon="i-lucide-shield-alert"
          :title="data.owner_alert"
        />

        <UPageCard variant="subtle" title="Integrações">
          <ul class="divide-y divide-default">
            <li v-for="check in data.checks" :key="check.key" class="flex items-center justify-between gap-3 py-2 text-sm">
              <div>
                <p class="font-medium">
                  {{ check.label }}
                </p>
                <p v-if="check.detail" class="text-xs text-muted">
                  {{ check.detail }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <span v-if="check.duration_ms !== null" class="text-xs text-muted tabular-nums">{{ check.duration_ms }} ms</span>
                <AdminStatusBadge kind="check" :value="check.status" />
              </div>
            </li>
          </ul>
        </UPageCard>

        <div class="grid gap-4 lg:grid-cols-2">
          <UPageCard variant="subtle" title="Versão e ambiente">
            <dl class="text-sm space-y-1">
              <div>
                <dt class="inline text-muted">
                  App:
                </dt><dd class="inline">
                  {{ data.version.app || '—' }}
                </dd>
              </div>
              <div>
                <dt class="inline text-muted">
                  Commit:
                </dt><dd class="inline font-mono">
                  {{ data.version.commit?.slice(0, 10) || '—' }}
                </dd>
              </div>
              <div>
                <dt class="inline text-muted">
                  Ambiente:
                </dt><dd class="inline">
                  {{ data.version.environment || '—' }}
                </dd>
              </div>
              <div>
                <dt class="inline text-muted">
                  URL do site:
                </dt><dd class="inline">
                  {{ data.version.site_url || '—' }}
                </dd>
              </div>
            </dl>
          </UPageCard>

          <UPageCard variant="subtle" title="Owners da plataforma">
            <ul class="text-sm space-y-1">
              <li v-for="owner in data.owners" :key="owner.id">
                {{ owner.display_name || '—' }} <span class="text-muted">{{ owner.email }}</span>
              </li>
            </ul>
            <AdminEmptyState
              v-if="!data.owners.length"
              icon="i-lucide-user-round-x"
              title="Nenhum owner cadastrado"
              description="Sem owner, ninguém acessa este painel. Conceda o acesso pelo SQL abaixo."
            />
            <p class="text-xs text-muted mt-2">
              Conceder: <code>UPDATE user_profiles SET is_owner = true WHERE email = '...'</code>
            </p>
          </UPageCard>
        </div>

        <UPageCard variant="subtle" title="Erros e fricção (log de auditoria)">
          <USelect
            v-model="range"
            class="w-48 mb-3"
            :items="[{ label: 'Últimas 24 horas', value: 'errors_24h' }, { label: 'Últimos 7 dias', value: 'errors_7d' }]"
            value-key="value"
            label-key="label"
          />
          <table class="w-full text-sm">
            <thead class="text-left text-muted">
              <tr>
                <th class="py-1">
                  Rota
                </th><th>Status</th><th>Ocorrências</th><th>Última</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in failing" :key="`${row.http_method}${row.route_pattern}${row.status_code}`" class="border-t border-default">
                <td class="py-2 font-mono text-xs">
                  {{ row.http_method }} {{ row.route_pattern }}
                </td>
                <td>
                  <AdminStatusBadge kind="http" :value="row.status_code" />
                </td>
                <td class="tabular-nums">
                  {{ row.total }}
                </td>
                <td class="whitespace-nowrap">
                  {{ fmt(row.last_at) }}
                </td>
              </tr>
            </tbody>
          </table>
          <AdminEmptyState
            v-if="!failing.length"
            icon="i-lucide-shield-check"
            title="Nenhuma falha no período"
            description="Nenhuma rota respondeu com erro (4xx/5xx) neste intervalo."
          />
          <p class="text-xs text-muted mt-2">
            5xx = bug do sistema; 4xx = validação ou permissão (erro de uso). Detalhes em <NuxtLink to="/admin/audit" class="underline">Auditoria</NuxtLink>.
          </p>
        </UPageCard>
      </template>
    </div>
  </UDashboardPanel>
</template>
