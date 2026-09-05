export interface CommissionRuleDraft {
  key: string
  name: string
  commissionType: 'percentage' | 'fixed_amount'
  commissionAmount: string
  commissionBase: 'revenue' | 'profit'
  isDefault: boolean
  categoryIds: string[]
}

function newRuleKey() {
  return Math.random().toString(36).slice(2)
}

export function createEmptyCommissionRuleDraft(): CommissionRuleDraft {
  return {
    key: newRuleKey(),
    name: '',
    commissionType: 'percentage',
    commissionAmount: '',
    commissionBase: 'revenue',
    isDefault: false,
    categoryIds: []
  }
}

/** Client-side mirror of server/utils/employee-commission-plans.ts's parseCommissionRulesInput — catches obvious mistakes before the round trip. */
export function validateCommissionRuleDrafts(drafts: CommissionRuleDraft[]): string | null {
  if (drafts.length === 0) return 'Informe ao menos uma regra de comissão'

  const seenCategoryIds = new Set<string>()
  let defaultCount = 0

  for (const [index, draft] of drafts.entries()) {
    const amount = Number(draft.commissionAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return `Regra ${index + 1}: informe um valor de comissão maior que zero`
    }
    if (draft.commissionType === 'percentage' && amount > 100) {
      return `Regra ${index + 1}: o percentual não pode ser maior que 100`
    }
    if (draft.isDefault) {
      defaultCount += 1
    } else if (draft.categoryIds.length === 0) {
      return `Regra ${index + 1}: selecione ao menos uma categoria, ou marque como regra padrão`
    }
    for (const categoryId of draft.categoryIds) {
      if (seenCategoryIds.has(categoryId)) return `Categoria repetida entre regras (regra ${index + 1})`
      seenCategoryIds.add(categoryId)
    }
  }

  if (defaultCount > 1) return 'No máximo uma regra pode ser marcada como padrão'
  return null
}

export function commissionRuleDraftsToPayload(drafts: CommissionRuleDraft[]) {
  return drafts.map(draft => ({
    name: draft.name.trim() || undefined,
    commissionType: draft.commissionType,
    commissionAmount: Number(draft.commissionAmount),
    // fixed_amount is a flat R$ per unit — it has no base, so the field
    // (kept on the draft only so the UI has a value ready if the user
    // switches back to percentage) is dropped before it reaches the API.
    commissionBase: draft.commissionType === 'percentage' ? draft.commissionBase : null,
    isDefault: draft.isDefault,
    categoryIds: draft.isDefault ? [] : draft.categoryIds
  }))
}

export function commissionRuleDraftFromRule(rule: {
  name: string | null
  commission_type: 'percentage' | 'fixed_amount'
  commission_amount: number
  commission_base: 'revenue' | 'profit' | null
  is_default: boolean
  category_ids: string[]
}): CommissionRuleDraft {
  return {
    key: newRuleKey(),
    name: rule.name ?? '',
    commissionType: rule.commission_type,
    commissionAmount: String(rule.commission_amount),
    commissionBase: rule.commission_base ?? 'revenue',
    isDefault: rule.is_default,
    categoryIds: [...rule.category_ids]
  }
}
