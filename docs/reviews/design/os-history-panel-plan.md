# Refactor: Histórico da OS como painel lateral no detalhe da OS

Público: desenvolvedor que vai implementar e quem vai rodar o `/design-review` · Status: proposta (nenhum código alterado)

Base: `docs/architecture/os-history-timeline.md` (§8, §11.1, §11.2), `server/api/service-orders/[id]/history.get.ts`, `server/utils/os-history/render.ts`, `lib/utils/os-history-sources.ts`.

## 1. Current state (evidence)

| Região | Evidência | O que faz |
|---|---|---|
| Detalhe da OS | `app/components/service-orders/detail/Modal.vue:352-360` | `UModal` tela cheia (`w-screen h-dvh`), header em slot `#header`, `#body` com `overflow-y-auto p-0`. Um único scroll no body; cards empilhados (`:413-478`). |
| Header | `OSHeader.vue:84-265` | Título, badges, botões de ação, cada um com `v-if` vindo de props `can*`. Fechar: `:243-263`. |
| Permissões | `app/pages/app/service-orders.vue:29-36`, `:652-661` | A página calcula `can*` com `workshop.can(ActionCode.X)` e passa por props ao Modal, que repassa ao header. Padrão a seguir para `canViewHistory`. |
| Recarga | `Modal.vue:34-47` | `loadDetail()` é chamado após pagar, cancelar, avançar status etc. O histórico precisa acompanhar. |
| API | `history.get.ts:32-87` | Query aceita só `source`, `cursor`, `limit` (30, máx. 100). Ordem decrescente. Resposta `{ items: RenderedOsEvent[], nextCursor: string \| null }`. 400 para `source`/`cursor` inválidos, 404 se OS não é da org ou foi excluída. |
| Item | `render.ts:18-29` | `{ id, occurredAt, category, title, description, details:[{label, from, to}], actorName, source:{code,label}, groupId }`. `description` já é pt-BR final e já cita o autor. Valores nulos em `from`/`to` significam "adicionado"/"removido" (ex.: itens, responsáveis). |
| Categorias | `server/utils/os-history/events.ts:14-49` | Valores reais de `category`: `status`, `order`, `items`, `payment`, `commission`. A resposta NÃO traz `visibility` (general/financial/commission). |
| Origens | `os-history-sources.ts:5-20` | Catálogo fechado; o servidor já devolve o rótulo (`source.label`). `os_*` = dentro da OS; demais = outra tela; `unknown` = "Origem não identificada". |

Divergências entre doc e código (verificadas):
1. §8 do doc diz que `UTimeline` já é usado em `financial/entries/DetailSlideover.vue`. Não é: ali é uma lista própria (`DetailSlideover.vue:186-203`, `:453`). Não há precedente de `UTimeline` no app.
2. §11.2 ainda não foi implementado: o endpoint exige `orders.read` (`history.get.ts:34`) e não existe `ORDERS_HISTORY` em `app/constants/action-codes.ts` (só `ORDERS_READ…ORDERS_PAY`, linhas 12-18).
3. O endpoint não tem filtro `category` (doc §8 previa).

## 2. Problems / riscos de desenho (ordenados)

Blocker (bloqueia a UI, não é preferência):
- **B1. Permissão inexistente no cliente e no servidor** (item 2 acima). A UI não pode ser entregue antes de `ActionCode.ORDERS_HISTORY`, da migration de catálogo e do 404 no endpoint, ou o gate do botão não tem o que checar. Sigilo exige que o 404 já esteja no ar quando o botão existir.
- **B2. Sigilo no cliente.** Sem a permissão, nada pode existir no DOM: botão, painel, slot de layout, `aria-*`, tooltip, chamada de rede, texto "Histórico" em qualquer lugar. Isso é critério de aceite verificável (seção 7).

High:
- **H1. Filtro por categoria sem suporte no servidor.** Filtrar no cliente só os itens já carregados dá resultado enganoso com paginação ("vazio" enquanto há mais páginas). Recomendação: adicionar `category` ao endpoint (item de backend separado, sem mudança de regra de negócio, valida contra a lista fechada, 400 se inválida). Alternativa de contingência na seção 9.
- **H2. Largura.** O painel de ~24rem dentro de um modal cujo conteúdo usa breakpoints de viewport (`xl:grid-cols-[360px_minmax(0,1fr)]`, `Modal.vue:415`) deixa os cards ~384 px mais estreitos em 1280-1440 px. Ver risco R2.
- **H3. Histórico desatualizado.** Depois de `loadDetail()` o painel mostraria dados antigos ao lado dos novos, derrotando o objetivo de comparar.

