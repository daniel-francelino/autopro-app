<script setup lang="ts">
// Estado vazio padrão do admin: ícone, título curto, explicação do porquê e (opcional) o próximo passo.
withDefaults(defineProps<{
  icon?: string
  title: string
  description?: string
  /** Sem borda/fundo, para uso dentro de cards e tabelas. */
  flat?: boolean
}>(), { icon: 'i-lucide-inbox', description: undefined, flat: true })
</script>

<template>
  <div
    class="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center"
    :class="flat ? '' : 'rounded-lg border border-dashed border-default bg-elevated/30'"
  >
    <span class="flex size-11 items-center justify-center rounded-full bg-elevated text-muted">
      <UIcon :name="icon" class="size-5" />
    </span>
    <p class="text-sm font-medium text-highlighted">
      {{ title }}
    </p>
    <p v-if="description" class="max-w-md text-xs text-muted">
      {{ description }}
    </p>
    <div v-if="$slots.default" class="mt-2 flex flex-wrap items-center justify-center gap-2">
      <slot />
    </div>
  </div>
</template>
