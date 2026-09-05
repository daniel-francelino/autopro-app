<script setup lang="ts">
import {
  formatCurrency,
  formatCommissionRuleSublabel,
  PAYMENT_STATUS_COLOR,
  PAYMENT_STATUS_ICON,
  PAYMENT_STATUS_LABEL,
  STATUS_COLOR,
  STATUS_ICON,
  STATUS_LABEL,
  type ServiceOrderCommissionEstimate,
  type ServiceOrderItemCommissionEntry,
  computeServiceOrderCommissionBreakdown
} from '../../utils/service-orders'
import {
  getActiveOverridePlanIds,
  resolveEffectiveCommissionRules
} from '../../../lib/utils/employee-commission-engine'
import type {
  ServiceOrderDraftItem,
  ServiceOrderItem,
  ServiceOrderRaw,
  ServiceOrderSelectedTax
} from '../../types/service-orders'
import type { EmployeeCommissionDisplay } from './create/ResponsiblesCard.vue'
import type { ItemCommissionDisplayDetail } from './create/ItemsCard.vue'

const props = defineProps<{
  open: boolean
  orderToEdit?: ServiceOrderRaw | null
  orderToEditClientLabel?: string | null
  orderToEditVehicleLabel?: string | null
}>()

const emit = defineEmits<{
  'update:open': [v: boolean]
  'created': []
  'updated': []
}>()

interface SelectOption {
  label: string
  value: string
}

interface EmployeeItem {
  id: string
  name: string
}

interface MasterProductItem {
  id: string
  name: string
  description: string | null
  notes: string | null
}

interface TaxItem {
  id: string
  name: string
  type: string
  rate: number
}

interface FormData {
  number: string
  status: string
  client_id: string
  vehicle_id: string
  master_product_id: string
  responsible_employees: string[]
  entry_date: string | undefined
  expected_date: string | undefined
  reported_defect: string
  diagnosis: string
  notes: string
  items: ServiceOrderDraftItem[]
  discount: number | string
  apply_taxes: boolean
  selected_tax_ids: string[]
  create_appointment: boolean
  appointment_date: string | undefined
  appointment_time: string
  appointment_priority: string
  appointment_notes: string
}

const APPOINTMENT_NO_PRIORITY = 'none'

const appointmentPriorityMeta: Record<
  string,
  { label: string, icon: string, color: 'neutral' | 'info' | 'warning' }
> = {
  [APPOINTMENT_NO_PRIORITY]: {
    label: 'Sem prioridade',
    icon: 'i-lucide-minus',
    color: 'neutral'
  },
  low: { label: 'Baixa', icon: 'i-lucide-arrow-down', color: 'neutral' },
  medium: { label: 'Média', icon: 'i-lucide-equal', color: 'info' },
  high: { label: 'Alta', icon: 'i-lucide-arrow-up', color: 'warning' }
}

const toast = useToast()

const selectedClientLabel = ref<string | null>(null)
const selectedVehicleLabel = ref<string | null>(null)
const employeeCatalog = ref<EmployeeItem[]>([])
const masterProducts = ref<MasterProductItem[]>([])
const taxesCatalog = ref<TaxItem[]>([])
const productCategoriesCatalog = ref<Array<{ id: string, name: string }>>([])

const isLoadingOptions = ref(false)
const isLoadingNextNumber = ref(false)
const optionsLoaded = ref(false)
const itemCounter = ref(0)
let nextNumberRequestId = 0

// master product modals state
const masterProductEditorOpen = ref(false)
const masterProductEditorMode = ref<'create' | 'edit'>('create')
const masterProductEditorProduct = ref<MasterProductItem | null>(null)
const masterProductManagerOpen = ref(false)

const isEditMode = computed(() => !!props.orderToEdit?.id)

const paymentBadgeStatus = computed(() =>
  isEditMode.value
    ? (props.orderToEdit?.payment_status ?? 'pending')
    : 'pending'
)
const paymentBadgeLabel = computed(
  () => PAYMENT_STATUS_LABEL[paymentBadgeStatus.value] ?? 'Pagamento pendente'
)
const paymentBadgeColor = computed(
  () => PAYMENT_STATUS_COLOR[paymentBadgeStatus.value] ?? 'neutral'
)
const paymentBadgeIcon = computed(
  () => PAYMENT_STATUS_ICON[paymentBadgeStatus.value] ?? 'i-lucide-credit-card'
)

const appointmentPriorityBadge = computed(
  () =>
    appointmentPriorityMeta[form.appointment_priority]
    ?? appointmentPriorityMeta[APPOINTMENT_NO_PRIORITY]!
)

