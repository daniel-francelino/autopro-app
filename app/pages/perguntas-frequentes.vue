<script setup lang="ts">
const siteUrl = useSiteUrl()
const { data: faq } = await useAsyncData('faq', () => queryCollection('faq').first())

const items = faq.value?.items ?? []
const url = `${siteUrl}/perguntas-frequentes`
const title = 'Perguntas frequentes sobre o AutoPro'
const description = 'Respostas diretas sobre o AutoPro, sistema para oficinas mecânicas: planos, pagamento, cancelamento, nota fiscal (NFS-e), comissões, unidades e suporte.'

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description,
  ogUrl: url,
  ogLocale: 'pt_BR'
})

defineOgImageComponent('Saas', { title, description })

useHead({
  link: [{ rel: 'canonical', href: url }],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'FAQPage',
            'mainEntity': items.map(item => ({
              '@type': 'Question',
              'name': item.label,
              'acceptedAnswer': { '@type': 'Answer', 'text': item.content }
            }))
          },
          {
            '@type': 'BreadcrumbList',
            'itemListElement': [
              { '@type': 'ListItem', 'position': 1, 'name': 'Início', 'item': `${siteUrl}/` },
              { '@type': 'ListItem', 'position': 2, 'name': 'Perguntas frequentes', 'item': url }
            ]
          }
        ]
      })
    }
  ]
})
</script>

<template>
  <UContainer class="py-10 sm:py-14">
    <div class="mx-auto max-w-3xl">
      <nav aria-label="Você está em" class="mb-6 text-sm text-muted">
        <NuxtLink to="/" class="hover:text-highlighted">
          Início
        </NuxtLink>
        <span aria-hidden="true"> / </span>
        <span>Perguntas frequentes</span>
      </nav>

      <h1 class="text-3xl font-bold tracking-tight text-highlighted sm:text-4xl">
        Perguntas frequentes
      </h1>
      <p class="mt-4 text-lg text-default">
        Dúvidas comuns antes de assinar o AutoPro, sistema para oficinas mecânicas.
      </p>

      <UAccordion
        :items="items"
        :unmount-on-hide="false"
        type="multiple"
        class="mt-8"
        :ui="{ trigger: 'text-base text-highlighted', body: 'text-base text-muted' }"
      />

      <p class="mt-10 text-muted">
        Veja também os <NuxtLink to="/pricing" class="text-primary hover:underline">
          planos e preços
        </NuxtLink> e a página <NuxtLink to="/sistema-para-oficina-mecanica" class="text-primary hover:underline">
          sistema para oficina mecânica
        </NuxtLink>.
      </p>
    </div>
  </UContainer>
</template>
