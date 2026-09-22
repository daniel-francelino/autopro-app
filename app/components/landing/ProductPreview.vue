<script setup lang="ts">
import { AnimatePresence, Motion, useReducedMotion } from 'motion-v'

const reducedMotion = useReducedMotion()
const activeView = ref('orders')
const views = [
  { id: 'orders', label: 'Ordens de serviço', icon: 'i-lucide-clipboard-list' },
  { id: 'finance', label: 'Financeiro', icon: 'i-lucide-chart-no-axes-combined' },
  { id: 'stock', label: 'Estoque', icon: 'i-lucide-package' }
]
const orders = [
  { car: 'Honda Civic', service: 'Revisão preventiva', status: 'Em execução', class: 'blue', value: 'R$ 850,00' },
  { car: 'Volkswagen Polo', service: 'Troca de óleo e filtros', status: 'Aguardando', class: 'amber', value: 'R$ 420,00' },
  { car: 'Chevrolet Onix', service: 'Alinhamento e balanceamento', status: 'Concluído', class: 'green', value: 'R$ 280,00' }
]
const products = [
  { name: 'Óleo sintético 5W30', category: 'Lubrificantes', quantity: '24 un.', state: 'Em estoque', class: 'green' },
  { name: 'Filtro de óleo', category: 'Filtros', quantity: '18 un.', state: 'Em estoque', class: 'green' },
  { name: 'Pastilha de freio', category: 'Freios', quantity: '3 un.', state: 'Estoque baixo', class: 'amber' }
]
</script>

<template>
  <div class="lp-product">
    <div class="lp-product-browser">
      <span /><span /><span /><div><UIcon name="i-lucide-lock-keyhole" /> Sua oficina, conectada</div><UIcon name="i-lucide-panel-top" />
    </div>
    <div class="lp-product-body">
      <aside class="lp-product-sidebar" aria-label="Explorar a prévia do sistema">
        <span class="lp-mini-brand" aria-hidden="true"><UIcon name="i-lucide-command" /></span>
        <button
          v-for="view in views"
          :key="view.id"
          type="button"
          :class="{ active: activeView === view.id }"
          :aria-label="`Prévia: ${view.label}`"
          :aria-pressed="activeView === view.id"
          @click="activeView = view.id"
        >
          <UIcon :name="view.icon" />
        </button>
        <span class="lp-sidebar-avatar" aria-hidden="true">OF</span>
      </aside>
      <div class="lp-product-main">
        <div class="lp-product-topline">
          <span>Minha oficina <UIcon name="i-lucide-chevron-down" /></span><span class="lp-product-user"><UIcon name="i-lucide-bell" /><span>OF</span></span>
        </div>
        <div class="lp-product-title">
          <div><span>VISÃO GERAL</span><h2>Sua oficina em movimento <span>✦</span></h2></div><span class="lp-today">Hoje</span>
        </div>
        <div class="lp-preview-stats">
          <div><span>Em andamento</span><strong>08 <UIcon name="i-lucide-wrench" /></strong><small>Serviços em execução</small></div><div><span>Concluídas hoje</span><strong>12 <UIcon name="i-lucide-circle-check" /></strong><small>Prontas para a próxima etapa</small></div><div><span>Recebido hoje</span><strong>R$ 4.850</strong><small class="lp-stat-positive">Pagamentos registrados</small></div>
        </div>
        <div class="lp-preview-switch" role="group" aria-label="Escolha uma prévia">
          <button
            v-for="view in views"
            :key="view.id"
            type="button"
            :class="{ active: activeView === view.id }"
            :aria-pressed="activeView === view.id"
            @click="activeView = view.id"
          >
            {{ view.label }}
          </button>
        </div>
        <div class="lp-preview-panel" aria-live="polite">
          <AnimatePresence :initial="false" mode="wait">
            <Motion
              :key="activeView"
              :initial="reducedMotion ? false : { opacity: 0, y: 8 }"
              :animate="{ opacity: 1, y: 0 }"
              :exit="{ opacity: 0, y: reducedMotion ? 0 : -5 }"
              :transition="{ duration: reducedMotion ? 0 : 0.16, ease: 'easeOut' }"
            >
              <template v-if="activeView === 'orders'">
                <div class="lp-preview-panel-heading">
                  <strong>Ordens de serviço</strong><span>3 atendimentos</span>
                </div>
                <div v-for="order in orders" :key="order.car" class="lp-preview-row">
                  <span class="lp-car-icon"><UIcon name="i-lucide-car-front" /></span><div class="lp-row-name">
                    <strong>{{ order.car }}</strong><span>{{ order.service }}</span>
                  </div><span class="lp-badge" :class="order.class">{{ order.status }}</span><strong class="lp-row-value">{{ order.value }}</strong>
                </div>
              </template>
              <template v-else-if="activeView === 'finance'">
                <div class="lp-preview-panel-heading">
                  <strong>Resumo da semana</strong><span>Entradas recebidas</span>
                </div>
                <div class="lp-preview-chart" role="img" aria-label="Exemplo de entradas na semana: segunda 1800, terça 2600, quarta 2100, quinta 3800 e sexta 4850 reais">
                  <div v-for="(bar, index) in [37, 54, 43, 78, 100]" :key="index">
                    <Motion
                      as="span"
                      :style="{ height: `${bar}%`, transformOrigin: 'bottom' }"
                      :initial="false"
                      :while-in-view="reducedMotion ? { scaleY: 1 } : { scaleY: [0, 1] }"
                      :in-view-options="{ once: true }"
                      :transition="{ duration: reducedMotion ? 0 : 0.45, delay: reducedMotion ? 0 : index * 0.06 }"
                    /><small>{{ ['SEG', 'TER', 'QUA', 'QUI', 'SEX'][index] }}</small>
                  </div>
                </div>
                <div class="lp-chart-total">
                  <span>Recebido na semana</span><strong>R$ 15.150,00</strong>
                </div>
              </template>
              <template v-else>
                <div class="lp-preview-panel-heading">
                  <strong>Peças e produtos</strong><span>Controle de estoque</span>
                </div>
                <div v-for="product in products" :key="product.name" class="lp-preview-row">
                  <span class="lp-car-icon"><UIcon name="i-lucide-package" /></span><div class="lp-row-name">
                    <strong>{{ product.name }}</strong><span>{{ product.category }}</span>
                  </div><span class="lp-badge" :class="product.class">{{ product.state }}</span><strong class="lp-row-value">{{ product.quantity }}</strong>
                </div>
              </template>
            </Motion>
          </AnimatePresence>
        </div>
        <div class="lp-preview-bottom">
          <span><span class="lp-status-dot" /> Tudo em um só lugar</span><span>Uma gestão mais simples <UIcon name="i-lucide-sparkles" /></span>
        </div>
      </div>
    </div>
  </div>
</template>
