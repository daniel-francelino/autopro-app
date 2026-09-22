<script setup lang="ts">
import { Motion, useReducedMotion } from 'motion-v'
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  as?: 'div' | 'article' | 'section'
  delay?: number
  distance?: number
  interactive?: boolean
}>(), { as: 'div', delay: 0, distance: 24, interactive: false })

const reducedMotion = useReducedMotion()
const entrance = computed(() => reducedMotion.value
  ? { opacity: 1, y: 0 }
  : { opacity: [0, 1], y: [props.distance, 0] })
</script>

<template>
  <!-- Keep SSR content visible, including when JavaScript is unavailable. -->
  <Motion
    :as="as"
    :initial="false"
    :while-in-view="entrance"
    :in-view-options="{ once: true, amount: 0.12 }"
    :while-hover="interactive && !reducedMotion ? { y: -5, transition: { duration: 0.2 } } : undefined"
    :transition="{ duration: reducedMotion ? 0 : 0.6, delay: reducedMotion ? 0 : delay, ease: [0.22, 1, 0.36, 1] }"
  >
    <slot />
  </Motion>
</template>
