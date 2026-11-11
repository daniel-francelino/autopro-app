# Desempenho do `nuxt build` local (27,6 min) vs Vercel (~4 min)

Escopo: análise de leitura. Nada foi executado (sem `nuxt build`, Docker ou Playwright). Convenção: **FATO** = verificado em arquivo ou log; **ESTIMATIVA** = inferência.

Evidência de tempo vem de `.test-output/baseline/cold-e2e-logs/build.log` (log completo da execução de 1655,6 s; `cold.stages.txt` registra `build.log ... secs 1655.6`) e de `.test-output/baseline/cold-e2e.console.txt`. O `.test-output/logs/build.log` atual (2,5 KB) é de outra execução, interrompida em `transforming...` do cliente, e não serve para tempo.

## A. Diagnóstico (ordenado por impacto)

### Achado central: os 27,6 min não são um build bem-sucedido

- FATO: `cold-e2e.console.txt` mostra `[FAIL] build (exit 134)` e `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`. Os últimos GCs (`1645438 ms` e `1652992 ms`) mostram o heap preso em ~4023 MB, com `Mark-Compact` de 4,8 s e 7,4 s e `mu = 0.08`. O processo passou o fim da execução em thrash de GC e morreu em ~1650 s.
- FATO: a morte ocorre na etapa `Building Nuxt Nitro server (preset: node-server ...)` (build.log:371), a última, depois do prerender.
- FATO: o teto de ~4 GB indica que `--max-old-space-size=8192` (`scripts/test-stack.mjs:171-173`) não estava aplicado naquela execução. O log de 10 GB (`cold-e2e-10g.console.txt`) mostra `[ok] build`. Ou seja, com heap maior o build termina.
- ESTIMATIVA (alta confiança): a maior parte dos ~1650 s foi gasta na etapa final do Nitro (Rollup sobre o bundle do servidor) com o heap perto do limite. As etapas anteriores somam ~6 a 7 min, e o resto (~20 min) sobra para a última etapa e o thrash de GC.

### Tempos por etapa (cold-e2e-logs/build.log)

| Etapa | Tempo | Evidência |
|---|---|---|
| Vite cliente (2694 módulos) | 150,9 s | build.log:302-303 |
| Vite servidor (1700 módulos) | 71,4 s | build.log:309-310 |
| Prerender de 30 rotas | 141,4 s | build.log:358 |
| PWA `generateSW` (303 entradas, 6,08 MiB) | não medido | console.txt (saída "PWA v1.2.0") |
| Nitro final (Rollup do servidor) | restante: ~1290 s, termina em OOM | build.log:371, GC acima |

Soma das etapas medidas: ~364 s (6 min). O restante é a etapa final com thrash.

### Causas, por impacto

1. **Heap de 4 GB insuficiente para a etapa final do Nitro** (FATO: OOM; ESTIMATIVA: é o maior consumidor de tempo). Causas prováveis do volume: `better-sqlite3`, `@nuxt/content` (banco SQLite embutido, `database.compressed.mjs` no log), `stripe`, `pdf-lib`, `@unovis`, `apexcharts` e outras dependências no bundle do servidor (`package.json`). 331 arquivos em `server/` e 310 em `app/`.
2. **Prerender de 30 rotas em 141 s com OG images** (FATO). Cada `/__og-image__/static/<slug>/og.png` leva 450 a 900 ms (log). Só há 3 chamadas `defineOgImageComponent` (`app/pages/pricing.vue:25`, `app/pages/perguntas-frequentes.vue:19`, `app/pages/[slug].vue:44`), com um componente `Saas` (`app/components/OgImage/OgImageSaas.vue`). O log não mostra Chromium/Puppeteer (0 ocorrências), então o renderizador é Satori/resvg, sem navegador headless. As 30 rotas vêm de `routeRules` (`nuxt.config.ts:115-119`), das 6 páginas de `content/paginas`, e dos assets de OG/sitemap/robots. Não há `nitro.prerender` ativo (`nuxt.config.ts:141-149`, comentado), nem `crawlLinks`.
3. **Build do cliente com `sourcemap.client: true`** (`nuxt.config.ts:134-137`) (FATO). Gerar sourcemaps de 2694 módulos aumenta tempo e memória (ESTIMATIVA). O PWA ainda gera `sw.js.map` e `workbox*.js.map`.
4. **Ambiente Windows** (ESTIMATIVA, ver B): `node_modules/.pnpm` tem 1808 pacotes; `du -sh node_modules` nem terminou em 120 s neste ambiente, sinal de I/O lento do sistema de arquivos/antivírus.
5. **Poucos fatores que NÃO explicam**: o `@nuxt/content` processa só 8 arquivos (build.log: `Processed 4 collections and 8 files in 2746ms (8 cached, 0 parsed)`; `content/` tem 6 `.md` em `paginas/` mais `2.pricing.yml` e `faq.yml`). `.nuxt` tem 4,4 MB. `.data` tem 1,3 MB. `public` tem 678 KB. `.output` não existe agora. O volume de conteúdo é pequeno.