const form = reactive<FormData>({
  number: '',
  status: 'estimate',
  client_id: '',
  vehicle_id: '',
  master_product_id: '',
  responsible_employees: [],
  entry_date: new Date().toISOString().substring(0, 10),
  expected_date: '',
  reported_defect: '',
  diagnosis: '',
  notes: '',
  items: [],
  discount: '',
  apply_taxes: false,
  selected_tax_ids: [],
  create_appointment: false,
  appointment_date: '',
  appointment_time: '08:00',
  appointment_priority: APPOINTMENT_NO_PRIORITY,
  appointment_notes: ''
})

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nextItemId() {
  itemCounter.value += 1
  return `draft-item-${itemCounter.value}`
}

function createDraftItem(
  overrides: Partial<ServiceOrderDraftItem> = {}
): ServiceOrderDraftItem {
  return {
    id: nextItemId(),
    name: '',
    description: '',
    quantity: 1,
    unit_price: '',
    cost_price: '',
    source: 'manual',
    product_id: null,
    category_id: null,
    stored_commission: null,
    ...overrides
  }
}

function mapOrderItemToDraftItem(
  item: ServiceOrderItem
): ServiceOrderDraftItem {
  return createDraftItem({
    name: item.name ?? item.description ?? '',
    description: item.description ?? item.name ?? '',
    quantity: toNumber(item.quantity) || 1,
    unit_price: toNumber(item.unit_price),
    cost_price: toNumber(item.cost_price ?? item.cost_amount),
    source: item.product_id ? 'catalog' : 'manual',
    product_id: item.product_id ?? null,
    category_id: item.category_id ?? null,
    category_name: item.category_name ?? null,
    stored_commission: item.commission_total ?? item.total_commission ?? null
  })
}

function populateFormFromOrder(order: ServiceOrderRaw) {
  const selectedTaxes = (order.selected_taxes
    ?? []) as ServiceOrderSelectedTax[]

  form.number = order.number ?? ''
  form.status = order.status || 'estimate'
  form.client_id = order.client_id ?? ''
  form.vehicle_id = order.vehicle_id ?? ''
  form.master_product_id = order.master_product_id ?? ''
  form.responsible_employees = (order.responsible_employees ?? [])
    .map((r: { employee_id: string }) => r.employee_id)
    .filter(Boolean)
  form.entry_date
    = order.entry_date ?? new Date().toISOString().substring(0, 10)
  form.expected_date = order.expected_date ?? ''
  form.reported_defect = order.reported_defect ?? ''
  form.diagnosis = order.diagnosis ?? ''
  form.notes = order.notes ?? ''
  form.items = (order.items ?? []).map(mapOrderItemToDraftItem)
  form.discount = order.discount ?? ''
  form.apply_taxes = Boolean(order.apply_taxes)
  form.selected_tax_ids = selectedTaxes
    .map(t => t.tax_id ?? '')
    .filter(Boolean)
  form.create_appointment = false
  form.appointment_date = ''
  form.appointment_time = '08:00'
  form.appointment_priority = APPOINTMENT_NO_PRIORITY
  form.appointment_notes = ''
}

function getEmployeeById(employeeId: string) {
  return employeeCatalog.value.find(e => e.id === employeeId) ?? null
}

async function loadMasterProducts(force = false) {
  if (masterProducts.value.length && !force) return
  const res = await $fetch<{ items: MasterProductItem[] }>(
    '/api/master-products',
    { query: { page_size: 500 } }
  )
  masterProducts.value = res.items ?? []
}

async function backfillItemCategories() {
  const productIds = [
    ...new Set(
      form.items
        .filter(item => item.product_id && item.category_id == null)
        .map(item => item.product_id as string)
    )
  ]
  if (!productIds.length) return

  try {
    const res = await $fetch<{
      items: Array<{
        id: string
        category_id: string | null
        product_categories: { id: string, name: string } | null
      }>
    }>('/api/products', { query: { page_size: 500 } })

    const productMap = new Map(
      (res.items ?? []).map(p => [
        p.id,
        {
          category_id: p.category_id ?? null,
          category_name: p.product_categories?.name ?? null
        }
      ])
    )

    for (const item of form.items) {
      if (item.product_id && item.category_id == null) {
        const cat = productMap.get(item.product_id)
        if (cat !== undefined) {
          item.category_id = cat.category_id
          item.category_name = cat.category_name
        }
      }
    }
  } catch {
    // fail silently — commission will be calculated without category filter
  }
}

async function loadNextNumber() {
  const requestId = ++nextNumberRequestId
  isLoadingNextNumber.value = true
  try {
    const res = await $fetch<{ number: string }>(
      '/api/service-orders/next-number'
    )
    if (requestId !== nextNumberRequestId || !props.open) return
    if (!form.number.trim()) form.number = res.number ?? ''
  } catch {
    if (requestId === nextNumberRequestId && props.open) {
      toast.add({
        title: 'Não foi possível sugerir o número da OS',
        color: 'warning'
      })
    }
  } finally {
    if (requestId === nextNumberRequestId) isLoadingNextNumber.value = false
  }
}

