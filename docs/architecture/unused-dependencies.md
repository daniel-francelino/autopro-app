# Dependências não utilizadas

Data: 2026-11-12. Análise por leitura e busca no código. Atualizado após a remoção dos pacotes listados abaixo (`@he-tree/vue` e `@iconify-json/simple-icons` mantidos).

## Provavelmente não usadas (confiança alta)

| Pacote | Seção | Evidência | Observação |
|---|---|---|---|
| `@unovis/ts`, `@unovis/vue` | dependencies | Sem referência no código | REMOVIDOS. Os gráficos usam `vue3-apexcharts` |
| `@he-tree/vue` | devDependencies | EM USO: `app/assets/css/main.css:3` (`@import "@he-tree/vue/style/default.css"`) | MANTIDO. Erro da análise inicial (só buscou imports JS/TS) |
| `@standard-schema/spec` | devDependencies | Sem referência | REMOVIDO. Continua instalado como transitiva de `@nuxt/content` e `@nuxt/ui` |
| `sanitize-html` | dependencies | Só `declare module` em `app/types/index.d.ts:77`; sem import ou chamada | REMOVIDO, junto com o `declare module 'sanitize-html'` de `app/types/index.d.ts` |
| `scule` | dependencies | Sem uso direto | REMOVIDO. Continua instalado como transitiva de `@nuxt/kit` e outros |

## Segundo grupo (decisão tomada)

| Pacote | Decisão | Motivo |
|---|---|---|
| `driver.js` | REMOVIDO, junto com `'driver.js/dist/driver.css'` em `nuxt.config.ts` (css) | Sem uso no código; a entrada de CSS foi retirada na mesma mudança para não quebrar o build |
| `@capacitor/haptics` | REMOVIDO | Sem uso; não há `android/` nem `ios/` no repositório |
| `onesignal-cordova-plugin` | REMOVIDO | Só o SDK web via CDN é usado; variáveis e configuração do OneSignal web foram mantidas |
| `@iconify-json/simple-icons` | MANTIDO | Decisão do usuário (o Nuxt Icon o descobre como coleção local) |

## Mantidas

- `apexcharts`: peer de `vue3-apexcharts`.
- Módulos do Nuxt em `nuxt.config.ts`, `@nuxt/ui`, Capacitor (CLI e plataformas), Supabase, Stripe, Zod, TanStack, Vitest, Playwright, ESLint, TypeScript, `sharp`, `better-sqlite3`, entre outros usados indiretamente por config ou scripts.

## Não feito (opcional)

- Apagar `app/types/guided-tour.ts` e remover `tour_started`/`tour_completed` de `lib/analytics/events.ts` (restos do tour com `driver.js`). `docs/metrics/usage-metrics-plan.md` ainda cita `driver.js`.

## Validação

Build local proibido nesta tarefa; validação via Docker (`Dockerfile`, alvo `build`: `pnpm install --frozen-lockfile` + `pnpm build`). Typecheck, lint e test unitário não existem como etapa do Docker; foram executados com `docker run` sobre a imagem do alvo `build`.

Comandos: `docker build --target build -t autopro-app:depcheck .` e `docker run --rm autopro-app:depcheck pnpm <script>`.

| Etapa | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` (Docker) | OK |
| `pnpm build` (Docker, alvo `build`) | OK, exit 0 (`.output` gerado) |
| `pnpm test` (Docker) | OK: 30 arquivos, 999 passed, 33 expected fail |
| `pnpm typecheck` (Docker) | FALHA: 548 `error TS`, todos em código do app (ex.: `AppDataTable.vue`, `ChartsArea.vue`). Nenhum menciona pacote removido nem TS2307 (módulo não encontrado) |
| `pnpm lint` (Docker) | FALHA: 439 erros do ESLint, nenhum menciona pacote removido |

Typecheck e lint falham por débito já existente, não por módulo ausente. Não foi feita comparação com a base (HEAD) em Docker; seria necessário para provar que as contagens são idênticas.
