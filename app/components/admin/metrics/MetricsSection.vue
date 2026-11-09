<script setup lang="ts">
defineProps<{ title: string, description?: string }>()
</script>

<template>
  <UPageCard variant="subtle" :ui="{ container: 'p-4 sm:p-5 gap-3' }">
    <div>
      <h3 class="text-base font-semibold text-highlighted">
        {{ title }}
      </h3>
      <p v-if="description" class="text-sm text-muted">
        {{ description }}
      </p>
    </div>
    <slot />
  </UPageCard>
</template>
