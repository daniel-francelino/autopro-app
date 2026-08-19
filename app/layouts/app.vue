<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { ActionCode } from '~/constants/action-codes'

const open = ref(false)
const sidebarCollapsed = ref(true)
const isMobile = ref(false)
const workshop = useWorkshopPermissions()
const reportsAccess = useReportsAccess()
const route = useRoute()
let mediaQuery: MediaQueryList | null = null

function syncViewportMode() {
  isMobile.value = mediaQuery?.matches ?? false
}

function closeSidebar() {
  open.value = false
}

function item(label: string, icon: string, to: string, exact = false): NavigationMenuItem {
  return {
    label,
    icon,
    to,
    exact,
    onSelect: closeSidebar
  }
}

function normalizePath(path: string) {
  if (path === '/')
    return path

  return path.replace(/\/+$/, '') || '/'
}

function isRouteMatch(target: string) {
  const currentPath = normalizePath(route.path)
  const targetPath = normalizePath(target)

  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`)
}

function shouldOpenGroup(to: string, children: NavigationMenuItem[]) {
  return isRouteMatch(to) || children.some(child => child.to ? isRouteMatch(String(child.to)) : false)
}

function sortChildren(children: NavigationMenuItem[]): NavigationMenuItem[] {
  const overview = children.find(c => c.label?.toLowerCase() === 'visão geral')
  const rest = children
    .filter(c => c.label?.toLowerCase() !== 'visão geral')
    .sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '', 'pt-BR', { sensitivity: 'base' }))
  return overview ? [overview, ...rest] : rest
}

function triggerItem(label: string, icon: string, to: string, children: NavigationMenuItem[]): NavigationMenuItem {
  return {
    label,
    icon,
    to,
    open: shouldOpenGroup(to, children),
    type: 'trigger',
    children
  }
}

const links = computed<NavigationMenuItem[][]>(() => {
  const operational: NavigationMenuItem[] = [
    item('Dashboard', 'i-lucide-house', '/app/')
  ]

  if (workshop.can(ActionCode.ORDERS_READ))
    operational.push(item('Ordens de serviço', 'i-lucide-clipboard-list', '/app/service-orders'))

  if (workshop.can(ActionCode.APPOINTMENTS_READ))
    operational.push(item('Agendamentos', 'i-lucide-calendar-days', '/app/appointments'))

  if (workshop.can(ActionCode.CUSTOMERS_READ))
    operational.push(item('Clientes', 'i-lucide-users', '/app/customers'))

  if (workshop.can(ActionCode.VEHICLES_READ))
    operational.push(item('Veículos', 'i-lucide-car-front', '/app/vehicles'))

  const productsChildren: NavigationMenuItem[] = []

  if (workshop.can(ActionCode.PRODUCTS_READ))
    productsChildren.push(item('Visão geral', 'i-lucide-package', '/app/products'))

  if (workshop.can(ActionCode.PRODUCT_CATEGORIES_READ))
    productsChildren.push(item('Categorias', 'i-lucide-tags', '/app/products/categories'))

  if (workshop.can(ActionCode.INVENTORY_READ))
    productsChildren.push(item('Estoque', 'i-lucide-box', '/app/products/inventory'))

  if (workshop.can(ActionCode.SUPPLIERS_READ))
    productsChildren.push(item('Fornecedores', 'i-lucide-briefcase-business', '/app/products/suppliers'))

  if (workshop.can(ActionCode.AUTHORIZATIONS_READ))
    productsChildren.push(item('Autorizações', 'i-lucide-clipboard-list', '/app/products/purchase-requests'))

  if (workshop.can(ActionCode.PURCHASES_READ))
    productsChildren.push(item('Compras', 'i-lucide-shopping-cart', '/app/products/purchases'))

  if (workshop.can(ActionCode.RETURNS_READ))
    productsChildren.push(item('Devoluções', 'i-lucide-undo-2', '/app/products/purchase-returns'))

  const catalog: NavigationMenuItem[] = productsChildren.length > 0
    ? [triggerItem('Produtos', 'i-lucide-shopping-bag', '/app/products', sortChildren(productsChildren))]
    : []

  const financeChildren: NavigationMenuItem[] = []

  if (workshop.can(ActionCode.FINANCIAL_READ))
    financeChildren.push(item('Visão geral', 'i-lucide-dollar-sign', '/app/financial'))

  if (workshop.can(ActionCode.FINANCIAL_READ))
    financeChildren.push(item('Categorias', 'i-lucide-tag', '/app/financial/categories'))

  if (workshop.can(ActionCode.BANK_ACCOUNTS_READ))
    financeChildren.push(item('Contas bancárias', 'i-lucide-landmark', '/app/financial/accounts'))

  if (workshop.can(ActionCode.TAXES_VIEW))
    financeChildren.push(item('Impostos', 'i-lucide-percent', '/app/financial/taxes'))

  if (workshop.can(ActionCode.PAYMENT_MACHINES_VIEW))
    financeChildren.push(item('Maquininhas', 'i-lucide-credit-card', '/app/financial/machines'))

  if (workshop.can(ActionCode.SERVICE_INVOICE_READ))
    financeChildren.push(item('Notas fiscais', 'i-lucide-receipt', '/app/financial/service-invoices'))

  if (workshop.can(ActionCode.BONUSES_READ))
    financeChildren.push(item('Bônus', 'i-lucide-gift', '/app/financial/bonuses'))

  if (workshop.can(ActionCode.COMMISSIONS_READ))
    financeChildren.push(item('Comissões', 'i-lucide-badge-percent', '/app/financial/commissions'))

  const finance: NavigationMenuItem[] = financeChildren.length > 0
    ? [triggerItem('Financeiro', 'i-lucide-dollar-sign', '/app/financial', sortChildren(financeChildren))]
    : []

  const reportsChildren: NavigationMenuItem[] = reportsAccess.allowedReportItems.value.map(report =>
    item(report.label, report.icon, report.to)
  )

  const reports: NavigationMenuItem[] = reportsAccess.hasReportsAccess.value
    ? [{
        label: 'Relatórios',
        icon: 'i-lucide-bar-chart-3',
        to: reportsAccess.firstReportPath.value,
        open: shouldOpenGroup('/app/reports', reportsChildren),
        type: 'trigger',
        children: sortChildren(reportsChildren)
      }]
    : []

  const settingsChildren: NavigationMenuItem[] = [
    item('Conta', 'i-lucide-user', '/app/settings', true),
    item('Assinatura', 'i-lucide-credit-card', '/app/settings/subscription'),
    item('Notificações', 'i-lucide-bell', '/app/settings/notifications')
  ]

  if (workshop.can(ActionCode.SETTINGS_VIEW))
    settingsChildren.splice(1, 0, item('Empresa', 'i-lucide-building-2', '/app/settings/company'))

  if (workshop.can(ActionCode.EMPLOYEES_READ))
    settingsChildren.splice(Math.min(settingsChildren.length, 2), 0, item('Funcionários', 'i-lucide-users-round', '/app/settings/employees'))

  if (workshop.can(ActionCode.ROLES_VIEW))
    settingsChildren.splice(Math.min(settingsChildren.length, 3), 0, item('Permissões', 'i-lucide-shield-check', '/app/settings/roles'))

  const settings: NavigationMenuItem[] = [{
    label: 'Configurações',
    to: '/app/settings',
    icon: 'i-lucide-settings',
    open: shouldOpenGroup('/app/settings', settingsChildren),
    type: 'trigger',
    children: sortChildren(settingsChildren)
  }]

  const primaryLinks = [
    ...operational,
    ...catalog,
    ...finance,
    ...reports,
    ...settings
  ]

  const secondaryLinks: NavigationMenuItem[] = [
    item('Suporte', 'i-lucide-message-circle', '/app/support'),
    {
      label: 'Ajuda',
      icon: 'i-lucide-info',
      to: '/docs'
    }
  ]

  return [
    primaryLinks,
    secondaryLinks
  ].filter(group => group.length > 0)
})

const groups = computed(() => [
  {
    id: 'links',
    label: 'Ir para',
    items: links.value.flat()
  }
])

const { load: loadPreferences } = useUserPreferences()

await loadPreferences()

onMounted(async () => {
  mediaQuery = window.matchMedia('(max-width: 1023px)')
  syncViewportMode()
  mediaQuery.addEventListener?.('change', syncViewportMode)
})

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener?.('change', syncViewportMode)
})

watch(
  isMobile,
  (mobile) => {
    if (mobile) {
      sidebarCollapsed.value = false
    }
  },
  { immediate: true }
)
</script>

<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar
      id="default"
      v-model:open="open"
      v-model:collapsed="sidebarCollapsed"
      :collapsible="!isMobile"
      :resizable="!isMobile"
      class="bg-elevated/25"
      :ui="{ footer: 'lg:border-t lg:border-default' }"
    >
      <template #header="{ collapsed }">
        <TeamsMenu :collapsed="collapsed" />
      </template>

      <template #default="{ collapsed }">
        <UDashboardSearchButton
          :collapsed="collapsed"
          class="bg-transparent ring-default"
        />

        <UNavigationMenu
          v-for="(group, index) in links"
          :key="index"
          :collapsed="collapsed"
          :items="group"
          orientation="vertical"
          tooltip
          popover
          :class="index === links.length - 1 ? 'mt-auto' : ''"
        />
      </template>

      <template #footer="{ collapsed }">
        <UserMenu :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>

    <UDashboardSearch :groups="groups" />

    <div class="app-content-with-bottom-nav flex min-h-0 flex-1 flex-col w-full min-w-0 overflow-hidden">
      <slot />
    </div>

    <MobileBottomNav />

    <NotificationsSlideover />
  </UDashboardGroup>

  <OnboardingFlowModal />
</template>
