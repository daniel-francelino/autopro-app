<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { ActionCode } from '~/constants/action-codes'

definePageMeta({
  layout: 'app'
})

useSeoMeta({
  title: 'Configurações'
})

const workshop = useWorkshopPermissions()

const links = computed<NavigationMenuItem[][]>(() => {
  const items: NavigationMenuItem[] = [
    {
      label: 'Conta',
      icon: 'i-lucide-user',
      to: '/app/settings',
      exact: true
    },
    {
      label: 'Assinatura',
      icon: 'i-lucide-credit-card',
      to: '/app/settings/subscription'
    },
    {
      label: 'Notificações',
      icon: 'i-lucide-bell',
      to: '/app/settings/notifications'
    }
  ]

  if (workshop.can(ActionCode.SETTINGS_VIEW)) {
    items.push({
      label: 'Empresa',
      icon: 'i-lucide-building-2',
      to: '/app/settings/company'
    })
  }

  if (workshop.can(ActionCode.EMPLOYEES_READ)) {
    items.push({
      label: 'Funcionários',
      icon: 'i-lucide-users-round',
      to: '/app/settings/employees'
    })
  }

  if (workshop.can(ActionCode.ROLES_READ)) {
    items.push({
      label: 'Permissões',
      icon: 'i-lucide-shield-check',
      to: '/app/settings/roles'
    })
  }

  items.sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '', 'pt-BR', { sensitivity: 'base' }))

  return [items]
})
</script>

<template>
  <UDashboardPanel id="settings" :ui="{ body: 'lg:py-12' }">
    <template #header>
      <AppPageHeader title="Configurações" />

      <UDashboardToolbar>
        <UNavigationMenu :items="links" highlight class="-mx-1 flex-1" />
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-4 w-full lg:max-w-4xl px-4 mx-auto">
        <NuxtPage />
      </div>
    </template>
  </UDashboardPanel>
</template>
