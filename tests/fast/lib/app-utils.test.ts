import { describe, expect, it, vi } from 'vitest'
import {
  buildMonthGrid,
  buildTimeSlots,
  buildWeekDays,
  formatCalendarTitle,
  getDayRange,
  getMonthRange,
  getWeekRange,
  isSameMonth,
  minuteFromStart,
  toISO
} from '../../../app/utils/calendar'
import {
  commissionRuleDraftsToPayload,
  createEmptyCommissionRuleDraft,
  validateCommissionRuleDrafts,
  type CommissionRuleDraft
} from '../../../app/utils/commission-rule-draft'
import { formatCategoryName, isValidHexColor } from '../../../app/utils/financial-category-options'
import {
  formatPaymentMethodLabel,
  formatDebtorStatusLabel,
  paymentMethodColor,
  paymentMethodIcon
} from '../../../app/utils/report-debtors'
import {
  canEditServiceOrder,
  formatCurrency,
  formatDate,
  formatPhone,
  formatTaxId,
  formatZipCode,
  getItemTotal,
  getNextStatus
} from '../../../app/utils/service-orders'
import { generateCode } from '../../../app/utils/index'
import { ACTION_PLAN_REQUIREMENTS, PLAN_LICENSES, PlanKey, hasPlanAccess } from '../../../app/composables/usePlans'

