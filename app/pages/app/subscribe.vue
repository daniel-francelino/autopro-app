<script setup lang="ts">
import BillingPricingPlans from '~/components/billing/BillingPricingPlans.vue'

definePageMeta({
  layout: 'app'
})

useSeoMeta({
  title: 'Assinatura'
})

// O schema da collection `pricing` (content.config.ts) nao declara `plans`, mas o YAML o fornece em runtime
type PricingPageProp = InstanceType<typeof BillingPricingPlans>['$props']['page']

const isOpen = ref(true)

const { data: page, status } = await useAsyncData(
  'pricing-embedded',
  () => queryCollection('pricing').first()
)
</script>

<template>
  <UDashboardPanel id="subscribe">
    <template #header>
      <AppPageHeader title="Assinatura" />
    </template>

    <template #body>
      <UModal
        v-model:open="isOpen"
        :prevent-close="true"
        :ui="{ content: 'sm:max-w-5xl' }"
      >
        <template #content>
          <UCard>
            <template #header>
              Assinatura necessária
            </template>

            <div v-if="status === 'pending'" class="space-y-3">
              <USkeleton class="h-10 w-full" />
              <USkeleton class="h-10 w-full" />
              <USkeleton class="h-10 w-full" />
            </div>

            <BillingPricingPlans
              v-else-if="page"
              embedded
              :page="(page as unknown as PricingPageProp)"
              cancel-path="/app/subscribe?checkout=cancel"
              success-path="/app?checkout=success"
            />
          </UCard>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
