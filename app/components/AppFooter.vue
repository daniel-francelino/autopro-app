<script setup lang="ts">
const columns = [
  {
    title: 'Produto',
    links: [
      { label: 'Sistema para oficina', to: '/sistema-para-oficina-mecanica' },
      { label: 'Ordem de serviço', to: '/ordem-de-servico-oficina' },
      { label: 'Comissão de mecânico', to: '/comissao-mecanico' },
      { label: 'Nota fiscal', to: '/nota-fiscal-oficina' },
      { label: 'Financeiro', to: '/controle-financeiro-oficina' },
      { label: 'Estoque de peças', to: '/estoque-pecas-oficina' }
    ]
  },
  {
    title: 'Empresa',
    links: [
      { label: 'Planos', to: '/pricing' },
      { label: 'Perguntas frequentes', to: '/perguntas-frequentes' },
      { label: 'Suporte', to: 'mailto:suporte@beenk.com.br' },
      { label: 'Entrar', to: '/login' }
    ]
  }
]

const year = new Date().getFullYear()
</script>

<template>
  <footer class="border-t border-default bg-elevated/30">
    <div class="mx-auto w-full max-w-7xl px-6 py-12 lg:px-8 lg:py-16">
      <div class="grid gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,1fr))] lg:gap-16">
        <div class="space-y-4 sm:col-span-2 lg:col-span-1">
          <NuxtLink
            to="/"
            class="inline-flex items-center"
            aria-label="AutoPro — página inicial"
          >
            <AppLogo />
          </NuxtLink>
          <p class="max-w-sm text-sm leading-relaxed text-muted">
            Sistema de gestão para oficina mecânica: ordens de serviço, clientes e veículos, estoque, financeiro,
            comissões e nota fiscal em um só lugar.
          </p>
        </div>

        <nav
          v-for="column in columns"
          :key="column.title"
          :aria-label="column.title"
        >
          <h2 class="text-sm font-semibold text-highlighted">
            {{ column.title }}
          </h2>
          <ul class="mt-4 space-y-3">
            <li
              v-for="link in column.links"
              :key="link.to"
            >
              <NuxtLink
                :to="link.to"
                class="text-sm text-muted transition-colors hover:text-highlighted"
              >
                {{ link.label }}
              </NuxtLink>
            </li>
          </ul>
        </nav>
      </div>

      <div class="mt-12 flex flex-col gap-2 border-t border-default pt-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>© {{ year }} AutoPro. Todos os direitos reservados.</p>
        <NuxtLink
          to="mailto:suporte@beenk.com.br"
          class="transition-colors hover:text-highlighted"
        >
          suporte@beenk.com.br
        </NuxtLink>
      </div>
    </div>
  </footer>
</template>
