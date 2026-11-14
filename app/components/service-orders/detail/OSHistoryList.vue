<script setup lang="ts">
import type { OsHistoryDayGroup, OsHistoryEvent } from '~/types/service-order-history'
import { formatTime, getCategoryUi, isExternalSource } from '~/utils/os-history-ui'

defineProps<{
  groups: OsHistoryDayGroup[]
  status: 'idle' | 'loading' | 'ready' | 'error' | 'not-found'
  loadingMore: boolean
  loadMoreError: boolean
  hasMore: boolean
  filtered: boolean
  total: number
}>()

const emit = defineEmits<{
  'load-more': []
  'retry': []
  'clear-filter': []
}>()

function toTimelineItems(items: OsHistoryEvent[]) {
  return items.map((ev) => {
    const ui = getCategoryUi(ev.category)
    return {
      value: ev.id,
      date: formatTime(ev.occurredAt),
      title: ev.title,
      description: ev.description,
      icon: ui.icon,
      ui: { indicator: ui.indicatorClass, date: 'text-muted' },
      event: ev
    }
  })
}
</script>

<template>
  <div class="min-w-0">
    <!-- Carregando a 1ª página -->
    <div v-if="status === 'loading' || status === 'idle'" class="space-y-5 p-4" aria-busy="true">
      <div v-for="n in 4" :key="n" class="flex gap-3">
        <USkeleton class="size-6 shrink-0 rounded-full motion-reduce:animate-none" />
        <div class="min-w-0 flex-1 space-y-2">
          <USkeleton class="h-4 w-2/3 motion-reduce:animate-none" />
          <USkeleton class="h-3 w-full motion-reduce:animate-none" />
          <USkeleton class="h-3 w-1/2 motion-reduce:animate-none" />
        </div>
      </div>
    </div>

    <!-- Erro na 1ª página -->
    <div v-else-if="status === 'error'" class="p-4">
      <UAlert
        color="error"
        variant="subtle"
        title="Não foi possível carregar o histórico."
        :actions="[{ label: 'Tentar novamente', color: 'neutral', variant: 'outline', class: 'max-xl:min-h-11', onClick: () => emit('retry') }]"
      />
    </div>

    <!-- 404: sem botão de retry e sem citar permissão -->
    <div v-else-if="status === 'not-found'" class="p-6 text-center text-sm text-muted">
      Histórico indisponível para esta OS.
    </div>

    <!-- Vazio -->
    <div v-else-if="groups.length === 0" class="flex flex-col items-center gap-2 p-6 text-center">
      <UIcon name="i-lucide-history" class="size-8 text-muted" aria-hidden="true" />
      <template v-if="filtered">
        <p class="text-sm text-muted">
          Nenhum evento nesta categoria.
        </p>
        <UButton
          label="Limpar filtro"
          color="neutral"
          variant="outline"
          size="sm"
          class="max-xl:min-h-11"
          @click="emit('clear-filter')"
        />
      </template>
      <template v-else>
        <p class="text-sm text-muted">
          Nenhum evento registrado para esta OS.
        </p>
        <p class="text-xs text-muted">
          OS criadas antes deste recurso não possuem histórico.
        </p>
      </template>
    </div>

    <!-- Lista -->
    <div v-else class="space-y-1 pb-4">
      <section
        v-for="group in groups"
        :key="group.key"
        :aria-labelledby="`os-history-day-${group.key}`"
      >
        <h3
          :id="`os-history-day-${group.key}`"
          class="sticky top-0 z-10 bg-default px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted"
        >
          {{ group.label }}
        </h3>
        <UTimeline
          :items="toTimelineItems(group.items)"
          size="xs"
          class="px-4"
          :ui="{ item: 'pb-4', wrapper: 'min-w-0 pb-1', title: 'break-words', description: 'break-words text-sm' }"
        >
          <template #description="{ item }">
            <div class="min-w-0 space-y-1">
              <p class="break-words">
                {{ item.event.description }}
              </p>
              <p
                v-if="item.event.actorName"
                class="text-xs text-muted"
              >
                Por {{ item.event.actorName }}
              </p>
              <div class="flex flex-wrap items-center gap-1.5">
                <UBadge
                  :label="getCategoryUi(item.event.category).label"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                />
                <UBadge
                  :label="item.event.source.label"
                  :icon="isExternalSource(item.event.source.code) ? 'i-lucide-external-link' : undefined"
                  color="neutral"
                  variant="outline"
                  size="sm"
                />
              </div>
              <ServiceOrdersDetailOSHistoryEventDetails :details="item.event.details" />
            </div>
          </template>
        </UTimeline>
      </section>

      <!-- Erro ao carregar mais: mantém os itens -->
      <div v-if="loadMoreError" class="px-4">
        <UAlert
          color="error"
          variant="subtle"
          title="Não foi possível carregar mais eventos."
          :actions="[{ label: 'Tentar novamente', color: 'neutral', variant: 'outline', class: 'max-xl:min-h-11', onClick: () => emit('load-more') }]"
        />
      </div>

      <div class="px-4 pt-2">
        <UButton
          v-if="hasMore && !loadMoreError"
          label="Carregar mais"
          color="neutral"
          variant="outline"
          block
          class="max-xl:min-h-11"
          :loading="loadingMore"
          @click="emit('load-more')"
        />
        <p v-else-if="!hasMore && total > 0" class="text-center text-xs text-muted">
          Fim do histórico
        </p>
      </div>
    </div>
  </div>
</template>
