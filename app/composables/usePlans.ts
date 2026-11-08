export enum PlanKey {
  Starter = 'starter',
  Pro = 'pro',
  Fiscal = 'fiscal'
}

/** Ordered from lowest to highest tier. Position = access level. */
export const PLAN_KEYS = [PlanKey.Starter, PlanKey.Pro, PlanKey.Fiscal] as const satisfies readonly PlanKey[]

/** Returns true if `current` plan has access to `required` plan features */
export function hasPlanAccess(current: PlanKey | null | undefined, required: PlanKey): boolean {
  if (!current) return false
  return PLAN_KEYS.indexOf(current) >= PLAN_KEYS.indexOf(required)
}

export type PlanLicense = {
  maxEmployees: number | null
  advancedReports: boolean
  nfseEmission: boolean
}

export const PLAN_LICENSES: Record<PlanKey, PlanLicense> = {
  [PlanKey.Starter]: {
    maxEmployees: 2,
    advancedReports: false,
    nfseEmission: false
  },
  [PlanKey.Pro]: {
    maxEmployees: 10,
    advancedReports: true,
    nfseEmission: false
  },
  [PlanKey.Fiscal]: {
    maxEmployees: null,
    advancedReports: true,
    nfseEmission: true
  }
}

/**
 * Maps action codes that require a minimum plan tier.
 * When a code is listed here, the plan gate is checked BEFORE the role gate.
 * If the org plan is below the required tier, access is denied for everyone
 * (including admins), because it is an org-level capability, not just a role.
 */
export const ACTION_PLAN_REQUIREMENTS: Partial<Record<string, PlanKey>> = {
  // ── Reports (Pro+) ────────────────────────────────────────────────
  'reports.customers': PlanKey.Pro,
  'reports.costs': PlanKey.Pro,
  'reports.debtors': PlanKey.Pro,

  // ── Fiscal / NF-e (Fiscal plan only) ─────────────────────────────
  'service_invoice.read': PlanKey.Fiscal,
  'service_invoice.create': PlanKey.Fiscal,
  'service_invoice.update': PlanKey.Fiscal,
  'service_invoice.delete': PlanKey.Fiscal,
  'product_invoice.read': PlanKey.Fiscal,
  'product_invoice.create': PlanKey.Fiscal,
  'product_invoice.update': PlanKey.Fiscal,
  'product_invoice.delete': PlanKey.Fiscal,
  'fiscal.manage': PlanKey.Fiscal
}

export type Plan = {
  key: PlanKey
  name: string
  price: string
  priceAmount: number
  description: string
  icon: string
  highlight: boolean
  badge: string | null
  features: string[]
  cta: string
  priceId: string | null
}

export const PLAN_DEFINITIONS = [
  {
    key: PlanKey.Starter,
    name: 'Starter',
    price: 'R$ 199',
    priceAmount: 199,
    description: 'Ideal para oficinas que estão começando a organizar sua operação.',
    icon: 'i-lucide-wrench',
    highlight: false,
    badge: null,
    features: [
      'Até 2 funcionários',
      'Ordens de serviço ilimitadas',
      'Cadastro de clientes e veículos',
      'Gestão financeira',
      'Relatórios essenciais',
      'Suporte por email'
    ],
    cta: 'Começar com Starter'
  },
  {
    key: PlanKey.Pro,
    name: 'Pro',
    price: 'R$ 399',
    priceAmount: 399,
    description: 'Para oficinas que precisam de controle completo e escala.',
    icon: 'i-lucide-zap',
    highlight: true,
    badge: 'Mais popular',
    features: [
      'Tudo do Starter',
      'Até 10 funcionários',
      'Relatórios avançados e análises',
      'Suporte prioritário'
    ],
    cta: 'Começar com Pro'
  },
  {
    key: PlanKey.Fiscal,
    name: 'Fiscal',
    price: 'R$ 599',
    priceAmount: 599,
    description: 'Para oficinas que precisam de emissão fiscal integrada e suporte completo.',
    icon: 'i-lucide-file-check',
    highlight: false,
    badge: null,
    features: [
      'Tudo do Pro',
      'Funcionários ilimitados',
      'Emissão de NFS-e integrada',
      'Onboarding assistido',
      'Suporte dedicado'
    ],
    cta: 'Começar com Fiscal'
  }
] as const

export function usePlans() {
  const config = useRuntimeConfig()

  const plans: Plan[] = PLAN_DEFINITIONS.map(p => ({
    ...p,
    features: [...p.features],
    badge: p.badge ?? null,
    priceId: (config.public as Record<string, string>)[`stripe${p.key.charAt(0).toUpperCase() + p.key.slice(1)}PriceId`] || null
  }))

  function getPlanByPriceId(priceId: string | null | undefined): Plan | null {
    if (!priceId) return null
    return plans.find(p => p.priceId === priceId) ?? null
  }

  /** Shape esperada pelo BillingPricingPlans / UPricingPlan */
  function toCmsPlan(plan: Plan) {
    return {
      title: plan.name,
      description: plan.description,
      highlight: plan.highlight,
      scale: plan.highlight,
      badge: plan.badge ? { label: plan.badge } : undefined,
      button: { label: plan.cta },
      features: plan.features.map(f => ({ title: f })),
      price: {
        month: plan.price
      },
      stripePriceId: {
        month: plan.priceId ?? ''
      }
    }
  }

  return { plans, getPlanByPriceId, toCmsPlan }
}
