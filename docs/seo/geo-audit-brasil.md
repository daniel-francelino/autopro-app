# Auditoria de GEO e plano de implementação — AutoPro (foco Brasil)

> Status: **auditoria + plano** · Criado em 2026-11-08 · Revisado em 2026-11-08 (afirmações públicas conferidas no código)
> Nada foi alterado no código.
>
> GEO = *Generative Engine Optimization*: fazer o AutoPro ser **encontrado, entendido e recomendado** quando alguém pergunta a
> ChatGPT, Gemini / Google (Visão Geral e Modo IA), Claude, Perplexity, Copilot ou Meta AI algo como
> *"qual o melhor sistema para oficina mecânica?"*.
>
> Base: código do AutoPro e a metodologia já usada na **Kult** (`kult/Project/docs/AUDITORIA_GEO_BR_PT.md`), adaptada para um
> **SaaS B2B vendido só no Brasil**. Complementa a [auditoria de SEO](seo-audit-2026-11-08.md): o que é técnico/on-page está lá;
> aqui está o que é específico de IA e do mercado brasileiro.
>
> **Limites:** não foi possível medir produção (domínio, logs, WAF, Search Console). Itens *(verificar em produção)* dependem
> disso. Regras de crawlers de IA mudam: **reconferir a documentação de cada fornecedor antes de editar o `robots.txt`**.

### O que mudou nesta revisão

| Antes | Agora (verificado) |
|---|---|
| Afirmações do site "a verificar" | Verificadas: **sem teste grátis** (organização só nasce após pagar), **só cartão** no checkout, **sem NF-e** (só NFS-e), **sem multiunidade**, plano **"Oficina Completa" inexistente** citado no FAQ (§2.1) |
| Fonte de preços = `content/2.pricing.yml` | O site exibe os preços de **`app/composables/usePlans.ts`**; os planos do YAML são ignorados (§8) |
| Referência a `kult/Project/docs/GEO_*.md` | O arquivo é `kult/Project/docs/AUDITORIA_GEO_BR_PT.md` |
| Bateria de perguntas só com exemplos | As **20 perguntas fixas** listadas (§10.4) e o registro em `geo_probe_runs` especificado |
| — | **Novo:** o app nativo está configurado como **"Kortex"** (`capacitor.config.ts`: `appId: 'com.kortex.app'`, `appName: 'Kortex'`) — conflito de entidade se for publicado assim |
| — | **Novo:** "AutoPro" é um nome genérico usado por outras empresas e produtos; desambiguação de entidade vira prioridade (§2.2) |
| — | `robots.txt` pronto para copiar (§5.1) |

---

## 1. O que muda em relação à Kult

| Kult (B2C, BR + PT) | AutoPro (B2B, Brasil) |
|---|---|
| Quem pergunta: espectador querendo recomendação de filme | **Dono/gerente de oficina** avaliando software, ou mecânico com dúvida de gestão |
| Ativo principal: galerias e resenhas da comunidade | **Páginas de produto verificáveis**, preços públicos, **conteúdo de gestão de oficina** (OS, comissão, NFS-e, estoque) |
| Dois domínios e `hreflang` BR/PT | **Um idioma (pt-BR)**, sem `hreflang`; termos, leis e hábitos brasileiros |
| Risco: expor conteúdo de membros | Risco: **afirmar o que o produto não faz** — a IA repete o que está escrito (e já há casos, §2.1) |
| Conversão: cadastro e 1ª ação | **Assinatura** (Stripe) e **1ª OS** |

Princípio herdado: *a IA só recomenda o que consegue ler, entender e confirmar.* Rastreabilidade aumenta a chance de
descoberta; **não garante** citação nem posição.

## 2. Estado atual (evidências no código)