Medium:
- **M1. UTimeline não resolve sozinho:** agrupamento por dia, de→para e metadados precisam de slots/estrutura própria (seção 3).
- **M2. 404 ambíguo** (OS excluída, OS de outra org, permissão revogada na sessão). A mensagem não pode insinuar "sem permissão".
- **M3. Eventos longos** (`order.items_changed` até 50 linhas + "e mais N", textos livres como diagnóstico) estouram um painel estreito.

Low (preferência / defeitos adjacentes no arquivo que será editado):
- `OSHeader.vue:184` usa `UDivider`; em Nuxt UI 4 o nome é `USeparator` (verificar no console; se não resolve, é defeito pré-existente).
- `OSHeader.vue:256-263`: botão de fechar mobile sem `aria-label` (ícone sozinho). Baixo risco corrigir junto.
- Botões `size="sm"` têm ~32 px; meta do projeto é 44 px em toque. Aplicar `max-xl:min-h-11` no novo botão; não refatorar os demais aqui.

Guidelines consultadas: `nuxt-ui.csv` (v-model:open em overlays, linha 17; USkeleton em vez de spinner, linha 32); regras do projeto 4 e 5 (denso, 360 px+, 44 px, foco visível, contraste 4.5:1, reduced-motion).

## 3. Target layout

### 3.1 Comportamento

- Botão **"Histórico"** no `OSHeader`, no grupo de ações, `v-if="canViewHistory"` (renderização condicional, nunca `disabled`, nunca `UTooltip`). Ícone `i-lucide-history`, `color="neutral"`, `variant` `soft` quando aberto e `outline` quando fechado, `aria-expanded`, `aria-controls="os-history-panel"`. Texto sempre visível (não só ícone).
- **>= xl (1280 px): painel fixo à direita**, dentro do corpo do modal, com scroll independente do conteúdo. Estado inicial **fechado** (nenhuma regressão de largura para quem não usa).
- **< xl: `USlideover` (`side="right"`)** sobre o detalhe. Proponho xl e não lg como corte porque em 1024 px um painel fixo comprimiria demais os cards (ver pergunta Q1; o pedido original dizia "mobile").
- Alterna pelo mesmo botão nos dois modos. Cruzar o breakpoint com o painel aberto mantém o estado aberto e os itens carregados (composable vive no container, não nas listas).
- Fechar o modal fecha o painel e zera o estado (o `watch` de `open` já zera `detail`; o painel segue o mesmo ciclo).

### 3.2 Estrutura (wireframe, desktop >= xl)

```
UModal (content: flex-col h-dvh)
 ├─ #header  OSHeader  [... Editar][Histórico] [x]
 └─ #body    div.flex.h-full.min-h-0
      ├─ div.min-w-0.flex-1.overflow-y-auto    <- cards atuais (inalterados)
      └─ aside#os-history-panel (w-96 shrink-0 border-l border-default overflow-y-auto)
           ├─ cabeçalho sticky: h2 "Histórico" · [Atualizar] · [Fechar painel]
           ├─ filtro: USelect "Categoria" (Todas, Status, Dados da OS, Itens, Pagamentos, Comissões)
           └─ lista: por dia -> h3 sticky "Hoje / Ontem / 12/11/2026" -> UTimeline
                evento: título (medium) · descrição · meta (hora, autor, UBadge origem) · "Ver N alterações" (UCollapsible) com de -> para
              rodapé: [Carregar mais] (UButton outline, block) ou "Fim do histórico"
```

`#body` hoje tem `p-0 overflow-y-auto` (`Modal.vue:357`). Mudança: o body passa a `overflow-hidden` e o scroll migra para o `div` interno do conteúdo, só quando `canViewHistory` (com o painel fechado o conteúdo ocupa 100%, visual idêntico). Cuidado: `loadDetail` hoje não reseta scroll; manter.

### 3.3 Evento (UTimeline)

Uma `UTimeline` por dia (`orientation="vertical"`, `size="xs"` ou `sm`), `items` mapeados do contrato:

