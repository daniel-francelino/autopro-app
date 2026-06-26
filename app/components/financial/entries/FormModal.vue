<script setup lang="ts">
import { addMonths, format, parseISO } from 'date-fns'

type Entry = Record<string, unknown>
type BankAccountItem = {
  id: string
  account_name: string
  bank_name?: string | null
}
type CategoryItem = { id: string, name: string, type: 'income' | 'expense', icon: string, color: string, is_default: boolean }
type CategoryResponse = {
  defaults: CategoryItem[]
  custom: CategoryItem[]
}

const props = defineProps<{
  open: boolean
  entry: Entry | null
  bankAccountOptions: BankAccountItem[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const toast = useToast()
const isSaving = ref(false)
const showCategoryModal = ref(false)
const showRecurringDialog = ref(false)
const pendingPayload = ref<Record<string, unknown> | null>(null)

const NO_BANK_ACCOUNT = '__none__'
const NO_RECURRENCE = '__none__'

// ── Normalize helpers ──────────────────────────────────────────────────────────

function normalizeStatus(value: unknown) {
  const v = String(value || '')
    .trim()
    .toLowerCase()
  if (v === 'pago') return 'paid'
  if (v === 'pendente') return 'pending'
  return ['paid', 'pending'].includes(v) ? v : 'pending'
}

function normalizeRecurrence(value: unknown) {
  const v = String(value || '')
    .trim()
    .toLowerCase()
  if (!v || ['null', 'none', 'nao_recorrente', NO_RECURRENCE].includes(v))
    return NO_RECURRENCE
  if (v === 'mensal' || v === 'monthly') return 'monthly'
  if (v === 'anual' || v === 'annual') return 'yearly'
  if (v === 'semanal') return 'weekly'
  return ['monthly', 'yearly', 'weekly'].includes(v) ? v : NO_RECURRENCE
}

function recurrenceForApi(value: string) {
  if (value === NO_RECURRENCE) return null
  if (value === 'monthly') return 'monthly'
  if (value === 'yearly') return 'annual'
  return null
}

// ── Categories ─────────────────────────────────────────────────────────────────

const categoriesLoading = ref(false)
const defaultCategories = ref<CategoryItem[]>([])
const customCategories = ref<CategoryItem[]>([])

async function fetchCategories() {
  categoriesLoading.value = true
  try {
    const res = await $fetch<CategoryResponse>('/api/financial/categories')
    defaultCategories.value = res.defaults
    customCategories.value = res.custom
  } catch {
    // keep empty on error
  } finally {
    categoriesLoading.value = false
  }
}

const categoryOptions = computed(() => {
  const currentType = form.type
  const fromDefaults = defaultCategories.value
    .filter(d => d.type === currentType)
    .map(d => ({ label: d.name, value: d.id, icon: d.icon }))
  const fromCustom = customCategories.value
    .filter(c => c.type === currentType)
    .map(c => ({ label: c.name, value: c.id, icon: c.icon }))
  return [...fromDefaults, ...fromCustom]
})

// ── Installments ───────────────────────────────────────────────────────────────

interface Installment {
  number: number
  amount: number
  due_date: string
  status: string
}

const installmentCountOptions = Array.from({ length: 23 }, (_, i) => ({
  label: `${i + 2}x`,
  value: i + 2
}))

const installmentStatusOptions = [
  { label: 'Pendente', value: 'pending' },
  { label: 'Pago', value: 'paid' }
]

// Editable installments list (reactive, user can change each row)
const editableInstallments = ref<Installment[]>([])

function generateInstallments(
  totalAmount: number,
  count: number,
  firstDate: string,
  firstStatus: string
): Installment[] {
  if (!totalAmount || !count || !firstDate) return []
  const base = Math.floor((totalAmount * 100) / count) / 100
  const remainder = Math.round((totalAmount - base * count) * 100) / 100
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    amount: i === 0 ? base + remainder : base,
    due_date: format(addMonths(parseISO(firstDate), i), 'yyyy-MM-dd'),
    status: i === 0 ? firstStatus : 'pending'
  }))
}

