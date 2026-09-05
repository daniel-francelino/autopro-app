/**
 * Curated icon choices for the financial categories icon picker
 * (docs/finance/financial-categories-crud.md, section 3.5). Not a free icon search —
 * the picker only offers this list. Color is free-form hex, picked via
 * CategoryColorPicker.vue, not a closed list — CATEGORY_COLOR_PRESETS below
 * are just quick-pick suggestions inside that picker.
 */
export const CATEGORY_ICON_OPTIONS = [
  { label: 'Vendas', value: 'i-lucide-shopping-cart' },
  { label: 'Receita', value: 'i-lucide-trending-up' },
  { label: 'Despesa', value: 'i-lucide-trending-down' },
  { label: 'Caixa', value: 'i-lucide-wallet' },
  { label: 'Investimento', value: 'i-lucide-piggy-bank' },
  { label: 'Outros valores', value: 'i-lucide-coins' },
  { label: 'Banco/Impostos', value: 'i-lucide-landmark' },
  { label: 'Taxas/Recibos', value: 'i-lucide-receipt' },
  { label: 'Pessoal', value: 'i-lucide-users' },
  { label: 'Comissões', value: 'i-lucide-handshake' },
  { label: 'Serviços profissionais', value: 'i-lucide-briefcase' },
  { label: 'Empréstimo', value: 'i-lucide-banknote-arrow-down' },
  { label: 'Cartão', value: 'i-lucide-credit-card' },
  { label: 'Transporte/Frete', value: 'i-lucide-truck' },
  { label: 'Veículos', value: 'i-lucide-car' },
  { label: 'Imóvel/Aluguel', value: 'i-lucide-building-2' },
  { label: 'Marketing', value: 'i-lucide-megaphone' },
  { label: 'Energia', value: 'i-lucide-zap' },
  { label: 'Água/Combustível', value: 'i-lucide-droplet' },
  { label: 'Internet', value: 'i-lucide-wifi' },
  { label: 'Telefonia', value: 'i-lucide-phone' },
  { label: 'Software', value: 'i-lucide-monitor-cog' },
  { label: 'Materiais/Estoque', value: 'i-lucide-package' },
  { label: 'Manutenção', value: 'i-lucide-wrench' },
  { label: 'Seguro', value: 'i-lucide-shield-check' },
  { label: 'Bônus', value: 'i-lucide-gift' },
  { label: 'Outros', value: 'i-lucide-folder-open' }
] as const

export const CATEGORY_COLOR_PRESETS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#d946ef', '#ec4899', '#64748b'
] as const

export const DEFAULT_CATEGORY_ICON = 'i-lucide-folder-open'
export const DEFAULT_CATEGORY_COLOR = '#64748b'

export type CategoryIconValue = typeof CATEGORY_ICON_OPTIONS[number]['value']

export function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

/**
 * Display-only sentence case ("CUSTO FIXO" -> "Custo fixo"). Never write the
 * result back — categories created before this UI existed (or via the SQL
 * backfill) keep whatever casing they were stored with; this only normalizes
 * how the name is *shown*.
 */
export function formatCategoryName(name: string): string {
  const lower = name.toLocaleLowerCase('pt-BR')
  return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1)
}