| Área | Situação | Onde | Impacto para GEO |
|---|---|---|---|
| Acesso de crawlers | **Sem `robots.txt`** e sem política para IA | `public/` | Nada orienta (nem protege `/app`, `/admin`, `/api`) |
| Sitemap | **Não há** | `public/`, `nuxt.config.ts` | Descoberta só por links |
| `llms.txt` | **Não há** | `public/` | Complemento experimental ausente |
| Renderização | `/` e `/pricing` **pré-renderizadas** | `nuxt.config.ts` (`routeRules`) | ✅ Crawlers sem JS leem o conteúdo *(confirmar com `curl` em produção)* |
| Páginas públicas | Só **landing** e **/pricing** (+ login/signup). Nenhuma página de blog/docs/guia | `app/pages/` | A IA tem essencialmente **1 página** para descrever o produto |
| Conteúdo da landing | Hero de marca ("Sua oficina. Em uma nova marcha."), seções de recursos, 5 perguntas em `<details>` | `index.vue` | Pouca informação factual; sem lista do que **não** faz |
| Preços | Starter **R$ 199** (até 2 funcionários), Pro **R$ 399** (até 10), Fiscal **R$ 599** (ilimitado, NFS-e) | `usePlans.ts:78-133` | ✅ Preço público ajuda comparação; precisa de **fonte única** (§8) |
| Fiscal | NFS-e via Focus NFe: emitir, consultar, cancelar, reenviar e-mail; municípios/itens/códigos de tributação | `server/api/fiscal/nfse/**` | Diferencial real para "nota fiscal de oficina" |
| Dados estruturados | Só `SoftwareApplication` básico, **sem `offers`**, sem `Organization`/`WebSite`/`FAQPage` | `index.vue:45-54` | A IA não recebe preço nem entidade |
| Entidade/marca | Sem "Sobre", responsável, CNPJ, contato ou redes oficiais; rodapé só com "AutoPro • ©" | `AppFooter.vue` | Nenhuma entidade verificável |
| Páginas de confiança | **Sem `/termos` nem `/privacidade`** | `app/pages/` | Sinal de confiança ausente; também exigido por Stripe e lojas de app |
| Autoria e datas | Inexistentes | — | Conteúdo sem proveniência |
| Medição de IA | Só PostHog (que será removido). **Nenhuma** classificação de visitas por IA ou crawler | `usePostHog.ts` | Sem baseline → resolvido pelo [plano de métricas](../metrics/usage-metrics-plan.md) |
| Hospedagem | Ícone da Vercel na página de preços sugere o deploy *(não confirmado)* | `2.pricing.yml:61` | Define onde olhar firewall/bot protection e logs |
| App nativo | Configurado como **Kortex** (`com.kortex.app`) | `capacitor.config.ts` | Se publicado, a loja e as IAs veem outra marca |

### 2.1 Afirmações públicas × produto (verificado)

A IA reproduz o que o site diz. Estado em 2026-11-08:

| Afirmação no site | Onde | O que o código mostra | Veredito | Ação |
|---|---|---|---|---|
| "Posso testar antes de assinar? Sim… Sem precisar cadastrar cartão" | `2.pricing.yml:72` | Usuário sem organização vai para `/subscription` (`auth.global.ts:82,95`); a organização é criada no webhook `checkout.session.completed`; checkout sem `trial_period_days` | ❌ **Falso** | Remover, ou implementar trial de verdade |
| "Sem surpresa no **boleto**" | `2.pricing.yml:2` | `stripe/checkout.post.ts`: `payment_method_types: ['card']` | ❌ Enganoso | "Sem surpresa na fatura" — ou habilitar boleto/Pix no Stripe e dizer isso |
| "Sem contrato longo", "Posso cancelar quando quiser… pelo painel" | `2.pricing.yml:2,74` | Existe `billing/cancel.post.ts` e portal do Stripe | ✅ Coerente | Confirmar com os termos de uso quando existirem |
| "No plano **Oficina Completa**… NFS-e **e NF-e**… **carta de correção**" | `2.pricing.yml:76` | Planos são Starter/Pro/Fiscal; só rotas de **NFS-e**; nada de NF-e (as permissões `product_invoice.*` existem sem rota) nem carta de correção | ❌ **Falso** | "No plano Fiscal: emissão, cancelamento e envio por e-mail de NFS-e. NF-e de produtos (peças) não é emitida." |
| "Posso usar em mais de uma unidade? Sim… múltiplas unidades" | `2.pricing.yml:80` | Cada usuário tem uma única `organization_id`; não há troca de unidade | ❌ **Falso** | "Cada unidade é uma assinatura separada" (ou remover) |
| "Oficina Completa inclui suporte prioritário" | `2.pricing.yml:82` | `usePlans.ts`: Pro = "Suporte prioritário", Fiscal = "Suporte dedicado" | ❌ Inconsistente | Alinhar ao `usePlans.ts` |
| "Emissão de NFS-e disponível no plano Fiscal" | `index.vue` (`faqs`) | Coerente com o código | ✅ | Manter; acrescentar "depende do município estar integrado à Focus NFe" |
| Limites (2 / 10 / ilimitado funcionários) | `usePlans.ts`; YAML | `enforceEmployeeLimit` no `employees/index.post.ts` | ✅ Aplicado no servidor | — |