- `value`: `id`; `title`: `title`; `description`: `description`; `date`: hora `HH:mm` (a data já está no cabeçalho do dia); `icon` + `color` por `category` (mapa em `app/utils/os-history-ui.ts`; cor semântica Nuxt UI: status `info`, order `neutral`, items `neutral`, payment `success`, commission `warning` — sugestão visual, não regra de negócio; cor nunca é o único sinal: há ícone e texto de categoria).
- Slots `#title`, `#description` customizados para: título, descrição (`break-words`), linha de meta com autor (`actorName`; se `null`, omitir a linha de autor, não inventar texto), e `UBadge variant="outline" color="neutral"` com `source.label` (já vem do servidor). Origem fora da OS (`!source.code.startsWith('os_')` e diferente de `unknown`): ícone `i-lucide-external-link` no badge, como pede o doc §8. `unknown` mostra o rótulo "Origem não identificada" em neutro, sem alerta.
- **De → para** (`details`): `UCollapsible` "Ver N alterações" quando `details.length > 2`; até 2 aparecem abertas. Cada linha: `label` + "de" (muted) / "para" (destaque) em lista `<dl>`; seta decorativa `aria-hidden` e `sr-only` "de ... para ...". `from === null` mostra "adicionado"; `to === null` mostra "removido"; ambos `null` (linha "e mais N itens") é texto simples. Valores já vêm formatados (BRL, datas); o cliente não reformata.
- `groupId` (opcional, baixa prioridade): itens consecutivos com o mesmo `groupId` recebem uma linha vertical sutil e `sr-only` "Parte da mesma ação". Não alterar a ordem.
- Dia: cabeçalho `h3` sticky com "Hoje", "Ontem" ou `dd/MM/yyyy`; hora `HH:mm`. Fuso: ver Q2.
- Se `UTimeline` não expuser semântica de lista, envolver cada dia em `<section aria-labelledby>`; validar no design-review.

### 3.4 Estados

| Estado | Comportamento |
|---|---|
| Carregando (1ª página) | 4-5 `USkeleton` com a forma do evento (não spinner), `aria-busy="true"` na região. Sem pulso com `prefers-reduced-motion` (`motion-reduce:animate-none`). |
| Atualizando (refresh) | Mantém a lista atual visível; só indicador discreto no cabeçalho (botão Atualizar com `loading`). |
| Carregando mais | Botão com `loading`, itens existentes intactos; ao terminar, foco no primeiro item novo e anúncio. |
| Vazio (sem filtro) | Ícone + "Nenhum evento registrado para esta OS." (texto final: Q3). |
| Vazio (com filtro) | "Nenhum evento nesta categoria." + botão "Limpar filtro". |
| Erro (rede/5xx) na 1ª página | `UAlert color="error"` "Não foi possível carregar o histórico." + "Tentar novamente". |
| Erro em "carregar mais" | Mantém os itens; `UAlert` inline abaixo da lista + "Tentar novamente". |
| 404 | "Histórico indisponível para esta OS." sem botão de retry e sem mencionar permissão. Não gera toast. |
| Fim | `nextCursor === null` e há itens: "Fim do histórico" (texto muted). |
| Cursor/`source` 400 | Tratar como erro genérico; o cliente nunca monta cursor, só repassa o opaco. |

### 3.5 Acessibilidade (WCAG AA)

- `aside` com `id="os-history-panel"`, `aria-labelledby` do `h2`. Título do slideover via props `title`/`description` (descrição `sr-only`), evita aviso do Reka.
- Toggle com `aria-expanded`/`aria-controls`. Abrir no desktop: foco no `h2` do painel (`tabindex="-1"`); fechar: foco de volta ao botão "Histórico". Slideover: o foco retorna ao botão pelo comportamento do overlay (verificar, pois está aninhado em `UModal`).
- Não amarrar Esc ao painel desktop (Esc continua fechando o modal). No slideover, Esc fecha só o slideover (confirmar no design-review).
- Região `aria-live="polite"` (sr-only) anuncia "N eventos carregados", "Fim do histórico", erros.
- Contraste: texto informativo em `text-muted` no mínimo; nunca `text-dimmed` para conteúdo. Foco visível herdado do Nuxt UI; não remover `outline`.
- Alvos de toque >= 44 px em `< xl` (botões do painel com `max-xl:min-h-11`).
- Sem animação própria; só as transições do `USlideover`; painel desktop abre sem transição (ou `motion-safe:`).
- Largura 360 px: o slideover usa `w-full max-w-md`; nada de scroll horizontal (`min-w-0`, `break-words`, tabelas não são usadas).

