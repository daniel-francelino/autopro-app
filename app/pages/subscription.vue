<script setup lang="ts">
definePageMeta({
  layout: 'subscription'
})

useSeoMeta({
  title: 'Escolha seu plano — beenk',
  description: 'Selecione um plano para começar a usar o sistema de gestão'
})

const toast = useToast()
const { plans } = usePlans()

const loadingPlanKey = ref<string | null>(null)

async function subscribe(plan: { key: string, priceId: string | null }) {
  if (loadingPlanKey.value) return

  if (!plan.priceId) {
    toast.add({
      title: 'Plano indisponível',
      description: 'Este plano ainda não está configurado. Tente novamente em breve.',
      color: 'warning'
    })
    return
  }

  loadingPlanKey.value = plan.key

  try {
    const { url } = await $fetch<{ url: string }>('/api/stripe/checkout', {
      method: 'POST',
      body: { priceId: plan.priceId },
      credentials: 'include'
    })

    // Hard redirect to Stripe — navigateTo doesn't work for external URLs
    window.location.href = url
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao iniciar assinatura',
      description: err?.data?.statusMessage || err?.statusMessage || 'Tente novamente em instantes.',
      color: 'error'
    })
    loadingPlanKey.value = null
  }
}
</script>

<template>
  <div class="space-y-10">
    <!-- ─── Cabeçalho ────────────────────────────────────────────────────── -->
    <div class="text-center space-y-4 animate-fade-in">
      <div class="flex justify-center">
        <UBadge
          color="primary"
          variant="subtle"
          size="md"
          icon="i-lucide-sparkles"
          class="animate-bounce-subtle"
        >
          Falta pouco!
        </UBadge>
      </div>

      <h1 class="text-3xl font-bold tracking-tight text-highlighted">
        Escolha seu plano para continuar
      </h1>

      <p class="text-muted max-w-md mx-auto leading-relaxed text-sm">
        Sua conta foi criada. Selecione um plano abaixo para liberar o acesso
        completo ao sistema de gestão da sua oficina.
      </p>
    </div>

    <!-- ─── Cards ─────────────────────────────────────────────────────────── -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
      <div
        v-for="(plan, index) in plans"
        :key="plan.key"
        class="group relative flex flex-col rounded-2xl border cursor-pointer
               transition-all duration-300 ease-out
               hover:-translate-y-1.5 hover:shadow-xl"
        :class="[
          plan.highlight
            ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10 hover:shadow-primary/20'
            : 'border-default bg-default shadow-sm hover:border-primary/30 hover:bg-primary/2',
          'animate-fade-up'
        ]"
        :style="{ animationDelay: `${index * 80}ms` }"
      >
        <!-- Badge -->
        <div
          v-if="plan.badge"
          class="absolute -top-3 left-1/2 -translate-x-1/2 z-10 transition-transform duration-300 group-hover:scale-105"
        >
          <UBadge color="primary" variant="solid" size="sm">
            {{ plan.badge }}
          </UBadge>
        </div>

        <div class="flex flex-col flex-1 p-6 gap-5">
          <!-- Nome + Preço -->
          <div class="space-y-1">
            <p
              class="text-xs font-semibold uppercase tracking-widest transition-colors duration-200"
              :class="plan.highlight ? 'text-primary' : 'text-muted group-hover:text-primary/70'"
            >
              {{ plan.name }}
            </p>

            <div class="flex items-baseline gap-1">
              <span
                class="text-4xl font-bold tabular-nums transition-colors duration-200"
                :class="plan.highlight ? 'text-primary' : 'text-highlighted'"
              >
                {{ plan.price }}
              </span>
              <span class="text-muted text-sm">/mês</span>
            </div>

            <p class="text-sm text-muted leading-snug">
              {{ plan.description }}
            </p>
          </div>

          <USeparator />

          <!-- Features -->
          <ul class="space-y-2.5 flex-1">
            <li
              v-for="(feature, fi) in plan.features"
              :key="feature"
              class="flex items-center gap-2.5 text-sm
                     transition-all duration-200 group-hover:translate-x-0.5"
              :class="plan.highlight ? 'text-default' : 'text-muted'"
              :style="{ transitionDelay: `${fi * 15}ms` }"
            >
              <UIcon
                name="i-lucide-check-circle-2"
                class="shrink-0 size-4 transition-transform duration-200 group-hover:scale-110"
                :class="plan.highlight ? 'text-primary' : 'text-muted group-hover:text-primary/60'"
              />
              {{ feature }}
            </li>
          </ul>

          <!-- CTA -->
          <UButton
            block
            size="lg"
            :color="plan.highlight ? 'primary' : 'neutral'"
            :variant="plan.highlight ? 'solid' : 'outline'"
            :trailing-icon="plan.highlight && loadingPlanKey !== plan.key ? 'i-lucide-arrow-right' : undefined"
            :loading="loadingPlanKey === plan.key"
            :disabled="!!loadingPlanKey"
            class="transition-all duration-200 group-hover:scale-[1.02]"
            @click="subscribe(plan)"
          >
            {{ plan.cta }}
          </UButton>
        </div>
      </div>
    </div>

    <!-- ─── Garantias ─────────────────────────────────────────────────────── -->
    <div class="flex flex-wrap justify-center gap-x-6 gap-y-2 animate-fade-in animation-delay-200">
      <span
        v-for="item in ['Sem fidelidade', 'Cancele quando quiser', 'Cobrança mensal via cartão']"
        :key="item"
        class="flex items-center gap-1.5 text-xs text-muted"
      >
        <UIcon name="i-lucide-shield-check" class="size-3.5 text-primary/60" />
        {{ item }}
      </span>
    </div>

    <!-- ─── Suporte ───────────────────────────────────────────────────────── -->
    <p class="text-center text-sm text-muted animate-fade-in animation-delay-300">
      Dúvidas?
      <ULink to="mailto:suporte@beenk.com.br" class="text-primary font-medium hover:underline underline-offset-2">
        Fale com nosso time
      </ULink>
    </p>
  </div>
</template>

<style scoped>
@keyframes fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes fade-up {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes bounce-subtle {
  0%, 100% { transform: translateY(0); }
  50%       { transform: translateY(-3px); }
}

.animate-fade-in {
  animation: fade-in 0.5s ease both;
}

.animate-fade-up {
  animation: fade-up 0.5s ease both;
}

.animate-bounce-subtle {
  animation: bounce-subtle 2.4s ease-in-out infinite;
}

.animation-delay-200 { animation-delay: 200ms; }
.animation-delay-300 { animation-delay: 300ms; }
</style>
