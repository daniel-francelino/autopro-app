<script setup lang="ts">
import type { OsHistoryDayGroup, OsHistoryEvent } from '~/types/service-order-history'
import { formatRelativeTime, formatTime, getCategoryUi, groupEventsByAction, isExternalSource } from '~/utils/os-history-ui'

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

// Com detalhes (antes/depois), a descrição só repete o que o título e os detalhes já dizem:
// mostra apenas "Por <autor>". Sem detalhes (ou sem autor), a descrição carrega a informação e fica.
function eventLine(ev: OsHistoryEvent): string {
  return ev.details.length > 0 && ev.actorName ? `Por ${ev.actorName}` : ev.description
}

function toTimelineItems(items: OsHistoryEvent[]) {
  return groupEventsByAction(items).map((events) => {
    const ev = events[0]!
    const multi = events.length > 1
    const ui = getCategoryUi(ev.category)
    // Categorias e origens distintas da ação (sem repetir badges).
    const categories = [...new Set(events.map(e => e.category))]
    const source = ev.source
    return {
      value: ev.id,
      date: formatRelativeTime(ev.occurredAt),
      exactTime: formatTime(ev.occurredAt),
      title: multi ? undefined : ev.title,
      description: ev.description,
      icon: multi ? 'i-lucide-layers' : ui.icon,
      ui: { indicator: multi ? 'text-muted' : ui.indicatorClass, date: 'text-muted' },
      events,
      multi,
      categories,
      source
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
          <template #date="{ item }">
            <p v-if="item.multi && item.events[0]!.actorName" class="text-xs font-medium text-default">
              Por {{ item.events[0]!.actorName }}
            </p>
            <time :title="item.exactTime">{{ item.date }}</time>
          </template>
          <template #description="{ item }">
            <div class="min-w-0 space-y-1">
              <p v-if="!item.multi" class="break-words">
                {{ eventLine(item.events[0]!) }}
              </p>
              <div class="flex flex-wrap items-center gap-1.5">
                <UBadge
                  v-for="cat in item.categories"
                  :key="cat"
                  :label="getCategoryUi(cat).label"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                />
                <UTooltip :text="item.source.label">
                  <UBadge
                    :label="item.source.label.replace(/\s*\(.*\)\s*$/, '')"
                    :icon="isExternalSource(item.source.code) ? 'i-lucide-external-link' : undefined"
                    color="neutral"
                    variant="outline"
                    size="sm"
                  />
                </UTooltip>
              </div>
              <template v-if="item.multi">
                <div
                  v-for="(ev, idx) in item.events"
                  :key="ev.id"
                  class="mt-3 flex min-w-0 gap-2.5"
                >
                  <!-- Coluna do indicador: círculo + linha vertical ligando ao próximo (igual ao 1º nível) -->
                  <div class="flex shrink-0 flex-col items-center">
                    <span class="flex size-6 items-center justify-center rounded-full bg-elevated">
                      <UIcon
                        :name="getCategoryUi(ev.category).icon"
                        class="size-3.5"
                        :class="getCategoryUi(ev.category).indicatorClass"
                        aria-hidden="true"
                      />
                    </span>
                    <span
                      v-if="idx < item.events.length - 1"
                      class="mt-1 w-px flex-1 bg-accented"
                      aria-hidden="true"
                    />
                  </div>
                  <div class="min-w-0 flex-1" :class="idx < item.events.length - 1 && 'pb-1'">
                    <p class="break-words text-sm font-medium text-highlighted">
                      {{ ev.title }}
                    </p>
                    <!-- Autor já aparece no topo do grupo; só mostra descrição quando ela traz informação (sem detalhes). -->
                    <p v-if="!ev.details.length || !ev.actorName" class="break-words text-xs text-muted">
                      {{ ev.description }}
                    </p>
                    <ServiceOrdersDetailOSHistoryEventDetails :details="ev.details" />
                  </div>
                </div>
              </template>
              <ServiceOrdersDetailOSHistoryEventDetails v-else :details="item.events[0]!.details" />
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