## 4. Componentes e arquivos propostos

Nomes seguem o auto-import (`service-orders/detail/OSHistory*.vue` -> `ServiceOrdersDetailOSHistory*`).

| Arquivo | Tipo | Responsabilidade |
|---|---|---|
| `app/composables/useServiceOrderHistory.ts` | composable | Dados, paginação, filtro, estados (seção 5). |
| `app/types/service-order-history.ts` | tipos | `OsHistoryEvent`, `OsHistoryPage`, `OsHistoryCategory`. Espelho do contrato; não importar de `server/`. |
| `app/utils/os-history-ui.ts` | utils puros | `groupEventsByDay`, `formatDayLabel`, `formatTime`, mapa categoria -> rótulo/ícone/cor, `isExternalSource`. Testáveis sem DOM. |
| `app/components/service-orders/detail/OSHistorySidebar.vue` | container | Escolhe `aside` (>= xl) ou `USlideover` (< xl) com `useMediaQuery`/`matchMedia`; instancia o composable; gerencia foco e live region. |
| `.../OSHistoryList.vue` | apresentação | Cabeçalho do dia + `UTimeline` + estados + "Carregar mais". Sem fetch. |
| `.../OSHistoryEventDetails.vue` | apresentação | Bloco de→para com `UCollapsible`. |
| `.../OSHistoryFilters.vue` | apresentação | `USelect` de categoria (label visível "Categoria"). |
| `OSHeader.vue` (edição) | existente | Botão "Histórico" gated. |
| `Modal.vue` (edição) | existente | Layout flex do body, `v-model:history-open`, `refreshKey`. |
| `app/pages/app/service-orders.vue` (edição) | existente | `canViewHistory = workshop.can(ActionCode.ORDERS_HISTORY)` e passa ao Modal. |

Todo `.vue` que use `ActionCode.` importa `import { ActionCode } from '~/constants/action-codes'` (há teste estático). Só a página usa; os demais recebem boolean.

### Props / emits

```ts
// OSHeader.vue (novos)
props: { canViewHistory?: boolean; historyOpen?: boolean }
emits: { 'toggle-history': [] }

// Modal.vue (novo)
props: { canViewHistory?: boolean }
// estado interno: historyOpen (ref, false), refreshKey (ref, ++ ao fim de loadDetail com sucesso)

// OSHistorySidebar.vue
props: { open: boolean; orderId: string; refreshKey: number }
emits: { 'update:open': [boolean] }

// OSHistoryList.vue
props: { groups: Array<{ key: string; label: string; items: OsHistoryEvent[] }>;
         status: 'loading'|'ready'|'error'|'not-found';
         loadingMore: boolean; loadMoreError: boolean;
         hasMore: boolean; filtered: boolean; total: number }
emits: { 'load-more': []; 'retry': []; 'clear-filter': [] }

// OSHistoryFilters.vue
props: { modelValue: OsHistoryCategory | 'all'; options: Array<{label:string; value:string}> }
emits: { 'update:modelValue': [OsHistoryCategory | 'all'] }
```

Regra de render no Modal: `v-if="canViewHistory"` envolve TANTO o wrapper flex quanto o `OSHistorySidebar`; sem a permissão o template é o atual byte a byte (sem `aside`, sem wrapper extra, sem prop de estado exposta).

## 5. Composable de dados

`useServiceOrderHistory(orderId: Ref<string | null>, options?: { category?: Ref<OsHistoryCategory | 'all'> })`

