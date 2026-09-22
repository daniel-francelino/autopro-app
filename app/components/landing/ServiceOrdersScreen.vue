<script setup lang="ts">
import OrderCard from '~/components/service-orders/OrderCard.vue'
import type { ServiceOrder } from '~/types/service-orders'

// Same presentational card used by /app/service-orders. No API or session data.
const orders: ServiceOrder[] = [
  { id: 'demo-1042', number: 'OS1042', status: 'estimate', payment_status: 'pending', client_name: 'Mariana Oliveira', vehicle_label: 'FORD KA 1.0 — ABC1D23', total_amount: 1228, responsible_names: [] },
  { id: 'demo-1041', number: 'OS1041', status: 'completed', payment_status: 'paid', client_name: 'Pedro Almeida', vehicle_label: 'VOLKSWAGEN GOL — DEF4G56', total_amount: 850, responsible_names: ['Lucas Santos'] },
  { id: 'demo-1040', number: 'OS1040', status: 'open', payment_status: 'pending', client_name: 'Camila Souza', vehicle_label: 'CHEVROLET ONIX — GHI7J89', total_amount: 420, responsible_names: ['Lucas Santos'] },
  { id: 'demo-1039', number: 'OS1039', status: 'in_progress', payment_status: 'pending', client_name: 'Rafael Costa', vehicle_label: 'HONDA CIVIC — JKL0M12', total_amount: 1680, responsible_names: ['Ana Lima'] }
].map(order => ({
  ...order,
  is_installment: false,
  client_id: null,
  vehicle_id: null,
  entry_date: '2026-09-22',
  reported_defect: null,
  master_product_name: null,
  responsible_name: order.responsible_names[0] ?? null,
  has_commissions: false,
  installments_progress: null
}))

const items = [
  { label: 'Dashboard', icon: 'i-lucide-house' },
  { label: 'Ordens de serviço', icon: 'i-lucide-clipboard-list', active: true },
  { label: 'Agendamentos', icon: 'i-lucide-calendar-days' },
  { label: 'Clientes', icon: 'i-lucide-users' },
  { label: 'Veículos', icon: 'i-lucide-car-front' },
  { label: 'Produtos', icon: 'i-lucide-shopping-bag', trailingIcon: 'i-lucide-chevron-down' },
  { label: 'Financeiro', icon: 'i-lucide-dollar-sign', trailingIcon: 'i-lucide-chevron-down' },
  { label: 'Relatórios', icon: 'i-lucide-bar-chart-3', trailingIcon: 'i-lucide-chevron-down' },
  { label: 'Configurações', icon: 'i-lucide-settings', trailingIcon: 'i-lucide-chevron-down' }
]
</script>

<template>
  <div class="lp-real-screen" inert aria-hidden="true">
    <aside class="lp-real-sidebar">
      <div class="lp-real-team"><AppLogo size="sm" /></div>
      <div class="lp-real-search"><UButton label="Pesquisar..." icon="i-lucide-search" color="neutral" variant="outline" block /></div>
      <UNavigationMenu :items="items" orientation="vertical" class="px-3" />
      <div class="lp-real-sidebar-bottom">
        <UNavigationMenu :items="[{ label: 'Suporte', icon: 'i-lucide-message-circle' }, { label: 'Ajuda', icon: 'i-lucide-info' }]" orientation="vertical" class="px-3" />
        <div class="lp-real-user"><UAvatar text="OD" size="sm" /><span>Oficina demonstração</span><UIcon name="i-lucide-chevrons-up-down" /></div>
      </div>
    </aside>
    <div class="lp-real-content">
      <div class="lp-real-navbar"><UIcon name="i-lucide-panel-left-close" /><strong>Ordens de Serviço</strong><UIcon name="i-lucide-bell" /></div>
      <div class="lp-real-panel">
        <div class="lp-real-toolbar">
          <UInput placeholder="Buscar por número ou cliente..." icon="i-lucide-search" class="w-72" />
          <UButton label="Filtros" icon="i-lucide-sliders-horizontal" color="neutral" variant="outline" size="sm" />
          <UButton label="Nova OS" icon="i-lucide-plus" size="sm" class="ml-auto" />
        </div>
        <div class="lp-real-orders">
          <OrderCard v-for="order in orders" :key="order.id" :order="order" can-create can-update can-cancel can-delete />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lp-real-screen { display: flex; width: 1120px; height: 680px; background: var(--ui-bg); color: var(--ui-text); font-family: 'Public Sans', sans-serif; font-size: 14px; text-align: left; }
.lp-real-sidebar { display: flex; flex-direction: column; width: 208px; flex-shrink: 0; border-right: 1px solid var(--ui-border); background: color-mix(in srgb, var(--ui-bg-elevated) 25%, var(--ui-bg)); }
.lp-real-team { display: flex; align-items: center; height: 64px; padding: 16px 20px; }
.lp-real-search { padding: 14px 16px 18px; }
.lp-real-sidebar-bottom { margin-top: auto; padding-top: 24px; }
.lp-real-user { display: flex; align-items: center; gap: 10px; border-top: 1px solid var(--ui-border); padding: 16px; font-size: 12px; }
.lp-real-user > .iconify { margin-left: auto; }
.lp-real-content { flex: 1; min-width: 0; }
.lp-real-navbar { display: flex; align-items: center; gap: 16px; height: 64px; padding: 0 24px; border-bottom: 1px solid var(--ui-border); }
.lp-real-navbar strong { font-size: 18px; font-weight: 600; color: var(--ui-text-highlighted); }
.lp-real-navbar .iconify { width: 20px; height: 20px; }
.lp-real-navbar > .iconify:last-child { margin-left: auto; }
.lp-real-panel { margin: 22px; border: 1px solid var(--ui-border); border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px #0f172a12; }
.lp-real-toolbar { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--ui-border); background: color-mix(in srgb, var(--ui-bg-elevated) 25%, var(--ui-bg)); }
.lp-real-orders { display: grid; gap: 12px; padding: 16px; }
</style>