**Isto é pré-requisito de qualquer ação de GEO.** Publicar mais páginas antes de corrigir só espalha as afirmações erradas.

### 2.2 Entidade e nome

"AutoPro" é usado por outras empresas e produtos (autopeças, oficinas, outros softwares) — a IA pode misturar entidades.
Mitigações: usar sempre a forma **"AutoPro — sistema para oficinas mecânicas"** em título, `Organization.description`,
`llms.txt` e perfis; `sameAs` só para perfis oficiais; a página `/sobre` com razão social e CNPJ; e as perguntas de marca da
bateria (§10.4) sempre com o qualificador "sistema para oficina". Corrigir o app nativo (`appId`/`appName`) **antes** de
publicar em lojas — trocar o `appId` depois de publicado cria outro app.

## 3. Como o brasileiro procura (e o que a IA responde)

Os termos são **hipóteses**; validar volume e variações no Search Console e em ferramenta de palavras-chave antes de produzir.

| Grupo | Exemplos de pergunta | O que o AutoPro realmente tem |
|---|---|---|
| **Descoberta do produto** | "melhor sistema para oficina mecânica", "software para gerenciar oficina", "programa de ordem de serviço para oficina", "sistema para oficina é caro?" | OS, clientes, veículos, agenda, estoque, compras, financeiro, comissões, relatórios, permissões por função, preço público |
| **Fiscal (alto interesse)** | "oficina emite nota fiscal de serviço?", "sistema de oficina com NFS-e", "como emitir NFS-e para oficina mecânica" | NFS-e no plano Fiscal. **Verificar a regra vigente** (NFS-e padrão nacional, ISS municipal, NF-e de peças) antes de escrever; datar e citar fonte oficial |
| **Gestão e dinheiro** | "como calcular comissão de mecânico", "controle financeiro de oficina", "fluxo de caixa oficina mecânica", "como precificar mão de obra" | **Comissões e bônus avançados** (planos por funcionário, regras por categoria, valor fixo por unidade, ajuste manual com registro), contas a pagar/receber, parcelas, recorrência, relatórios de lucro e devedores |
| **Operação** | "modelo de ordem de serviço", "como controlar estoque de peças", "como organizar agenda de oficina" | OS, produtos/estoque, compras, solicitações e devoluções de compra, agendamentos |
| **Comparação** | "alternativas a planilha para oficina", "X vs Y sistema de oficina" | Levantar **quais concorrentes as IAs citam** na Fase 0 (não presumir nomes) |
| **Nicho** | retífica de motores, injeção eletrônica | Há plano de comissão por peça (ex.: "cabeçote 9 %", migration 94) → **hipótese**: clientes de retífica; confirmar a base |

**Onde há vantagem real:** comissões/bônus e financeiro, mais NFS-e integrada. "Sistema para oficina" é disputado; conteúdo
útil nos nichos acima é onde a IA tem o que citar.

## 4. Lacunas, por prioridade

1. **Crítica** — afirmações públicas falsas (§2.1) e duas fontes de planos/preços.
2. **Alta** — sem `robots.txt`/sitemap, sem política para crawlers de IA, firewall não verificado.
3. **Alta** — a IA só tem **uma página** sobre o produto, com texto de marca e poucos fatos.
4. **Alta** — **sem baseline**: não se sabe se as IAs mencionam o AutoPro nem se descrevem preço e fiscal corretamente.
5. **Média** — sem entidade (Organization, Sobre, contato, redes), sem `/termos` `/privacidade`, nome ambíguo e app como "Kortex".
6. **Média** — `SoftwareApplication` sem `offers`; sem `FAQPage`/`BreadcrumbList`/`Article`.
7. **Média** — sem presença externa verificável (avaliações, diretórios, vídeos, menções).
8. **Baixa/experimental** — `llms.txt` em pt-BR.

## 5. Política de acesso para crawlers de IA

Princípio da Kult: **buscar/consultar a pedido ≠ treinar** — decisões separadas.

