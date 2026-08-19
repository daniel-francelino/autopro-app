export enum ResourceType {
  APPOINTMENTS = 'appointments',
  AUTHORIZATIONS = 'authorizations',
  BANK_ACCOUNTS = 'bank_accounts',
  BONUSES = 'bonuses',
  COMMISSIONS = 'commissions',
  CONSULTATION = 'consultation',
  CUSTOMERS = 'customers',
  EMPLOYEES = 'employees',
  FINANCIAL = 'financial',
  INVENTORY = 'inventory',
  NOTIFICATIONS = 'notifications',
  ORDERS = 'orders',
  PRODUCTS = 'products',
  PRODUCT_CATEGORIES = 'product_categories',
  PURCHASES = 'purchases',
  REPORTS = 'reports',
  ROLES = 'roles',
  SERVICE_INVOICE = 'service_invoice',
  SETTINGS = 'settings',
  SUPPLIERS = 'suppliers',
  TAXES = 'taxes',
  USERS = 'users',
  VEHICLES = 'vehicles'
}
export function useRoleResources() {
  function normalizeResourceKey(resource: string | null | undefined): string {
    return String(resource || 'geral')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  }

  function getResourceIcon(resource: string | null | undefined): string {
    const key = normalizeResourceKey(resource)

    if (key.includes(ResourceType.APPOINTMENTS)) return 'i-lucide-calendar-days'
    if (key.includes(ResourceType.AUTHORIZATIONS)) return 'i-lucide-badge-check'
    if (key.includes(ResourceType.BANK_ACCOUNTS) || key.includes('bank')) return 'i-lucide-landmark'
    if (key.includes(ResourceType.BONUSES) || key.includes('bonus')) return 'i-lucide-gift'
    if (key.includes(ResourceType.COMMISSIONS) || key.includes('commission')) return 'i-lucide-badge-percent'
    if (key.includes(ResourceType.CUSTOMERS) || key.includes('client')) return 'i-lucide-users'
    if (key.includes(ResourceType.CONSULTATION)) return 'i-lucide-stethoscope'
    if (key.includes(ResourceType.EMPLOYEES) || key.includes('team')) return 'i-lucide-users-round'
    if (key.includes(ResourceType.FINANCIAL) || key.includes('billing')) return 'i-lucide-badge-dollar-sign'
    if (key.includes(ResourceType.PRODUCT_CATEGORIES)) return 'i-lucide-tags'
    if (key.includes(ResourceType.INVENTORY) || key.includes(ResourceType.PRODUCTS) || key.includes('part')) return 'i-lucide-package'
    if (key.includes(ResourceType.NOTIFICATIONS)) return 'i-lucide-bell'
    if (key.includes(ResourceType.SERVICE_INVOICE) || key.includes('invoice')) return 'i-lucide-file-text'
    if (key.includes(ResourceType.ORDERS) || key.includes('service')) return 'i-lucide-clipboard-list'
    if (key.includes(ResourceType.PURCHASES)) return 'i-lucide-shopping-cart'
    if (key.includes(ResourceType.REPORTS)) return 'i-lucide-bar-chart-3'
    if (key.includes(ResourceType.ROLES) || key.includes('permission')) return 'i-lucide-shield-check'
    if (key.includes(ResourceType.SETTINGS)) return 'i-lucide-settings-2'
    if (key.includes(ResourceType.SUPPLIERS)) return 'i-lucide-truck'
    if (key.includes(ResourceType.TAXES)) return 'i-lucide-percent'
    if (key.includes(ResourceType.VEHICLES)) return 'i-lucide-car-front'
    if (key.includes(ResourceType.USERS)) return 'i-lucide-user'

    return 'i-lucide-folder'
  }

  function formatResourceLabel(resource: string | null | undefined): string {
    const key = normalizeResourceKey(resource)

    if (!key || key === 'geral' || key === 'general') return 'Geral'
    if (key.includes(ResourceType.APPOINTMENTS)) return 'Agendamentos'
    if (key.includes(ResourceType.AUTHORIZATIONS)) return 'Autorizações'
    if (key.includes(ResourceType.BANK_ACCOUNTS) || key.includes('bank')) return 'Contas bancárias'
    if (key.includes(ResourceType.BONUSES) || key.includes('bonus')) return 'Bônus'
    if (key.includes(ResourceType.COMMISSIONS) || key.includes('commission')) return 'Comissões'
    if (key.includes(ResourceType.CUSTOMERS) || key.includes('client')) return 'Clientes'
    if (key.includes(ResourceType.CONSULTATION)) return 'Consultas'
    if (key.includes(ResourceType.EMPLOYEES) || key.includes('team')) return 'Funcionários'
    if (key.includes(ResourceType.FINANCIAL) || key.includes('billing')) return 'Financeiro'
    if (key.includes(ResourceType.INVENTORY)) return 'Estoque'
    if (key.includes(ResourceType.PRODUCT_CATEGORIES)) return 'Categorias de produtos'
    if (key.includes(ResourceType.PRODUCTS)) return 'Produtos'
    if (key.includes('part')) return 'Peças'
    if (key.includes(ResourceType.NOTIFICATIONS)) return 'Notificações'
    if (key.includes(ResourceType.SERVICE_INVOICE) || key.includes('invoice')) return 'Notas fiscais (NFS-e)'
    if (key.includes(ResourceType.ORDERS) || key.includes('service')) return 'Ordens de serviço'
    if (key.includes(ResourceType.PURCHASES)) return 'Compras'
    if (key.includes(ResourceType.REPORTS)) return 'Relatórios'
    if (key.includes('permission')) return 'Permissões'
    if (key.includes(ResourceType.ROLES)) return 'Papéis'
    if (key.includes(ResourceType.SETTINGS)) return 'Configurações'
    if (key.includes(ResourceType.SUPPLIERS)) return 'Fornecedores'
    if (key.includes(ResourceType.TAXES)) return 'Impostos'
    if (key.includes(ResourceType.VEHICLES)) return 'Veículos'
    if (key.includes(ResourceType.USERS)) return 'Usuários'

    return 'Outros'
  }

  return { normalizeResourceKey, getResourceIcon, formatResourceLabel }
}
