<script setup lang="ts">
import { AnimatePresence, Motion, useReducedMotion } from 'motion-v'
import '~/assets/css/landing.css'

const reducedMotion = useReducedMotion()

definePageMeta({ layout: false })

const mobileMenuOpen = ref(false)
const siteUrl = useSiteUrl()
const { plans } = usePlans()
const { data: faqContent } = await useAsyncData('faq', () => queryCollection('faq').first())
const faqs = (faqContent.value?.items ?? []).map(item => ({
  question: item.label,
  answer: item.content
}))
const title = 'Sistema para oficina mecânica | AutoPro'
const description
  = 'Organize ordens de serviço, clientes, estoque e financeiro em um só sistema. Menos papelada, mais tempo para fazer sua oficina crescer.'

useSeoMeta({
  titleTemplate: '',
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  ogType: 'website',
  ogUrl: `${siteUrl}/`,
  ogLocale: 'pt_BR',
  ogImage: `${siteUrl}/og/home.jpg`,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt: 'Oficina mecânica usando o AutoPro para gerenciar ordens de serviço',
  twitterTitle: title,
  twitterDescription: description,
  twitterImage: `${siteUrl}/og/home.jpg`,
  robots: 'index, follow'
})
useHead({
  htmlAttrs: { class: 'landing-smooth-scroll' },
  meta: [
    {
      name: 'viewport',
      content: 'width=device-width, initial-scale=1, viewport-fit=cover'
    }
  ],
  link: [{ rel: 'canonical', href: `${siteUrl}/` }],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Organization',
            '@id': `${siteUrl}/#org`,
            'name': 'AutoPro',
            'url': `${siteUrl}/`,
            'logo': `${siteUrl}/icons/icon-512x512.png`
          },
          {
            '@type': 'WebSite',
            '@id': `${siteUrl}/#website`,
            'url': `${siteUrl}/`,
            'name': 'AutoPro',
            'inLanguage': 'pt-BR',
            'publisher': { '@id': `${siteUrl}/#org` }
          },
          {
            '@type': 'SoftwareApplication',
            '@id': `${siteUrl}/#app`,
            'name': 'AutoPro',
            'applicationCategory': 'BusinessApplication',
            'operatingSystem': 'Web',
            'inLanguage': 'pt-BR',
            description,
            'url': `${siteUrl}/`,
            'offers': plans.map(plan => ({
              '@type': 'Offer',
              'name': plan.name,
              'price': String(plan.priceAmount),
              'priceCurrency': 'BRL',
              'url': `${siteUrl}/pricing`,
              'category': 'subscription'
            })),
            'publisher': { '@id': `${siteUrl}/#org` }
          },
          {
            '@type': 'FAQPage',
            'mainEntity': faqs.map(faq => ({
              '@type': 'Question',
              'name': faq.question,
              'acceptedAnswer': { '@type': 'Answer', 'text': faq.answer }
            }))
          }
        ]
      })
    }
  ]
})

const navigation = [
  { label: 'O sistema', to: '#sistema' },
  { label: 'Recursos', to: '#recursos' },
  { label: 'Como funciona', to: '#how-it-works' },
  { label: 'Planos', to: '/pricing' }
]
const guideLinks = [
  { label: 'Sistema para oficina', to: '/sistema-para-oficina-mecanica' },
  { label: 'Ordem de serviço', to: '/ordem-de-servico-oficina' },
  { label: 'Comissão de mecânico', to: '/comissao-mecanico' },
  { label: 'Nota fiscal', to: '/nota-fiscal-oficina' },
  { label: 'Controle financeiro', to: '/controle-financeiro-oficina' },
  { label: 'Estoque de peças', to: '/estoque-pecas-oficina' },
  { label: 'Perguntas frequentes', to: '/perguntas-frequentes' }
]
const features = [
  {
    icon: 'i-lucide-users-round',
    title: 'Cada cliente. Todo o histórico.',
    description:
      'Clientes, veículos e serviços anteriores conectados. Um atendimento que começa de onde o último parou.',
    tag: 'CLIENTES E VEÍCULOS'
  },
  {
    icon: 'i-lucide-package-search',
    title: 'A peça certa, na hora certa.',
    description:
      'Acompanhe entradas, saídas e quantidades mínimas. Conecte compras, fornecedores e estoque à operação.',
    tag: 'ESTOQUE E COMPRAS'
  },
  {
    icon: 'i-lucide-chart-no-axes-combined',
    title: 'Números que mostram o caminho.',
    description:
      'Contas a pagar e receber, custos e resultados. Enxergue a saúde financeira da oficina sem juntar planilhas.',
    tag: 'GESTÃO FINANCEIRA'
  },
  {
    icon: 'i-lucide-percent',
    title: 'Comissões sem conta de cabeça.',
    description:
      'Defina regras por funcionário e categoria de serviço. O cálculo acompanha o trabalho da equipe.',
    tag: 'EQUIPE E COMISSÕES'
  },
  {
    icon: 'i-lucide-calendar-days',
    title: 'Seu dia com tudo no lugar.',
    description:
      'Organize os atendimentos na agenda e transforme agendamentos em ordens de serviço.',
    tag: 'AGENDA INTEGRADA'
  },
  {
    icon: 'i-lucide-shield-check',
    title: 'Cada pessoa com o acesso certo.',
    description:
      'Permissões por função para a equipe trabalhar com autonomia e você manter o controle da gestão.',
    tag: 'CONTROLE DE ACESSO'
  }
]
const steps = [
  {
    title: 'Prepare sua oficina',
    description:
      'Crie sua conta, escolha seu plano e configure os dados da empresa e da equipe.'
  },
  {
    title: 'Organize a operação',
    description:
      'Cadastre clientes, veículos e peças. Deixe tudo pronto para os próximos atendimentos.'
  },
  {
    title: 'Dê a partida',
    description:
      'Abra sua primeira OS e acompanhe os serviços, os pagamentos e os resultados.'
  }
]