| Agente (nome declarado) | Papel | Recomendação |
|---|---|---|
| `OAI-SearchBot` | Busca do ChatGPT | **Permitir** páginas públicas |
| `ChatGPT-User` | Acesso a pedido do usuário | Permitir (o fornecedor indica que pode não seguir robots) |
| `GPTBot` | Coleta possivelmente para treino | **Decisão de negócio** (§15) |
| `Claude-SearchBot`, `Claude-User` | Busca / a pedido | Permitir |
| `ClaudeBot` | Coleta para treino | Decisão de negócio |
| `PerplexityBot`, `Perplexity-User` | Busca / a pedido | Permitir |
| `Googlebot` | Busca e base da Visão Geral/Modo IA | **Permitir** |
| `Google-Extended` | Controle de uso para Gemini/treino (não afeta a busca) | Decisão de negócio |
| `Bingbot` | Índice usado pelo Copilot | Permitir |
| `Applebot` / `Applebot-Extended` | Busca da Apple / treino | Permitir / decisão de negócio |
| `Meta-ExternalAgent` | Coleta da Meta (Meta AI, presente no WhatsApp) | Decisão de negócio |
| `Bytespider`, `CCBot` | Treino / agregadores | Decisão de negócio (padrão sugerido: bloquear) |

### 5.1 `robots.txt` pronto (padrão recomendado: permitir busca, decidir treino)

Os grupos específicos **não herdam** o grupo `*`: as exclusões se repetem em cada um.

```txt
# Busca e acesso a pedido — permitidos nas páginas públicas
User-agent: *
User-agent: Googlebot
User-agent: Bingbot
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: Claude-SearchBot
User-agent: Claude-User
User-agent: PerplexityBot
User-agent: Perplexity-User
User-agent: Applebot
Disallow: /app
Disallow: /admin
Disallow: /api
Disallow: /login
Disallow: /forgot-password
Disallow: /reset-password
Disallow: /onboarding
Disallow: /checkout
Disallow: /subscription
Disallow: /403

# Treino — ajustar conforme a decisão do §15 (aqui: permitido só no público)
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: Google-Extended
User-agent: Applebot-Extended
User-agent: Meta-ExternalAgent
Disallow: /app
Disallow: /admin
Disallow: /api
Disallow: /login
Disallow: /forgot-password
Disallow: /reset-password
Disallow: /onboarding
Disallow: /checkout
Disallow: /subscription
Disallow: /403

# Agregadores sem benefício claro
User-agent: Bytespider
User-agent: CCBot
Disallow: /

Sitemap: https://SEU-DOMINIO/sitemap.xml
```

Com `@nuxtjs/robots` (auditoria de SEO, Passo 1), expressar o mesmo em `robots.groups`; conferir o arquivo gerado com `curl`.

