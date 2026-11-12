# Dependências não utilizadas

Data: 2026-11-12. Análise por leitura e busca no código. Atualizado após a remoção do primeiro grupo (exceto `@he-tree/vue`, mantido).

## Provavelmente não usadas (confiança alta)

| Pacote | Seção | Evidência | Observação |
|---|---|---|---|
| `@unovis/ts`, `@unovis/vue` | dependencies | Sem referência no código | REMOVIDOS. Os gráficos usam `vue3-apexcharts` |
| `@he-tree/vue` | devDependencies | EM USO: `app/assets/css/main.css:3` (`@import "@he-tree/vue/style/default.css"`) | MANTIDO. Erro da análise inicial (só buscou imports JS/TS) |
| `@standard-schema/spec` | devDependencies | Sem referência | REMOVIDO. Continua instalado como transitiva de `@nuxt/content` e `@nuxt/ui` |
| `sanitize-html` | dependencies | Só `declare module` em `app/types/index.d.ts:77`; sem import ou chamada | REMOVIDO, junto com o `declare module 'sanitize-html'` de `app/types/index.d.ts` |
| `scule` | dependencies | Sem uso direto | REMOVIDO. Continua instalado como transitiva de `@nuxt/kit` e outros |

## Provavelmente não usadas, com ressalva

| Pacote | Ressalva |
|---|---|
| `driver.js` | Só aparece no CSS em `nuxt.config.ts:54`. Remover pacote e entrada juntos |
| `@capacitor/haptics` | `cap sync` inclui plugins listados no package.json nas builds nativas; pode ser intencional |
| `onesignal-cordova-plugin` | Sem import visível; `app/plugins/onesignal.client.ts` não foi lido por inteiro |
| `@iconify-json/simple-icons` | Sem uso encontrado; confirmar em `content/` e templates antes de remover |

## Mantidas

- `apexcharts`: peer de `vue3-apexcharts`.
- Módulos do Nuxt em `nuxt.config.ts`, `@nuxt/ui`, Capacitor (CLI e plataformas), Supabase, Stripe, Zod, TanStack, Vitest, Playwright, ESLint, TypeScript, `sharp`, `better-sqlite3`, entre outros usados indiretamente por config ou scripts.

## Próximo passo sugerido (não executado)

1. Em branch separada, remover o primeiro grupo e a linha de `app/types/index.d.ts`.
2. Antes de cada remoção, `pnpm why <pacote>` para checar peers.
3. Rodar `pnpm install`, `typecheck`, `lint`, `test`, `build` e `cap:sync`.
4. Tratar o segundo grupo em lote separado, após verificar `onesignal` e `haptics`.
5. `package.json` e `pnpm-lock.yaml` têm alterações não commitadas: manter esse trabalho separado de outras mudanças.