const { track } = useAnalytics()

function onCta(location: string) {
  mobileMenuOpen.value = false
  const event = location === 'hero'
    ? 'cta_hero_click'
    : location === 'page-bottom'
      ? 'cta_final_click'
      : location === 'footer'
        ? 'cta_footer_click'
        : 'nav_click'
  track(event)
}
</script>

<template>
  <div class="landing">
    <a href="#main-content" class="lp-skip">Pular para o conteúdo</a>
    <header class="lp-header" @keydown.esc="mobileMenuOpen = false">
      <div class="lp-container lp-nav">
        <NuxtLink
          to="/"
          aria-label="Página inicial"
          class="lp-logo"
        ><AppLogo /></NuxtLink>
        <nav class="lp-desktop-nav" aria-label="Navegação principal">
          <NuxtLink
            v-for="item in navigation"
            :key="item.to"
            :to="item.to"
            @click="onCta('header')"
          >{{ item.label }}</NuxtLink>
        </nav>
        <div class="lp-nav-actions">
          <NuxtLink
            to="/login"
            class="lp-login"
            @click="onCta('header')"
          >Entrar <UIcon name="i-lucide-arrow-up-right" /></NuxtLink>
          <NuxtLink
            to="/signup"
            class="lp-button lp-button-dark lp-nav-cta"
            @click="onCta('header')"
          >Começar agora <UIcon name="i-lucide-arrow-right" /></NuxtLink>
          <button
            class="lp-menu-toggle"
            type="button"
            :aria-expanded="mobileMenuOpen"
            aria-controls="mobile-navigation"
            :aria-label="mobileMenuOpen ? 'Fechar menu' : 'Abrir menu'"
            @click="mobileMenuOpen = !mobileMenuOpen"
          >
            <UIcon :name="mobileMenuOpen ? 'i-lucide-x' : 'i-lucide-menu'" />
          </button>
        </div>
      </div>
      <AnimatePresence>
        <Motion
          v-if="mobileMenuOpen"
          id="mobile-navigation"
          key="mobile-menu"
          as="nav"
          :initial="{ opacity: 0, height: reducedMotion ? 'auto' : 0, paddingTop: 0, paddingBottom: 0 }"
          :animate="{ opacity: 1, height: 'auto', paddingTop: 12, paddingBottom: 24 }"
          :exit="{ opacity: 0, height: reducedMotion ? 'auto' : 0, paddingTop: 0, paddingBottom: 0 }"
          :transition="{ duration: reducedMotion ? 0 : 0.22 }"
          class="lp-mobile-nav"
          aria-label="Navegação móvel"
        >
          <NuxtLink
            v-for="item in navigation"
            :key="item.to"
            :to="item.to"
            @click="onCta('header-mobile')"
          >{{ item.label }} <UIcon name="i-lucide-arrow-up-right" /></NuxtLink>
          <NuxtLink
            to="/signup"
            class="lp-button lp-button-blue"
            @click="onCta('header-mobile')"
          >Começar agora <UIcon name="i-lucide-arrow-right" /></NuxtLink>
        </Motion>
      </AnimatePresence>
    </header>

    <main id="main-content">
      <section class="lp-hero">
        <div class="lp-container lp-hero-grid">
          <LandingReveal class="lp-hero-copy">
            <span class="lp-eyebrow"><span class="lp-status-dot" /> O PRÓXIMO PASSO DA SUA
              OFICINA</span>
            <h1>Sua oficina.<br>Em uma <span>nova marcha.</span></h1>
            <p>
              Você entende de carros.<br class="lp-desktop-break">
              A gente simplifica a gestão.
            </p>
            <p class="lp-hero-description">
              Sistema para oficina mecânica: do primeiro atendimento ao financeiro, conecte toda a operação em
              um só lugar, com ordens de serviço, estoque e financeiro. Menos papelada. Mais espaço para crescer.
            </p>
            <div class="lp-hero-actions">
              <NuxtLink
                to="/signup"
                class="lp-button lp-button-blue"
                @click="onCta('hero')"
              >Começar agora <UIcon name="i-lucide-arrow-up-right" /></NuxtLink>
              <a
                href="#sistema"
                class="lp-text-link"
                @click="onCta('hero')"
              ><span class="lp-play"><UIcon name="i-lucide-arrow-down" /></span>
                Conhecer o sistema</a>
            </div>
            <div class="lp-hero-notes">
              <span><UIcon name="i-lucide-check" /> 100% online</span><span><UIcon name="i-lucide-check" /> Feito para oficinas</span>
            </div>
          </LandingReveal>
          <LandingReveal :delay="0.14" :distance="32" class="lp-hero-visual">
            <div class="lp-orbit lp-orbit-one" aria-hidden="true" />
            <div class="lp-orbit lp-orbit-two" aria-hidden="true" />
            <span class="lp-visual-caption"><UIcon name="i-lucide-zap" /> SUA OPERAÇÃO, CONECTADA.</span>
            <LandingProductPreview />
            <span class="lp-demo-caption">Tela do sistema com dados fictícios</span>
          </LandingReveal>
        </div>
        <div class="lp-container lp-capabilities">
          <span>UMA PLATAFORMA.<br><strong>A OFICINA INTEIRA.</strong></span>
          <div><UIcon name="i-lucide-clipboard-list" /> Ordens de serviço</div>
          <div><UIcon name="i-lucide-users-round" /> Clientes</div>
          <div><UIcon name="i-lucide-package" /> Estoque</div>
          <div><UIcon name="i-lucide-chart-no-axes-combined" /> Financeiro</div>
        </div>
      </section>

      <section id="sistema" class="lp-section lp-container">
        <LandingReveal class="lp-section-heading">
          <div>
            <span class="lp-eyebrow">MENOS COMPLICAÇÃO. MAIS CONTROLE.</span>
            <h2>A oficina anda melhor<br>quando tudo anda junto.</h2>
          </div>
          <p>
            Chega de procurar informações em papéis, conversas e planilhas. Sua
            operação merece trabalhar no mesmo ritmo que você.
          </p>
        </LandingReveal>
        <div class="lp-operation-grid">
          <LandingReveal class="lp-workshop-image">
            <img
              src="/homepage/workshop.webp"
              alt="Profissional trabalhando na suspensão de um veículo em uma oficina mecânica"
              width="1400"
              height="788"
              loading="lazy"
              decoding="async"
            >
            <div class="lp-photo-caption">
              <span>FEITO PARA A VIDA REAL.</span><strong>Da bancada<br>à gestão.</strong><span
                class="lp-photo-arrow"
                aria-hidden="true"
              ><UIcon name="i-lucide-arrow-up-right" /></span>
            </div>
          </LandingReveal>
          <LandingReveal :delay="0.12" class="lp-operation-copy">
            <span class="lp-icon-box"><UIcon name="i-lucide-wrench" /></span>
            <h3>Um serviço bem feito começa com uma operação organizada.</h3>
            <p>
              Do orçamento à entrega do veículo, cada ordem de serviço reúne o
              que sua equipe precisa para seguir em frente.
            </p>
            <ul class="lp-check-list">
              <li>
                <UIcon name="i-lucide-circle-check" /> Serviços, peças e
                responsáveis na mesma OS
              </li>
              <li>
                <UIcon name="i-lucide-circle-check" /> Histórico do cliente e do
                veículo sempre à mão
              </li>
              <li>
                <UIcon name="i-lucide-circle-check" /> Pagamentos e comissões
                ligados ao atendimento
              </li>
            </ul>
            <NuxtLink
              to="/signup"
              class="lp-text-link"
              @click="onCta('operation')"
            >Organizar minha oficina <UIcon name="i-lucide-arrow-up-right" /></NuxtLink>
          </LandingReveal>
        </div>
      </section>

      <section id="recursos" class="lp-resources">
        <div class="lp-container lp-section">
          <LandingReveal class="lp-centered-heading">
            <span class="lp-eyebrow">CADA DETALHE IMPORTA</span>
            <h2>Uma visão completa.<br>Mil coisas a menos na cabeça.</h2>
            <p>
              As ferramentas que fazem o dia render, juntas em um só sistema.
            </p>
          </LandingReveal>
          <div class="lp-feature-grid">
            <LandingReveal
              v-for="(feature, index) in features"
              :key="feature.title"
              as="article"
              :delay="(index % 3) * 0.08"
              interactive
              class="lp-feature-card"
            >
              <div class="lp-feature-top">
                <span class="lp-icon-box"><UIcon :name="feature.icon" /></span><span class="lp-feature-number">0{{ index + 1 }}</span>
              </div>
              <span class="lp-feature-tag">{{ feature.tag }}</span>
              <h3>{{ feature.title }}</h3>
              <p>{{ feature.description }}</p>
            </LandingReveal>
          </div>
          <NuxtLink
            to="/pricing"
            class="lp-text-link lp-resources-link"
            @click="
              onCta('features')
            "
          >Encontre os recursos certos para sua oficina
            <UIcon name="i-lucide-arrow-right" /></NuxtLink>
        </div>
      </section>

      <section id="how-it-works" class="lp-start">
        <div class="lp-container lp-section">
          <LandingReveal class="lp-section-heading">
            <div>
              <span class="lp-eyebrow">SIMPLES DESDE O PRIMEIRO DIA</span>
              <h2>Seu próximo capítulo<br>começa aqui.</h2>
            </div>
            <NuxtLink
              to="/signup"
              class="lp-button lp-button-lime"
              @click="onCta('how-it-works')"
            >Vamos começar <UIcon name="i-lucide-arrow-up-right" /></NuxtLink>
          </LandingReveal>
          <div class="lp-steps">
            <LandingReveal
              v-for="(step, index) in steps"
              :key="step.title"
              as="article"
              :delay="index * 0.1"
            >
              <span class="lp-step-number">0{{ index + 1
              }}<UIcon
                :name="
                  index === 2 ? 'i-lucide-flag' : 'i-lucide-arrow-right'
                "
              /></span>
              <h3>{{ step.title }}</h3>
              <p>{{ step.description }}</p>
            </LandingReveal>
          </div>
        </div>
      </section>

      <section class="lp-container lp-section lp-faq-section">
        <div>
          <span class="lp-eyebrow">ANTES DE DAR A PARTIDA</span>
          <h2>Boas perguntas.<br>Respostas diretas.</h2>
          <p>
            Conheça um pouco mais sobre o sistema e encontre o plano para o seu
            momento.
          </p>
          <NuxtLink
            to="/pricing"
            class="lp-text-link"
            @click="onCta('faq')"
          >Conhecer os planos <UIcon name="i-lucide-arrow-up-right" /></NuxtLink>
        </div>
        <div class="lp-faq-list">
          <details v-for="faq in faqs" :key="faq.question">
            <summary>{{ faq.question }}<UIcon name="i-lucide-plus" /></summary>
            <p>{{ faq.answer }}</p>
          </details>
        </div>
      </section>

      <section class="lp-container lp-final-wrap">
        <LandingReveal class="lp-final-cta">
          <div class="lp-cta-rings" aria-hidden="true" />
          <div>
            <span class="lp-eyebrow">SUA OFICINA TEM MUITO PELA FRENTE</span>
            <h2>Menos burocracia.<br>Mais oficina.</h2>
            <p>
              O próximo passo do seu negócio começa com uma gestão mais simples.
            </p>
          </div>
          <div class="lp-final-actions">
            <NuxtLink
              to="/signup"
              class="lp-button lp-button-dark"
              @click="onCta('page-bottom')"
            >Começar agora <UIcon name="i-lucide-arrow-up-right" /></NuxtLink><NuxtLink
              to="/pricing"
              class="lp-text-link"
              @click="onCta('page-bottom')"
            >Ver planos e preços <UIcon name="i-lucide-arrow-right" /></NuxtLink>
          </div>
        </LandingReveal>
      </section>
    </main>

    <footer class="lp-footer lp-container">
      <div class="lp-footer-top">
        <div>
          <NuxtLink to="/" aria-label="Página inicial"><AppLogo /></NuxtLink>
          <p>Tecnologia que acompanha<br>o ritmo da sua oficina.</p>
        </div>
        <nav aria-label="Navegação do rodapé">
          <NuxtLink
            v-for="item in navigation"
            :key="item.to"
            :to="item.to"
            @click="onCta('footer')"
          >{{ item.label }}</NuxtLink><NuxtLink
            to="/login"
            @click="onCta('footer')"
          >Entrar <UIcon name="i-lucide-arrow-up-right" /></NuxtLink>
        </nav>
        <nav aria-label="Guias e perguntas">
          <NuxtLink
            v-for="item in guideLinks"
            :key="item.to"
            :to="item.to"
            @click="onCta('footer')"
          >{{ item.label }}</NuxtLink>
        </nav>
      </div>
      <div class="lp-footer-bottom">
        <span>© {{ new Date().getFullYear() }} AutoPro. Todos os direitos
          reservados.</span><span>Feito para quem faz a oficina acontecer.</span>
      </div>
    </footer>
  </div>
</template>
