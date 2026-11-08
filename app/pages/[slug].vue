<script setup lang="ts">
const route = useRoute()
const siteUrl = useSiteUrl()
const { plans } = usePlans()

const slug = String(route.params.slug)

const { data: page } = await useAsyncData(`pagina-${slug}`, () =>
  queryCollection('paginas').path(`/paginas/${slug}`).first())

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Página não encontrada', fatal: true })
}

const { data: relatedPages } = await useAsyncData(`pagina-${slug}-related`, async () => {
  const paths = (page.value?.related ?? []).map(item => `/paginas/${item}`)
  if (!paths.length) return []
  const all = await queryCollection('paginas').select('title', 'description', 'path').all()
  return all
    .filter(item => paths.includes(item.path))
    .map(item => ({
      title: item.title,
      description: item.description,
      to: item.path.replace('/paginas', '')
    }))
})

const url = `${siteUrl}/${slug}`
const title = page.value.title
const description = page.value.description
const faq = page.value.faq ?? []

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description,
  ogType: 'article',
  ogUrl: url,
  ogLocale: 'pt_BR',
  articleModifiedTime: page.value.updatedAt
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
            '@type': 'Article',
            'headline': title,
            description,
            'inLanguage': 'pt-BR',
            'dateModified': page.value.updatedAt,
            'mainEntityOfPage': url,
            'publisher': { '@id': `${siteUrl}/#org` }
          },
          {
            '@type': 'BreadcrumbList',
            'itemListElement': [
              { '@type': 'ListItem', 'position': 1, 'name': 'Início', 'item': `${siteUrl}/` },
              { '@type': 'ListItem', 'position': 2, 'name': title, 'item': url }
            ]
          },
          ...(faq.length
            ? [{
                '@type': 'FAQPage',
                'mainEntity': faq.map(item => ({
                  '@type': 'Question',
                  'name': item.label,
                  'acceptedAnswer': { '@type': 'Answer', 'text': item.content }
                }))
              }]
            : [])
        ]
      })
    }
  ]
})

const revisedAt = computed(() => {
  const [year, month, day] = String(page.value?.updatedAt).split('-').map(Number)
  return new Date(year!, (month ?? 1) - 1, day ?? 1).toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
})
</script>

<template>
  <UContainer v-if="page" class="py-10 sm:py-14">
    <article class="mx-auto max-w-3xl">
      <nav aria-label="Você está em" class="mb-6 text-sm text-muted">
        <NuxtLink to="/" class="hover:text-highlighted">
          Início
        </NuxtLink>
        <span aria-hidden="true"> / </span>
        <span>{{ page.title }}</span>
      </nav>

      <header class="mb-8">
        <h1 class="text-3xl font-bold tracking-tight text-highlighted sm:text-4xl">
          {{ page.title }}
        </h1>
        <p class="mt-4 text-lg text-default">
          {{ page.answer }}
        </p>
        <p class="mt-3 text-sm text-muted">
          Última revisão: <time :datetime="page.updatedAt">{{ revisedAt }}</time>
        </p>
      </header>

      <ContentRenderer :value="page" class="prose-content" />

      <section v-if="page.showPlans" class="mt-6 overflow-x-auto" aria-label="Planos do AutoPro">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-default text-highlighted">
              <th class="py-2 pr-4 font-semibold">
                Plano
              </th>
              <th class="py-2 pr-4 font-semibold">
                Preço mensal
              </th>
              <th class="py-2 font-semibold">
                O que inclui
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="plan in plans" :key="plan.key" class="border-b border-default align-top">
              <th scope="row" class="py-3 pr-4 font-medium text-highlighted">
                {{ plan.name }}
              </th>
              <td class="py-3 pr-4 whitespace-nowrap">
                {{ plan.price }}
              </td>
              <td class="py-3 text-muted">
                {{ plan.features.join(' · ') }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="faq.length" class="mt-12" aria-labelledby="faq-title">
        <h2 id="faq-title" class="text-2xl font-semibold text-highlighted">
          Perguntas frequentes
        </h2>
        <UAccordion
          :items="faq"
          :unmount-on-hide="false"
          type="multiple"
          class="mt-4"
          :ui="{ trigger: 'text-base text-highlighted', body: 'text-base text-muted' }"
        />
      </section>

      <section class="mt-12 rounded-xl border border-default bg-elevated/50 p-6">
        <h2 class="text-xl font-semibold text-highlighted">
          Conheça o AutoPro
        </h2>
        <p class="mt-2 text-muted">
          Assinatura mensal no cartão, sem fidelidade. Veja os planos e comece pela criação da conta.
        </p>
        <div class="mt-4 flex flex-wrap gap-3">
          <UButton to="/signup" label="Começar agora" />
          <UButton
            to="/pricing"
            label="Ver planos e preços"
            color="neutral"
            variant="subtle"
          />
        </div>
      </section>

      <section v-if="relatedPages?.length" class="mt-12" aria-labelledby="related-title">
        <h2 id="related-title" class="text-xl font-semibold text-highlighted">
          Leia também
        </h2>
        <ul class="mt-3 space-y-2">
          <li v-for="item in relatedPages" :key="item.to">
            <NuxtLink :to="item.to" class="font-medium text-primary hover:underline">
              {{ item.title }}
            </NuxtLink>
            <span class="text-muted"> — {{ item.description }}</span>
          </li>
        </ul>
      </section>
    </article>
  </UContainer>
</template>