function regenerateInstallments() {
  const amount = Number(form.amount) || 0
  const count = form.installment_count || 2
  if (!amount || !form.due_date) {
    editableInstallments.value = []
    return
  }
  editableInstallments.value = generateInstallments(
    amount,
    count,
    form.due_date,
    form.status
  )
}

// ── Form state ─────────────────────────────────────────────────────────────────

const form = reactive({
  description: '',
  amount: '' as string | number,
  due_date: '',
  type: 'expense' as 'income' | 'expense',
  status: 'pending',
  category_id: '',
  bank_account_id: NO_BANK_ACCOUNT,
  notes: '',
  recurrence: NO_RECURRENCE,
  recurrence_end_date: '',
  is_installment: false,
  installment_count: 2,
  is_editing_installment: false
})

// Regenrate when checkbox is toggled on, or when count/amount/date/status changes
watch(
  () =>
    [
      form.is_installment,
      form.installment_count,
      form.amount,
      form.due_date,
      form.status
    ] as const,
  ([checked]) => {
    if (checked && !isEditing.value) {
      regenerateInstallments()
    } else {
      editableInstallments.value = []
    }
  }
)

function addInstallment() {
  const last
    = editableInstallments.value[editableInstallments.value.length - 1]
  const nextDate = last
    ? format(addMonths(parseISO(last.due_date), 1), 'yyyy-MM-dd')
    : form.due_date || format(new Date(), 'yyyy-MM-dd')
  editableInstallments.value.push({
    number: editableInstallments.value.length + 1,
    amount: 0,
    due_date: nextDate,
    status: 'pending'
  })
  form.installment_count = editableInstallments.value.length
}

function removeInstallment(index: number) {
  if (editableInstallments.value.length <= 1) return
  editableInstallments.value.splice(index, 1)
  editableInstallments.value.forEach((inst, i) => {
    inst.number = i + 1
  })
  form.installment_count = editableInstallments.value.length
}

const installmentTotal = computed(() =>
  editableInstallments.value.reduce(
    (sum, inst) => sum + (Number(inst.amount) || 0),
    0
  )
)
const installmentOriginalAmount = computed(() => Number(form.amount) || 0)
const installmentTotalsMatch = computed(
  () =>
    Math.abs(installmentOriginalAmount.value - installmentTotal.value) < 0.015
)

const isEditing = computed(() => Boolean(props.entry?.id))

// Only monthly/yearly are treated as recurring series (weekly is not managed as a series)
const isEditingRecurring = computed(() => {
  if (!props.entry) return false
  const rec = String(props.entry.recurrence || '').toLowerCase()
  const hasParent
    = Boolean(props.entry.recurring_parent_id)
      || Boolean(props.entry.parent_recurrence_id)
  const isRecurring = ['mensal', 'anual', 'monthly', 'yearly'].includes(rec)
  return hasParent || isRecurring
})

watch(
  () => props.open,
  (open) => {
    if (!open) {
      editableInstallments.value = []
      return
    }
    fetchCategories()

    if (props.entry) {
      const e = props.entry
      Object.assign(form, {
        description: String(e.description ?? ''),
        amount: e.amount == null ? '' : Number(e.amount),
        due_date: String(e.due_date ?? ''),
        type: String(e.type ?? 'expense') as 'income' | 'expense',
        status: normalizeStatus(e.status),
        category_id: e.category_id ? String(e.category_id) : '',
        bank_account_id: e.bank_account_id
          ? String(e.bank_account_id)
          : NO_BANK_ACCOUNT,
        notes: String(e.notes ?? ''),
        recurrence: normalizeRecurrence(e.recurrence),
        recurrence_end_date: e.recurrence_end_date
          ? String(e.recurrence_end_date)
          : '',
        is_installment: false,
        installment_count: 2,
        is_editing_installment: Boolean(e.is_installment)
      })
      return
    }

    Object.assign(form, {
      description: '',
      amount: '',
      due_date: '',
      type: 'expense',
      status: 'pending',
      category_id: '',
      bank_account_id: NO_BANK_ACCOUNT,
      notes: '',
      recurrence: NO_RECURRENCE,
      recurrence_end_date: '',
      is_installment: false,
      installment_count: 2,
      is_editing_installment: false
    })
  },
  { immediate: true }
)

// Reset category when type toggles
watch(
  () => form.type,
  () => {
    form.category_id = ''
  }
)

