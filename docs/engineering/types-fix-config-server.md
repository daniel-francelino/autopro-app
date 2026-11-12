# Correção de typecheck: config e server (fora de reports)

Data: 2026-11-12. Escopo: `nuxt.config.ts`, `server/routes/llms.txt.get.ts`, `server/api/admin/subscriptions/*`. Somente tipo, sem mudança de comportamento. Reports e `app/**` ficam com outros devs.

## Erros antes/depois

| Arquivo | Antes | Depois |
|---|---:|---:|
| nuxt.config.ts | 11 | 0 (tsc `tsconfig.node.json`) |
| server/routes/llms.txt.get.ts | 8 | 0 (ver nota de validação) |
| server/api/admin/subscriptions/chart.get.ts | 4 (2 contados no baseline + repetição) | 0 |
| server/api/admin/subscriptions/index.get.ts | 2 (1 distinto) | 0 |

Nenhum outro arquivo de `server/**` ou `lib/**` fora de reports/profit-report-helpers tinha erro no baseline.

## Causas e correções

1. **nuxt.config.ts (TS2353, `robots` em `routeRules`)**. O módulo `@nuxtjs/robots` estende `NitroRouteConfig` em `.nuxt/types/nuxt-robots-nitro.d.ts`. O `nuxt.config.ts` é tipado só pelo `.nuxt/tsconfig.node.json`, cujo `include` não traz esse arquivo gerado; logo `robots` não existia no tipo. O valor está correto (a propriedade é lida pelo módulo em runtime). Correção: `import type {} from './.nuxt/types/nuxt-robots-nitro'` no topo (apagado na compilação, zero efeito em runtime, nenhum valor de config alterado). Alternativa `/// <reference path>` foi rejeitada pela regra eslint `triple-slash-reference`.
2. **llms.txt.get.ts**. Esse handler entra no projeto `app` do vue-tsc via tipos de rota do Nitro (`$fetch`), onde os auto-imports globais `useSiteConfig` e `queryCollection` são as versões de client (assinaturas sem `event`; coleção como união). Correção: imports explícitos das versões de servidor, `queryCollection` de `@nuxt/content/nitro` e `useSiteConfig` de `#site-config/server/composables/useSiteConfig`. São as mesmas funções que o Nitro auto-importa no server (conferido em `.nuxt/types/nitro-imports.d.ts`), então o runtime não muda.
3. **chart.get.ts (TS2532)**. `noUncheckedIndexedAccess`: `newByMonth[key]++` em `Record<string, number>`. Correção: `newByMonth[key] = (newByMonth[key] ?? 0) + 1` (a chave já é validada por `key in ...` e inicializada com 0, resultado idêntico).
4. **index.get.ts (TS2538)**. `sub` é `Record<string, unknown>`, então `sub.organization_id` é `unknown` como índice. Correção: `as string`. Para `null`/`undefined` o índice vira `"null"`/`"undefined"` e cai em `'—'`, igual a antes.

## Decisões e riscos

- O import de tipo em `nuxt.config.ts` depende de `.nuxt/` existir (gerado por `nuxt prepare`/`nuxt typecheck`). Em runtime/build não importa. Em checkout limpo sem `prepare`, só ferramentas de tipo reclamariam (o `pnpm typecheck` já roda prepare). Sem `any`/`@ts-ignore`.
- A solução de `llms.txt` depende do alias `#site-config/server/composables/useSiteConfig` (nuxt-site-config 3.2.21). Se o módulo mudar o caminho, o build falha de forma explícita. Validar com `nuxt build`/dev antes de merge (não executado aqui: `/llms.txt` é prerender).
- Causa estrutural comum a outros handlers: arquivos de `server/` que usam auto-imports específicos de client/server podem errar quando entram no projeto `app`. Se aparecer em outros, usar o mesmo padrão de import explícito.
- Alterações no `nuxt.config.ts` não tocam módulos, runtimeConfig nem build.

## Regra proposta para imports de `server/types` (sem mover nada)

Estado atual (verificado): `server/` usa imports relativos para `server/types` (ex.: `'../../../../types/fiscal'`); 0 usos de alias `~~/server` ou `~~/lib` no server; `server/` importa `lib/` por relativo (24 ocorrências); `app` não importa `server/`.

Regra:
1. Em `server/**`, importar `server/types/*` e `lib/*` por caminho **relativo** e com `import type` (o alias `~/` aponta para `app/` no server e nunca deve ser usado para tipos de server; `~~/` não está em uso). Motivo: consistência com o código atual, funciona em vitest e no Nitro sem depender da config de alias.
2. `app/**` nunca importa de `server/types`. Tipo compartilhado app+server vai para `lib/` (seção 4 de types-organization.md) e é importado por relativo no server e por `~~/lib/...` ou relativo no app (seguir o que o arquivo já usa).
3. Tipo usado em um único arquivo fica local; em 2+ do lado server vai para `server/types/<domínio>.ts` (ex.: `reports.ts`, que já existe).
4. Se profundidade de `../` passar de 4 níveis, preferir reexportar via um arquivo de `server/types` mais próximo em vez de introduzir alias novo.

## Validação

- `eslint` nos 4 arquivos: OK.
- `tsc -p .nuxt/tsconfig.node.json`: 0 erros em `nuxt.config.ts`.
- `tsc -p .nuxt/tsconfig.server.json` (antes das edições): chart/index com os 3 erros esperados; llms não aparece neste projeto, só no `app`.
- `vue-tsc -p .nuxt/tsconfig.app.json` após as edições: 0 erros em llms, nuxt.config, subscriptions e lib. (2 execuções completas de tsc no total; `nuxt build` não executado.)
- Sem testes unitários específicos para esses arquivos.
