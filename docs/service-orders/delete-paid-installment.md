# Excluir uma parcela (qualquer status) com motivo obrigatório

Continuação de [payment-flow-redesign.md](payment-flow-redesign.md) (a Fase 5 daquele documento cobriu editar/remover uma linha **pendente** sem motivo e desfazer um **recebimento** isolado sem motivo, mas não havia nenhuma forma de remover a linha inteira depois que ela já está `paid`/`partial`). Também segue o precedente já implementado em `financial/index.vue` para exclusão com motivo obrigatório (seção 2.2).

## 1. Pedido

Hoje, nos detalhes da OS, uma parcela com `status = 'paid'` (ou `partial`) não tem nenhum botão de remoção — só é possível "desfazer" recebimento por recebimento (sem motivo). Uma parcela `pending` pode ser removida, mas sem pedir motivo.

**Decisão final do time**: unificar tudo em uma única ação de exclusão, disponível para **qualquer status** da parcela (`pending`, `overdue`, `partial`, `paid`), sempre exigindo motivo — não só quando há dinheiro envolvido. Isso substitui a remoção "rápida sem motivo" que hoje existe para `pending` (seção 2.1) por essa mesma ação unificada.

## 2. Estado atual verificado

### 2.1 Onde a exclusão de parcela vive hoje

`app/components/service-orders/detail/OSInstallmentsCard.vue`:
- Linha 334: botão "Pagar"/"Receber restante" só aparece se `canUpdate && installment.status !== 'paid'`.
- Linha 351: os ícones de editar (lápis) e remover (lixeira) só aparecem se `canUpdate && installment.status === 'pending'`. A remoção hoje **não pede motivo** (`requestRemove`/`confirmRemove`, linhas 200-225; modal linhas 498-513, só uma frase estática). **Uma parcela `paid`/`partial` não tem nenhum ícone de remoção hoje** — é a lacuna que motivou o pedido original.
- Linhas 372-407: parcelas com `receipts` (recebimentos já liquidados) mostram uma lista expansível, cada recebimento com um botão "Desfazer este recebimento" (`requestUndoReceipt`/`confirmUndoReceipt`, linhas 237-263). O modal desse fluxo (linhas 516-530) **não tem campo de motivo** — continua assim, é uma ação diferente (desfaz um recebimento específico, não a parcela inteira — ver seção 3.1).
- Todas as ações seguem o mesmo padrão local: um `ref` guardando "o item sendo agido", um `isX` de loading, `request*()` que abre o `AppConfirmModal` correspondente, `confirm*()` que faz o `$fetch` + toast + `emit('changed')`.

`app/components/AppConfirmModal.vue` é o wrapper reutilizável (`open`, `title`, `description`, `confirmLabel`, `confirmColor`, `loading`, `confirmDisabled`, emite `update:open`/`confirm`) — é o componente certo pra reaproveitar aqui, com um `UFormField`/`UTextarea` no slot `#description`, igual ao próximo item.

### 2.2 O padrão já implementado no financeiro (exclusão com motivo obrigatório)

`app/pages/app/financial/index.vue` (linhas 543-575 e 1110-1144): `AppConfirmModal` com `:confirm-disabled="!deletionReasonValid"` (`deletionReasonValid = computed(() => deletionReason.value.trim().length > 0)`), um `UFormField label="Motivo da exclusão" required` com `UTextarea`, e o body da requisição `DELETE` leva `{ reason: deletionReason.value.trim() }`.

`server/api/financial/[id].delete.ts`: revalida no backend que `reason` não é vazio (400 `'O motivo da exclusão é obrigatório'`) — nunca confia só na validação do cliente — e delega pra `softDeleteFinancialTransaction()` (`server/utils/financial-transaction-deletion.ts`), o **único** ponto de escrita que seta `deleted_at`/`deleted_by`/`deletion_reason`/`deletion_source` em `financial_transactions`. `deletion_source` vem de um enum central (`FINANCIAL_TRANSACTION_DELETION_SOURCES`) — cada chamador (exclusão manual, cancelamento de OS, estorno de recebimento, rollback de comissão) se identifica com sua própria constante, nunca uma string solta. Este é o precedente direto pra exigir motivo em qualquer status na seção 3.

