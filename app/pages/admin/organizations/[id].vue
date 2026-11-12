<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['owner-only']
})

const route = useRoute()
const id = String(route.params.id)
const toast = useToast()
const showApiError = useApiErrorToast()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

type Org = {
  id: string
  name: string
  tax_id: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  is_active: boolean | null
  is_internal: boolean | null
  onboarding_completed: boolean | null
  created_at: string
  suspended_at: string | null
  suspended_reason: string | null
  suspended_by: string | null
  subscription: { status: string, plan_key: string | null, plan_name: string | null, monthly_amount: number | null, start_date: string | null, next_payment_date: string | null, cancellation_date: string | null } | null
}

const { data: org, error, status: orgStatus, refresh } = await useAsyncData(`admin-org-${id}`, () =>
  requestFetch<Org>(`/api/admin/organizations/${id}`, { headers: requestHeaders }))

useSeoMeta({ title: computed(() => `${org.value?.name ?? 'Oficina'} — Admin`) })

const tab = ref('users')
const tabs = [
  { label: 'Usuários', value: 'users' },
  { label: 'Cobrança', value: 'billing' },
  { label: 'Atividade', value: 'activity' },
  { label: 'Uso', value: 'usage' },
  { label: 'Fiscal', value: 'fiscal' }
]

// Cada aba só carrega quando é aberta.
const loaded = reactive<Record<string, unknown>>({})
const loading = ref(false)
async function loadTab(name: string) {
  if (loaded[name] !== undefined) return
  loading.value = true
  try {
    loaded[name] = await $fetch(`/api/admin/organizations/${id}/${name}`)
  } catch (err) {
    showApiError(err, 'Não foi possível carregar a aba')
  } finally {
    loading.value = false
  }
}
watch(tab, name => loadTab(name), { immediate: true })

const fmt = (value: string | null | undefined) => (value ? new Date(value).toLocaleString('pt-BR') : '—')
const money = (value: number | string | null | undefined) =>
  value === null || value === undefined ? '—' : Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Suspender / reativar (motivo obrigatório + confirmação)
const dialog = reactive({ open: false, action: 'suspend' as 'suspend' | 'reactivate', reason: '', busy: false })
function openDialog(action: 'suspend' | 'reactivate') {
  Object.assign(dialog, { open: true, action, reason: '' })
}
async function confirmDialog() {
  dialog.busy = true
  try {
    await $fetch(`/api/admin/organizations/${id}/${dialog.action}`, { method: 'POST', body: { reason: dialog.reason } })
    toast.add({ title: dialog.action === 'suspend' ? 'Oficina suspensa' : 'Oficina reativada', color: 'success' })
    dialog.open = false
    delete loaded.activity
    await refresh()
  } catch (err) {
    showApiError(err, 'Não foi possível concluir')
  } finally {
    dialog.busy = false
  }
}

// Desativar / reativar usuário
const userDialog = reactive({ open: false, userId: '', name: '', action: 'deactivate' as 'deactivate' | 'reactivate', reason: '', busy: false })
function openUserDialog(user: { id: string, display_name: string | null, email: string | null }, action: 'deactivate' | 'reactivate') {
  Object.assign(userDialog, { open: true, userId: user.id, name: user.display_name || user.email || '', action, reason: '' })
}
async function confirmUserDialog() {
  userDialog.busy = true
  try {
    await $fetch(`/api/admin/users/${userDialog.userId}/${userDialog.action}`, { method: 'POST', body: { reason: userDialog.reason } })
    toast.add({ title: userDialog.action === 'deactivate' ? 'Usuário desativado' : 'Usuário reativado', color: 'success' })
    userDialog.open = false
    delete loaded.users
    await loadTab('users')
  } catch (err) {
    showApiError(err, 'Não foi possível concluir')
  } finally {
    userDialog.busy = false
  }
}

type AdminUser = {
  id: string
  display_name: string | null
  email: string | null
  is_active?: boolean | null
  last_seen_at?: string | null
  role_name?: string | null
}
type AdminSubscription = {
  cancellation_date?: string | null
  monthly_amount?: number | null
  next_payment_date?: string | null
  plan_key?: string | null
  plan_name?: string | null
  status?: string | null
}
type AdminInvoice = {
  id: string
  invoice_number?: string | null
  amount?: number | null
  attempt_count?: number | null
  due_date?: string | null
  payment_date?: string | null
  status?: string | null
}
type AdminActivityRow = {
  id: string
  action?: string | null
  actor_email?: string | null
  created_at: string
  error_message?: string | null
  outcome?: string | null
  status_code?: number | null
}
type AdminFiscalSyncStatus = {
  integration_status?: string | null
  last_synced_at?: string | null
  sync_error_code?: string | null
  sync_error_message?: string | null
  sync_status?: string | null
}
type AdminFiscalCall = {
  id: string
  created_at: string
  error_message?: string | null
  request_method?: string | null
  request_path?: string | null
  response_status?: number | null
}