async function loadOptions() {
  if (optionsLoaded.value || isLoadingOptions.value) return
  isLoadingOptions.value = true
  try {
    const [employeesRes, masterProductsRes, taxesRes, productCategoriesRes]
      = await Promise.all([
        $fetch<{ items: EmployeeItem[] }>('/api/employees'),
        $fetch<{ items: MasterProductItem[] }>('/api/master-products', {
          query: { page_size: 500 }
        }),
        $fetch<{ items: TaxItem[] }>('/api/taxes', {
          query: { page_size: 500, sort_by: 'name', sort_order: 'asc' }
        }),
        $fetch<{ items: Array<{ id: string, name: string }> }>('/api/product-categories')
      ])
    employeeCatalog.value = employeesRes.items ?? []
    masterProducts.value = masterProductsRes.items ?? []
    taxesCatalog.value = taxesRes.items ?? []
    productCategoriesCatalog.value = productCategoriesRes.items ?? []
    optionsLoaded.value = true
  } catch {
    toast.add({ title: 'Erro ao carregar opções', color: 'error' })
  } finally {
    isLoadingOptions.value = false
  }
}

// ─── Computed options ─────────────────────────────────────────────────────────

const employeeSelectOptions = computed<SelectOption[]>(() =>
  employeeCatalog.value.map(e => ({ label: e.name, value: e.id }))
)

const selectedMasterProductRef = ref<MasterProductItem | null>(null)

const selectedMasterProduct = computed(
  () =>
    selectedMasterProductRef.value?.id === form.master_product_id
      ? selectedMasterProductRef.value
      : (masterProducts.value.find(p => p.id === form.master_product_id) ?? null)
)

// ─── Normalized items + totals ────────────────────────────────────────────────

const normalizedItems = computed(() =>
  form.items
    .map((item) => {
      const quantity = Math.max(toNumber(item.quantity), 0)
      const unitPrice = Math.max(toNumber(item.unit_price), 0)
      const costPrice = Math.max(toNumber(item.cost_price), 0)
      const description = item.description.trim() || item.name.trim()
      const name = item.name.trim() || description
      return {
        id: item.id,
        name,
        description,
        quantity,
        unit_price: unitPrice,
        total_price: quantity * unitPrice,
        cost_price: costPrice,
        product_id: item.product_id || null,
        category_id: item.category_id || null,
        category_name: item.category_name || null
      }
    })
    .filter(item => item.description && item.quantity > 0)
)

const subtotal = computed(() =>
  normalizedItems.value.reduce((total, item) => total + item.total_price, 0)
)

const totalCost = computed(() =>
  normalizedItems.value.reduce(
    (total, item) => total + item.cost_price * item.quantity,
    0
  )
)

const discountValue = computed(() => Math.max(toNumber(form.discount), 0))

const totalAmount = computed(() =>
  Math.max(subtotal.value - discountValue.value, 0)
)

const selectedTaxes = computed(() => {
  if (!form.apply_taxes) return []
  return taxesCatalog.value
    .filter(tax => form.selected_tax_ids.includes(tax.id))
    .map(tax => ({
      tax_id: tax.id,
      name: tax.name,
      type: tax.type,
      rate: toNumber(tax.rate),
      calculated_amount: (totalAmount.value * toNumber(tax.rate)) / 100
    }))
})

const totalTaxesAmount = computed(() =>
  selectedTaxes.value.reduce((total, tax) => total + tax.calculated_amount, 0)
)

// ─── Commission calculation ───────────────────────────────────────────────────
// Step 8 cutover (docs/finance/commissions-step8-engine-cutover.md §7.1):
// fetch each responsible employee's new-model rules, keyed by the order's
// own entry_date, and feed them to computeServiceOrderCommissionBreakdown —
// which uses them when present, falling back to the legacy employees.*
// fields otherwise.
const { rulesByEmployeeId, ensureRules } = useEmployeeCommissionRules()
// Manual commission override (docs/finance/commissions-manual-override.md):
// editing an order that already has an active override needs its live
// preview to reflect it too, or the numbers shown while editing would
// disagree with what actually gets saved (server/api/service-orders
// resolves the override on save regardless of what this preview shows).
const { rulesByPlanId, ensureRules: ensurePlanRules } = usePlanCommissionRules()

watch(
  [() => form.responsible_employees, () => form.entry_date],
  ([responsibleEmployeeIds, entryDate]) => {
    const referenceDate = entryDate || new Date().toISOString().substring(0, 10)
    ensureRules(responsibleEmployeeIds, referenceDate)
    ensurePlanRules(getActiveOverridePlanIds(props.orderToEdit?.commission_manual_adjustments_log ?? []), referenceDate)
  },
  { immediate: true, deep: true }
)