Essas duas colunas (`deletion_reason`, `deletion_source`) foram adicionadas à tabela `financial_transactions` pela migration `20240101000075_add_deletion_audit_to_financial_transactions.sql` — **`service_order_installments` não tem essas colunas** (só tem `deleted_at`/`deleted_by` genéricos, herdados da criação da tabela, nunca usados na prática — ver 2.3).

### 2.3 `service_order_installments` já nasceu com `deleted_at`/`deleted_by`, mas nenhum código usa soft delete nela

Migration base (`20240101000019_create_service_order_installments.sql`, linhas 74-75): a tabela já tem `deleted_at timestamptz` e `deleted_by varchar(200)` desde o início, e os índices parciais (linhas 110-126) já são escritos com `WHERE deleted_at IS NULL` — ou seja, o soft delete **já era a intenção original do schema**. A policy de `DELETE` (linha 163) até comenta isso: *"soft deletes are preferred, but hard-delete is also org-scoped"*.

Na prática, hoje **nenhum caminho de código soft-deleta essa tabela** — todos fazem `DELETE` físico:
- `server/api/service-orders/[id]/installments/[installmentId].delete.ts:43-46` — remove uma linha `pending` sem motivo (bloqueia com 409 se não for `pending`). **Este endpoint é o que a proposta abaixo substitui inteiramente** (seção 3.3) — deixa de existir "remoção sem motivo", mesmo para `pending`.
- `server/api/service-orders/[id]/payment.delete.ts:133` — apaga todas as parcelas da OS ao cancelar o pagamento inteiro. Sem mudança — continua sendo "apagar tudo" com a justificativa já sendo o cancelamento do pagamento inteiro, não a exclusão pontual de uma linha.
- `server/api/service-orders/[id].delete.ts:112` — apaga as parcelas ao excluir a OS inteira. Sem mudança, mesmo motivo do item acima.

### 2.4 Todo lugar que lê `service_order_installments` sem filtrar `deleted_at`

Confirmado via busca em todo o `server/`: **nenhuma leitura hoje filtra `deleted_at`**, porque a coluna nunca é preenchida. Ao introduzir soft delete (seção 3), todos esses pontos precisam do filtro `.is('deleted_at', null)` (ou `nullColumns: ['deleted_at']` no helper de paginação), senão uma parcela excluída continua aparecendo:

| Arquivo | Uso |
|---|---|
| `server/api/service-orders/[id].get.ts:46` | Lista de parcelas exibida no detalhe da OS |
| `server/api/service-orders/index.get.ts:40` | `installments_progress` (pago/total) na listagem de OS |
| `server/utils/service-order-payment-status.ts:27-30` | Recalcula `payment_status` da OS a partir do `status` de cada parcela |
| `server/utils/service-order-commissions.ts:229-232` | Soma parcelas pagas pra liberar comissão |
| `server/api/service-orders/[id]/cancel.post.ts:59-62` | Bloqueia cancelamento se existir qualquer parcela |
| `server/api/service-orders/[id]/process-payment.post.ts:90-93` | Trava de idempotência: "já existe plano pra esta OS?" |
| `server/api/service-orders/[id]/down-payment.post.ts:60-63` | Mesma trava, específica pro sinal |
| `server/api/service-orders/[id]/receive-extra-payment.post.ts:62-65` | Mesma trava, específica pro avulso |
| `server/api/reports/debtors.get.ts:118-121` | Relatório de inadimplência (usa `fetchAllOrganizationRows`, que já suporta `nullColumns`, só falta passar `['deleted_at']`) |

`server/api/service-orders/[id]/installments/[installmentId].patch.ts` e `[installmentId]/pay.post.ts` buscam por `id` específico e continuam existindo (editar/pagar uma linha ainda faz sentido antes de ela ser excluída) — precisam passar a rejeitar (404) uma parcela já soft-deletada, já que agora ela pode existir com qualquer status.

### 2.5 Guarda de comissão já paga — precedente a reaproveitar (só entra em jogo quando há dinheiro a reverter)

Dois endpoints que revertem dinheiro já recebido de uma OS bloqueiam (409) se existir qualquer comissão `status='paid'` da OS naquele funcionário, pra nunca reverter saldo bancário de dinheiro que já saiu pro funcionário silenciosamente:

- `server/api/service-orders/[id]/financial-transactions/[transactionId].delete.ts:55-69` (desfazer um recebimento)
- `server/api/service-orders/[id]/payment.delete.ts` (cancelar todo o pagamento da OS)

