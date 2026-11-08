<script setup lang="ts">
import type { NuxtError } from '#app'
import { pt_br } from '@nuxt/ui/locale'

const props = defineProps({
  error: {
    type: Object as PropType<NuxtError>,
    required: true
  }
})

const route = useRoute()

const statusCode = computed(() => props.error.statusCode || 500)
const isNotFound = computed(() => statusCode.value === 404)
const isAppRoute = computed(() => route.path.startsWith('/app'))
const isAdminRoute = computed(() => route.path.startsWith('/admin'))
const isDocsRoute = computed(() => route.path.startsWith('/docs'))

const title = computed(() => (
  isNotFound.value
    ? 'Página não encontrada'
    : 'Algo saiu da rota'
))

const description = computed(() => {
  if (isNotFound.value) {
    return isAppRoute.value
      ? 'A rota que você tentou abrir não existe ou foi movida. Use os atalhos abaixo para voltar rapidamente ao fluxo da oficina.'
      : 'O endereço informado não existe ou foi movido. Você pode voltar para uma área segura do AutoPro usando os atalhos abaixo.'
  }

  return 'Encontramos um erro inesperado ao carregar esta tela. Você pode tentar novamente ou voltar para uma área estável do sistema.'
})

const errorBadge = computed(() => (
  isNotFound.value
    ? 'Erro 404'
    : `Erro ${statusCode.value}`
))

const statusLabel = computed(() => (
  isNotFound.value
    ? 'Rota indisponível'
    : 'Falha de carregamento'
))

const primaryAction = computed(() => {
  if (isAdminRoute.value) {
    return {
      label: 'Ir para o painel admin',
      to: '/admin'
    }
  }

  if (isAppRoute.value) {
    return {
      label: 'Ir para o dashboard',
      to: '/app'
    }
  }

  if (isDocsRoute.value) {
    return {
      label: 'Abrir documentação',
      to: '/docs/getting-started'
    }
  }

  return {
    label: 'Voltar para a home',
    to: '/'
  }
})

const secondaryAction = computed(() => {
  if (isAppRoute.value) {
    return {
      label: 'Abrir produtos',
      to: '/app/products'
    }
  }

  if (isDocsRoute.value) {
    return {
      label: 'Ver planos',
      to: '/pricing'
    }
  }

  return {
    label: 'Ler a documentação',
    to: '/docs/getting-started'
  }
})

const guidance = computed(() => {
  if (isNotFound.value) {
    return [
      'Confira se o link foi digitado corretamente.',
      'Se a página mudou de lugar, volte pelo menu principal.',
      'Em áreas internas, prefira acessar pelos atalhos da sidebar.'
    ]
  }

  return [
    'Atualize a página para tentar novamente.',
    'Se o problema persistir, volte para uma área segura.',
    'Se necessário, registre o caminho exibido para suporte.'
  ]
})

async function navigateFromError(to: string) {
  await clearError({ redirect: to })
}

function goBack() {
  if (import.meta.client && window.history.length > 1) {
    window.history.back()
    return
  }

  void navigateFromError(primaryAction.value.to)
}

useHead({
  htmlAttrs: {
    lang: 'pt-BR'
  }
})

useSeoMeta({
  title: () => title.value,
  description: () => description.value
})
</script>