const commissionOrderInput = computed(
  () =>
    ({
      items: normalizedItems.value,
      responsible_employees: form.responsible_employees
        .filter(Boolean)
        .map(employeeId => ({ employee_id: employeeId })),
      total_amount: totalAmount.value,
      total_cost_amount: totalCost.value,
      total_taxes_amount: totalTaxesAmount.value,
      discount: discountValue.value,
      commission_manual_adjustments_log: props.orderToEdit?.commission_manual_adjustments_log ?? []
    }) as ServiceOrderRaw
)

const commissionBreakdown = computed(() =>
  computeServiceOrderCommissionBreakdown(
    commissionOrderInput.value,
    rulesByEmployeeId.value,
    rulesByPlanId.value
  )
)

/** Same patch-over-standard resolution computeServiceOrderCommissionBreakdown() applies internally — recomputed here so the "Regras" popover can show exactly which rules are driving the amount (docs/finance/commissions-manual-override.md). */
const effectiveRulesByEmployeeId = computed(() =>
  resolveEffectiveCommissionRules(
    rulesByEmployeeId.value,
    commissionOrderInput.value.commission_manual_adjustments_log ?? [],
    rulesByPlanId.value
  )
)

const categoryNameById = computed(() => new Map(productCategoriesCatalog.value.map(c => [c.id, c.name])))

const itemCommissionDetail = computed(() => {
  const detail = new Map<string, ServiceOrderItemCommissionEntry>()

  normalizedItems.value.forEach((item, index) => {
    detail.set(
      item.id,
      commissionBreakdown.value.byItemIndex.get(index) ?? {
        total: 0,
        commissions: []
      }
    )
  })

  return detail
})

const itemCommissionMap = computed(() => {
  const map = new Map<string, number>()
  for (const [itemId, { total }] of itemCommissionDetail.value)
    map.set(itemId, total)
  return map
})

const itemCommissionDisplayDetailMap = computed(() => {
  const map = new Map<string, ItemCommissionDisplayDetail>()
  normalizedItems.value.forEach((normalizedItem, index) => {
    const entry = commissionBreakdown.value.byItemIndex.get(index) ?? {
      total: 0,
      commissions: []
    }
    map.set(normalizedItem.id, {
      total: entry.total,
      lines: entry.commissions
        .filter(c => c.amount > 0)
        .map((c) => {
          const emp = getEmployeeById(c.employee_id)
          return {
            label: emp?.name ?? 'Funcionário',
            sublabel: formatCommissionRuleSublabel(c),
            amount: c.amount
          }
        })
    })
  })
  return map
})

const normalizedItemsWithCommission = computed(() =>
  normalizedItems.value.map((item) => {
    const { id: _id, ...itemWithoutId } = item
    const detail = itemCommissionDetail.value.get(item.id)
    const commissionTotal = detail?.total ?? 0
    return {
      ...itemWithoutId,
      total_price: item.total_price,
      total_amount: item.total_price,
      cost_price: item.cost_price,
      cost_amount: item.cost_price,
      commission_total: commissionTotal,
      total_commission: commissionTotal,
      commissions: detail?.commissions ?? []
    }
  })
)

function computeResponsibleCommission(
  employee: EmployeeItem | null
): ServiceOrderCommissionEstimate {
  if (!employee?.id) return { value: 0, hasMatchingItems: true }

  return (
    commissionBreakdown.value.byEmployeeId.get(employee.id) ?? {
      value: 0,
      hasMatchingItems: true
    }
  )
}

const storedCommissionByEmployee = computed(() => {
  if (!props.orderToEdit?.items) return new Map<string, number>()
  const map = new Map<string, number>()
  for (const item of props.orderToEdit.items) {
    for (const c of item.commissions ?? []) {
      if (c.employee_id) {
        map.set(
          c.employee_id,
          (map.get(c.employee_id) ?? 0) + Number(c.amount ?? 0)
        )
      }
    }
  }
  return map
})

function getStoredCommissionForEmployee(employeeId: string) {
  return storedCommissionByEmployee.value.get(employeeId) ?? 0
}

const totalCommissionAmount = computed(() =>
  form.responsible_employees.reduce((total, employeeId) => {
    const employee = getEmployeeById(employeeId)
    const fresh = computeResponsibleCommission(employee).value
    if (fresh > 0) return total + fresh
    return total + getStoredCommissionForEmployee(employeeId)
  }, 0)
)

const estimatedProfit = computed(
  () =>
    totalAmount.value
    - totalCost.value
    - totalTaxesAmount.value
    - totalCommissionAmount.value
)