- Retorna: `items` (ref), `nextCursor`, `status` (`'idle'|'loading'|'ready'|'error'|'not-found'`), `loadingMore`, `loadMoreError`, `hasMore` (`!!nextCursor`), `load()`, `loadMore()`, `refresh()`, `reset()`.
- `load()`: limpa itens, chama `$fetch<OsHistoryPage>(`/api/service-orders/${id}/history`, { query: { limit: 30, category? } })` (mesmo estilo do `Modal.vue:39`). `loadMore()`: repassa `cursor: nextCursor` opaco; não faz parse; ignora se `loadingMore` ou sem cursor; concatena deduplicando por `id`.
- Concorrência: token/`AbortController` por requisição; resposta de OS, filtro ou geração anterior é descartada (troca rápida de OS ou filtro não mistura listas).
- Erro: `error.statusCode === 404` (ou `response.status`) -> `not-found`; qualquer outro -> `error` (1ª página) ou `loadMoreError` (páginas seguintes, sem perder itens). Sem toast (o painel tem estado próprio), diferente do `loadDetail`.
- Muda a categoria -> `reset()` + `load()`. `refresh()` recarrega a 1ª página mantendo os itens visíveis até a resposta chegar.
- Só roda com painel aberto e `canViewHistory` (o container só instancia/dispara quando `open`); fechado não há chamada de rede. Primeira abertura carrega; reabrir com mesma OS e `refreshKey` igual reaproveita o cache em memória.
- Nenhum filtro de permissão aqui: o servidor já devolveu só o que o usuário pode ver. Nenhum cálculo de negócio; apenas apresentação.
- Opções do filtro: lista fixa das 5 categorias reais com rótulos pt-BR sugeridos (Status, Dados da OS, Itens, Pagamentos, Comissões). Mostrar todas sempre (o cliente não sabe quais o usuário pode ver; se não puder, simplesmente virá vazio). Ver Q4 sobre esconder opções.

## 6. Preserved behavior

- Todos os gates existentes de `OSHeader` (`canPay`, `canCancelPayment`, `canEdit`, etc.) e props `can*` do Modal permanecem idênticos.
- Nenhuma chamada de API existente muda; a única nova é `GET /api/service-orders/:id/history`.
- Permissões internas (financial -> `orders.pay`, commission -> `reports.commissions`) são aplicadas só pelo servidor; o cliente não filtra por visibilidade nem tenta inferi-la.
- Eventos não são fonte de cálculo; nada na UI calcula valores a partir do histórico.
- O histórico é somente leitura: sem ações de editar/desfazer.

## 7. Steps (PRs pequenos, por risco)

| # | Passo | Arquivos | Risco | Aceite |
|---|---|---|---|---|
| 0 | **Pré-requisito backend (fora desta UI):** `ORDERS_HISTORY = 'orders.history'` em `action-codes.ts`, migration do catálogo, `history.get.ts`/`access.ts` respondendo 404 sem a permissão; opcional `category` no endpoint (H1) | `app/constants/action-codes.ts`, `supabase/migrations/*`, `server/...` | médio (segurança) | Usuário sem `orders.history` recebe 404 idêntico a rota inexistente; admin/dono passam; testes de acesso atualizados |
| 1 | Tipos + utils puros + testes (`groupEventsByDay`, rótulos, `isExternalSource`) | `app/types/service-order-history.ts`, `app/utils/os-history-ui.ts`, testes | baixo | Agrupa por dia na ordem recebida, sem reordenar; "Hoje/Ontem/dd/MM/yyyy" corretos; testes passam |
| 2 | Composable + testes unitários (mock de `$fetch`) | `app/composables/useServiceOrderHistory.ts` | baixo | Append com dedupe; 404 -> `not-found`; 5xx -> `error`; falha em loadMore preserva itens; resposta obsoleta descartada; mudar categoria reseta cursor |
| 3 | Componentes de apresentação (List, EventDetails, Filters), sem integrar | `OSHistory*.vue` | baixo | Renderiza todos os estados da seção 3.4; teclado e leitor de tela ok em isolamento |
| 4 | Container Sidebar (aside + slideover, foco, live region) | `OSHistorySidebar.vue` | médio | Troca de modo no breakpoint sem perder itens; foco entra/volta como na 3.5 |
| 5 | Integração: botão no header, layout flex no Modal, `canViewHistory` na página, `refreshKey` | `OSHeader.vue`, `Modal.vue`, `service-orders.vue` | médio (layout do body e sigilo) | Sem permissão: DOM idêntico ao atual e zero request a `/history`; com permissão: painel abre/fecha; após pagar/cancelar o histórico atualiza |
| 6 | Acabamento: `groupId` visual, ajustes de largura 1280-1440, correções adjacentes (`USeparator`, aria-label do fechar) | vários | baixo | design-review sem findings blocker |

Passos 1-4 podem ser entregues antes do 0, mas o 5 só vai a produção depois do 0.

## 8. Verification