describe('calendar', () => {
  it('toISO uses local time', () => {
    expect(toISO(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
  it('month, week (Monday to Sunday) and day intervals', () => {
    expect(getMonthRange(new Date(2028, 1, 10))).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(getWeekRange(new Date(2026, 2, 15))).toEqual({ from: '2026-03-09', to: '2026-03-15' }) // domingo
    expect(getWeekRange(new Date(2026, 2, 9))).toEqual({ from: '2026-03-09', to: '2026-03-15' }) // segunda
    expect(getDayRange(new Date(2026, 2, 9))).toEqual({ from: '2026-03-09', to: '2026-03-09' })
  })
  it('month grid has 42 days starting on Monday', () => {
    const grid = buildMonthGrid(new Date(2026, 2, 10))
    expect(grid).toHaveLength(42)
    expect(grid[0]!.getDay()).toBe(1)
    expect(grid.some(d => isSameMonth(d, new Date(2026, 2, 1)))).toBe(true)
  })
  it('week has 7 days; day slots are 48', () => {
    expect(buildWeekDays(new Date(2026, 2, 10))).toHaveLength(7)
    const slots = buildTimeSlots()
    expect(slots).toHaveLength(48)
    expect(slots[0]).toBe('00:00')
    expect(slots[47]).toBe('23:30')
  })
  it('minuteFromStart', () => {
    expect(minuteFromStart('00:00')).toBe(0)
    expect(minuteFromStart('01:30')).toBe(144) // devolve pixels (48px por 30 min)
  })
  it('calendar title is a non-empty string', () => {
    for (const v of ['month', 'week', 'day'] as const) expect(formatCalendarTitle(new Date(2026, 2, 10), v).length).toBeGreaterThan(0)
  })
})

describe('commission-rule-draft', () => {
  const draft = (o: Partial<CommissionRuleDraft> = {}): CommissionRuleDraft => ({ ...createEmptyCommissionRuleDraft(), commissionAmount: '10', isDefault: true, ...o })

  it('empty list is invalid', () => {
    expect(validateCommissionRuleDrafts([])).toMatch(/ao menos uma regra/)
  })
  it('amount must be > 0 and percentage <= 100', () => {
    expect(validateCommissionRuleDrafts([draft({ commissionAmount: '0' })])).toMatch(/maior que zero/)
    expect(validateCommissionRuleDrafts([draft({ commissionAmount: 'abc' })])).toMatch(/maior que zero/)
    expect(validateCommissionRuleDrafts([draft({ commissionAmount: '101' })])).toMatch(/100/)
    expect(validateCommissionRuleDrafts([draft({ commissionType: 'fixed_amount', commissionAmount: '500' })])).toBeNull()
  })
  it('non-default rule needs a category; category does not repeat; only one default', () => {
    expect(validateCommissionRuleDrafts([draft({ isDefault: false })])).toMatch(/categoria/)
    expect(validateCommissionRuleDrafts([draft({ isDefault: false, categoryIds: ['a'] }), draft({ isDefault: false, categoryIds: ['a'] })])).toMatch(/repetida/)
    expect(validateCommissionRuleDrafts([draft(), draft()])).toMatch(/no máximo uma/i)
  })
  it('payload: fixed_amount loses the base; default loses the categories', () => {
    const [fixed, std] = commissionRuleDraftsToPayload([
      draft({ commissionType: 'fixed_amount', isDefault: false, categoryIds: ['c'] }),
      draft({ categoryIds: ['x'], name: '  Padrão ' })
    ])
    expect(fixed).toMatchObject({ commissionBase: null, categoryIds: ['c'], commissionAmount: 10 })
    expect(std).toMatchObject({ commissionBase: 'revenue', categoryIds: [], name: 'Padrão' })
  })
})

describe('financial-category-options', () => {
  it('hex colors', () => {
    expect(isValidHexColor('#a1B2c3')).toBe(true)
    for (const bad of ['a1b2c3', '#abc', '#gggggg', '']) expect(isValidHexColor(bad)).toBe(false)
  })
  it('formatCategoryName is display only', () => {
    expect(formatCategoryName('CUSTO FIXO')).toBe('Custo fixo')
    expect(formatCategoryName('água')).toBe('Água')
  })
})

describe('report-debtors', () => {
  it('payment methods', () => {
    expect(formatPaymentMethodLabel('pix')).toBe('Pix')
    expect(formatPaymentMethodLabel('')).toBe('Sem forma')
    expect(formatPaymentMethodLabel('vale_refeicao')).toBe('Vale Refeicao')
    expect(paymentMethodIcon('qualquer')).toBe('i-lucide-alert-circle')
    expect(paymentMethodColor('pix')).toBe('success')
    expect(paymentMethodColor('???')).toBe('error')
  })
  it('debtor status returns text', () => {
    expect(typeof formatDebtorStatusLabel('overdue')).toBe('string')
  })
})

describe('service-orders (front)', () => {
  it('canEditServiceOrder', () => {
    expect(canEditServiceOrder('open', 'pending')).toBe(true)
    expect(canEditServiceOrder('open', 'paid')).toBe(false)
    expect(canEditServiceOrder('open', 'partial')).toBe(false)
    expect(canEditServiceOrder('completed', 'pending')).toBe(true)
    expect(canEditServiceOrder('completed', 'paid')).toBe(false)
    expect(canEditServiceOrder('completed', 'partial')).toBe(false)
    expect(canEditServiceOrder('cancelled', 'pending')).toBe(false)
    expect(canEditServiceOrder(null, null)).toBe(false)
  })
  it('getNextStatus', () => {
    expect(getNextStatus('estimate')).toBe('open')
    expect(getNextStatus('open')).toBe('in_progress')
    expect(getNextStatus('in_progress')).toBe('completed')
    expect(getNextStatus('completed')).toBeNull()
  })
  it('formatters', () => {
    expect(formatCurrency(1234.5).replace(/\s/g, ' ')).toBe('R$ 1.234,50')
    expect(formatCurrency(null).replace(/\s/g, ' ')).toBe('R$ 0,00')
    expect(formatDate('2026-03-09')).toBe('09/03/2026')
    expect(formatDate(null)).toBe('—')
    expect(formatPhone('11987654321')).toBe('(11) 98765-4321')
    expect(formatPhone('1133334444')).toBe('(11) 3333-4444')
    expect(formatPhone('123')).toBe('123')
    expect(formatTaxId('12345678901')).toBe('123.456.789-01')
    expect(formatTaxId('12345678000190')).toBe('12.345.678/0001-90')
    expect(formatTaxId('')).toBe('—')
    expect(formatZipCode('01310100')).toBe('01310-100')
  })
  it('getItemTotal: saved total or price × quantity', () => {
    expect(getItemTotal({ total_price: 50 } as never)).toBe(50)
    expect(getItemTotal({ unit_price: 10, quantity: 3 } as never)).toBe(30)
  })
})

describe('app/utils/index', () => {
  it('generateCode uses the prefix', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(generateCode('AB')).toMatch(/^AB/)
    vi.restoreAllMocks()
  })
})

describe('plan matrix (usePlans)', () => {
  it('hasPlanAccess', () => {
    expect(hasPlanAccess(PlanKey.Fiscal, PlanKey.Pro)).toBe(true)
    expect(hasPlanAccess(PlanKey.Pro, PlanKey.Pro)).toBe(true)
    expect(hasPlanAccess(PlanKey.Starter, PlanKey.Pro)).toBe(false)
    expect(hasPlanAccess(null, PlanKey.Starter)).toBe(false)
    expect(hasPlanAccess(undefined, PlanKey.Starter)).toBe(false)
  })
  it('limits grow with the plan', () => {
    expect(PLAN_LICENSES[PlanKey.Starter].maxEmployees).toBe(2)
    expect(PLAN_LICENSES[PlanKey.Pro].maxEmployees).toBe(10)
    expect(PLAN_LICENSES[PlanKey.Fiscal].maxEmployees).toBeNull()
    expect(PLAN_LICENSES[PlanKey.Starter].nfseEmission).toBe(false)
    expect(PLAN_LICENSES[PlanKey.Fiscal].nfseEmission).toBe(true)
  })
  it('every fiscal action requires the fiscal plan', () => {
    for (const [code, plan] of Object.entries(ACTION_PLAN_REQUIREMENTS)) {
      if (/invoice|fiscal/.test(code)) expect(plan).toBe(PlanKey.Fiscal)
    }
  })
})

describe('useWorkshopPermissions.can (plan × role × action)', () => {
  async function load(state: { planKey: string | null, isAdmin: boolean, permissions: Record<string, boolean> }) {
    vi.resetModules()
    ;(globalThis as Record<string, unknown>).useWorkshopBootstrap = () => ({
      planKey: { value: state.planKey },
      isAdmin: { value: state.isAdmin },
      permissions: { value: state.permissions }
    })
    const mod = await import('../../../app/composables/useWorkshopPermissions')
    return mod.useWorkshopPermissions()
  }

  it('admin passes a common action, but does not exceed the plan', async () => {
    const p = await load({ planKey: 'starter', isAdmin: true, permissions: {} })
    expect(p.can('customers.create')).toBe(true)
    expect(p.can('fiscal.manage')).toBe(false)
    expect(p.can('reports.costs')).toBe(false)
  })
  it('fiscal plan + admin allow everything', async () => {
    const p = await load({ planKey: 'fiscal', isAdmin: true, permissions: {} })
    expect(p.can('fiscal.manage')).toBe(true)
  })
  it('non-admin depends on explicit permission', async () => {
    const p = await load({ planKey: 'pro', isAdmin: false, permissions: { 'reports.costs': true, 'customers.read': false } })
    expect(p.can('reports.costs')).toBe(true)
    expect(p.can('customers.read')).toBe(false)
    expect(p.can('inexistente')).toBe(false)
    expect(p.canAny(['customers.read', 'reports.costs'])).toBe(true)
    expect(p.canAll(['customers.read', 'reports.costs'])).toBe(false)
  })
  it('non-admin with permission but insufficient plan is blocked', async () => {
    const p = await load({ planKey: 'starter', isAdmin: false, permissions: { 'reports.costs': true } })
    expect(p.can('reports.costs')).toBe(false)
  })
  it('without active plan, actions requiring a plan are blocked', async () => {
    const p = await load({ planKey: null, isAdmin: true, permissions: {} })
    expect(p.can('reports.debtors')).toBe(false)
  })
})