// ─── Employee commission display (for ResponsiblesCard) ───────────────────────

const employeeCommissionsDisplay = computed<
  Record<string, EmployeeCommissionDisplay>
>(() => {
  const result: Record<string, EmployeeCommissionDisplay> = {}
  for (const employeeId of form.responsible_employees) {
    if (!employeeId) continue
    const employee = getEmployeeById(employeeId)
    const fresh = computeResponsibleCommission(employee)
    const stored = getStoredCommissionForEmployee(employeeId)
    const commissionValue = fresh.value > 0 ? fresh.value : stored

    // Step 10 (docs/finance/commissions-configuration-architecture.md):
    // commission is resolved exclusively through the new model now — an
    // employee has no single rate/base to show (it varies per rule/category),
    // so rateLabel/baseLabel are gone and the note always reflects whether
    // this employee has an active plan, same as detail/OSResponsiblesCard.vue.
    const hasCommissionPlan = (rulesByEmployeeId.value.get(employeeId)?.length ?? 0) > 0

    const note: EmployeeCommissionDisplay['note'] = hasCommissionPlan
      ? (!fresh.hasMatchingItems
          ? { label: 'Sem itens elegíveis', color: 'warning', icon: 'i-lucide-triangle-alert' }
          : { label: 'Por regra/categoria', color: 'primary', icon: 'i-lucide-list-checks' })
      : { label: 'Sem comissão', color: 'neutral', icon: 'i-lucide-circle-off' }

    const itemBreakdown = normalizedItems.value
      .map((normalizedItem) => {
        const detail = itemCommissionDetail.value.get(normalizedItem.id)
        const c = detail?.commissions.find(
          commission => commission.employee_id === employeeId
        )
        if (!c || c.amount <= 0) return null
        return {
          label: normalizedItem.description || normalizedItem.name,
          sublabel: formatCommissionRuleSublabel(c),
          amount: c.amount
        }
      })
      .filter(Boolean) as { label: string, sublabel: string, amount: number }[]

    result[employeeId] = {
      commissionLabel: formatCurrency(commissionValue),
      note,
      hasInfo: !!employee || stored > 0,
      itemBreakdown,
      rules: effectiveRulesByEmployeeId.value.get(employeeId) ?? []
    }
  }
  return result
})

// ─── Item actions ─────────────────────────────────────────────────────────────

function addManualItem() {
  form.items.push(createDraftItem())
}

interface ProductGroupItem {
  description?: string | null
  quantity: number
  cost_price: number
  sale_price: number
}
interface ProductCatalogItem {
  id: string
  name: string
  type: 'unit' | 'group'
  category_id?: string | null
  product_categories?: { id: string, name: string } | null
  unit_sale_price: number | null
  unit_cost_price: number | null
  group_items?: ProductGroupItem[] | null
}

function addProductItem(product: ProductCatalogItem) {
  if (product.type === 'group' && product.group_items?.length) {
    for (const groupItem of product.group_items) {
      form.items.push(
        createDraftItem({
          name: groupItem.description || product.name,
          description: groupItem.description || product.name,
          quantity: toNumber(groupItem.quantity) || 1,
          unit_price: toNumber(groupItem.sale_price),
          cost_price: toNumber(groupItem.cost_price),
          source: 'catalog',
          product_id: product.id,
          category_id: product.category_id ?? null,
          category_name: product.product_categories?.name ?? null
        })
      )
    }
  } else {
    form.items.push(
      createDraftItem({
        name: product.name,
        description: product.name,
        quantity: 1,
        unit_price: toNumber(product.unit_sale_price),
        cost_price: toNumber(product.unit_cost_price),
        source: 'catalog',
        product_id: product.id,
        category_id: product.category_id ?? null,
        category_name: product.product_categories?.name ?? null
      })
    )
  }
}

function removeItem(itemId: string) {
  form.items = form.items.filter(item => item.id !== itemId)
}

function setItemQuantity(item: ServiceOrderDraftItem, value: string | number) {
  const nextValue = Number(value)
  item.quantity = Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 0
}

// ─── Responsible actions ──────────────────────────────────────────────────────

function addResponsible() {
  if (
    employeeCatalog.value.length > 0
    && form.responsible_employees.filter(Boolean).length
    >= employeeCatalog.value.length
  ) {
    toast.add({
      title: 'Todos os responsáveis já foram adicionados',
      color: 'warning'
    })
    return
  }
  form.responsible_employees.push('')
}

function updateResponsible(index: number, employeeId: string) {
  if (
    employeeId
    && form.responsible_employees.some((id, i) => i !== index && id === employeeId)
  ) {
    toast.add({
      title: 'Responsável já selecionado',
      description: 'Escolha outro funcionário para esta OS.',
      color: 'warning'
    })
    return
  }
  form.responsible_employees[index] = employeeId
}