Esse guard só faz sentido quando a parcela sendo excluída tem dinheiro de fato recebido contra ela (`paid`/`partial`) — uma parcela `pending`/`overdue` não tem nenhuma transação vinculada, então não há o que reverter e o guard não deveria nem ser consultado (ver seção 3.1, para não bloquear à toa a exclusão de uma linha pendente só porque *outra* comissão da mesma OS já foi paga).

### 2.6 Permissão

**Decisão do time**: esta ação usa uma permissão do módulo **Financeiro** (`ActionCode.FINANCIAL_DELETE = 'financial.delete'`) — para **qualquer** status, já que agora é uma única ação unificada, não faria sentido ter uma permissão para excluir `pending` e outra pra excluir `paid`.

`useWorkshopPermissions()` (`app/composables/useWorkshopPermissions.ts`) é um composable genérico — já é usado em telas de módulos diferentes checando `ActionCode`s de outros módulos, então checar `FINANCIAL_DELETE` dentro de `service-orders.vue` não é um padrão novo, só uma combinação nova.

Não existe hoje, em `service-orders.vue`, nenhum `computed` pra `FINANCIAL_DELETE` — precisa de um novo, separado do `canDelete` existente (que continua sendo `ORDERS_DELETE`, usado pra excluir a OS inteira, cancelar, etc. — ações diferentes, não relacionadas a esta):

```ts
const canDeleteInstallment = computed(() => workshop.can(ActionCode.FINANCIAL_DELETE))
```

Repassado por `ServiceOrdersDetailModal` → `Modal.vue` → `OSInstallmentsCard.vue` como um prop novo e distinto (`canDeleteInstallment`), não reaproveitando os props `canDelete`/`canUpdate` já existentes — são permissões diferentes.

## 3. Desenho da funcionalidade

### 3.1 O que "excluir uma parcela" significa agora

Uma única ação, para **qualquer status** (`pending`, `overdue`, `partial`, `paid`), sempre com motivo obrigatório. A diferença de mecânica por trás não é sobre "pedir motivo ou não" — é só sobre **se existe dinheiro a reverter**:

1. **Busca toda `financial_transactions` ainda ligada a essa parcela** (`status='paid'`, `deleted_at IS NULL`), via `service_order_installment_id` (modelo novo da Fase 0) **e** via `service_order_installments.financial_transaction_id` (modelo legado, dedupe por id) — ver `payment-flow-redesign.md` seção 2. Uma parcela `pending`/`overdue` não tem nenhuma; uma `paid` tem uma; uma `partial` pode ter uma ou mais.
2. **Se encontrou alguma**: roda o guard de comissão já paga (seção 2.5, 409 se houver) e reverte cada uma — mesma mecânica já usada em `financial-transactions/[transactionId].delete.ts:71-97`: ler `bank_account_statements.previous_balance`, devolver o saldo da conta, apagar o extrato, e soft-deletar a `financial_transactions` via `softDeleteFinancialTransaction()` com o **motivo digitado pelo usuário** (em vez do texto fixo usado no desfazer avulso). **Se não encontrou nenhuma** (`pending`/`overdue`): pula direto pro próximo passo, sem consultar o guard — nada a reverter, nada a bloquear.
3. **Soft-deleta a própria linha de `service_order_installments`**, sempre, independente do que os passos 1-2 encontraram — grava `deleted_at`, `deleted_by`, `deletion_reason` (o motivo do usuário) e `deletion_source` (seção 3.2), preservando valor/vencimento/tipo da parcela pra auditoria em vez de perder essa informação como um `DELETE` físico perderia.
4. **Recalcula** `payment_status` da OS (`recalculateServiceOrderPaymentStatus`) e a liberação de comissão (`releaseServiceOrderCommissions`) — sempre, mesmo quando não havia dinheiro a reverter (uma parcela `pending` some do total esperado, o que também pode mudar `payment_status`).

O "desfazer um recebimento específico" (seção 2.1, `requestUndoReceipt`) continua existindo do jeito que é hoje, sem motivo — é uma ação mais fina (reverte só um recebimento, mantém a parcela e o restante dela intactos). A exclusão de parcela (esta proposta) é mais larga: tira a linha inteira do plano, revertendo tudo que estiver ligado a ela.

