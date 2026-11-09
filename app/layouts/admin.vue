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

const links = computed<NavigationMenuItem[][]>(() => [[
  item('Dashboard', 'i-lucide-layout-dashboard', '/admin'),
  item('Organizações', 'i-lucide-building-2', '/admin/organizations'),
  item('Usuários', 'i-lucide-users', '/admin/users'),
  item('Métricas de uso', 'i-lucide-chart-line', '/admin/metrics'),
  item('Auditoria', 'i-lucide-clipboard-list', '/admin/audit'),
  item('Cobrança', 'i-lucide-credit-card', '/admin/billing'),
  item('Feedbacks', 'i-lucide-message-square', '/admin/feedbacks'),
  item('SEO e GEO', 'i-lucide-sparkles', '/admin/geo'),
  item('Sistema', 'i-lucide-server', '/admin/system'),
  item('Fiscal empresas', 'i-lucide-file-stack', '/admin/fiscal/companies'),
  item('Fiscal logs', 'i-lucide-scroll-text', '/admin/fiscal/logs')
]])

const groups = computed(() => [
  {
    id: 'admin-links',
    label: 'Administração',
    items: links.value.flat()
  }
])

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
          orientation="vertical"
          tooltip
          popover
        />
      </template>

      <template #footer="{ collapsed }">
        <UserMenu :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>

    <UDashboardSearch :groups="groups" />

    <div class="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      <slot />
    </div>

    <NotificationsSlideover />
  </UDashboardGroup>
</template>