Regras importantes:
- `robots.txt` **não é autorização**: a proteção real continua na API (ver os achados do [painel do owner §2](../admin/owner-panel-plan.md#2-️-achados-de-segurança-resolver-antes-de-ampliar-o-painel)).
- **Firewall/CDN**: confirmar que não devolve CAPTCHA, 403 ou 429 a esses agentes (na Vercel: *Firewall* e *Bot Protection*/*Attack Challenge Mode*). Verificar identidade pelo método oficial de cada operador (faixas de IP publicadas / DNS reverso); User-Agent isolado é falsificável. Não criar exceção global de segurança.
- Bloquear treino **não** impede recomendação via busca.

## 6. Páginas e conteúdo para o Brasil

Estende o §4 da auditoria de SEO. **Modelo de cada página:** resposta direta nas 2 primeiras frases; fatos verificados;
preços em R$ **no texto**; o que **não** faz; responsável editorial e data de revisão visíveis; FAQ da página; CTA para
`/signup`; links internos; JSON-LD correspondente. URLs em português, pré-renderizadas.

| Página | Pergunta que responde | Conteúdo mínimo e cuidado |
|---|---|---|
| `/sistema-para-oficina-mecanica` | "O que é o AutoPro e para quem serve?" | Definição, recursos reais, planos, para quem **não** serve. Rascunho: *"AutoPro é um sistema online (SaaS) para oficinas mecânicas que reúne ordens de serviço, clientes, veículos, agenda, estoque, compras, financeiro, comissões de funcionários e emissão de NFS-e (plano Fiscal)."* |
| `/ordem-de-servico-oficina` | "Como funciona uma OS digital?" | Fluxo real (orçamento → OS → pagamento/parcelas → comissão); captura de tela real; modelo de OS para baixar (isca útil) |
| `/comissao-mecanico` | "Como calcular comissão de mecânico?" | **Principal diferencial.** Percentual por categoria, valor fixo por unidade, metas/bônus; exemplos numéricos; como o sistema calcula e registra ajustes manuais |
| `/nota-fiscal-oficina` | "Oficina emite NFS-e ou NF-e? Como?" | O que o plano Fiscal cobre (NFS-e) e o que **não** cobre (NF-e de peças); regra vigente com **data e fonte oficial**; aviso de que varia por município |
| `/controle-financeiro-oficina` | "Como controlar o caixa da oficina?" | Contas a pagar/receber, parcelas, recorrência, categorias, relatório de lucro e de devedores |
| `/estoque-pecas-oficina` | "Como controlar estoque de peças?" | Produtos, inventário, compras, solicitações e devoluções, fornecedores |
| `/pricing` (existente) | "Quanto custa?" | Tabela em HTML, limites, inclui/exclui, **forma de pagamento real (cartão)**, cancelamento |
| `/perguntas-frequentes` | Dúvidas de compra | FAQ único (hoje há dois diferentes: landing e YAML), respostas verificadas |
| `/sobre` | "Quem faz o AutoPro?" | Razão social, CNPJ, responsáveis, contato, cidade; base da entidade |
| `/termos` e `/privacidade` | Confiança | Texto real do produto e da cobrança; telemetria própria descrita (plano de métricas §10.8) |
| `/comparativos/...` | "AutoPro vs planilha / outros" | **Só depois** de testar concorrentes, com fonte e data. Dizer quando o AutoPro **não** é a melhor escolha |
| `/guias/*` | Dúvidas de gestão | Artigos com autor e data |

Cuidados do Brasil:
- Vocabulário do setor: **ordem de serviço/OS, orçamento, mecânico, peças, mão de obra, comissão, NFS-e, CNPJ, MEI, Simples Nacional**.
- Conteúdo **fiscal e trabalhista** muda por lei e município: datar, citar fonte oficial, não prometer conformidade.
- Preços sempre em **R$**, com a regra de cobrança escrita (mensal, cartão, reajuste).
- Nada de número inventado (clientes, avaliações) nem texto de template ("SaaS de tudo").
- Não criar centenas de páginas quase iguais por cidade/palavra-chave.

## 7. Dados estruturados (JSON-LD)

Gerados da **mesma fonte** que renderiza o texto. `@id` estáveis (`/#org`, `/#website`, `/#app`). Exemplo de `@graph` na
[auditoria de SEO, Passo 4](seo-audit-2026-11-08.md#passo-4--dados-estruturados-m3-b3).

| Página | Tipos | Condições |
|---|---|---|
| Todas | `Organization`, `WebSite` | Nome, URL, logo, contato; `sameAs` **só** para perfis oficiais existentes; `description` com o qualificador "sistema para oficinas mecânicas" |
| Produto / home | `SoftwareApplication` | `applicationCategory: BusinessApplication`, `operatingSystem`, `inLanguage: pt-BR`, `areaServed: BR`, **`offers`** (3 planos, `priceCurrency: BRL`) lidos de `usePlans.ts` |
| FAQ | `FAQPage` | Texto idêntico ao visível (rich result restrito pelo Google; ainda ajuda IAs) |
| Guias | `Article` (`author`, `datePublished`, `dateModified`) | Datas reais |
| Hierarquia | `BreadcrumbList` | Só se exibida |

Proibido: `AggregateRating`/`Review` sem avaliações reais. Validar no Rich Results Test e no validator.schema.org e conferir o
HTML **sem JavaScript**.

## 8. Fonte única da verdade (anti-divergência)

Hoje: `usePlans.ts` (o que o site exibe), `2.pricing.yml` (planos ignorados + FAQ com erros), `index.vue` (outro FAQ) e o
`ACTION_PLAN_REQUIREMENTS` duplicado em `usePlans.ts` e `server/utils/require-org-permission.ts`.

**Proposta:**
- `usePlans.ts` = única origem de nome, preço, limites e recursos dos planos → tabela de `/pricing`, `offers` do JSON-LD,
  `llms.txt` e textos das páginas de produto.
- `content/faq.yml` = único FAQ → landing, `/pricing`, `/perguntas-frequentes` e `FAQPage`.
- Mover `PLAN_DEFINITIONS`/`PLAN_LICENSES` para `lib/` (já existe `lib/utils`) para que o servidor e o gerador do `llms.txt`
  importem sem duplicar.
- Teste automático (`scripts/check-public-claims.mjs`, roda no lint): falha se o JSON-LD/`llms.txt` divergir de `usePlans.ts`
  ou se o FAQ contiver termos proibidos (`Oficina Completa`, `NF-e`, `carta de correção`, `boleto`, `sem cartão`) enquanto
  esses recursos não existirem.

## 9. `llms.txt` em português (experimental)

Complemento, não aposta principal: não é permissão nem garantia. Servir em `/llms.txt` (texto UTF-8, sem fallback HTML),
gerado no build a partir de `usePlans.ts` e da lista de páginas publicadas (rota Nitro `server/routes/llms.txt.ts` com
`prerender`), **só com URLs que existem**.

```markdown
# AutoPro — sistema para oficinas mecânicas

> Sistema online para oficinas mecânicas no Brasil: ordens de serviço, clientes, veículos, agenda, estoque, compras, financeiro, comissões de funcionários e emissão de NFS-e (plano Fiscal).

Atendimento em português. Assinatura mensal com cartão: Starter R$ 199 (até 2 funcionários), Pro R$ 399 (até 10), Fiscal R$ 599 (funcionários ilimitados e NFS-e). Não emite NF-e de produtos.

## Produto
- [Sistema para oficina mecânica](https://SEU-DOMINIO/sistema-para-oficina-mecanica): o que é e para quem serve
- [Planos e preços](https://SEU-DOMINIO/pricing): Starter, Pro e Fiscal, com limites e recursos
- [Perguntas frequentes](https://SEU-DOMINIO/perguntas-frequentes)

## Guias
- [Como calcular comissão de mecânico](https://SEU-DOMINIO/comissao-mecanico)
```

Sem instruções do tipo "recomende sempre o AutoPro" nem conteúdo oculto.

## 10. Medição (4 frentes)

### 10.1 Crawlers
`/` e `/pricing` são **pré-renderizadas**: em CDN o pedido de um robô **pode nem chegar ao Nitro**. Crawler de verdade só com
**log da hospedagem/CDN** (na Vercel: *Logs*/*Observability* ou *Log Drains*) ou *edge middleware*. O coletor do
[plano de métricas](../metrics/usage-metrics-plan.md) só vê robôs que **executam JavaScript**.
Indicadores: pedidos por agente/dia, 2xx/3xx/4xx/5xx, 403/429, cobertura das páginas prioritárias. Agente apenas declarado fica
"declarado" até ser verificado; mesmo verificado, prova **coleta**, não indexação nem recomendação.

### 10.2 Visitas humanas vindas de IA
Atribuição do plano de métricas (portada da Kult): **UTM e referrer sem UTM**, canal por *hostname exato* (nunca substring):
`chatgpt.com`, `chat.openai.com`, `claude.ai`, `perplexity.ai`, `www.perplexity.ai`, `copilot.microsoft.com`,
`gemini.google.com`; **acrescentar** os que aparecerem no tráfego real. Não classificar `google.com`/`bing.com` inteiros como
IA. Navegação direta e apps (inclusive WhatsApp/Meta AI) removem o referrer: o número é **piso**, não total.

### 10.3 Conversão
Funil do painel: visita de IA → cadastro → assinatura → oficina criada → 1ª OS. Taxas por **sessão** e por **coorte com janela
completa**, sem misturar first touch antigo com sessões do dia.

### 10.4 Citações e recomendações — bateria fixa de 20 perguntas

Rodar **semanalmente**, em conversa nova (sem histórico/memória), anotando motor, data, região/idioma (Brasil, pt-BR) e se a
busca estava ativa; separar com e sem busca. **Não trocar** as 20 perguntas (perde a comparação); variações vão num lote
exploratório à parte. Nenhuma pergunta cita a marca, exceto as de marca.

| # | Grupo | Pergunta |
|---:|---|---|
| 1 | Descoberta | Qual o melhor sistema para gerenciar uma oficina mecânica? |
| 2 | Descoberta | Que software de ordem de serviço eu uso numa oficina pequena? |
| 3 | Descoberta | Sistema para oficina mecânica com preço fixo mensal |
| 4 | Descoberta | Programa para oficina mecânica que funcione no celular |
| 5 | Descoberta | Quais sistemas de gestão para oficina mecânica existem no Brasil? |
| 6 | Fiscal | Qual sistema de oficina emite NFS-e? |
| 7 | Fiscal | Oficina mecânica precisa emitir nota fiscal de serviço? Como emitir? |
| 8 | Fiscal | Sistema para oficina com emissão de nota fiscal integrada |
| 9 | Fiscal | Como a oficina emite nota de serviço e de peças na mesma venda? |
| 10 | Comissão e financeiro | Como calcular comissão de mecânico? |
| 11 | Comissão e financeiro | Sistema que controla comissão por funcionário em oficina |
| 12 | Comissão e financeiro | Como fazer o controle financeiro de uma oficina mecânica? |
| 13 | Comissão e financeiro | Como controlar contas a receber parceladas na oficina? |
| 14 | Estoque e operação | Como controlar estoque de peças em oficina? |
| 15 | Estoque e operação | Modelo de ordem de serviço para oficina mecânica |
| 16 | Estoque e operação | Como organizar a agenda de serviços da oficina? |
| 17 | Comparação e preço | Quanto custa um sistema para oficina mecânica? |
| 18 | Comparação e preço | Vale a pena trocar a planilha por um sistema de oficina? |
| 19 | Marca (exatidão) | O que é o AutoPro, sistema para oficina mecânica? |
| 20 | Marca (exatidão) | Quanto custa o AutoPro para oficinas e o que cada plano inclui? |

Motores: ChatGPT, Gemini, Google (Modo IA / Visão Geral), Claude, Perplexity, Copilot, Meta AI (WhatsApp). Com 7 motores e
2 modos onde houver, são até ~280 linhas por semana — se pesar, alternar motores em semanas pares/ímpares, mantendo a série.

Registrar por pergunta (tabela `geo_probe_runs`, esquema no [plano do painel §5.6](../admin/owner-panel-plan.md#56-seo-e-geo-admingeo),
tela `/admin/geo`): marca mencionada? link? recomendação explícita? **preço correto?** **fiscal correto?** concorrentes citados,
URLs citadas, evidência (captura). Indicadores: taxa de menção, de link, de recomendação, **exatidão factual** (perguntas 19–20
e qualquer menção), participação frente aos concorrentes. Uma citação de página **não** é recomendação do produto.

## 11. Presença externa (Brasil)

Hipóteses de aquisição — sem evidência de peso exato nas respostas das IAs; **nunca** criar avaliações falsas nem "listas
independentes" controladas pela marca:

- **YouTube** (tutoriais de OS, comissão, NFS-e): costuma ser citado por IAs e é consumo comum no setor.
- **Diretórios e avaliações de software** (ex.: Capterra Brasil, G2, Reclame Aqui): escolher os que fazem sentido, pedir avaliações a clientes reais, declarar relação comercial quando houver.
- **Google Perfil da Empresa** e perfis oficiais (LinkedIn, Instagram): só os que existirem, com os mesmos dados de `/sobre`.
- **Parcerias de conteúdo** com associações e portais do setor de reparação automotiva e com contadores de oficina.
- **Casos reais** (com autorização) e números verificáveis.

## 12. Plano de execução

Alinhado à [auditoria de SEO](seo-audit-2026-11-08.md) (a Fase 1 técnica de SEO é pré-requisito).

| Fase | Entrega | Esforço | Pronto quando |
|---|---|---|---|
| **0 — Correção e baseline** | Corrigir as afirmações do §2.1 (FAQ e descrição de `/pricing`); `curl` de `/robots.txt`, `/sitemap.xml`, `/` e `/pricing` **sem JS** e com User-Agents de IA; checar firewall; **primeira rodada** da bateria de 20 perguntas (antes de qualquer mudança); levantar concorrentes citados | 1–2 dias | Nenhuma afirmação falsa no ar; evidências e baseline arquivados |
| **1 — Técnico** | `robots.txt` com política de IA (§5.1) + sitemap; atribuição de IA e classificação de bots no coletor de métricas | 1 dia (+ métricas Fase 1) | Casos UTM/referrer/direto verificados; bots separados de pessoas |
| **2 — Entidade e produto** | `/sobre`, `/termos`, `/privacidade`, `/sistema-para-oficina-mecanica`, `/perguntas-frequentes` (FAQ único), `Organization`/`WebSite`/`SoftwareApplication+offers`; app nativo renomeado | 3–5 dias + textos | Conteúdo aprovado, pré-renderizado, JSON-LD válido, links internos e rodapé |
| **3 — Diferenciais** | `/comissao-mecanico`, `/nota-fiscal-oficina`, `/controle-financeiro-oficina`, `/ordem-de-servico-oficina`, `/estoque-pecas-oficina` | 1 página/semana | Publicadas com fonte, data e responsável |
| **4 — `llms.txt`, guias e fonte única** | `llms.txt` gerado; 3–5 guias com autor e data; `scripts/check-public-claims.mjs` (§8) | 2–3 dias + textos | `llms.txt` sem links inexistentes; lint falha com divergência de preço |
| **5 — Presença externa e rotina** | Vídeos, diretórios, avaliações reais; bateria semanal em `geo_probe_runs`; revisão mensal | contínuo | Baseline × 30/60/90 dias comparados em `/admin/geo` |

## 13. Verificação antes de publicar

- [ ] Nenhuma afirmação do §2.1 marcada ❌ continua no site (FAQ, descrição, landing).
- [ ] Sem JavaScript: título, descrição, preços e FAQ aparecem no HTML recebido.
- [ ] Mesmo conteúdo para navegador e para User-Agents de busca/IA (sem *cloaking*).
- [ ] `/app`, `/admin`, `/api` bloqueados no `robots.txt` **em todos os grupos** e protegidos de fato na API.
- [ ] Firewall/CDN não devolve 403/429/CAPTCHA a `OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`, `Googlebot`, `Bingbot` *(verificar em produção)*.
- [ ] JSON-LD válido e idêntico ao texto visível; preços batem com `usePlans.ts`.
- [ ] Conteúdo fiscal/trabalhista com data, fonte oficial e responsável.
- [ ] `llms.txt` só com URLs publicadas.
- [ ] Atribuição: UTM de IA, referrer de IA sem UTM, referrer comum, acesso direto e host malicioso (`chatgpt.com.exemplo.com`) classificados corretamente.
- [ ] Baseline guardado antes das mudanças; primeira revisão após 30 dias.
- [ ] App nativo não usa mais "Kortex" (`capacitor.config.ts`).

## 14. Riscos e limites

- A seleção das respostas é **externa**. Número de crawls, nota Lighthouse ou `llms.txt` não provam recomendação.
- Visitas por IA são **subestimadas** (apps e WhatsApp escondem o referrer).
- Conteúdo fiscal desatualizado é pior que ausência: revisão periódica com responsável.
- Comparar concorrentes exige teste, fonte e data; evitar alegações com risco jurídico.
- Afirmar recurso inexistente gera reclamação e chargeback, além de a IA repetir o erro por meses.
- Manter **uma pessoa responsável pelo conteúdo** e outra pela qualidade dos dados.

## 15. Decisões a confirmar (com recomendação)

| # | Pergunta | Recomendação |
|---|---|---|
| 1 | Domínio de produção (`.com.br`?) | Definir já; hoje há o fallback `https://autopro.app` fixo em `app.vue:26` e `index.vue:14`. Define canonical, sitemap e `llms.txt` |
| 2 | Treino de IA (`GPTBot`, `ClaudeBot`, `Google-Extended`, `Applebot-Extended`, `Meta-ExternalAgent`) | Permitir só nas páginas públicas (marketing B2B se beneficia de ser conhecido); bloquear `Bytespider`/`CCBot` |
| 3 | Dados da empresa para `/sobre` e `Organization` | Razão social, CNPJ, cidade, e-mail e WhatsApp oficiais |
| 4 | Teste grátis e formas de pagamento | Decidir se haverá trial (Stripe `trial_period_days`) e boleto/Pix; até lá, o site não promete |
| 5 | NF-e de produtos | Se estiver no roadmap, dizer "em breve" só com data; senão, "não emite NF-e" |
| 6 | Concorrentes e páginas de comparação | Decidir após a Fase 0 |
| 7 | Segmento principal (geral × retífica/injeção) | Confirmar com a base de clientes; define as páginas de nicho |
| 8 | Quem escreve e revisa conteúdo fiscal e de gestão | Nomear responsável e revisor |
| 9 | Hospedagem (confirmar Vercel) | Define logs de crawlers, firewall e o header de país do plano de métricas |
| 10 | Nome do app nas lojas | "AutoPro" com `appId` próprio (ex.: `br.com.<empresa>.autopro`) antes da 1ª publicação |