// ── Bank account items ─────────────────────────────────────────────────────────

const bankItems = computed(() => [
  { label: 'Não vincular a uma conta', value: NO_BANK_ACCOUNT },
  ...props.bankAccountOptions.map(a => ({
    label: `${a.account_name}${a.bank_name ? ` — ${a.bank_name}` : ''}`,
    value: a.id
  }))
])

// ── Static options ─────────────────────────────────────────────────────────────

const recurrenceOptions = [
  { label: 'Sem recorrência', value: NO_RECURRENCE },
  { label: 'Mensal', value: 'monthly' },
  { label: 'Anual', value: 'yearly' }
]

const statusOptions = [
  { label: 'Pendente', value: 'pending' },
  { label: 'Pago', value: 'paid' }
]

// ── Save logic ─────────────────────────────────────────────────────────────────

function buildBody() {
  return {
    description: form.description.trim(),
    amount: Number(form.amount),
    due_date: form.due_date,
    type: form.type,
    status: form.status,
    category_id: form.category_id,
    bank_account_id:
      form.bank_account_id === NO_BANK_ACCOUNT ? null : form.bank_account_id,
    notes: form.notes.trim() || null,
    recurrence: recurrenceForApi(form.recurrence),
    recurrence_end_date:
      form.recurrence !== NO_RECURRENCE && form.recurrence_end_date
        ? form.recurrence_end_date
        : null
  }
}

async function save() {
  if (isSaving.value) return
  if (!form.description.trim()) {
    toast.add({ title: 'Descrição obrigatória', color: 'warning' })
    return
  }
  if (!form.amount || Number(form.amount) <= 0) {
    toast.add({ title: 'Valor inválido', color: 'warning' })
    return
  }
  if (!form.due_date) {
    toast.add({ title: 'Data de vencimento obrigatória', color: 'warning' })
    return
  }
  if (!form.category_id) {
    toast.add({ title: 'Categoria obrigatória', color: 'warning' })
    return
  }

  if (
    !isEditing.value
    && form.is_installment
    && editableInstallments.value.length > 1
  ) {
    if (!installmentTotalsMatch.value) {
      toast.add({
        title: 'Total das parcelas não confere com o valor original',
        color: 'warning'
      })
      return
    }
  }

  if (isEditing.value && isEditingRecurring.value) {
    pendingPayload.value = buildBody()
    showRecurringDialog.value = true
    return
  }

  await doSave(buildBody())
}

