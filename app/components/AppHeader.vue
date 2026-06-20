<script setup lang="ts">
import { PostHogEvent } from '~/types/analytics'

const { capture } = usePostHog()

function trackNavigation(label: string, target: string, location: 'header' | 'header-mobile') {
  capture(PostHogEvent.PublicNavigationClicked, {
    location,
    target,
    target_label: label
  })
}

const items = computed(() => [{
  label: 'Planos',
  to: '/pricing',
  onSelect: () => trackNavigation('Pricing', '/pricing', 'header')
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
        color="neutral"
        variant="ghost"
        to="/login"
        class="lg:hidden"
        @click="trackNavigation('Login', '/login', 'header')"
      />

      <UButton
        label="Entrar"
        color="neutral"
        variant="outline"
        to="/login"
        class="hidden lg:inline-flex"
        @click="trackNavigation('Login', '/login', 'header')"
      />

      <UButton
        label="Criar conta"
        color="neutral"
        trailing-icon="i-lucide-arrow-right"
        class="hidden lg:inline-flex"
        to="/signup"
        @click="trackNavigation('Signup', '/signup', 'header')"
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
        @click="trackNavigation('Login', '/login', 'header-mobile')"
      />
      <UButton
        label="Criar conta"
        color="neutral"
        to="/signup"
        block
        @click="trackNavigation('Signup', '/signup', 'header-mobile')"
      />
    </template>
  </UHeader>
</template>
