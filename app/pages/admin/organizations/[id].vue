<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
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

const { data: org, error, refresh } = await useAsyncData(`admin-org-${id}`, () =>
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

const users = computed(() => (loaded.users as { data: Array<Record<string, any>> } | undefined)?.data ?? [])
const billing = computed(() => loaded.billing as { subscription: Record<string, any> | null, invoices: Array<Record<string, any>> } | undefined)
const activity = computed(() => loaded.activity as { data: Array<Record<string, any>>, total: number } | undefined)
const usage = computed(() => loaded.usage as { service_orders_by_month: Array<{ month: string, total: number }>, modules: Array<{ label: string, total: number }>, last_action: { created_at: string, action: string } | null } | undefined)
const fiscal = computed(() => loaded.fiscal as { sync_status: Record<string, any> | null, recent_calls: Array<Record<string, any>> } | undefined)

const outcomeColor: Record<string, 'success' | 'warning' | 'neutral' | 'error'> = { success: 'success', denied: 'warning', invalid: 'neutral', error: 'error' }
</script>

<template>
  <UDashboardPanel>
    <UDashboardNavbar :title="org?.name ?? 'Oficina'">
      <template #leading>
        <UButton
          to="/admin/organizations"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          aria-label="Voltar"
        />
      </template>
    </UDashboardNavbar>

    <div class="p-6 overflow-auto space-y-6">
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        title="Oficina não encontrada"
      />

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
                  <UBadge size="sm" variant="subtle">
                    {{ org.subscription.status }}
                  </UBadge>
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
            <p v-else class="text-sm text-muted">
              Sem assinatura.
            </p>
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
                label="Suspender oficina"
                @click="openDialog('suspend')"
              />
              <UButton
                v-else
                color="success"
                variant="soft"
                icon="i-lucide-play"
                label="Reativar oficina"
                @click="openDialog('reactivate')"
              />
              <UButton
                :to="`/admin/audit?organizationId=${org.id}`"
                color="neutral"
                variant="outline"
                icon="i-lucide-clipboard-list"
                label="Ver auditoria"
              />
            </div>
          </UPageCard>
        </div>

        <UTabs v-model="tab" :items="tabs" :content="false" />

        <div v-if="loading" class="text-sm text-muted">
          Carregando...
        </div>

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
                  <UBadge size="sm" variant="subtle" :color="user.is_active === false ? 'neutral' : 'success'">
                    {{ user.is_active === false ? 'Inativo' : 'Ativo' }}
                  </UBadge>
                </td>
                <td class="text-right">
                  <UButton
                    v-if="user.is_active !== false"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    label="Desativar"
                    @click="openUserDialog(user as any, 'deactivate')"
                  />
                  <UButton
                    v-else
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    label="Reativar"
                    @click="openUserDialog(user as any, 'reactivate')"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!users.length" class="text-sm text-muted">
            Nenhum usuário.
          </p>
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
                <td>{{ inv.status }}</td>
                <td>{{ fmt(inv.due_date) }}</td>
                <td>{{ fmt(inv.payment_date) }}</td>
                <td>{{ inv.attempt_count ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!(billing?.invoices ?? []).length" class="text-sm text-muted">
            Nenhuma fatura.
          </p>
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
                  <UBadge size="sm" variant="subtle" :color="outcomeColor[row.outcome]">
                    {{ row.status_code }}
                  </UBadge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else-if="tab === 'usage'" class="grid gap-4 md:grid-cols-2">
          <UPageCard variant="subtle" title="Ordens de serviço por mês">
            <ul class="text-sm space-y-1">
              <li v-for="m in usage?.service_orders_by_month ?? []" :key="m.month" class="flex justify-between">
                <span>{{ m.month }}</span><span class="tabular-nums">{{ m.total }}</span>
              </li>
            </ul>
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
            <p v-if="!fiscal?.sync_status" class="text-sm text-muted">
              Empresa não sincronizada com a Focus NFe.
            </p>
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
                  <UBadge size="sm" variant="subtle" :color="call.is_success ? 'success' : 'error'">
                    {{ call.response_status ?? '—' }}
                  </UBadge>
                </td>
                <td class="text-xs text-error">
                  {{ call.error_message || '' }}
                </td>
              </tr>
            </tbody>
          </table>
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
            label="Cancelar"
            @click="dialog.open = false"
          />
          <UButton
            :color="dialog.action === 'suspend' ? 'warning' : 'success'"
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
            label="Cancelar"
            @click="userDialog.open = false"
          />
          <UButton
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