const users = computed(() => (loaded.users as { data: AdminUser[] } | undefined)?.data ?? [])
const billing = computed(() => loaded.billing as { subscription: AdminSubscription | null, invoices: AdminInvoice[] } | undefined)
const activity = computed(() => loaded.activity as { data: AdminActivityRow[], total: number } | undefined)
const usage = computed(() => loaded.usage as { service_orders_by_month: Array<{ month: string, total: number }>, modules: Array<{ label: string, total: number }>, last_action: { created_at: string, action: string } | null } | undefined)
const fiscal = computed(() => loaded.fiscal as { sync_status: AdminFiscalSyncStatus | null, recent_calls: AdminFiscalCall[] } | undefined)
</script>

<template>
  <UDashboardPanel>
    <AppPageHeader :title="org?.name ?? 'Oficina'">
      <template #leading>
        <UButton
          to="/admin/organizations"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          aria-label="Voltar"
        />
      </template>
    </AppPageHeader>

    <div class="p-6 overflow-auto space-y-6">
      <template v-if="orgStatus === 'pending' && !org">
        <div class="grid gap-4 md:grid-cols-3">
          <AdminSkeleton />
          <AdminSkeleton />
          <AdminSkeleton />
        </div>
        <AdminSkeleton variant="table" />
      </template>

      <AdminEmptyState
        v-else-if="error"
        icon="i-lucide-building-2"
        title="Oficina não encontrada"
        description="O link pode estar errado ou a oficina foi removida."
      >
        <UButton
          to="/admin/organizations"
          icon="i-lucide-arrow-left"
          size="sm"
          color="neutral"
          variant="outline"
          label="Voltar para organizações"
        />
      </AdminEmptyState>

      <template v-else-if="org">
        <UAlert
          v-if="org.suspended_at"
          color="warning"
          variant="subtle"
          icon="i-lucide-pause-circle"
          title="Oficina suspensa"
          :description="`${fmt(org.suspended_at)} por ${org.suspended_by || '—'}: ${org.suspended_reason || 'sem motivo'}`"
        />

        <div class="grid gap-4 md:grid-cols-3">
          <UPageCard variant="subtle" title="Cadastro">
            <dl class="text-sm space-y-1">
              <div>
                <dt class="inline text-muted">
                  CNPJ/CPF:
                </dt><dd class="inline">
                  {{ org.tax_id || '—' }}
                </dd>
              </div>
              <div>
                <dt class="inline text-muted">
                  E-mail:
                </dt><dd class="inline">
                  {{ org.email || '—' }}
                </dd>
              </div>
              <div>
                <dt class="inline text-muted">
                  Telefone:
                </dt><dd class="inline">
                  {{ org.phone || '—' }}
                </dd>
              </div>
              <div>
                <dt class="inline text-muted">
                  Cidade:
                </dt><dd class="inline">
                  {{ [org.city, org.state].filter(Boolean).join('/') || '—' }}
                </dd>
              </div>
              <div>
                <dt class="inline text-muted">
                  Criada em:
                </dt><dd class="inline">
                  {{ fmt(org.created_at) }}
                </dd>
              </div>
              <div>
                <dt class="inline text-muted">
                  Onboarding:
                </dt><dd class="inline">
                  {{ org.onboarding_completed ? 'concluído' : 'pendente' }}
                </dd>
              </div>
            </dl>
          </UPageCard>

          <UPageCard variant="subtle" title="Assinatura">
            <dl v-if="org.subscription" class="text-sm space-y-1">
              <div>
                <dt class="inline text-muted">
                  Status:
                </dt><dd class="inline">
                  <AdminStatusBadge kind="subscription" :value="org.subscription.status" />
                </dd>
              </div>
              <div>
                <dt class="inline text-muted">
                  Plano:
                </dt><dd class="inline">
                  {{ org.subscription.plan_key || org.subscription.plan_name || '—' }}
                </dd>
              </div>
              <div>
                <dt class="inline text-muted">
                  Valor mensal:
                </dt><dd class="inline">
                  {{ money(org.subscription.monthly_amount) }}
                </dd>
              </div>
              <div>
                <dt class="inline text-muted">
                  Próx. cobrança:
                </dt><dd class="inline">
                  {{ fmt(org.subscription.next_payment_date) }}
                </dd>
              </div>
              <div v-if="org.subscription.cancellation_date">
                <dt class="inline text-muted">
                  Cancelada em:
                </dt><dd class="inline">
                  {{ fmt(org.subscription.cancellation_date) }}
                </dd>
              </div>
            </dl>
            <AdminEmptyState
              v-else
              icon="i-lucide-credit-card"
              title="Sem assinatura"
              description="Esta oficina nunca assinou um plano."
            />
          </UPageCard>

          <UPageCard variant="subtle" title="Ações do owner">
            <p class="text-sm text-muted">
              Toda ação exige motivo e fica registrada na auditoria.
            </p>
            <div class="flex flex-wrap gap-2 mt-2">
              <UButton
                v-if="!org.suspended_at"
                color="warning"
                variant="soft"
                icon="i-lucide-pause"
                size="sm"
                label="Suspender oficina"
                @click="openDialog('suspend')"
              />
              <UButton
                v-else
                color="success"
                variant="soft"
                icon="i-lucide-play"
                size="sm"
                label="Reativar oficina"
                @click="openDialog('reactivate')"
              />
              <UButton
                :to="`/admin/audit?organizationId=${org.id}`"
                color="neutral"
                variant="outline"
                icon="i-lucide-clipboard-list"
                size="sm"
                label="Ver auditoria"
              />
            </div>
          </UPageCard>
        </div>

        <UTabs v-model="tab" :items="tabs" :content="false" />

        <AdminSkeleton
          v-if="loading"
          variant="table"
          :rows="4"
          :cols="5"
        />

        <div v-else-if="tab === 'users'" class="space-y-2">
          <table class="w-full text-sm">
            <thead class="text-left text-muted">
              <tr>
                <th class="py-1">
                  Nome
                </th><th>E-mail</th><th>Papel</th><th>Último acesso</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="user in users" :key="user.id" class="border-t border-default">
                <td class="py-2">
                  {{ user.display_name || '—' }}
                </td>
                <td>{{ user.email || '—' }}</td>
                <td>{{ user.role_name || '—' }}</td>
                <td>{{ fmt(user.last_seen_at) }}</td>
                <td>
                  <AdminStatusBadge kind="active" :value="user.is_active !== false" />
                </td>
                <td class="text-right">
                  <UButton
                    v-if="user.is_active !== false"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-user-x"
                    label="Desativar"
                    @click="openUserDialog(user, 'deactivate')"
                  />
                  <UButton
                    v-else
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-user-check"
                    label="Reativar"
                    @click="openUserDialog(user, 'reactivate')"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <AdminEmptyState
            v-if="!users.length"
            icon="i-lucide-users"
            title="Nenhum usuário"
            description="Esta oficina ainda não tem usuários cadastrados."
          />
        </div>

        <div v-else-if="tab === 'billing'" class="space-y-3">
          <table class="w-full text-sm">
            <thead class="text-left text-muted">
              <tr>
                <th class="py-1">
                  Fatura
                </th><th>Valor</th><th>Status</th><th>Vencimento</th><th>Pagamento</th><th>Tentativas</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="inv in billing?.invoices ?? []" :key="inv.id" class="border-t border-default">
                <td class="py-2">
                  {{ inv.invoice_number || inv.id.slice(0, 8) }}
                </td>
                <td>{{ money(inv.amount) }}</td>
                <td>
                  <AdminStatusBadge kind="invoice" :value="inv.status" />
                </td>
                <td>{{ fmt(inv.due_date) }}</td>
                <td>{{ fmt(inv.payment_date) }}</td>
                <td>{{ inv.attempt_count ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
          <AdminEmptyState
            v-if="!(billing?.invoices ?? []).length"
            icon="i-lucide-receipt"
            title="Nenhuma fatura"
            description="Quando a Stripe gerar cobranças para esta oficina, elas aparecem aqui."
          />
        </div>

        <div v-else-if="tab === 'activity'" class="space-y-2">
          <p class="text-xs text-muted">
            Últimos 31 dias · {{ activity?.total ?? 0 }} registros (50 mais recentes).
          </p>
          <table class="w-full text-sm">
            <thead class="text-left text-muted">
              <tr>
                <th class="py-1">
                  Quando
                </th><th>Usuário</th><th>Ação</th><th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in activity?.data ?? []" :key="row.id" class="border-t border-default">
                <td class="py-2 whitespace-nowrap">
                  {{ fmt(row.created_at) }}
                </td>
                <td>{{ row.actor_email || '—' }}</td>
                <td>{{ row.action }}<span v-if="row.error_message" class="block text-xs text-error">{{ row.error_message }}</span></td>
                <td>
                  <AdminStatusBadge kind="outcome" :value="row.outcome" :prefix="row.status_code" />
                </td>
              </tr>
            </tbody>
          </table>
          <AdminEmptyState
            v-if="!(activity?.data ?? []).length"
            icon="i-lucide-activity"
            title="Sem atividade recente"
            description="Nenhuma requisição desta oficina nos últimos 31 dias."
          />
        </div>

        <div v-else-if="tab === 'usage'" class="grid gap-4 md:grid-cols-2">
          <UPageCard variant="subtle" title="Ordens de serviço por mês">
            <ul class="text-sm space-y-1">
              <li v-for="m in usage?.service_orders_by_month ?? []" :key="m.month" class="flex justify-between">
                <span>{{ m.month }}</span><span class="tabular-nums">{{ m.total }}</span>
              </li>
            </ul>
            <AdminEmptyState
              v-if="!(usage?.service_orders_by_month ?? []).length"
              icon="i-lucide-clipboard-list"
              title="Nenhuma OS criada"
              description="A oficina ainda não registrou ordens de serviço."
            />
          </UPageCard>
          <UPageCard variant="subtle" title="Registros por módulo">
            <ul class="text-sm space-y-1">
              <li v-for="m in usage?.modules ?? []" :key="m.label" class="flex justify-between">
                <span>{{ m.label }}</span><span class="tabular-nums">{{ m.total }}</span>
              </li>
            </ul>
            <p class="text-xs text-muted mt-2">
              Última ação: {{ usage?.last_action ? `${usage.last_action.action} em ${fmt(usage.last_action.created_at)}` : 'sem registro' }}
            </p>
          </UPageCard>
        </div>

        <div v-else-if="tab === 'fiscal'" class="space-y-3">
          <UPageCard variant="subtle" title="Integração">
            <AdminEmptyState
              v-if="!fiscal?.sync_status"
              icon="i-lucide-file-x"
              title="Fiscal não configurado"
              description="Esta empresa ainda não foi sincronizada com a Focus NFe."
            />
            <dl v-else class="text-sm space-y-1">
              <div>
                <dt class="inline text-muted">
                  Status:
                </dt><dd class="inline">
                  {{ fiscal.sync_status.integration_status }} / {{ fiscal.sync_status.sync_status }}
                </dd>
              </div>
              <div>
                <dt class="inline text-muted">
                  Última sincronização:
                </dt><dd class="inline">
                  {{ fmt(fiscal.sync_status.last_synced_at) }}
                </dd>
              </div>
              <div v-if="fiscal.sync_status.sync_error_message" class="text-error">
                {{ fiscal.sync_status.sync_error_code }} — {{ fiscal.sync_status.sync_error_message }}
              </div>
            </dl>
          </UPageCard>
          <table class="w-full text-sm">
            <thead class="text-left text-muted">
              <tr>
                <th class="py-1">
                  Quando
                </th><th>Chamada</th><th>Status</th><th>Erro</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="call in fiscal?.recent_calls ?? []" :key="call.id" class="border-t border-default">
                <td class="py-2 whitespace-nowrap">
                  {{ fmt(call.created_at) }}
                </td>
                <td>{{ call.request_method }} {{ call.request_path }}</td>
                <td>
                  <AdminStatusBadge kind="http" :value="call.response_status" />
                </td>
                <td class="text-xs text-error">
                  {{ call.error_message || '' }}
                </td>
              </tr>
            </tbody>
          </table>
          <AdminEmptyState
            v-if="!(fiscal?.recent_calls ?? []).length"
            icon="i-lucide-plug-zap"
            title="Nenhuma chamada fiscal"
            description="As chamadas ao provedor de NFS-e desta oficina aparecem aqui."
          />
        </div>
      </template>
    </div>

    <UModal v-model:open="dialog.open" :title="dialog.action === 'suspend' ? 'Suspender oficina' : 'Reativar oficina'">
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-muted">
            {{ dialog.action === 'suspend' ? 'Todos os usuários desta oficina passam a receber 403 na API.' : 'Os usuários voltam a acessar normalmente.' }}
          </p>
          <UTextarea
            v-model="dialog.reason"
            placeholder="Motivo (obrigatório, mínimo de 5 caracteres)"
            :rows="3"
            class="w-full"
          />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            label="Cancelar"
            @click="dialog.open = false"
          />
          <UButton
            :color="dialog.action === 'suspend' ? 'warning' : 'success'"
            :icon="dialog.action === 'suspend' ? 'i-lucide-pause' : 'i-lucide-play'"
            :loading="dialog.busy"
            :disabled="dialog.reason.trim().length < 5"
            :label="dialog.action === 'suspend' ? 'Suspender' : 'Reativar'"
            @click="confirmDialog"
          />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="userDialog.open" :title="`${userDialog.action === 'deactivate' ? 'Desativar' : 'Reativar'} ${userDialog.name}`">
      <template #body>
        <UTextarea
          v-model="userDialog.reason"
          placeholder="Motivo (obrigatório, mínimo de 5 caracteres)"
          :rows="3"
          class="w-full"
        />
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            label="Cancelar"
            @click="userDialog.open = false"
          />
          <UButton
            icon="i-lucide-check"
            :loading="userDialog.busy"
            :disabled="userDialog.reason.trim().length < 5"
            label="Confirmar"
            @click="confirmUserDialog"
          />
        </div>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
