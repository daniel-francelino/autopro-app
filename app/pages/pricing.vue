<script setup lang="ts">
import BillingPricingPlans from '~/components/billing/BillingPricingPlans.vue'

const siteUrl = useSiteUrl()
const { data: cms } = await useAsyncData('pricing', () => queryCollection('pricing').first())
const { data: faq } = await useAsyncData('faq', () => queryCollection('faq').first())
const { plans, toCmsPlan } = usePlans()

const title = cms.value?.seo?.title || cms.value?.title
const description = cms.value?.seo?.description || cms.value?.description

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description,
  ogUrl: `${siteUrl}/pricing`,
  ogLocale: 'pt_BR'
})

useHead({
  link: [{ rel: 'canonical', href: `${siteUrl}/pricing` }]
})

defineOgImageComponent('Saas')

const page = computed(() => cms.value
  ? {
      ...cms.value,
      plans: plans.map(toCmsPlan),
      faq: { ...cms.value.faq, items: faq.value?.items ?? [] }
    }
  : null
)
</script>

<template>
  <div v-if="page">
    <BillingPricingPlans :page="page" />

    <UPageSection
      :title="page.faq.title"
      :description="page.faq.description"
    >
      <UAccordion
        :items="page.faq.items"
        :unmount-on-hide="false"
        :default-value="['0']"
        type="multiple"
        class="max-w-3xl mx-auto"
        :ui="{
          trigger: 'text-base text-highlighted',
          body: 'text-base text-muted'
        }"
      />
    </UPageSection>
  </div>
</template>