function removeResponsible(index: number) {
  form.responsible_employees.splice(index, 1)
}

// ─── Master product handlers ──────────────────────────────────────────────────

function openMasterProductCreate() {
  masterProductEditorMode.value = 'create'
  masterProductEditorProduct.value = null
  masterProductManagerOpen.value = false
  masterProductEditorOpen.value = true
}

function openMasterProductEdit(product: MasterProductItem) {
  masterProductEditorMode.value = 'edit'
  masterProductEditorProduct.value = product
  masterProductManagerOpen.value = false
  masterProductEditorOpen.value = true
}

function onSelectMasterProduct(product: MasterProductItem) {
  selectedMasterProductRef.value = product
}

function onClearMasterProduct() {
  form.master_product_id = ''
  selectedMasterProductRef.value = null
}

async function onMasterProductSaved(product: MasterProductItem) {
  await loadMasterProducts(true)
  if (masterProductEditorMode.value === 'create') {
    form.master_product_id = product.id
    selectedMasterProductRef.value = product
  }
}

async function onMasterProductDeleted(id: string) {
  await loadMasterProducts(true)
  if (form.master_product_id === id) {
    form.master_product_id = ''
    selectedMasterProductRef.value = null
  }
}

// ─── Watchers ─────────────────────────────────────────────────────────────────

watch(
  () => props.open,
  (opened) => {
    if (opened) {
      resetForm()
      loadOptions()
      if (isEditMode.value && props.orderToEdit) {
        populateFormFromOrder(props.orderToEdit)
        selectedClientLabel.value = props.orderToEditClientLabel ?? null
        selectedVehicleLabel.value = props.orderToEditVehicleLabel ?? null
        backfillItemCategories()
      } else {
        loadNextNumber()
      }
    } else {
      nextNumberRequestId += 1
      isLoadingNextNumber.value = false
    }
  }
)

interface ClientRecord { id: string, name: string }
interface VehicleRecord { id: string, brand: string | null, model: string | null, license_plate: string | null }

function onSelectClient(client: ClientRecord) {
  selectedClientLabel.value = client.name
  if (form.vehicle_id) {
    form.vehicle_id = ''
    selectedVehicleLabel.value = null
  }
}

function onClearClient() {
  selectedClientLabel.value = null
}

function onSelectVehicle(vehicle: VehicleRecord) {
  selectedVehicleLabel.value
    = [vehicle.brand, vehicle.model, vehicle.license_plate].filter(Boolean).join(' - ') || null
}

function onClearVehicle() {
  selectedVehicleLabel.value = null
}

watch(
  () => form.create_appointment,
  (enabled) => {
    if (!enabled) return
    if (!form.appointment_date) form.appointment_date = form.entry_date
    if (!form.appointment_time) form.appointment_time = '08:00'
  }
)

// ─── Form reset ───────────────────────────────────────────────────────────────

function resetForm() {
  itemCounter.value = 0
  selectedMasterProductRef.value = null
  selectedClientLabel.value = null
  selectedVehicleLabel.value = null
  form.number = ''
  form.status = 'estimate'
  form.client_id = ''
  form.vehicle_id = ''
  form.master_product_id = ''
  form.responsible_employees = []
  form.entry_date = new Date().toISOString().substring(0, 10)
  form.expected_date = ''
  form.reported_defect = ''
  form.diagnosis = ''
  form.notes = ''
  form.items = []
  form.discount = ''
  form.apply_taxes = false
  form.selected_tax_ids = []
  form.create_appointment = false
  form.appointment_date = ''
  form.appointment_time = '08:00'
  form.appointment_priority = APPOINTMENT_NO_PRIORITY
  form.appointment_notes = ''
}

// ─── Submit ───────────────────────────────────────────────────────────────────

const isSaving = ref(false)