<template>
  <UApp :locale="pt_br">
    <main class="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_30%),linear-gradient(180deg,_#f8fafc_0%,_#eef4ff_42%,_#f8fafc_100%)] text-default dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.24),_transparent_24%),linear-gradient(180deg,_#020617_0%,_#0f172a_54%,_#020617_100%)]">
      <div class="pointer-events-none absolute inset-0">
        <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div class="absolute left-1/2 top-16 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
        <div class="absolute -left-20 top-24 h-64 w-64 rounded-full bg-sky-400/10 blur-3xl" />
        <div class="absolute -right-16 bottom-10 h-80 w-80 rounded-full bg-cyan-300/10 blur-3xl" />
        <div class="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0.2))]" />
      </div>

      <div class="relative mx-auto flex min-h-screen w-full max-w-7xl items-center px-6 py-12 sm:px-8 lg:px-12">
        <div class="grid w-full gap-8 lg:grid-cols-[minmax(0,1.1fr)_420px] lg:items-center">
          <section class="relative overflow-hidden rounded-[2rem] border border-white/60 bg-white/72 p-8 shadow-[0_25px_80px_rgba(15,23,42,0.10)] backdrop-blur-xl dark:border-white/10 dark:bg-white/6 dark:shadow-[0_30px_100px_rgba(2,6,23,0.55)] sm:p-10">
            <div class="absolute right-0 top-0 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
            <div class="absolute -bottom-10 left-10 h-32 w-32 rounded-full bg-sky-300/20 blur-3xl" />

            <div class="relative flex flex-col gap-8">
              <div class="flex flex-wrap items-center gap-3">
                <UBadge
                  color="primary"
                  variant="subtle"
                  class="rounded-full px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.24em]"
                >
                  {{ errorBadge }}
                </UBadge>

                <span class="text-xs font-medium uppercase tracking-[0.26em] text-muted">
                  {{ statusLabel }}
                </span>
              </div>

              <div class="space-y-4">
                <p class="text-[5rem] leading-none font-semibold tracking-[-0.08em] text-primary/85 sm:text-[7rem]">
                  {{ statusCode }}
                </p>

                <div class="max-w-2xl space-y-3">
                  <h1 class="text-3xl font-semibold tracking-[-0.04em] text-highlighted sm:text-5xl">
                    {{ title }}
                  </h1>

                  <p class="max-w-xl text-sm leading-7 text-toned sm:text-base">
                    {{ description }}
                  </p>
                </div>
              </div>

              <div class="flex flex-wrap gap-3">
                <UButton
                  color="primary"
                  size="xl"
                  icon="i-lucide-arrow-right"
                  trailing
                  @click="navigateFromError(primaryAction.to)"
                >
                  {{ primaryAction.label }}
                </UButton>

                <UButton
                  color="neutral"
                  variant="soft"
                  size="xl"
                  icon="i-lucide-compass"
                  @click="navigateFromError(secondaryAction.to)"
                >
                  {{ secondaryAction.label }}
                </UButton>

                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xl"
                  icon="i-lucide-undo-2"
                  @click="goBack"
                >
                  Voltar
                </UButton>
              </div>

              <div class="grid gap-4 border-t border-default/60 pt-6 text-sm text-muted sm:grid-cols-[1.3fr_0.7fr]">
                <div class="space-y-3">
                  <p class="font-medium uppercase tracking-[0.2em] text-[0.7rem] text-toned">
                    Caminho solicitado
                  </p>
                  <code class="block overflow-x-auto rounded-2xl border border-default/70 bg-default/60 px-4 py-3 text-sm text-highlighted">
                    {{ route.path }}
                  </code>
                </div>

                <div class="space-y-3">
                  <p class="font-medium uppercase tracking-[0.2em] text-[0.7rem] text-toned">
                    Próximos passos
                  </p>
                  <ul class="space-y-2 leading-6">
                    <li
                      v-for="item in guidance"
                      :key="item"
                      class="flex gap-2"
                    >
                      <UIcon name="i-lucide-dot" class="mt-1 size-4 shrink-0 text-primary" />
                      <span>{{ item }}</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          <aside class="relative overflow-hidden rounded-[2rem] border border-white/55 bg-slate-950 p-7 text-white shadow-[0_30px_90px_rgba(15,23,42,0.24)] sm:p-8">
            <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(56,189,248,0.24),_transparent_28%),radial-gradient(circle_at_bottom_left,_rgba(59,130,246,0.2),_transparent_32%)]" />
            <div class="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),transparent_40%,rgba(255,255,255,0.04))]" />

            <div class="relative flex h-full flex-col gap-6">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="flex size-11 items-center justify-center rounded-2xl border border-white/15 bg-white/10">
                    <UIcon name="i-lucide-car-front" class="size-5 text-sky-300" />
                  </div>
                  <div>
                    <p class="text-sm font-semibold tracking-[0.18em] text-sky-200 uppercase">
                      AutoPro
                    </p>
                    <p class="text-xs text-white/60">
                      Centro de navegação
                    </p>
                  </div>
                </div>

                <UIcon name="i-lucide-route-off" class="size-5 text-white/45" />
              </div>

              <div class="space-y-3">
                <p class="text-xs font-medium uppercase tracking-[0.24em] text-sky-200/80">
                  Diagnóstico rápido
                </p>
                <h2 class="text-2xl font-semibold tracking-[-0.04em]">
                  A rota saiu do mapa, mas o sistema continua acessível.
                </h2>
                <p class="text-sm leading-7 text-white/72">
                  Use um dos atalhos principais para retomar o fluxo. Isso ajuda quando links antigos, permissões ou caminhos digitados manualmente apontam para telas inexistentes.
                </p>
              </div>

              <div class="grid gap-3">
                <button
                  type="button"
                  class="group rounded-2xl border border-white/12 bg-white/6 p-4 text-left transition hover:border-sky-300/40 hover:bg-white/10"
                  @click="navigateFromError(primaryAction.to)"
                >
                  <div class="flex items-center justify-between gap-4">
                    <div>
                      <p class="text-sm font-semibold text-white">
                        {{ primaryAction.label }}
                      </p>
                      <p class="mt-1 text-sm text-white/60">
                        Retoma a navegação por um ponto seguro do sistema.
                      </p>
                    </div>
                    <UIcon name="i-lucide-arrow-up-right" class="size-5 text-sky-300 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>
                </button>

                <button
                  type="button"
                  class="group rounded-2xl border border-white/12 bg-white/6 p-4 text-left transition hover:border-sky-300/40 hover:bg-white/10"
                  @click="navigateFromError(secondaryAction.to)"
                >
                  <div class="flex items-center justify-between gap-4">
                    <div>
                      <p class="text-sm font-semibold text-white">
                        {{ secondaryAction.label }}
                      </p>
                      <p class="mt-1 text-sm text-white/60">
                        Atalho alternativo para continuar sem perder tempo.
                      </p>
                    </div>
                    <UIcon name="i-lucide-compass" class="size-5 text-sky-300" />
                  </div>
                </button>
              </div>

              <div class="mt-auto rounded-2xl border border-white/10 bg-black/20 p-4">
                <p class="text-xs font-medium uppercase tracking-[0.24em] text-white/45">
                  Mensagem técnica
                </p>
                <p class="mt-2 text-sm leading-6 text-white/72">
                  {{ error.message || 'Sem detalhes adicionais do erro.' }}
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <UToaster />
    </main>
  </UApp>
</template>