### 3.2 Migration nova: auditoria de exclusão em `service_order_installments`

Mesmo padrão de `20240101000075_add_deletion_audit_to_financial_transactions.sql`, próximo número livre é `20240101000076`:

```sql
-- 20240101000076_add_deletion_audit_to_service_order_installments.sql
ALTER TABLE public.service_order_installments
    ADD COLUMN deletion_reason text,
    ADD COLUMN deletion_source varchar(100);

COMMENT ON COLUMN public.service_order_installments.deletion_reason IS
    'Por que esta parcela foi excluída. Sempre obrigatório neste fluxo, independente do status da parcela no momento da exclusão. NULL apenas para linhas nunca excluídas.';
COMMENT ON COLUMN public.service_order_installments.deletion_source IS
    'De onde veio a exclusão. Hoje só um valor possível: service_orders.installment_delete. Ver server/api/service-orders/[id]/installments/[installmentId].delete.ts.';
```

Não mexe nos índices parciais existentes (`WHERE deleted_at IS NULL`) — eles já foram escritos pensando nisso (seção 2.3).

### 3.3 Contrato da API — mesmo endpoint, comportamento único

`server/api/service-orders/[id]/installments/[installmentId].delete.ts` deixa de ramificar por `status` — **sempre** exige motivo, e só ramifica internamente para decidir se há dinheiro a reverter (seção 3.1):

```ts
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const orderId = getRouterParam(event, 'id')
  const installmentId = getRouterParam(event, 'installmentId')
  if (!orderId || !installmentId) {
    throw createError({ statusCode: 400, statusMessage: 'Parâmetros obrigatórios ausentes' })
  }

  const body = (await readBody(event).catch(() => null)) || {}
  const reason = String(body?.reason || '').trim()
  if (!reason) throw createError({ statusCode: 400, statusMessage: 'O motivo da exclusão é obrigatório' })

  const { data: installment, error: installmentError } = await supabase
    .from('service_order_installments')
    .select('*')
    .eq('id', installmentId)
    .eq('service_order_id', orderId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (installmentError || !installment) {
    throw createError({ statusCode: 404, statusMessage: 'Parcela não encontrada' })
  }

  // Junta as transações ligadas por service_order_installment_id (modelo novo)
  // + financial_transaction_id legado (dedupe por id) — 0 resultados para uma
  // parcela pending/overdue, 1+ para paid/partial.
  const { data: linkedTransactions } = await supabase
    .from('financial_transactions')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('status', 'paid')
    .is('deleted_at', null)
    .or(
      `service_order_installment_id.eq.${installmentId}` +
      (installment.financial_transaction_id ? `,id.eq.${installment.financial_transaction_id}` : '')
    )

  if (linkedTransactions?.length) {
    // Mesmo guard de financial-transactions/[transactionId].delete.ts:55-69 —
    // só bloqueia quando existe dinheiro real sendo revertido.
    const { data: paidCommissions } = await supabase
      .from('employee_financial_records')
      .select('id')
      .eq('service_order_id', orderId)
      .eq('record_type', 'commission')
      .eq('organization_id', organizationId)
      .eq('status', 'paid')
      .limit(1)

    if (paidCommissions?.length) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Não é possível excluir esta parcela: existe comissão já paga a funcionário(s) nesta OS.'
      })
    }

    // Para cada transação em linkedTransactions: reverter bank_account_statements
    // (voltar current_balance pro previous_balance, apagar o extrato) e
    // softDeleteFinancialTransaction({ reason, source: SERVICE_ORDER_INSTALLMENT_DELETE, ... })
    // — mesma mecânica de financial-transactions/[transactionId].delete.ts:71-97,
    // repetida por transação em vez de uma só.
  }

  await supabase
    .from('service_order_installments')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: authUser.email,
      deletion_reason: reason,
      deletion_source: 'service_orders.installment_delete'
    })
    .eq('id', installmentId)

  await recalculateServiceOrderPaymentStatus({ supabase, organizationId, orderId, userEmail: authUser.email })
  const commissionResult = await releaseServiceOrderCommissions({ supabase, organizationId, orderId, userEmail: authUser.email })

  return { success: true, warnings: commissionResult.warnings }
})
```