async function submit() {
  if (isSaving.value) return

  if (!isEditMode.value && form.create_appointment) {
    if (!form.client_id) {
      toast.add({
        title: 'Selecione um cliente para agendar',
        color: 'warning'
      })
      return
    }
    if (!form.vehicle_id) {
      toast.add({
        title: 'Selecione um veículo para agendar',
        color: 'warning'
      })
      return
    }
    if (!form.appointment_date) {
      toast.add({
        title: 'Data do agendamento é obrigatória',
        color: 'warning'
      })
      return
    }
    if (!form.appointment_time) {
      toast.add({
        title: 'Horário do agendamento é obrigatório',
        color: 'warning'
      })
      return
    }
  }

  isSaving.value = true
  try {
    interface CreateResponse {
      duplicateNumber?: boolean
      suggestedNumber?: string
    }

    const res = await $fetch<CreateResponse>('/api/service-orders', {
      method: 'POST',
      body: {
        orderId: isEditMode.value ? props.orderToEdit?.id : undefined,
        orderData: {
          number: form.number || undefined,
          status: form.status,
          payment_status: isEditMode.value
            ? (props.orderToEdit?.payment_status ?? 'pending')
            : 'pending',
          client_id: form.client_id || null,
          vehicle_id: form.vehicle_id || null,
          master_product_id: form.master_product_id || null,
          appointment_id: isEditMode.value
            ? (props.orderToEdit?.appointment_id ?? null)
            : null,
          responsible_employees: form.responsible_employees
            .filter(Boolean)
            .map(id => ({ employee_id: id })),
          entry_date:
            form.entry_date || new Date().toISOString().substring(0, 10),
          expected_date: form.expected_date || null,
          reported_defect: form.reported_defect || null,
          diagnosis: form.diagnosis || null,
          notes: form.notes || null,
          items: normalizedItemsWithCommission.value,
          apply_taxes: form.apply_taxes,
          selected_taxes: selectedTaxes.value,
          total_taxes_amount: totalTaxesAmount.value,
          total_amount: totalAmount.value,
          total_cost_amount: totalCost.value,
          discount: discountValue.value,
          commission_amount: totalCommissionAmount.value
        },
        appointmentData:
          !isEditMode.value && form.create_appointment
            ? {
                appointment_date: form.appointment_date,
                time: form.appointment_time,
                service_type: form.reported_defect || 'Serviço da OS',
                priority:
                  form.appointment_priority !== APPOINTMENT_NO_PRIORITY
                    ? form.appointment_priority
                    : null,
                notes: form.appointment_notes || null
              }
            : null
      }
    })

    if (res?.duplicateNumber) {
      toast.add({
        title: 'Número já existe',
        description: `Sugestão: ${res.suggestedNumber}`,
        color: 'warning'
      })
      form.number = res.suggestedNumber ?? ''
      return
    }

    toast.add({
      title: isEditMode.value
        ? 'OS atualizada com sucesso'
        : 'OS criada com sucesso',
      color: 'success'
    })
    emit('update:open', false)
    if (isEditMode.value) emit('updated')
    else emit('created')
  } catch (error: unknown) {
    const err = error as {
      data?: { statusMessage?: string }
      statusMessage?: string
    }
    toast.add({
      title: isEditMode.value ? 'Erro ao atualizar OS' : 'Erro ao criar OS',
      description:
        err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :ui="{
      overlay: 'bg-default/90 backdrop-blur-sm',
      content:
        'max-w-none w-screen h-dvh rounded-none flex flex-col overflow-hidden sm:max-h-[100dvh] max-h-[100dvh]',
      header: 'p-0 shrink-0 border-b border-default',
      body: 'flex-1 min-h-0 overflow-y-auto p-0',
      footer:
        'p-0 shrink-0 border-t border-default bg-default/95 backdrop-blur'
    }"
    @update:open="emit('update:open', $event)"
  >
    <template #header>
      <div class="flex w-full justify-between gap-4 p-4 lg:px-6 lg:py-5">
        <div class="min-w-0 flex-1 space-y-4">
          <div
            class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between"
          >
            <div class="space-y-1.5">
              <p
                class="font-semibold uppercase tracking-[0.22em] text-primary/80"
              >
                {{
                  isEditMode
                    ? "Editar Ordem de Serviço"
                    : "Nova Ordem de Serviço"
                }}
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <UBadge
                :label="STATUS_LABEL[form.status] ?? 'Status'"
                :leading-icon="
                  STATUS_ICON[form.status] ?? 'i-lucide-circle-dot'
                "
                :color="STATUS_COLOR[form.status] ?? 'neutral'"
                variant="subtle"
                class="px-3 py-1"
              />
              <UBadge
                :color="paymentBadgeColor"
                variant="outline"
                :leading-icon="paymentBadgeIcon"
                :label="paymentBadgeLabel"
                class="px-3 py-1"
              />
              <UBadge
                v-if="form.apply_taxes && selectedTaxes.length"
                color="warning"
                variant="outline"
                leading-icon="i-lucide-percent"
                :label="`${selectedTaxes.length} imposto${selectedTaxes.length > 1 ? 's' : ''}`"
                class="px-3 py-1"
              />
              <UBadge
                v-if="!isEditMode && form.create_appointment"
                :color="appointmentPriorityBadge.color"
                variant="outline"
                :leading-icon="appointmentPriorityBadge.icon"
                label="Agendamento ativo"
                class="px-3 py-1"
              />
            </div>
          </div>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          square
          @click="emit('update:open', false)"
        />
      </div>
    </template>

    <template #body>
      <div v-if="isLoadingOptions" class="space-y-6 p-4 lg:p-6">
        <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <USkeleton class="h-80 w-full rounded-2xl" />
          <USkeleton class="h-80 w-full rounded-2xl" />
          <USkeleton class="h-72 w-full rounded-2xl" />
          <USkeleton class="h-72 w-full rounded-2xl" />
        </div>
        <USkeleton class="h-[26rem] w-full rounded-2xl" />
      </div>

      <form v-else class="space-y-6 p-4 lg:p-6" @submit.prevent="submit">
        <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div class="space-y-6">
            <ServiceOrdersCreateBasicInfoCard
              v-model:number="form.number"
              v-model:status="form.status"
              v-model:client-id="form.client_id"
              v-model:vehicle-id="form.vehicle_id"
              v-model:master-product-id="form.master_product_id"
              v-model:entry-date="form.entry_date"
              v-model:expected-date="form.expected_date"
              :client-selected-label="selectedClientLabel"
              :vehicle-selected-label="selectedVehicleLabel"
              :selected-master-product="selectedMasterProduct"
              :is-loading-next-number="isLoadingNextNumber"
              @select-client="onSelectClient"
              @clear-client="onClearClient"
              @select-vehicle="onSelectVehicle"
              @clear-vehicle="onClearVehicle"
              @select-master-product="onSelectMasterProduct"
              @clear-master-product="onClearMasterProduct"
              @open-master-product-editor="openMasterProductCreate"
              @open-master-product-manager="masterProductManagerOpen = true"
            />

            <ServiceOrdersCreateResponsiblesCard
              :model-value="form.responsible_employees"
              :employee-options="employeeSelectOptions"
              :employee-commissions="employeeCommissionsDisplay"
              :category-name-by-id="categoryNameById"
              :total-commission-amount="totalCommissionAmount"
              @add="addResponsible"
              @remove="removeResponsible"
              @update="updateResponsible"
            />
          </div>

          <div class="space-y-6">
            <ServiceOrdersCreateServiceCard
              v-model:reported-defect="form.reported_defect"
              v-model:diagnosis="form.diagnosis"
              v-model:notes="form.notes"
            />

            <ServiceOrdersCreateSettingsCard
              v-model:apply-taxes="form.apply_taxes"
              v-model:selected-tax-ids="form.selected_tax_ids"
              v-model:create-appointment="form.create_appointment"
              v-model:appointment-date="form.appointment_date"
              v-model:appointment-time="form.appointment_time"
              v-model:appointment-priority="form.appointment_priority"
              v-model:appointment-notes="form.appointment_notes"
              :taxes-catalog="taxesCatalog"
              :selected-taxes="selectedTaxes"
              :total-taxes-amount="totalTaxesAmount"
              :is-edit-mode="isEditMode"
            />
          </div>
        </div>

        <div
          class="grid grid-cols-1 gap-6"
        >
          <ServiceOrdersCreateItemsCard
            :items="form.items"
            :item-commission-map="itemCommissionMap"
            :item-commission-detail-map="itemCommissionDisplayDetailMap"
            @add-manual="addManualItem"
            @add-product="addProductItem"
            @remove="removeItem"
            @set-quantity="setItemQuantity"
          />

          <ServiceOrdersCreateFinancialSummaryCard
            v-model:discount="form.discount"
            :subtotal="subtotal"
            :total-cost="totalCost"
            :total-taxes-amount="totalTaxesAmount"
            :total-commission-amount="totalCommissionAmount"
            :total-amount="totalAmount"
            :estimated-profit="estimatedProfit"
          />
        </div>
      </form>
    </template>

    <template #footer>
      <div
        class="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-end lg:px-6"
      >
        <div class="flex items-center justify-end gap-3">
          <UButton
            label="Cancelar"
            icon="i-lucide-x"
            color="neutral"
            variant="outline"
            @click="emit('update:open', false)"
          />
          <UButton
            :label="isEditMode ? 'Salvar alterações' : 'Criar OS'"
            :icon="isEditMode ? 'i-lucide-save' : 'i-lucide-plus'"
            :loading="isSaving"
            @click="submit"
          />
        </div>
      </div>
    </template>
  </UModal>

  <ServiceOrdersCreateMasterProductEditor
    v-model:open="masterProductEditorOpen"
    :mode="masterProductEditorMode"
    :edit-product="masterProductEditorProduct"
    @saved="onMasterProductSaved"
  />

  <ServiceOrdersCreateMasterProductManager
    v-model:open="masterProductManagerOpen"
    :products="masterProducts"
    :selected-master-product-id="form.master_product_id"
    @select="
      (id) => {
        form.master_product_id = id;
      }
    "
    @open-create="openMasterProductCreate"
    @open-edit="openMasterProductEdit"
    @deleted="onMasterProductDeleted"
  />
</template>