### Dependência de rede e ambiente

- FATO: nenhuma rota prerenderizada busca dados externos. As páginas prerenderizadas usam `queryCollection` (conteúdo local: `app/pages/index.vue:12`, `app/pages/pricing.vue:5-6`). Supabase e Stripe estão em `runtimeConfig` (`nuxt.config.ts:74-85`) e só são lidos em runtime. Rede não é causa provável.
- FATO: `nuxt.config.ts` só usa `process.env.NODE_ENV` e `NUXT_PUBLIC_*`/`SUPABASE_*`/`STRIPE_*`; não há `process.env.VERCEL` em `nuxt.config.ts`, `app/`, `server/` ou `scripts/` (grep sem resultado).
- FATO: `readdirSync('content/paginas')` (`nuxt.config.ts:4`) é síncrono e trivial.
- FATO: preset local `node-server` (build.log:12). Na Vercel o Nuxt detecta `VERCEL` e usa o preset `vercel` (ESTIMATIVA, comportamento padrão do Nitro; não confirmável no repo).

Versões (FATO, build.log:3): Nuxt 4.3.1, Nitro 2.13.1, Vite 7.3.1, Vue 3.5.29. `packageManager: pnpm@10.29.3` (`package.json:99`). `postinstall: nuxt prepare` (`package.json:9`). Não há `engines`. `pnpm-workspace.yaml` lista `onlyBuiltDependencies: better-sqlite3, sharp` (compilação nativa na instalação, não no build).

## B. Por que a Vercel é mais rápido

| Diferença plausível | Verificável no repo? |
|---|---|
| Não há `vercel.json`, `.vercelignore` nem referência a `VERCEL` | SIM (FATO: arquivos ausentes). O Vercel usa os padrões da plataforma. |
| Linux e FS rápido vs Windows/NTFS + antivírus: 1808 pacotes em `node_modules/.pnpm` fazem milhares de `stat`/leitura. Defender escaneia cada arquivo lido pelo Node/Vite/Rollup | Parcial: só o tamanho de `node_modules` é verificável; o efeito só se confirma medindo (E). |
| Heap/memória: a máquina da Vercel não trava no teto de 4 GB, ou a memória e o tempo de GC são menores. A máquina local tem 31,8 GB RAM (FATO), então o problema é o teto do Node, não a RAM | SIM para o teto (log); o ambiente Vercel só se confirma medindo. |
| Mais núcleos e I/O em disco local da VM. O repo local tem 8 processadores (FATO: `nproc` = 8) | Parcial. A Vercel declara 4 vCPU em Standard e 8 em Enhanced (ESTIMATIVA, não verificável aqui). |
| Cache de build: a Vercel restaura `node_modules`, `.nuxt` e `node_modules/.cache` entre builds quando o lockfile não muda | NÃO verificável no repo; só no painel. Local, cold build não reaproveita nada (embora o log mostre `8 cached` do content). |
| Preset `vercel` gera funções serverless em vez de empacotar um servidor `node-server` único com todo o grafo de dependências. O build final é mais leve | ESTIMATIVA (comportamento do Nitro); confirmar com `--preset vercel` (E). |
| Outros processos na máquina local: Docker, Supabase stack e Playwright rodando em paralelo disputam CPU/RAM (build.log foi medido com a stack subida: `stack-up` precede `build`) | SIM (FATO: `stack-up.log` roda antes do build em `cold.stages.txt`). |
| CI do repo também não cacheia `.nuxt`; usa cache só de `.output` por carimbo (`ci.yml`, step "Cache build (.output)" e `scripts/test-stack.mjs:57-89`) | SIM (FATO). |