design-review (viewports 360, 768, 1024, 1280, 1366, 1440, 1920):
- Sem `orders.history`: inspecionar DOM (nenhum "Histórico", `aside`, `aria-controls`), aba Network sem `/history`, snapshot do header igual ao atual.
- Com permissão, 360 px: slideover abre por cima do modal, sem scroll horizontal, alvos >= 44 px, foco volta ao botão ao fechar, Esc fecha só o slideover.
- 1280-1440 px painel aberto: cards (itens, parcelas, comissões) sem overflow horizontal; row 1 (`360px + 1fr`) legível.
- Evento longo (`items_changed` com 50 linhas + "e mais N"), `diagnosis` com texto longo, valores `(vazio)`.
- Estados: loading, vazio, vazio filtrado, erro, erro em "carregar mais", 404 (usar OS excluída), fim do histórico.
- Teclado completo (Tab/Shift+Tab, Enter/Space no UCollapsible), leitor de tela anunciando "N eventos carregados", `prefers-reduced-motion`, contraste >= 4.5:1 dos textos muted.
- Atualização: pagar/cancelar na OS e ver o novo evento no painel sem reabrir.

Testes: unitários dos passos 1-2; teste estático existente de `ActionCode` import (a página e qualquer `.vue` novo que use `ActionCode.`); teste estático novo sugerido: `OSHeader.vue` renderiza o botão apenas com `v-if="canViewHistory"` (sem `disabled`/`UTooltip` no mesmo elemento).

## 9. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R1 | `UModal` é diálogo modal (foco preso, fora inerte). `USlideover` aninhado pode ter conflito de foco/Esc | Validar no passo 4/5 com design-review; fallback: no modo estreito renderizar o painel como camada própria dentro do `content` do modal em vez de portal |
| R2 | Largura: conteúdo usa breakpoints de viewport, não de container | Painel começa fechado; validar 1280-1440; se apertar, usar container queries (`@container`) no wrapper do conteúdo ou subir o corte do painel fixo para 2xl (Q1) |
| R3 | Filtro por categoria sem `category` no servidor | Contingência: filtrar no cliente e, enquanto houver `nextCursor`, avisar "Mostrando resultados dos eventos já carregados" + auto "carregar mais"; preferir resolver no backend (H1) |
| R4 | Vazamento de existência do histórico por qualquer resquício no DOM/rede | Critério do passo 5; revisão do `security-analyst` no PR de integração |
| R5 | Histórico vazio para OS anteriores ao recurso (sem backfill, D8) parece "bug" | Texto de vazio neutro (Q3) |
| R6 | `UTimeline` sem semântica de lista ou com slots limitados | Envolver por dia em `section`/`ul` e validar; plano B: lista própria `<ol>` com a mesma aparência (o app já tem uma em `financial/entries/DetailSlideover.vue`) |
| R7 | Fuso: `occurredAt` é ISO com offset; agrupar por dia no fuso errado desloca eventos de dia | Definir fuso (Q2); testar eventos próximos da meia-noite |
| R8 | Mudar `#body` para `overflow-hidden` quebrar scroll do conteúdo atual | Mover o scroll para o wrapper interno e testar em 360 px e com modais de pagamento abertos |

## 10. Open questions (decisão de produto)

- **Q1.** Corte do painel fixo: xl (1280, proposto), lg (1024) ou 2xl? O pedido original dizia "mobile = slideover"; tablets caem no slideover com o corte xl.
- **Q2.** Fuso para agrupar por dia e exibir hora: fuso do navegador ou fuso fixo da oficina (existe configuração por organização?).
- **Q3.** Texto do estado vazio e se deve haver aviso para OS anteriores ao recurso (doc §9.2/D8: "histórico anterior a DD/MM/AAAA é resumido").
- **Q4.** Rótulos do filtro: o pedido cita "geral/financeiro/comissão", mas a API só devolve `category` = status/order/items/payment/commission (e não a visibilidade). Aprovar os rótulos pt-BR propostos ou filtrar por visibilidade (exigiria expor o campo na resposta). Esconder opções que o usuário não pode ver seria inferência no cliente; não proposto.
- **Q5.** Filtro por origem (`source`) também na UI? O endpoint já suporta; não está nos requisitos, por isso fica fora do plano.
- **Q6.** Lembrar a preferência aberto/fechado do painel entre OS e sessões (padrão proposto: fechado, sem persistência).
- **Q7.** Mostrar o autor em linha própria quando a `description` já o cita ("... por Maria")? Proposto manter para varredura rápida; `actorName === null` omite a linha.
- **Q8.** Confirmar que `workshop.can()` retorna `true` para admin/dono (bypass de §11.2) para o gate do botão; não verificado aqui.