async function doSave(
  body: Record<string, unknown>,
  recurringScope?: 'single' | 'future'
) {
  isSaving.value = true
  try {
    if (isEditing.value && props.entry?.id) {
      const entryId = String(props.entry.id)
      if (recurringScope === 'future') {
        await $fetch('/api/financial/update-recurring', {
          method: 'POST',
          body: { originalEntryId: entryId, updateData: body }
        })
      } else {
        await $fetch(`/api/financial/${entryId}`, { method: 'PUT', body })
      }
      toast.add({ title: 'Lançamento atualizado', color: 'success' })
    } else {
      if (form.is_installment && editableInstallments.value.length > 1) {
        await $fetch('/api/financial', {
          method: 'POST',
          body: {
            ...body,
            is_installment: true,
            installment_count: editableInstallments.value.length,
            installments: editableInstallments.value
          }
        })
      } else {
        await $fetch('/api/financial', { method: 'POST', body })
      }
      toast.add({ title: 'Lançamento criado', color: 'success' })
    }
    emit('update:open', false)
    emit('saved')
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

async function confirmRecurringSingle() {
  showRecurringDialog.value = false
  if (!pendingPayload.value) return
  const payload = pendingPayload.value
  pendingPayload.value = null
  await doSave(payload, 'single')
}

async function confirmRecurringFuture() {
  showRecurringDialog.value = false
  if (!pendingPayload.value) return
  const payload = pendingPayload.value
  pendingPayload.value = null
  await doSave(payload, 'future')
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
</script>

<template>
  <UModal
    :open="open"
    :title="isEditing ? 'Editar lançamento' : 'Novo lançamento'"
    :description="
      isEditing
        ? 'Atualize os dados do lançamento financeiro.'
        : 'Cadastre uma nova receita ou despesa da oficina.'
    "
    :ui="{
      body: 'overflow-y-auto max-h-[72vh]',
      overlay: 'z-30',
      content: 'z-40'
    }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <!-- Descrição -->
        <UFormField label="Descrição" required>
          <UInput
            v-model="form.description"
            class="w-full"
            placeholder="Ex: Pagamento de fornecedor, entrada de serviço..."
          />
        </UFormField>

        <!-- Tipo toggle -->
        <UFormField label="Tipo" required>
          <div
            class="flex w-full overflow-hidden rounded-lg border border-default"
          >
            <button
              type="button"
              class="flex flex-1 items-center justify-center gap-2 py-2 text-sm font-medium transition-colors focus:outline-none"
              :class="
                form.type === 'income'
                  ? 'bg-success/10 text-success'
                  : 'text-muted hover:bg-elevated'
              "
              @click="form.type = 'income'"
            >
              <UIcon name="i-lucide-trending-up" class="size-4" />
              Entrada
            </button>
            <div class="w-px bg-border" />
            <button
              type="button"
              class="flex flex-1 items-center justify-center gap-2 py-2 text-sm font-medium transition-colors focus:outline-none"
              :class="
                form.type === 'expense'
                  ? 'bg-error/10 text-error'
                  : 'text-muted hover:bg-elevated'
              "
              @click="form.type = 'expense'"
            >
              <UIcon name="i-lucide-trending-down" class="size-4" />
              Saída
            </button>
          </div>
        </UFormField>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <!-- Valor -->
          <UFormField label="Valor total" required>
            <UiCurrencyInput v-model="form.amount" class="w-full" />
          </UFormField>

          <!-- Status -->
          <UFormField label="Status">
            <USelectMenu
              v-model="form.status"
              :items="statusOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>

          <!-- Vencimento -->
          <UFormField label="1º Vencimento" required>
            <UiDatePicker v-model="form.due_date" class="w-full" />
          </UFormField>

          <!-- Conta bancária -->
          <UFormField label="Conta bancária">
            <USelectMenu
              v-model="form.bank_account_id"
              :items="bankItems"
              value-key="value"
              class="w-full"
            />
          </UFormField>

          <!-- Categoria + botão gerenciar -->
          <UFormField label="Categoria" required class="sm:col-span-2">
            <div class="flex gap-2">
              <USelectMenu
                v-model="form.category_id"
                :items="categoryOptions"
                value-key="value"
                placeholder="Selecionar categoria..."
                :loading="categoriesLoading"
                class="flex-1"
              />
              <UTooltip text="Gerenciar categorias">
                <UButton
                  icon="i-lucide-settings-2"
                  color="neutral"
                  variant="outline"
                  @click="showCategoryModal = true"
                />
              </UTooltip>
            </div>
          </UFormField>

          <!-- Recorrência -->
          <UFormField label="Recorrência">
            <USelectMenu
              v-model="form.recurrence"
              :items="recurrenceOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>

          <!-- Data encerramento recorrência -->
          <UFormField
            v-if="form.recurrence !== NO_RECURRENCE"
            label="Encerrar recorrência em"
          >
            <UiDatePicker v-model="form.recurrence_end_date" class="w-full" />
          </UFormField>
        </div>

        <!-- Parcelamento -->
        <div class="rounded-lg border border-default p-4 space-y-3">
          <!-- Aviso: já é parcelado (edição) -->
          <UAlert
            v-if="isEditing && form.is_editing_installment"
            icon="i-lucide-info"
            color="info"
            variant="soft"
            title="Este lançamento faz parte de um parcelamento"
            description="Você está editando apenas esta parcela. Para alterar as demais, edite-as individualmente."
          />

          <!-- Checkbox de parcelamento (só na criação) -->
          <template v-if="!isEditing">
            <div class="flex items-end gap-3">
              <UCheckbox
                v-model="form.is_installment"
                label="Criar lançamento parcelado?"
              />
              <UButton
                v-if="form.is_installment"
                icon="i-lucide-plus"
                label="Adicionar parcela"
                color="neutral"
                variant="outline"
                size="sm"
                @click="addInstallment"
              />
            </div>

            <template v-if="form.is_installment">
              <!-- Resumo de totais -->
              <div
                v-if="editableInstallments.length > 0"
                class="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                :class="
                  installmentTotalsMatch
                    ? 'border-success/40 bg-success/5'
                    : 'border-error/40 bg-error/5'
                "
              >
                <div class="flex items-center gap-4">
                  <span class="text-muted text-xs">Valor original:</span>
                  <span class="font-semibold text-highlighted">{{
                    formatCurrency(installmentOriginalAmount)
                  }}</span>
                  <span class="text-muted text-xs">Total das parcelas:</span>
                  <span
                    class="font-semibold"
                    :class="
                      installmentTotalsMatch ? 'text-success' : 'text-error'
                    "
                  >
                    {{ formatCurrency(installmentTotal) }}
                  </span>
                </div>
                <UIcon
                  :name="
                    installmentTotalsMatch
                      ? 'i-lucide-circle-check'
                      : 'i-lucide-circle-alert'
                  "
                  class="size-4 shrink-0"
                  :class="
                    installmentTotalsMatch ? 'text-success' : 'text-error'
                  "
                />
              </div>

              <!-- Lista editável de parcelas -->
              <div v-if="editableInstallments.length > 0" class="space-y-2">
                <p class="text-xs font-medium text-muted">
                  Detalhes das parcelas
                </p>
                <div
                  class="divide-y divide-default rounded-md border border-default"
                >
                  <div
                    v-for="(inst, index) in editableInstallments"
                    :key="inst.number"
                    class="grid grid-cols-[2rem_1fr_1fr_1fr_2rem] items-center gap-2 px-3 py-2"
                  >
                    <!-- Número -->
                    <span class="text-xs font-semibold text-muted text-center">{{ inst.number }}ª</span>

                    <!-- Valor -->
                    <UiCurrencyInput
                      v-model="inst.amount"
                      size="sm"
                      class="w-full"
                    />

                    <!-- Data -->
                    <UiDatePicker
                      v-model="inst.due_date"
                      size="sm"
                      class="w-full"
                    />

                    <!-- Status -->
                    <USelectMenu
                      v-model="inst.status"
                      :items="installmentStatusOptions"
                      value-key="value"
                      size="sm"
                      class="w-full"
                    />

                    <!-- Remover -->
                    <UButton
                      icon="i-lucide-trash-2"
                      color="error"
                      variant="ghost"
                      size="xs"
                      :disabled="editableInstallments.length <= 1"
                      @click="removeInstallment(index)"
                    />
                  </div>
                </div>
              </div>
            </template>
          </template>
        </div>

        <!-- Observações -->
        <UFormField label="Observações">
          <UTextarea v-model="form.notes" class="w-full" :rows="3" />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="Cancelar"
          color="neutral"
          variant="ghost"
          @click="emit('update:open', false)"
        />
        <UButton
          label="Salvar alterações"
          color="neutral"
          :loading="isSaving"
          :disabled="isSaving"
          @click="save"
        />
      </div>
    </template>
  </UModal>

  <!-- Dialog: edição de recorrência -->
  <UModal
    v-model:open="showRecurringDialog"
    title="Editar recorrência"
    :ui="{ overlay: 'z-40', content: 'z-50' }"
    description="Deseja alterar somente este lançamento ou aplicar as alterações também para os próximos meses desta recorrência?"
  >
    <template #footer>
      <div class="flex flex-col gap-2 w-full sm:flex-row sm:justify-end">
        <UButton
          label="Cancelar"
          color="neutral"
          variant="ghost"
          :disabled="isSaving"
          @click="showRecurringDialog = false"
        />
        <UButton
          label="Somente este"
          color="neutral"
          variant="outline"
          :loading="isSaving"
          @click="confirmRecurringSingle"
        />
        <UButton
          label="Este e os próximos"
          color="neutral"
          :loading="isSaving"
          @click="confirmRecurringFuture"
        />
      </div>
    </template>
  </UModal>

  <!-- Modal: gerenciar categorias -->
  <FinancialEntriesCategoryModal
    v-model:open="showCategoryModal"
    :current-type="form.type"
    :default-categories="defaultCategories"
    :custom-categories="customCategories"
    @updated="fetchCategories"
  />
</template>
