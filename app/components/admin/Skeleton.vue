<script setup lang="ts">
// Skeleton do admin. variant: kpis (cartões de número) · table (linhas) · card (bloco de texto) · list (linhas curtas).
withDefaults(defineProps<{
  variant?: 'kpis' | 'table' | 'card' | 'list'
  rows?: number
  cols?: number
}>(), { variant: 'card', rows: 5, cols: 4 })
</script>

<template>
  <div v-if="variant === 'kpis'" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
    <div v-for="n in cols" :key="n" class="space-y-3 rounded-lg border border-default bg-elevated/30 p-4">
      <USkeleton class="h-3 w-20" />
      <USkeleton class="h-7 w-28" />
      <USkeleton class="h-3 w-32" />
    </div>
  </div>

  <div v-else-if="variant === 'table'" class="space-y-3 rounded-lg border border-default bg-elevated/30 p-4" aria-busy="true">
    <USkeleton class="h-4 w-40" />
    <div v-for="n in rows" :key="n" class="flex items-center gap-4">
      <USkeleton v-for="c in cols" :key="c" class="h-4 flex-1" />
    </div>
  </div>

  <div v-else-if="variant === 'list'" class="space-y-3" aria-busy="true">
    <div v-for="n in rows" :key="n" class="flex items-center gap-3">
      <USkeleton class="size-8 shrink-0 rounded-full" />
      <div class="flex-1 space-y-2">
        <USkeleton class="h-3 w-1/3" />
        <USkeleton class="h-3 w-2/3" />
      </div>
    </div>
  </div>

  <div v-else class="space-y-3 rounded-lg border border-default bg-elevated/30 p-4" aria-busy="true">
    <USkeleton class="h-4 w-40" />
    <USkeleton class="h-3 w-full" />
    <USkeleton class="h-3 w-5/6" />
    <USkeleton class="h-3 w-2/3" />
  </div>
</template>
