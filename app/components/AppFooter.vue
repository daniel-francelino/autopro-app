<script setup lang="ts">
const links = [
  { label: 'Sistema para oficina', to: '/sistema-para-oficina-mecanica' },
  { label: 'Ordem de serviço', to: '/ordem-de-servico-oficina' },
  { label: 'Comissão de mecânico', to: '/comissao-mecanico' },
  { label: 'Nota fiscal', to: '/nota-fiscal-oficina' },
  { label: 'Financeiro', to: '/controle-financeiro-oficina' },
  { label: 'Estoque de peças', to: '/estoque-pecas-oficina' },
  { label: 'Planos', to: '/pricing' },
  { label: 'Perguntas frequentes', to: '/perguntas-frequentes' },
  { label: 'Suporte', to: 'mailto:suporte@beenk.com.br' },
  { label: 'Entrar', to: '/login' }
]
</script>

<template>
  <USeparator class="h-px" />

  <UFooter :ui="{ top: 'border-b border-default' }">
    <template #left>
      <p class="text-muted text-sm">
        AutoPro • © {{ new Date().getFullYear() }}
      </p>
    </template>

    <template #right>
      <nav aria-label="Rodapé" class="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="text-muted hover:text-highlighted"
        >
          {{ link.label }}
        </NuxtLink>
      </nav>
    </template>
  </UFooter>
</template>
