<script setup lang="ts">
import { useAuth } from '~/composables/useAuth'

type PricingPage = {
  title: string
  description: string
  plans: PricingPlan[]
}

type PricingPlan = {
  button?: Record<string, unknown>
  price?: {
    month?: string
    year?: string
  }
  stripePriceId?: {
    month?: string
    year?: string
  }
} & Record<string, unknown>

type FetchErrorLike = {
  data?: {
    statusMessage?: string
  }
  statusMessage?: string
}

const props = withDefaults(defineProps<{
  page: PricingPage
  cancelPath?: string
  successPath?: string
  embedded?: boolean
}>(), {
  embedded: false
})

const isYearly = ref('0')

const items = ref([
  { label: 'Mensal', value: '0' }
])

const toast = useToast()
const { track } = useAnalytics()
const auth = useAuth()

async function startCheckout(priceId: string) {
  await auth.ensureReady()

  if (!auth.isAuthenticated.value) {
    track('pricing_login_redirected')
    await navigateTo('/login')
    return
  }

  try {
    track('pricing_checkout_started', { attribution: readAttribution() })
    const { url } = await $fetch<{ url: string }>('/api/billing/checkout', {
      method: 'POST',
      body: {
        priceId,
        successPath: props.successPath ?? undefined,
        cancelPath: props.cancelPath ?? undefined
      }
    })

    await navigateTo(url, { external: true })
  } catch (error: unknown) {
    const err = error as FetchErrorLike
    const message = err?.data?.statusMessage || err?.statusMessage || 'Não foi possível iniciar o checkout'
    toast.add({ title: 'Erro', description: message, color: 'error' })
  }
}

const plansWithActions = computed(() => {
  const plans = props.page?.plans || []

  return plans.map((plan) => {
    const priceId = isYearly.value === '1' ? plan?.stripePriceId?.year : plan?.stripePriceId?.month
    if (!priceId)
      return plan

    return {
      ...plan,
      button: {
        ...(plan.button || {}),
        onClick: () => startCheckout(priceId)
      }
    }
  })
})
</script>

<template>
  <div>
    <UPageHero
      v-if="!props.embedded"
      :title="props.page.title"
      :description="props.page.description"
    >
      <template #links>
        <UTabs
          v-if="items.length > 1"
          v-model="isYearly"
          :items="items"
          color="neutral"
          size="xs"
          class="w-48"
          :ui="{
            list: 'ring ring-accented rounded-full',
            indicator: 'rounded-full',
            trigger: 'w-1/2'
          }"
        />
      </template>
    </UPageHero>

    <div v-else class="space-y-4">
      <div class="flex items-start justify-between gap-4">
        <div class="space-y-1">
          <h2 class="text-lg font-semibold text-highlighted">
            {{ props.page.title }}
          </h2>
          <p class="text-sm text-muted">
            {{ props.page.description }}
          </p>
        </div>

        <UTabs
          v-if="items.length > 1"
          v-model="isYearly"
          :items="items"
          color="neutral"
          size="xs"
          class="w-40 shrink-0"
          :ui="{
            list: 'ring ring-accented rounded-full',
            indicator: 'rounded-full',
            trigger: 'w-1/2'
          }"
        />
      </div>
    </div>

    <UContainer v-if="!props.embedded">
      <UPricingPlans scale>
        <UPricingPlan
          v-for="(plan, index) in plansWithActions"
          :key="index"
          v-bind="plan"
          :price="isYearly === '1' ? plan.price?.year : plan.price?.month"
          :billing-cycle="isYearly === '1' ? '/ano' : '/mês'"
        />
      </UPricingPlans>
    </UContainer>

    <UPricingPlans v-else scale>
      <UPricingPlan
        v-for="(plan, index) in plansWithActions"
        :key="index"
        v-bind="plan"
        :price="isYearly === '1' ? plan.price?.year : plan.price?.month"
        :billing-cycle="isYearly === '1' ? '/ano' : '/mês'"
      />
    </UPricingPlans>
  </div>
</template>
