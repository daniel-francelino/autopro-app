// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/image',
    '@nuxt/ui',
    '@nuxt/content',
    '@vueuse/nuxt',
    'nuxt-og-image',
    '@vite-pwa/nuxt'
  ],

  devtools: {
    enabled: true
  },

  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/icons/apple-touch-icon.png' }
      ]
    }
  },

  css: ['driver.js/dist/driver.css', '~/assets/css/main.css'],

  colorMode: {
    preference: 'light',
    fallback: 'light',
    hid: 'nuxt-color-mode-script',
    globalName: '__NUXT_COLOR_MODE__',
    componentName: 'ColorScheme',
    classSuffix: '',
    disableTransition: true,
    storageKey: 'nuxt-color-mode'
  },

  runtimeConfig: {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,

    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    stripeAllowedPriceIds: process.env.STRIPE_ALLOWED_PRICE_IDS,
    stripeBillingPortalConfigurationId:
      process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID,

    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL ?? '',
      oneSignalEnabled:
        process.env.NODE_ENV === 'production'
        && process.env.NUXT_PUBLIC_ONESIGNAL_ENABLED === 'true',
      oneSignalAppId: process.env.NUXT_PUBLIC_ONESIGNAL_APP_ID ?? '',
      oneSignalServiceWorkerPath:
        process.env.NUXT_PUBLIC_ONESIGNAL_SERVICE_WORKER_PATH
        ?? '/push/onesignal/OneSignalSDKWorker.js',
      oneSignalServiceWorkerUpdaterPath:
        process.env.NUXT_PUBLIC_ONESIGNAL_SERVICE_WORKER_UPDATER_PATH
        ?? '/push/onesignal/OneSignalSDKUpdaterWorker.js',
      oneSignalServiceWorkerScope:
        process.env.NUXT_PUBLIC_ONESIGNAL_SERVICE_WORKER_SCOPE
        ?? '/push/onesignal/',
      posthogEnabled:
        process.env.NODE_ENV === 'production'
        && process.env.NUXT_PUBLIC_POSTHOG_ENABLED === 'true',
      posthogHost:
        process.env.NUXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      posthogKey: process.env.NUXT_PUBLIC_POSTHOG_KEY ?? '',
      stripeStarterPriceId: process.env.NUXT_PUBLIC_STRIPE_PRICE_ID_STARTER ?? '',
      stripeProPriceId: process.env.NUXT_PUBLIC_STRIPE_PRICE_ID_PRO ?? '',
      stripeFiscalPriceId: process.env.NUXT_PUBLIC_STRIPE_PRICE_ID_FISCAL ?? ''
    }
  },

  routeRules: {
    '/': { prerender: true },
    '/pricing': { prerender: true },
    '/app': { prerender: false },
    '/app/**': { prerender: false },
    '/checkout/**': { prerender: false },
    '/api/**': { cors: true }
  },

  sourcemap: {
    server: false,
    client: true
  },

  compatibilityDate: '2024-07-11',

  nitro: {
    // prerender is disabled in dev — it caused the "Dev server is unavailable" error
    // by making Nitro crawl links during startup before Vite was ready
    // prerender: {
    //   routes: ['/'],
    //   crawlLinks: true
    // }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'AutoPro',
      short_name: 'AutoPro',
      description:
        'Sistema para oficinas mecanicas com ordens de servico, clientes, veiculos, estoque, financeiro e operacao administrativa.',
      theme_color: '#9333ea',
      background_color: '#f8fafc',
      display: 'standalone',
      orientation: 'portrait',
      scope: '/',
      start_url: '/app',
      lang: 'pt-BR',
      categories: ['productivity', 'business'],
      icons: [
        {
          src: '/icons/icon-72x72.png',
          sizes: '72x72',
          type: 'image/png'
        },
        {
          src: '/icons/icon-96x96.png',
          sizes: '96x96',
          type: 'image/png'
        },
        {
          src: '/icons/icon-128x128.png',
          sizes: '128x128',
          type: 'image/png'
        },
        {
          src: '/icons/icon-144x144.png',
          sizes: '144x144',
          type: 'image/png'
        },
        {
          src: '/icons/icon-152x152.png',
          sizes: '152x152',
          type: 'image/png'
        },
        {
          src: '/icons/icon-192x192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any'
        },
        {
          src: '/icons/icon-384x384.png',
          sizes: '384x384',
          type: 'image/png'
        },
        {
          src: '/icons/icon-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any'
        },
        {
          src: '/icons/icon-maskable-192x192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'maskable'
        },
        {
          src: '/icons/icon-maskable-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable'
        }
      ]
    },
    workbox: {
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      navigateFallback: undefined,
      skipWaiting: true,
      globPatterns: ['**/*.{js,css,png,svg,ico,woff2}'],
      runtimeCaching: [
        {
          urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
          handler: 'CacheFirst',
          options: {
            cacheName: 'google-fonts-cache',
            expiration: {
              maxEntries: 10,
              maxAgeSeconds: 60 * 60 * 24 * 365
            },
            cacheableResponse: {
              statuses: [0, 200]
            }
          }
        },
        {
          urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
          handler: 'CacheFirst',
          options: {
            cacheName: 'gstatic-fonts-cache',
            expiration: {
              maxEntries: 10,
              maxAgeSeconds: 60 * 60 * 24 * 365
            },
            cacheableResponse: {
              statuses: [0, 200]
            }
          }
        }
      ]
    },
    client: {
      installPrompt: true
    },
    devOptions: {
      enabled: false
    }
  }
})
