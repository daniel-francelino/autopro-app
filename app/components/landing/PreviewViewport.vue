<script setup lang="ts">
import { useElementSize } from '@vueuse/core'

const viewport = ref<HTMLElement | null>(null)
const { width } = useElementSize(viewport, { width: 560, height: 340 })
const scale = computed(() => width.value / 1120)
</script>

<template>
  <div ref="viewport" class="lp-preview-viewport" role="img" aria-label="Prévia da tela de Ordens de Serviço: menu lateral, busca, filtros e cartões com cliente, veículo, status, pagamento, responsáveis e valor. Todos os dados são fictícios.">
    <div class="lp-preview-canvas" :style="{ transform: `scale(${scale})` }">
      <LandingServiceOrdersScreen />
    </div>
  </div>
</template>

<style scoped>
.lp-preview-viewport { position: relative; width: 100%; aspect-ratio: 1120 / 680; overflow: hidden; background: var(--ui-bg); }
.lp-preview-canvas { width: 1120px; height: 680px; transform-origin: top left; }
</style>