## C. Opções por ganho/risco

1. **Garantir `NODE_OPTIONS=--max-old-space-size=8192` em qualquer build local** (ganho: alto, provável redução de 27 min para minutos, ao eliminar o thrash). Risco de produção: nenhum (só afeta o processo local). Como aplicar: `NODE_OPTIONS=--max-old-space-size=8192 pnpm exec nuxt build` ou usar `pnpm build:e2e` (`scripts/test-stack.mjs:171-173` já define 8192 por padrão). Para `pnpm build`, o script é `nuxt build` sem heap (`package.json:6`): um `pnpm build` nu fica no teto de ~4 GB. Validar: observar a linha `Mark-Compact` no GC (`--trace-gc`) e o tempo da última etapa.
2. **Excluir `node_modules`, `.pnpm-store`, `.nuxt`, `.output`, `.data` e o projeto do Windows Defender** (ganho: médio a alto; I/O de milhares de arquivos). Risco: nenhum para produção; decisão de segurança local do usuário. Verificar: `Get-MpPreference | Select ExclusionPath` (PowerShell) e, se possível, mover o repo para um caminho curto (hoje `C:\Users\daniel.francelino\Desktop\projects_study\autopro-app`, ~70 caracteres; há também `node_modules\.pnpm\...` longos). Alternativa de maior ganho: rodar o build no WSL2 (FS ext4) ou em container Linux. Validar: medir a etapa Vite cliente antes e depois (150,9 s é a referência).
3. **Desligar `nuxt-og-image`, `@nuxtjs/sitemap`, `@nuxtjs/robots` e PWA só em build de teste** por variável de ambiente (ganho: médio; remove ~141 s do prerender de OG e o `generateSW`). Risco: ALTO se mal feito, pois o artefato de teste deixa de ser o de produção (ver D). Só para um build "rápido de smoke" separado. Validar: `time` de cada etapa com e sem a variável.
4. **Reduzir a lista de rotas pré-renderizadas** (ganho: pequeno a médio). As rotas são as 6 páginas SEO + `/`, `/pricing`, `/perguntas-frequentes`, `/llms.txt` (`nuxt.config.ts:115-119`) e as OG images delas. São páginas de aquisição, então removê-las muda produção/SEO. Risco: alto para SEO. Não recomendado; o tempo é dominado por OG (~0,5-0,9 s por imagem), que é o custo do recurso.
5. **Desligar `sourcemap.client` em build local** (ganho: pequeno a médio, a medir; `nuxt.config.ts:134-137`). Risco: perde sourcemaps de produção se a config for alterada para todos. Usar só via variável em build de teste ou aceitar `NUXT_SOURCEMAP`-style via `--sourcemap` ad hoc.
6. **Cache de `.nuxt` e `node_modules/.cache` entre builds** (ganho: pequeno no cold; o `.nuxt` tem só 4,4 MB, então o ganho está sobretudo em `node_modules/.cache` de `jiti`/`nuxt`, que já existe local). Risco: baixo. Para build local repetido, não limpe `.nuxt`/`.output` e use `pnpm test:stack`, que pula o build quando o carimbo bate (`scripts/test-stack.mjs:162-170`).
7. **Reduzir o bundle do servidor** (ganho: provável, ESTIMATIVA; é a causa de fundo do OOM). Revisar o que `server/` importa (`stripe`, `pdf-lib`, `better-sqlite3`, `@nuxt/content`). Ver `Duplicated imports "summarize"/"CheckStatus"` (build.log): auto-imports duplicados em `server/utils/audit/sanitize.ts`, `server/utils/site-check.ts`, `server/utils/system-checks.ts`. Risco: médio (refatoração). Não faça agora; medir antes (E).
8. **Atualizar `caniuse-lite`** (aviso no log): ganho irrelevante.

