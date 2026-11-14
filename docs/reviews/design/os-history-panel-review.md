# Design Review: painel "Histórico" da OS (revisão INCOMPLETA)

**Veredito:** não emitido. A verificação do painel no navegador não foi concluída. Nada abaixo é achado de defeito do painel.

## O que foi verificado de fato
- Ambiente local subiu e responde. Stack Docker em 127.0.0.1:58421 (gateway) e 58422 (db), containers `autopro-e2e-*` saudáveis. `nuxt dev` em http://127.0.0.1:3400 apontando para ela. `/login` respondeu 200. Nenhum endpoint de produção foi usado.
- Login local funcionou (HTTP 200) com `admin@demo.autopro.test` (papel "admin", sistema) e `funcionario@demo.autopro.test` (papel "CAMILA"). Os storage states ficaram em `.design-audit/auth3400-*.json`, não lidos nem versionados.
- Dados (banco local): `service_order_events` tem 6509 linhas, até 300 por OS, e há OS com 1 categoria só (payment/status). 1265 OS sem eventos, usáveis para o estado vazio.
- Papel CAMILA tem orders.cancel/correct/read/create/pay/update/delete e NÃO tem `orders.history`. Isso é o cenário "papel sem permissão".
- Migration `20240101000109_seed_orders_history_action.sql` NÃO estava aplicada no banco local (ação `orders.history` ausente). Apliquei-a só no banco local (idempotente, INSERT ... ON CONFLICT DO NOTHING). Sem isso o papel admin ainda passaria pelo bypass, mas o catálogo de ações estaria incompleto.
- A lista `/app/service-orders` renderiza para admin em 1440 px (screenshot `.design-audit/probe3400.png`): cards de OS, não tabela.
- Leitura de código: botão `#os-history-toggle` tem `v-if="canViewHistory"` (OSHeader.vue ~L248), com aria-controls/aria-expanded. O gate é `workshop.can(ActionCode.ORDERS_HISTORY)` (service-orders.vue L37). Sidebar: `aside` fixo >= 1280 px (useMediaQuery), USlideover abaixo. Foco vai ao h2 no desktop e volta ao botão ao fechar. Há região `aria-live`.

## O que NÃO foi verificado e por quê
- Painel aberto em 360/768/1024/1280/1440/1920 px, fixo x slideover, foco/Esc, scroll independente, UTimeline, estados vazio/erro/carregar mais, filtro por categoria, contraste e teclado: NÃO observados.
- Presença/ausência do botão por papel: NÃO confirmada. Meu script Playwright (`.design-audit/hist3400.mjs`) mediu `#os-history-toggle` = 0 em TODAS as execuções, inclusive admin (360/1024/1280/1440) e limitado (1440), com 0 chamadas a /history. Isso é inconclusivo: o detalhe da OS pode não ter aberto com meu seletor (`button:has(.i-lucide-eye)`), ou o botão pode realmente faltar para o admin. Não afirmo nenhum dos dois. Não verifiquei se o modal abriu (`[role=dialog]`) após o clique.
- Execuções de 6 viewports levam minutos cada no `nuxt dev` (compilação sob demanda), o que esgotou o limite de turnos.

## Leads (não confirmados)
- Observado no código: o botão "Ver detalhes" (olho) em `app/components/service-orders/OrderCard.vue` L270 é icon-only sem `aria-label`; UTooltip não fornece nome acessível. Ação: adicionar `aria-label="Ver detalhes"`. Verificar no DOM antes de tratar como alta (WCAG 4.1.2).
- Não confirmado se `workshop.can(ORDERS_HISTORY)` retorna true para o papel admin no cliente; se retornar false, o botão some para o dono/admin. Checar primeiro, pois explicaria o 0 observado.

## Para concluir (poucos passos)
1. Conferir no navegador (headed, `node .design-audit/probe3400.mjs` adaptado) que clicar no olho abre `[role=dialog]`; só então medir `#os-history-toggle`.
2. Se o modal abrir e o botão faltar para admin, inspecionar `workshop.can` / carga de permissões do papel admin.
3. Repetir `.design-audit/hist3400.mjs` por viewport. Para URL direta, rodar `design-audit.mjs` com `--storage-state .design-audit/auth3400-admin.json`.
4. Estado de erro: interceptar `**/history*` com `page.route` e responder 500; "carregar mais": usar OS com mais de PAGE_SIZE eventos (há OS com 300).

## Estado deixado
- `nuxt dev` na porta 3400 pode continuar rodando (derrube com taskkill no PID da porta 3400).
- Arquivos temporários em `.design-audit/` (login3400.mjs, hist3400.mjs, probe3400.mjs, auth3400-*.json). Nenhum código da aplicação foi alterado.