Nova constante em `server/utils/financial-transaction-deletion.ts` (`FINANCIAL_TRANSACTION_DELETION_SOURCES`):
```ts
SERVICE_ORDER_INSTALLMENT_DELETE: 'service_orders.installment_delete'
```

**Mudança de comportamento a confirmar com o time**: hoje remover uma parcela `pending` não pede motivo (seção 2.1/2.3); com esta proposta, passa a pedir — é a consequência direta de unificar tudo numa ação só, mas é uma fricção nova pra um caso que antes era instantâneo. Se isso for indesejado, a alternativa é manter dois caminhos (o que a primeira versão deste documento propunha) — decisão explícita do time foi unificar, registrada aqui para não se perder na implementação.

### 3.4 Frontend

**`ActionCode`**: novo computed `canDeleteInstallment` usando `ActionCode.FINANCIAL_DELETE` (seção 2.6) — substitui o uso de `canUpdate` para a ação de remover (o de editar continua com `canUpdate`, ver abaixo). Repassado: `service-orders.vue` → `ServiceOrdersDetailModal` → `Modal.vue` → `OSInstallmentsCard.vue` (novo prop `canDeleteInstallment?: boolean`).

**`OSInstallmentsCard.vue`** — muda o bloco das linhas 350-370:
- O ícone de **editar** continua exatamente como hoje: só para `pending`, gated por `canUpdate` (editar vencimento/valor não faz sentido numa parcela que já tem dinheiro ou já foi excluída).
- O ícone de **remover/excluir** deixa de existir só para `pending` sem motivo — vira um único botão visível **para qualquer status**, gated por `canDeleteInstallment`, sempre abrindo o modal com motivo obrigatório abaixo. Os antigos `removingInstallment`/`requestRemove`/`confirmRemove` (linhas 197-225) e o modal "Remover parcela" (linhas 498-513) são **substituídos** por esta nova versão, não somem — a ideia de "remover uma linha" continua existindo, só que unificada com o caso `paid`/`partial` e agora sempre com motivo.

Novo estado local (substitui `removingInstallment`/`isRemoving`, espelhando `deletionReason`/`deletionReasonValid` de `financial/index.vue`):
```ts
const deletingInstallment = ref<ServiceOrderInstallment | null>(null)
const deletionReason = ref('')
const deletionReasonValid = computed(() => deletionReason.value.trim().length > 0)
const isDeletingInstallment = ref(false)

function requestDelete(installment: ServiceOrderInstallment) {
  deletingInstallment.value = installment
  deletionReason.value = ''
}

async function confirmDelete() {
  if (!deletingInstallment.value || isDeletingInstallment.value || !deletionReasonValid.value) return
  isDeletingInstallment.value = true
  try {
    await $fetch(`/api/service-orders/${props.orderId}/installments/${deletingInstallment.value.id}`, {
      method: 'DELETE',
      body: { reason: deletionReason.value.trim() }
    })
    toast.add({ title: 'Parcela excluída', color: 'success' })
    deletingInstallment.value = null
    deletionReason.value = ''
    emit('changed')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Erro ao excluir parcela', description: err?.data?.statusMessage || 'Tente novamente.', color: 'error' })
  } finally {
    isDeletingInstallment.value = false
  }
}
```

Modal novo (substitui o "Remover parcela" existente, mesmo padrão visual do de `financial/index.vue`, linhas 1110-1144):
```html
<AppConfirmModal
  :open="!!deletingInstallment"
  title="Excluir parcela"
  confirm-label="Excluir parcela"
  confirm-color="error"
  :loading="isDeletingInstallment"
  :confirm-disabled="!deletionReasonValid"
  @update:open="(v) => { if (!v && !isDeletingInstallment) { deletingInstallment = null; deletionReason = '' } }"
  @confirm="confirmDelete"
>
  <template #description>
    <div v-if="deletingInstallment" class="space-y-3">
      <p class="text-sm text-muted">
        <template v-if="deletingInstallment.status === 'paid' || deletingInstallment.status === 'partial'">
          Isso reverte o(s) recebimento(s) ligados a esta parcela (o valor volta pro saldo da conta bancária) e remove a linha do plano de pagamento.
        </template>
        <template v-else>
          Remove esta linha do plano de pagamento.
        </template>
        Não pode ser desfeito.
      </p>
      <UFormField label="Motivo da exclusão" required>
        <UTextarea v-model="deletionReason" class="w-full" :rows="2" />
      </UFormField>
    </div>
  </template>
</AppConfirmModal>
```

