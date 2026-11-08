<template>
  <USeparator class="h-px" />

  <UFooter :ui="{ top: 'border-b border-default' }">
    <template #left>
      <p class="text-muted text-sm">
        AutoPro • © {{ new Date().getFullYear() }}
      </p>
    </template>

    <template #right>
      <nav aria-label="Rodapé" class="flex items-center gap-4 text-sm">
        <NuxtLink to="/pricing" class="text-muted hover:text-highlighted">
          Planos
        </NuxtLink>
        <NuxtLink to="/login" class="text-muted hover:text-highlighted">
          Entrar
        </NuxtLink>
      </nav>
    </template>
  </UFooter>
</template>