## D. O que NÃO fazer

- Não degradar o build de produção para acelerar o de teste. O build de teste deve continuar sendo o de produção (ver `docs/architecture/tests-organization.md` §10.3 item 12: trocar o artefato perde precisão). Manter ao menos um E2E contra o build completo no CI.
- Não aumentar o heap para "mascarar" sem medir: se o consumo for vazamento de configuração (grafo de dependências), 8 GB só adia o problema.
- Não alterar rotas pré-renderizadas ou `robots`/`sitemap` por velocidade: afeta SEO e produção.
- Não rodar o build com a stack Docker e o Playwright ligados ao mesmo tempo ao medir: contamina o tempo.

## E. Medição mínima (sem build completo)

Sempre com a stack desligada e em um terminal limpo. Cada comando mede uma etapa.

1. **Confirmar o teto de heap** (rápido): `node -e "console.log(v8.getHeapStatistics().heap_size_limit/1048576)"` com e sem `NODE_OPTIONS=--max-old-space-size=8192`. Se `pnpm build` mostra ~4144 MB, a causa 1 está confirmada.
2. **Build com heap e traço de GC**: `NODE_OPTIONS="--max-old-space-size=8192 --trace-gc" pnpm exec nuxt build 2>&1 | tee build-trace.log` (só uma vez; é o build completo, mas agora deve terminar). Medir: tempo por linha `Client built in`, `Server built in`, `Prerendered N routes in`, e o instante do `Building Nuxt Nitro server`.
3. **Isolar o Nitro final**: `NITRO_PRESET=vercel pnpm exec nuxt build` ou `pnpm exec nuxt build --preset vercel` para comparar o custo do preset (a Vercel usa esse preset). Compare com `node-server`.
4. **Medir antivírus/FS sem build**: `Measure-Command { Get-ChildItem node_modules\.pnpm -Recurse -File | Measure-Object }` (PowerShell), antes e depois de adicionar a exclusão do Defender. Se cair várias vezes, o I/O é relevante.
5. **Medir uma etapa**: `DEBUG=nuxt:*` e `NITRO_LOG_LEVEL=...` mostram etapas; `--trace-gc` mostra a pressão de memória. Para ver o peso do OG: comparar o tempo de `Prerendered 30 routes` (referência: 141,4 s) com o mesmo build sem `nuxt-og-image` na lista de `modules` em um clone ou branch descartável (nunca no código de produção).
6. **Escopo mínimo**: `pnpm test:stack --only=build` registra `build.log` e o carimbo; use `--build` para forçar e comparar execuções.

Métricas a registrar: heap limite, tempo de cada etapa, pico de memória (Gerenciador de Tarefas/`process.memoryUsage()`), CPU média, se Defender estava ativo.

## F. Resumo para o usuário

- Os 27,6 min são, na verdade, um build que terminou com erro: `exit 134`, "JavaScript heap out of memory", com o heap preso em ~4 GB (FATO, `cold-e2e.console.txt`).
- Causa mais provável: o `nuxt build` sem `--max-old-space-size` fica no teto de ~4 GB e passa ~20 min em GC na etapa final do Nitro (FATO do OOM; o tempo exato da etapa é ESTIMATIVA).
- Etapas medidas: Vite cliente 151 s, servidor 71 s, prerender (30 rotas, OG images de 0,5-0,9 s cada) 141 s. Soma ~6 min (FATO).
- Não há `vercel.json` nem lógica por `VERCEL`; o prerender não usa rede (FATO). O Windows (NTFS, antivírus, 1808 pacotes) é fator secundário (ESTIMATIVA).
- Primeira ação: rodar `NODE_OPTIONS=--max-old-space-size=8192 pnpm exec nuxt build` (ou `pnpm build:e2e`) e comparar. Depois, excluir o repo do Defender.
- Só mexer em OG/sitemap/PWA/sourcemap se a medição mostrar ganho, e nunca no build de produção.
- Sugestão (fora deste escopo): `package.json` `build` sem heap deveria receber `NODE_OPTIONS` ou `cross-env`; é mudança de script, não feita aqui.
