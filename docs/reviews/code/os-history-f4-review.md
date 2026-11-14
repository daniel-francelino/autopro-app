# Revisão de código: Histórico da OS, F4 (painel lateral + `orders.history`)

Data: 2026-11-14. Revisão somente leitura. Referências: `docs/architecture/os-history-timeline.md` §11.2, `docs/reviews/design/os-history-panel-plan.md`.

## Veredito

**Aprovado com ressalvas.** Nenhum bloqueante, nenhum alto. Há 1 ponto médio (documentação de segurança desatualizada) e itens baixos.

Validação executada: `npx vitest run tests/fast/os-history tests/static/action-catalog.test.ts` deu 22 arquivos, 599 passaram, 5 todo, 0 falhas. Os testes `tests/db/*` NÃO foram executados (exigem banco). Nenhum teste de componente Vue foi rodado, porque não existe nenhum (só guardas estáticas por regex).

## Verificado

### (1) Sigilo
- `history.get.ts:35` chama `requireOsHistoryAccess` logo após `requireAuthUser`, antes de `resolveOrganizationId`, validação de query, consulta a `service_orders` e a `service_order_events`. [verificado]
- `access.ts:39-42`: todo 403 de `requireOrgPermission` (perfil ausente, inativo, org suspensa, sem permissão) vira o mesmo 404 `Service order not found`, igual ao de `history.get.ts:59` e `[id].get.ts:31`. Erros não-403 (infra) são relançados. [verificado]
- Quem não tem permissão nunca chega à consulta da OS, então não há oráculo de existência de OS por tempo/corpo para esse usuário (todo id responde igual, cedo). Validações 400 (`source`/`category`/`cursor`) só rodam depois do gate: não vazam. [verificado]
- Teste `history-endpoint.test.ts` compara corpo/mensagem do negado com o de OS inexistente e verifica que `service_orders`/`service_order_events` não são consultados. [verificado, rodou verde]
- `editLogs` removido de `[id].get.ts`, do tipo e do `Promise.all`; `grep editLogs` em `app/ server/ lib/ tests/` não acha consumidor (só docs). Remove o vazamento de `changes` bruto. [verificado]
- UI: botão, sidebar e chamada `/history` só dentro de `v-if="canViewHistory"` (`OSHeader.vue`, `Modal.vue`); nenhuma outra string "histórico" fora do botão no header. [verificado]

### (2) Refactor de `Modal.vue`
- Sem a permissão, o caminho é `<ReuseBody v-else />`; classe do body idêntica à anterior (`flex-1 min-h-0 overflow-y-auto p-0`). O conteúdo é o mesmo markup movido para `DefineBody`; `createReusableTemplate` não adiciona elemento DOM. [verificado por leitura do diff]
- `ref="nfseInfoCardRef"` continua em `<script setup>` do Modal (linhas 350-361); o slot é compilado no escopo do Modal, então o ref resolve. `ReuseBody` é renderizado uma única vez por ramo, sem duplicar ref. `defineExpose({ refreshNfseCard })` intacto. Eventos `@changed`, `@paid`, `@recalculated`, `@issue-nfse` inalterados. [verificado por leitura; comportamento em runtime NÃO testado: não há teste de montagem]
- `update:open` e `v-model` do UModal inalterados. `historyOpen` é zerado ao fechar. [verificado]
- Nenhuma lógica de negócio/cálculo (`estimatedCommissionAmount`, etc.) tocada no diff. [verificado]

### (4) Filtro `category`
- Lista fechada espelha o CHECK da migration 108; vem de `query.category` com `typeof string`; `eq('category', category)` parametrizado; inválida/`a,b` dá 400; vazio = sem filtro. [verificado]
- Aplicado no SQL antes de `limit+1` e do cursor keyset; `organization_id` e `visibility in (...)` continuam no builder, então tenant isolation e visibilidade não mudam. [verificado]
- Cursor não carrega a categoria: reusar cursor de uma categoria com outra produz página coerente apenas por acaso (posição, não identidade). O cliente sempre faz reset ao trocar filtro. [baixo, ver B2]
- Keyset com cursor + category só é provado no teste `db` (o fake não suporta `and()`); não executado nesta revisão.

### (5) Composable `useServiceOrderHistory`
- Contador `generation` descarta respostas obsoletas em `fetchFirstPage` e `loadMore`; `reset` invalida voos; `refresh` durante `loadMore` zera `loadingMore`. Dedupe por `id` em `loadMore`. 404 vira `not-found` sem retry nem menção a permissão. [verificado, coberto por testes]
- Sidebar só busca com painel aberto e `orderId` não nulo; fechar o modal zera `orderId` e reseta estado, evitando dado de outra OS. [verificado]

