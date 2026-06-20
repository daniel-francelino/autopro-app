<script setup lang="ts">
import { PostHogEvent } from '~/types/analytics'

const { capture } = usePostHog()
</script>

<template>
  <USeparator icon="i-simple-icons-nuxtdotjs" class="h-px" />

  <UFooter :ui="{ top: 'border-b border-default' }">
    <template #left>
      <p class="text-muted text-sm">
        AutoPro • © {{ new Date().getFullYear() }}
      </p>
    </template>

    <template #right>
      <UButton
        to="/docs/getting-started"
        icon="i-lucide-book-open"
        label="Documentação"
        color="neutral"
        variant="ghost"
        @click="capture(PostHogEvent.PublicFooterCtaClicked, { location: 'footer', target: '/docs/getting-started', target_label: 'Documentation' })"
      />
      <UButton
        to="/blog"
        icon="i-lucide-pencil"
        label="Blog"
        color="neutral"
        variant="ghost"
        @click="capture(PostHogEvent.PublicFooterCtaClicked, { location: 'footer', target: '/blog', target_label: 'Blog' })"
      />
      <UButton
        to="/changelog"
        icon="i-lucide-history"
        label="Novidades"
        color="neutral"
        variant="ghost"
        @click="capture(PostHogEvent.PublicFooterCtaClicked, { location: 'footer', target: '/changelog', target_label: 'Changelog' })"
      />
    </template>
  </UFooter>
</template>