O botão de exclusão passa a aparecer ao lado do editar, condicionado só por status para o **editar** (`pending` apenas) — o de excluir some da checagem de status e passa a depender só de `canDeleteInstallment`.

## 4. Efeitos colaterais a cobrir (checklist de implementação)

- [ ] Migration `20240101000076_add_deletion_audit_to_service_order_installments.sql` (seção 3.2).
- [ ] Adicionar `.is('deleted_at', null)` (ou `nullColumns: ['deleted_at']`) em todos os 9 pontos de leitura listados na seção 2.4 — sem isso, uma parcela excluída continua contando pro `payment_status`, pro relatório de inadimplência, e pras travas de idempotência de sinal/avulso/plano.
- [ ] `server/utils/financial-transaction-deletion.ts`: nova constante `SERVICE_ORDER_INSTALLMENT_DELETE`.
- [ ] `server/api/service-orders/[id]/installments/[installmentId].delete.ts`: reescrever pro fluxo único (seção 3.3) — motivo sempre obrigatório, reversão de dinheiro só quando há transação vinculada.
- [ ] `server/api/service-orders/[id].get.ts`: `installments` já filtrado por `deleted_at IS NULL` faz a parcela excluída sumir sozinha da lista/`received_amount`/`remaining_amount`/`receipts`.
- [ ] `service-orders.vue`: novo computed `canDeleteInstallment` (`ActionCode.FINANCIAL_DELETE`), repassado até `OSInstallmentsCard` via `ServiceOrdersDetailModal` → `Modal.vue`.
- [ ] `OSInstallmentsCard.vue`: novo prop `canDeleteInstallment`; substituir `removingInstallment`/`requestRemove`/`confirmRemove` e o modal "Remover parcela" pelo fluxo único com motivo (seção 3.4); manter editar como está, só para `pending`.
- [ ] Conferir `server/api/service-orders/[id]/cancel.post.ts` e `payment.delete.ts`: ambos assumem hoje que "existe parcela = existe algo a proteger"; uma parcela soft-deletada não deve mais contar como "existe" nesses dois (reforça o item do filtro `deleted_at`, já listado acima, não é um caminho novo de código).

## 5. Critérios de aceite

- Qualquer parcela (`pending`, `overdue`, `partial`, `paid`) pode ser excluída pelo mesmo botão/fluxo.
- O botão de excluir é visível só para quem tem `FINANCIAL_DELETE`.
- O clique abre um modal que **não deixa confirmar** sem o campo de motivo preenchido (client-side) — e o backend também rejeita (400) uma requisição sem motivo, mesmo que o frontend seja contornado, **independente do status da parcela**. Não há tamanho mínimo de motivo — só não pode ser vazio/só espaço.
- Quando havia dinheiro recebido contra a parcela (`paid`/`partial`): o saldo da conta bancária volta ao valor de antes do(s) recebimento(s); nenhuma comissão já paga a funcionário é revertida silenciosamente (bloqueia com 409 antes disso).
- Em qualquer caso: a parcela some da lista de parcelas da OS; o `payment_status` da OS é recalculado; a liberação de comissão é recalculada.
- O motivo e quem excluiu ficam gravados (`deletion_reason`, `deletion_source`, `deleted_by`, `deleted_at`) na própria linha de `service_order_installments` — a parcela não desaparece do banco, só passa a ser filtrada nas leituras.
- Nenhum relatório (`debtors.get.ts`) ou trava de idempotência (sinal, avulso, plano) volta a contar uma parcela excluída como se ainda existisse.

## 6. Decisões do time (registradas para a implementação)

- **Escopo por status**: qualquer status pode ser excluído por este fluxo (`pending`, `overdue`, `partial`, `paid`) — não só `paid`/`partial` como numa versão anterior deste documento.
- **Motivo**: sempre obrigatório, para qualquer status — inclusive `pending`, que hoje é removido sem motivo. Sem tamanho mínimo, só não pode ser vazio/espaço.
- **Permissão**: `ActionCode.FINANCIAL_DELETE` para a ação de excluir, em qualquer status — não `ORDERS_DELETE`/`ORDERS_UPDATE`. O editar (`pending` apenas) continua em `ORDERS_UPDATE`/`canUpdate`, sem mudança.