### (7) Migration 109
- Idempotente (`ON CONFLICT (code) DO NOTHING`), `action_type='read'` válido no CHECK, não concede a nenhum papel (só dono/admin pelo bypass). Enum, descrição e teste de catálogo alinhados. [verificado]

## Achados

### Médio
- **M1. `docs/security/access-control-route-map.md` não foi atualizado.** O endpoint `history.get` mudou de gate (`orders.read` para `orders.history` + `orders.read`, 404 em vez de 403) e a nota da linha 174 ainda descreve o enum sem `orders.history`. O mapa é a referência de autorização do projeto. Atualizar na mesma entrega.

### Baixo
- **B1. Filtro da UI omite `fiscal`.** Servidor aceita `fiscal` (`history.get.ts:13`), mas `OS_HISTORY_CATEGORY_OPTIONS` (`os-history-ui.ts:7-14`) e `CATEGORY_UI` não têm; eventos fiscais aparecem só em "Todas", com rótulo "Outros". Confirmar se há emissores de `fiscal` em `record.ts` [hipótese: não verifiquei se algum evento usa essa categoria hoje]. Decisão de produto já registrada no teste (rótulos do responsável), então só alinhar quando `fiscal` for emitido.
- **B2. `loadMore` não trata 404** (`useServiceOrderHistory.ts` catch genérico): se a permissão for revogada com o painel aberto, mostra "Não foi possível carregar mais" com retry, em vez do estado "indisponível". Cosmético.
- **B3. Falha silenciosa no refresh** (`useServiceOrderHistory.ts`, comentário "mantém a lista"): o usuário não é avisado de que a lista pode estar desatualizada; só o leitor de tela anuncia erro em `status === 'error'`. Cosmético.
- **B4. a11y.** (a) `aria-controls="os-history-panel"` (`OSHeader.vue`) aponta para id que não existe quando o painel está fechado. (b) Ao cruzar 1280px com painel aberto, aside e slideover se trocam e o foco se perde. (c) Slideover aninhado em UModal (Reka dialogs) abaixo de xl: foco/Esc/empilhamento não testados [hipótese, verificar manualmente]. Pontos positivos: `aria-expanded`, `h2` focável, região `aria-live`, labels em botões de ícone, alvos `min-h-11`, `motion-reduce`.
- **B5. Mudança fora de escopo, porém correta.** `UDivider` para `USeparator` em `OSHeader.vue` (Nuxt UI `^4.5.1` não tem `UDivider`) e `aria-label="Fechar"`. Registrar no commit como correção adjacente.
- **B6. Timing/rota (hipótese).** A rota `/history` existe para todos (client bundle a expõe de qualquer forma); a única diferença observável para quem não tem a permissão seria entre "404 do handler" e "404 de rota inexistente do Nitro" (mensagem diferente). Sem impacto prático, porque o recurso é descobrível pelo código do cliente. Informativo.

### Qualidade dos testes (7)
- `f4-panel-ui.test.ts` cobre bem utils e composable (race, dedupe, 404, refresh). As guardas estáticas de sigilo são regex sobre fontes: dão sinal rápido, mas são frágeis e podem passar com o comportamento errado:
  - `modal.slice(0, idx)).toMatch(/<template v-if="canViewHistory">...[\s\S]*$/)` aceita quase qualquer coisa antes do sidebar; não prova que o sidebar está dentro do `v-if`.
  - `header.match(/Hist[óo]rico/g)).toHaveLength(1)` quebra com qualquer comentário/texto novo (falso negativo de manutenção, não de segurança).
  - `composable not.toContain('source')` e `Filters not.toMatch(/origem|source/i)` quebram com qualquer comentário que contenha a palavra.
  - Nenhum teste monta `Modal.vue` com e sem `canViewHistory` para provar que, sem permissão, o DOM/rede não contém o painel e que `nfseInfoCardRef`/scroll permanecem. Recomendado um teste de componente (`@vue/test-utils`/`mountSuspended`) para o ponto (2), hoje coberto só por leitura.
- Testes `db` novos/alterados não foram executados aqui.

## Recomendações
1. Corrigir M1 (route-map).
2. Teste de montagem do Modal sem/com permissão (ponto 2).
3. Opcional: B1, B2, B4a.
