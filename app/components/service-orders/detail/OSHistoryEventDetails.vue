<script setup lang="ts">
import type { OsHistoryDetail } from '~/types/service-order-history'

const props = defineProps<{
  details: OsHistoryDetail[]
}>()

// Até 2 alterações aparecem abertas; acima disso ficam recolhidas ("Ver N alterações").
const INLINE_LIMIT = 2
const collapsible = computed(() => props.details.length > INLINE_LIMIT)
</script>

<template>
  <UCollapsible
    v-if="details.length"
    :default-open="!collapsible"
    class="mt-2 min-w-0"
  >
    <UButton
      v-if="collapsible"
      color="neutral"
      variant="link"
      size="xs"
      class="px-0 max-xl:min-h-11"
      trailing-icon="i-lucide-chevron-down"
      :label="`Ver ${details.length} alterações`"
    />
    <template #content>
      <dl class="mt-1 space-y-1.5 text-xs">
        <div v-for="(d, i) in details" :key="i" class="min-w-0 break-words">
          <template v-if="d.from === null && d.to === null">
            <dt class="text-muted">
              {{ d.label }}
            </dt>
          </template>
          <template v-else>
            <dt class="font-medium text-highlighted">
              {{ d.label }}
            </dt>
            <dd v-if="d.from === null || d.to === null" class="text-muted">
              <template v-if="d.from === null">
                <span>adicionado</span>
                <span aria-hidden="true"> · </span>
                <span class="text-default">{{ d.to }}</span>
              </template>
              <template v-else-if="d.to === null">
                <span class="text-default">{{ d.from }}</span>
                <span aria-hidden="true"> · </span>
                <span>removido</span>
              </template>
            </dd>
            <dd v-else class="mt-1 grid grid-cols-2 gap-2">
              <div class="min-w-0 rounded-md bg-elevated px-3 py-2">
                <p class="text-xs text-muted">
                  Antes
                </p>
                <p class="break-words text-sm text-default">
                  {{ d.from }}
                </p>
              </div>
              <div class="min-w-0 rounded-md bg-primary/10 px-3 py-2">
                <p class="text-xs text-muted">
                  Depois
                </p>
                <p class="break-words text-sm font-semibold text-primary">
                  {{ d.to }}
                </p>
              </div>
            </dd>
          </template>
        </div>
      </dl>
    </template>
  </UCollapsible>
</template>
