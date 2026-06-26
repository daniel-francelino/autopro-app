/**
 * Curated icon/color choices for the financial categories icon/color
 * pickers (docs/financial-categories-crud.md, section 3.5). Not a free
 * icon search — the 13 expense icons mirror the keyword heuristic that used
 * to live in app/utils/report-costs.ts (now retired); shopping-cart and
 * circle-dollar-sign cover the income side, which had no prior heuristic.
 */
export const CATEGORY_ICON_OPTIONS = [
  { label: 'Vendas', value: 'i-lucide-shopping-cart' },
  { label: 'Dinheiro', value: 'i-lucide-circle-dollar-sign' },
  { label: 'Impostos', value: 'i-lucide-landmark' },
  { label: 'Pessoas', value: 'i-lucide-users' },
  { label: 'Empréstimo', value: 'i-lucide-banknote-arrow-down' },
  { label: 'Cartão', value: 'i-lucide-credit-card' },
  { label: 'Transporte', value: 'i-lucide-truck' },
  { label: 'Imóvel', value: 'i-lucide-building-2' },
  { label: 'Marketing', value: 'i-lucide-megaphone' },
  { label: 'Energia/Utilidades', value: 'i-lucide-zap' },
  { label: 'Software', value: 'i-lucide-monitor-cog' },
  { label: 'Materiais/Estoque', value: 'i-lucide-package' },
  { label: 'Manutenção', value: 'i-lucide-wrench' },
  { label: 'Taxas', value: 'i-lucide-receipt' },
  { label: 'Outros', value: 'i-lucide-folder-open' }
] as const

export const CATEGORY_COLOR_OPTIONS = [
  { label: 'Neutro', value: 'neutral' },
  { label: 'Primária', value: 'primary' },
  { label: 'Secundária', value: 'secondary' },
  { label: 'Sucesso', value: 'success' },
  { label: 'Informação', value: 'info' },
  { label: 'Alerta', value: 'warning' },
  { label: 'Erro', value: 'error' }
] as const

export type CategoryIconValue = typeof CATEGORY_ICON_OPTIONS[number]['value']
export type CategoryColorValue = typeof CATEGORY_COLOR_OPTIONS[number]['value']
