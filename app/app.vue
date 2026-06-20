<script setup lang="ts">
import { pt_br } from '@nuxt/ui/locale'

const route = useRoute()
const { state: preferencesState, applyBrandTheme, applyPublicTheme, applyStoredTheme } = useUserPreferences()
const runtimeConfig = useRuntimeConfig()
const auth = useAuth()
const bootstrap = useWorkshopBootstrap()

const color = '#f8fafc'
const isAppRoute = computed(() => route.path.startsWith('/app'))
const isProtectedRoute = computed(() =>
  route.path.startsWith('/app')
  || route.path.startsWith('/admin')
  || route.path === '/onboarding'
  || route.path.startsWith('/onboarding/')
  || route.path === '/subscription'
  || route.path.startsWith('/subscription/')
  || route.path.startsWith('/checkout')
)
const showAppLoadingOverlay = computed(() =>
  auth.loading.value
  || (isProtectedRoute.value && !auth.ready.value)
  || (isProtectedRoute.value && auth.isAuthenticated.value && bootstrap.pending.value)
)
const siteUrl = runtimeConfig.public.siteUrl?.replace(/\/$/, '') || 'https://autopro.app'
const defaultOgImage = `${siteUrl}/icons/icon-512x512.png`

watch(
  () => [
    route.path,
    preferencesState.value.loaded,
    preferencesState.value.primary_color,
    preferencesState.value.neutral_color,
    preferencesState.value.color_mode
  ],
  () => {
    if (!isAppRoute.value) {
      applyPublicTheme()
      return
    }

    if (!preferencesState.value.loaded) {
      applyBrandTheme()
      return
    }

    applyStoredTheme()
  },
  { immediate: true }
)

useHead({
  meta: [
    { charset: 'utf-8' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover' },
    { key: 'theme-color', name: 'theme-color', content: color },
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    { name: 'apple-mobile-web-app-title', content: 'AutoPro' },
    { name: 'mobile-web-app-capable', content: 'yes' },
    { name: 'format-detection', content: 'telephone=no' }
  ],
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/icons/autopro-icon.svg' },
    { rel: 'alternate icon', type: 'image/png', href: '/icons/icon-192x192.png' },
    { rel: 'shortcut icon', href: '/favicon.ico' },
    { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
    { rel: 'mask-icon', href: '/icons/autopro-mono.svg', color: '#8b5cf6' }
  ],
  htmlAttrs: {
    lang: 'pt-BR'
  }
})

useSeoMeta({
  titleTemplate: '%s - AutoPro',
  applicationName: 'AutoPro',
  appleMobileWebAppTitle: 'AutoPro',
  author: 'AutoPro',
  ogSiteName: 'AutoPro',
  ogImage: defaultOgImage,
  twitterImage: defaultOgImage,
  twitterCard: 'summary_large_image'
})

const { data: navigation } = await useAsyncData('navigation', () => queryCollectionNavigation('docs'), {
  transform: data => (data ?? []).find(item => item.path === '/docs')?.children || []
})
const { data: files } = useLazyAsyncData('search', () => queryCollectionSearchSections('docs'), {
  server: false
})

const links = [{
  label: 'Planos',
  icon: 'i-lucide-credit-card',
  to: '/pricing'
}]

provide('navigation', navigation)
</script>

<template>
  <UApp :locale="pt_br">
    <NuxtLoadingIndicator
      color="linear-gradient(90deg, #9333ea 0%, #a855f7 45%, #9333ea 100%)"
      error-color="#fb7185"
      :height="3"
    />

    <ClientOnly>
      <CapacitorInit />
    </ClientOnly>

    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <div
      v-if="showAppLoadingOverlay"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-default/92 backdrop-blur-sm"
      aria-live="polite"
      aria-busy="true"
    >
      <div class="flex flex-col items-center gap-3 text-center">
        <UIcon name="i-lucide-loader-2" class="size-9 animate-spin text-primary" />
        <p class="text-sm font-medium text-highlighted">
          Carregando sua sessão...
        </p>
        <p class="max-w-xs text-xs text-muted">
          Estamos verificando o acesso e preparando o ambiente.
        </p>
      </div>
    </div>

    <ClientOnly>
      <LazyUContentSearch
        :files="files"
        shortcut="meta_k"
        :navigation="navigation"
        :links="links"
        :fuse="{ resultLimit: 42 }"
      />
    </ClientOnly>
  </UApp>
</template>
