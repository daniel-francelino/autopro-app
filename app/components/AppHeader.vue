<script setup lang="ts">
const { track } = useAnalytics()

const items = computed(() => [{
  label: 'Planos',
  to: '/pricing',
  onSelect: () => track('nav_click')
}])
</script>

<template>
  <UHeader>
    <template #left>
      <NuxtLink
        to="/"
        aria-label="AutoPro"
        class="flex items-center"
      >
        <AppLogo />
      </NuxtLink>
    </template>

    <UNavigationMenu
      :items="items"
      variant="link"
    />

    <template #right>
      <UButton
        icon="i-lucide-log-in"
        aria-label="Entrar"
        color="neutral"
        variant="ghost"
        to="/login"
        class="lg:hidden"
        @click="track('nav_click')"
      />

      <UButton
        label="Entrar"
        color="neutral"
        variant="outline"
        to="/login"
        class="hidden lg:inline-flex"
        @click="track('nav_click')"
      />

      <UButton
        label="Criar conta"
        color="neutral"
        trailing-icon="i-lucide-arrow-right"
        class="hidden lg:inline-flex"
        to="/signup"
        @click="track('nav_click')"
      />
    </template>

    <template #body>
      <UNavigationMenu
        :items="items"
        orientation="vertical"
        class="-mx-2.5"
      />

      <USeparator class="my-6" />

      <UButton
        label="Entrar"
        color="neutral"
        variant="subtle"
        to="/login"
        block
        class="mb-3"
        @click="track('nav_click')"
      />
      <UButton
        label="Criar conta"
        color="neutral"
        to="/signup"
        block
        @click="track('nav_click')"
      />
    </template>
  </UHeader>
</template>
