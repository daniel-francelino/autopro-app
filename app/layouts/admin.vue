<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const open = ref(false)
const sidebarCollapsed = ref(true)
const isMobile = useMediaQuery('(max-width: 1023px)')

function closeSidebar() {
  open.value = false
}

function item(label: string, icon: string, to: string): NavigationMenuItem {
  return {
    label,
    icon,
    to,
    onSelect: closeSidebar
  }
}

// Seções do menu: o rótulo dá contexto e também agrupa os resultados da busca (Ctrl+K).
const sections = computed(() => [
  {
    id: 'admin-overview',
    label: 'Visão geral',
    items: [
      item('Dashboard', 'i-lucide-layout-dashboard', '/admin'),
      item('Métricas de uso', 'i-lucide-chart-line', '/admin/metrics')
    ]
  },
  {
    id: 'admin-customers',
    label: 'Clientes',
    items: [
      item('Organizações', 'i-lucide-building-2', '/admin/organizations'),
      item('Usuários', 'i-lucide-users', '/admin/users'),
      item('Cobrança', 'i-lucide-credit-card', '/admin/billing')
    ]
  },
  {
    id: 'admin-growth',
    label: 'Aquisição e retorno',
    items: [
      item('Feedbacks', 'i-lucide-message-square', '/admin/feedbacks'),
      item('SEO e GEO', 'i-lucide-sparkles', '/admin/geo')
    ]
  },
  {
    id: 'admin-platform',
    label: 'Plataforma',
    items: [
      item('Auditoria', 'i-lucide-clipboard-list', '/admin/audit'),
      item('Sistema', 'i-lucide-server', '/admin/system')
    ]
  },
  {
    id: 'admin-fiscal',
    label: 'Fiscal',
    items: [
      item('Fiscal empresas', 'i-lucide-file-stack', '/admin/fiscal/companies'),
      item('Fiscal logs', 'i-lucide-scroll-text', '/admin/fiscal/logs')
    ]
  }
])

// Uma lista por seção, com o rótulo como primeiro item (some com o menu recolhido).
const links = computed<NavigationMenuItem[][]>(() =>
  sections.value.map(section => [
    { label: section.label, type: 'label' } as NavigationMenuItem,
    ...section.items
  ])
)

const groups = computed(() => sections.value.map(({ id, label, items }) => ({ id, label, items })))

watch(
  isMobile,
  (mobile) => {
    if (mobile)
      sidebarCollapsed.value = false
  },
  { immediate: true }
)
</script>

<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar
      id="admin"
      v-model:open="open"
      v-model:collapsed="sidebarCollapsed"
      :collapsible="!isMobile"
      :resizable="!isMobile"
      class="bg-elevated/25"
      :ui="{ footer: 'lg:border-t lg:border-default' }"
    >
      <template #header="{ collapsed }">
        <NuxtLink
          to="/admin"
          class="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-elevated"
          :class="collapsed ? 'justify-center' : ''"
          aria-label="Painel admin"
        >
          <AppLogo size="sm" />
          <span
            v-if="!collapsed"
            class="truncate text-xs font-medium text-muted"
          >
            Admin
          </span>
        </NuxtLink>
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
          :class="index > 0 ? 'mt-3' : 'mt-2'"
          orientation="vertical"
          tooltip
          popover
        />
      </template>

      <template #footer="{ collapsed }">
        <UserMenu :collapsed="collapsed" variant="admin" />
      </template>
    </UDashboardSidebar>

    <UDashboardSearch :groups="groups" />

    <div class="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      <slot />
    </div>

    <NotificationsSlideover />
  </UDashboardGroup>
</template>
