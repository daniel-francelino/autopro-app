# Plano de implementação: refatoração de Configurações > Permissões (papéis)

Público: dev frontend, tech lead, PO. Status: proposta (nada implementado). Data: 2026-11-13.
Base: `docs/reviews/design/permissions-layout-review-2026-11-13.md` (findings F1 a F16, seção 6), validado contra o código. Este plano não altera código de produção.

## 0. Premissas e decisões

| Item | Estado |
|---|---|
| Papéis de sistema somente leitura | Decidido. O código já bloqueia (`canEditMetadata/Permissions/ManageUserLinks` exigem `!is_system_role`); falta só o texto/UX. |
| Guarda de saída e "Descartar" | Aprovados; escopo: dados do papel + permissões. Vínculo de usuário fora. |
| 5 resources sem rótulo (members, organization, payment_machines, returns, subscription) | Decidido mapear; fallback mostra valor bruto. **Rótulos/ícones ainda precisam de confirmação do stakeholder.** |
| Vínculo de usuário | **PREMISSA (decisão pendente): opção (a)**: mantém imediato + texto/toast + confirmação ao desvincular. Impacto se for (b), na seção 9. |
| Gates e API | Mesmos `workshop.can(ActionCode.X)`, mesmas chamadas (`GET /api/roles/:id`, `PUT /api/roles/:id`, `POST /api/roles/:id/actions` por ação alterada, `POST /api/users/update-fields`, `POST /api/users/list-organization`) e mesmo payload de salvar. |

## 1. Realidade do código (divergências do review)

Verificado em `app/pages/app/settings/roles/[id].vue` (824 linhas), `index.vue` (413), `app/composables/useRoleResources.ts`, `server/api/roles/**`:

1. **Barra de salvar já é `sticky bottom-0`** (`[id].vue` linha 799). F5 reduz-se a: indicador de dirty, "Descartar" e a guarda; confirmar no navegador por que parecia não sticky (hipótese: dentro de `UDashboardPanel #body` o ancestral com scroll/`-mx-4`; validar com design-review).
2. **Exclusão de papel já tem confirmação** (`AppConfirmModal` em `index.vue`), mas o texto não cita usuários vinculados. Desvincular usuário NÃO tem confirmação.
3. **Defeito latente que a guarda de saída expõe:** `watch([role, actions, roleActions], syncForm)` reexecuta `syncForm` sempre que `refresh()` troca `data`. `addUserLink`/`removeUserLink` chamam `refresh()`, então **vincular/desvincular um usuário zera edições não salvas de nome, descrição e permissões, sem aviso**. Precisa ser corrigido na fase de dirty (ver 3.3).
4. `index.vue`: `openPermissions` (clique na linha) carrega `/api/roles/:id/actions` em `actionsData`, mas o template **não renderiza** esse dado (só realça a linha): chamada de rede desnecessária por clique. Candidata a remoção/ajuste na fase da lista (tem custo zero para o usuário, mas é mudança de chamada de API: tratar como decisão explícita, não incluir sem aprovação; ver risco R6).
5. Listagem `GET /api/roles` (`server/api/roles/index.get.ts`) devolve só `select('*')` de `roles`: **sem contagem de usuários nem de permissões**. Observação de segurança, fora de escopo: essa rota não chama `requireOrgPermission('roles.read')`, ao contrário de `[id].get.ts`. Encaminhar ao `security-analyst`; não mexer aqui.
6. `GET /api/roles/:id` já retorna `summary` (granted/total/assigned). `granted_actions_count` conta concessões sem filtrar por plano, enquanto `total_actions_count` usa `filterActionsByPlan`: o "31 de 107" pode ficar inconsistente. **Contagem n/m na UI deve ser calculada no cliente** a partir de `actions` (já filtradas) e `permissionState`, não de `summary`.
7. `useRoleResources` também é usado por `app/components/roles/RoleDetailsSlideover.vue` (o "olho" da lista): toda mudança do mapeamento afeta os dois lugares (benefício).
8. Matching atual é por `key.includes(...)` em ordem. É frágil (ex.: `part` casa qualquer chave com "part"). Novos rótulos devem ser por **igualdade exata antes** dos `includes`.
9. Infra de testes: Vitest `fast` roda em `environment: 'node'`, sem `@vue/test-utils`/jsdom. Não há teste de componente Vue no repositório. Testes de lógica importam diretamente `app/utils/*` e `app/composables/*` puros (padrão `tests/fast/lib/app-utils.test.ts`). E2E: Playwright em `tests/e2e/*.e2e.ts` organizados por fluxo; `app-smoke.e2e.ts` já abre `/app/settings/roles` (sem erro JS / 5xx). Estáticos em `tests/static/` (`action-catalog.test.ts` cobre o catálogo de actions).

## 2. Dados/API novos: o que precisa e alternativas

| Necessidade | Sem backend (recomendado agora) | Com backend (opcional, fase própria) |
|---|---|---|
| Contagem de usuários e permissões na lista (F11/F12) | Omitir as colunas na tabela da lista. Mostrar apenas Papel, Tipo, Ações. | Estender aditivamente `GET /api/roles` com `assigned_users_count` e `granted_actions_count` (campos novos; não quebra consumidores). Exige query agregada por `user_profiles.role_id` e `role_actions.is_granted`, respeitando tenant (`organization_id`) e `filterActionsByPlan`. Precisa de revisão do `data-integrity-auditor`/`security-analyst`. **Não inventar**: só fazer com aprovação do PO. |
| n/m por módulo no editor | Cliente: já tem `actions` + `permissionState`. | Não precisa. |
| Aviso "N usuários vinculados" no diálogo de exclusão | Só se a contagem estiver disponível; sem backend, texto genérico: "Usuários vinculados a este papel ficarão sem papel" **somente se confirmado o comportamento real** (pergunta aberta O3). | Contagem via item acima. |
| Descrição duplicada de "Anderson" (F11) | É dado, não layout. Corrigir no cadastro. | n/a |

## 3. Arquitetura da mudança no editor

### 3.1 Extrações (somente o que se justifica)

Justificativa: `[id].vue` tem 824 linhas, mistura 4 responsabilidades, e a lógica nova (agrupar, contar, filtrar, diff) é pura e testável sem DOM.

- `app/utils/role-permissions.ts` (novo, funções puras, sem Vue): `groupActionsByResource(actions)`, `countGranted(groupActions, state)`, `diffPermissions(actions, original, current)` (retorna `actionIds` alterados), `filterActions(actions, query, onlyGranted, state)`, `setGroup(state, groupActions, value)`, `normalize(text)` (sem acento, minúsculo). Reutiliza `useRoleResources` para rótulo/ordem.
- `app/components/roles/RolePermissionsAccordion.vue` (novo, F3/F4/F7): recebe `actions`, `modelValue` (mapa `{[actionId]: boolean}`), `readonly`, `disabled`. Emite `update:modelValue`. Sem fetch.
- `app/components/roles/RoleUnsavedBar.vue` (opcional, fase 4): barra sticky (dirty count, Descartar, Salvar). Só extrair se a página ficar > ~600 linhas; senão manter inline.
- Não extrair composable de fetch; `useAsyncData` permanece na página.

### 3.2 Estado e "dirty"

Fonte da verdade do original (baseline), imutável entre cargas:

```
baseline = {
  display_name: role.display_name ?? role.name,      // mesma regra de syncForm atual
  description: role.description ?? '',
  permissions: originalPermissionState                // já existe (computed por action.id -> boolean)
}
current = { roleForm.display_name, roleForm.description, permissionState }
```

- Comparações reutilizam exatamente `hasMetadataChanges` e `hasPermissionChanges` já existentes (com `trim()` e `Boolean()`), que são a mesma lógica do payload de salvar. **Não** criar segunda definição de "diferente" (evita divergência entre dirty e o que é enviado).
- `isDirty = (canEditMetadata && hasMetadataChanges) || (canEditPermissions && hasPermissionChanges)`. Em papel de sistema nunca é dirty.
- Contador exibido: `changedPermissionsCount + (hasMetadataChanges ? 1 : 0)`; texto "Alterações não salvas (N)".
- **Descartar:** chama `syncForm()` existente (restaura nome, descrição e `permissionState` a partir de `originalPermissionState`). Sem request. Pede confirmação só se N > 0 e a ação não tiver "desfazer"; recomendação: sem modal (ação reversível apenas por refazer; mostrar toast "Alterações descartadas"). Decisão fina ao PO (O6).
- **Corrigir o `watch(syncForm)` (defeito 1.3):** executar `syncForm` apenas (i) na carga inicial/mudança de `roleId` e (ii) após salvar com sucesso. Para refresh disparado por vínculo de usuário, não sobrescrever campos sujos. Implementação mínima: trocar o watch por `watch(() => data.value?.item?.role?.id + versão)` OU manter o watch mas protegê-lo com `if (isDirty.value && sameRoleId) return`, e chamar `syncForm()` explicitamente no fim de `saveRole` (após `await refresh()`). Após salvar, o servidor é a verdade, então o baseline é recarregado. Alternativa mais barata: nos vínculos, usar `refreshUsers()` + refetch só de `assigned_users`; descartada porque exigiria API nova.
- Falha parcial ao salvar (várias chamadas `POST /actions` em `Promise.all`): hoje, em erro, não há `refresh()`; o estado local permanece dirty, o que é correto. Manter. (Risco R3: algumas ações podem ter sido gravadas; o diff recalculado após o próximo `refresh()` reflete isso. Não alterar.)

### 3.3 Guarda de saída

```ts
onBeforeRouteLeave(() => {
  if (!isDirty.value || isSaving.value) return true
  return confirmLeave()   // Promise<boolean> via modal
})
```
- `confirmLeave`: abre `AppConfirmModal` já existente (reuso; título "Sair sem salvar?", texto "As alterações em dados e permissões serão perdidas.", botões "Continuar editando" / "Sair sem salvar"). Retorna `Promise<boolean>`; `false` cancela a navegação.
- Navegação interna cobre o botão "Voltar", sidebar e abas de Configurações (todas via vue-router).
- Fechar aba/recarregar: `window.addEventListener('beforeunload', handler)` registrado em `onMounted` e removido em `onBeforeUnmount`; handler só chama `preventDefault()` + `returnValue = ''` se `isDirty`. Apenas client-side (SSR safe por `onMounted`). Texto do navegador é fixo (não customizável).
- Após salvar com sucesso, `isDirty` fica falso (porque baseline foi recarregado), então "Voltar" é livre. Navegar para outro `roleId` (rota `[id]` reutilizada): `onBeforeRouteUpdate` com a mesma verificação.
- Vínculo de usuário NÃO entra em `isDirty` (premissa a).

## 4. Busca, filtro, marcar todas e n de m (acordeão)

- Estrutura: `UAccordion` `type="multiple"`, um item por `resource`, ordenado por `label.localeCompare(..., 'pt-BR')` (substitui a ordem de inserção atual). Cabeçalho do item via slot `#leading/#default`: ícone (`getResourceIcon`), rótulo, `UBadge` "n/m" (`variant="subtle"`), e à direita o controle "marcar todas".
- Fallback de rótulo (ver fase 1): nunca "Outros" anônimo; exibir `Outros (valor_bruto)`.
- "Marcar todas do módulo": `UCheckbox` tri-state no cabeçalho (`indeterminate` quando 0 < n < m). `@click.stop` para não alternar o acordeão; `aria-label="Marcar todas as permissões de {módulo}"`. Aplica `setGroup` sobre o `permissionState` (apenas ações visíveis no filtro atual? **Regra proposta:** com filtro ativo, atua só nas ações filtradas visíveis, e o rótulo vira "Marcar resultados"; sem filtro, todas do módulo). Desabilitado quando `!canEditPermissions || isSaving`.
- Busca: `UInput` com `icon="i-lucide-search"` e botão limpar; filtra por `normalize(name + code + description)` com `.includes`. Com busca ativa, o conjunto de itens abertos é derivado (todos os módulos com resultado abertos; módulos sem resultado ocultos), sem perder a escolha manual: guardar `openManual` e usar `openEffective = query ? modulesWithResults : openManual`. Debounce não necessário (107 itens). Estado vazio: "Nenhuma ação encontrada para '...'" com botão "Limpar busca".
- "Só marcadas": `USwitch` (ou `UCheckbox`) filtra por `permissionState[id] === true`. Combina com busca (AND). Importante: desmarcar item sob o filtro "só marcadas" não faz a linha sumir imediatamente (evita salto de layout e perda do alvo): congelar a lista no momento de ligar o filtro e reavaliar só quando a busca/filtro mudar. Ver risco R5.
- Resumo global no topo da seção: `UBadge` "{granted} de {total} permissões", calculado no cliente (ver 1.6), com `aria-live="polite"` para refletir mudanças.
- Linha de ação (F7): `UCheckbox` com `label` = `action.name || action.code` e `description` apenas se `action.description` existir e for diferente (normalizado) do `name`; remover badge Permitido/Bloqueado, ícone repetido e o "Código: x" de fallback (mover o código para `title`/tooltip discreto ou `text-xs` apenas quando não há descrição, **mantendo o acesso ao código** para suporte). Linha clicável inteira via `label`/`for` do `UCheckbox` (Nuxt UI 4 associa o label ao input). `disabled` quando `!canEditPermissions || isSaving`.
- Papel de sistema: `UAlert` neutro no topo ("Papel de sistema: somente leitura. Para um perfil diferente, crie um papel próprio."), acordeão com checkboxes `disabled` (marcar-todas e salvar desabilitados). O link "Criar novo papel" só aparece se `workshop.can(ActionCode.ROLES_CREATE)`.

## 5. Fases/PRs (ordem de risco crescente)

Cada PR é independente e reversível com `git revert`. Nenhum altera API, payload nem gates.

### Fase 1: mapeamento de resources (F2)
- **Arquivos:** `app/composables/useRoleResources.ts`; teste novo `tests/fast/lib/role-resources.test.ts`.
- **Mudanças:** (a) mapa de igualdade exata antes dos `includes` para os 5 `resource`: `members`, `organization`, `payment_machines`, `returns`, `subscription` (rótulos sugeridos: Membros, Organização, Maquininhas, Devoluções, Assinatura; ícones sugeridos Lucide: `i-lucide-user-plus`/`i-lucide-users-round`, `i-lucide-building-2`, `i-lucide-credit-card`, `i-lucide-undo-2`, `i-lucide-receipt`; **a confirmar com stakeholder**); (b) fallback de `formatResourceLabel`: `Outros (${valor bruto})` em vez de `Outros`; (c) adicionar ao `ResourceType` apenas se for usado em outros pontos, senão manter literais para não ampliar o enum.
- **Verificar antes:** os valores de `resource` na tabela `actions` real (migration `20240101000105_sync_actions_catalog.sql` e fixture `tests/static/fixtures/actions-prod-103.json`) para garantir os 5 e que nenhum outro cai no fallback. Teste unitário pode iterar sobre a fixture e exigir que **nenhum `resource` retorne rótulo começando com "Outros"**: serve de catraca contra regressão.
- **Componentes Nuxt UI:** nenhum.
- **Riscos:** a ordem dos `includes` pode fazer um novo nome casar com regra antiga (ex.: `payment_machines`, `returns` não casam hoje, mas validar por teste). Menor risco: também altera o Slideover (desejado).
- **Rollback:** reverter o commit; sem efeito em dados.
- **Aceitação:** os 5 grupos têm nome e ícone próprios; nenhum "Outros" anônimo; teste com fixture passa; abas/acordeão atuais continuam funcionando.

### Fase 2: cards de métricas (F1), correção mínima
- **Arquivos:** `[id].vue` (bloco linhas ~511-556).
- **Mudanças:** rótulos curtos ("Usuários", "Liberadas", "Total de ações"), remover `uppercase tracking-widest`, `text-xs text-muted truncate`/`min-w-0`; grade `grid-cols-3` fixa em `sm+` e `grid-cols-1` com layout horizontal (rótulo à esquerda, valor à direita) em `<sm`; `tabular-nums` nos valores; alinhamento com `items-baseline`. **Não** redesenhar o header (F9 fica para a fase 6 ou descartar se obsoleto).
- **Riscos:** baixo, puramente CSS. O bloco será removido na fase 5 se o resumo em linha for aprovado; fase 2 existe para corrigir o defeito "Quebrado" rapidamente.
- **Rollback:** reverter.
- **Aceitação:** em 360, 768 e 1280 px nenhum rótulo quebra no meio da palavra nem vaza o card; valores alinhados na mesma linha-base.

### Fase 3: linha de permissão (F7, F8)
- **Arquivos:** `[id].vue` (bloco linhas ~623-686); sem componente novo ainda.
- **Mudanças:** conforme 4 ("Linha de ação"): remover `UBadge` Permitido/Bloqueado, ícone por linha e descrição duplicada; label clicável; densidade ~40 px desktop e `min-h-11` (44 px) em toque; manter abas por enquanto.
- **Componentes:** `UCheckbox` (`label`, `description`).
- **Riscos:** o estado "bloqueado" deixa de ter texto; o checkbox precisa ter contraste suficiente (verificar `color="neutral"` desmarcado vs. borda). Se a descrição for diferente do nome em só parte das ações, a altura da lista varia (aceitável).
- **Rollback:** reverter.
- **Aceitação:** cada ação mostra um único rótulo e um checkbox; clicar no texto alterna; mesma lógica `updatePermission`; mesmo payload ao salvar (comparar `changedActions` em teste manual de uma alteração).

### Fase 4: dirty, Descartar, guarda de saída, correção do `syncForm` (F5, 6.4)
- **Arquivos:** `[id].vue`; novo `app/utils/role-permissions.ts` só com `diffPermissions` se for compartilhar com `saveRole` (opcional); teste `tests/fast/lib/role-permissions.test.ts`.
- **Mudanças:** seção 3.2 e 3.3: `isDirty`, contador, indicador "Alterações não salvas (N)" na barra já sticky, botão "Descartar" (`variant="ghost"`, desabilitado sem dirty), `onBeforeRouteLeave`/`onBeforeRouteUpdate`, `beforeunload`, `AppConfirmModal` de saída, correção do `watch` de `syncForm` e `syncForm()` explícito após salvar.
- **Componentes:** `UButton`, `UBadge`/ponto de status, `AppConfirmModal` (existente).
- **Riscos:** (R1) quebrar o refresh pós-salvar se `syncForm` deixar de rodar: cobrir com teste E2E/manual "salvar → barra volta ao estado limpo"; (R2) `onBeforeRouteLeave` com modal assíncrono e o bug conhecido de navegação duplicada: retornar `false` e navegar manualmente após confirmar é evitado, usar o retorno `Promise<boolean>`; (R3) falha parcial no salvar (seção 3.2). Mudança comportamental: precisa de verificação no navegador.
- **Rollback:** reverter; sem dados.
- **Aceitação:** alterar permissão ou nome → indicador e N; Descartar restaura exatamente o estado carregado; sair (Voltar, sidebar, abas, fechar aba) com alterações pede confirmação; sem alterações, não pede; vincular/desvincular usuário **não** apaga edições pendentes; salvar zera o estado dirty; papel de sistema nunca fica dirty; payload de salvar inalterado.

### Fase 5: acordeão com busca, filtro, marcar todas e n/m (F3, F4)
- **Arquivos:** novo `app/components/roles/RolePermissionsAccordion.vue`; `app/utils/role-permissions.ts` (agrupar, contar, filtrar); `[id].vue` (substitui abas e `activePermissionTab`, remove `activeTabActions`/`permissionTabs`); opcionalmente trocar os 3 cards por resumo em linha "31 de 107 permissões · 1 usuário" (F9, aprovação visual do PO).
- **Mudanças:** seção 4. `UAccordion` multiple, `UInput` busca, `USwitch` só marcadas, `UCheckbox` tri-state por módulo, badge n/m, ordenação pt-BR, estados vazios. `Slideover` não muda.
- **Componentes:** `UAccordion`, `UInput`, `USwitch`, `UCheckbox`, `UBadge`, `UAlert` (papel de sistema), `UButton`.
- **Riscos:** (R4) desempenho: 107 `UCheckbox` renderizados de uma vez são aceitáveis; evitar `watch` profundo, usar `computed` por grupo; (R5) salto de layout ao filtrar "só marcadas" (congelar lista); (R6) acessibilidade do cabeçalho do acordeão com controle interativo dentro do botão do trigger: um `UCheckbox` dentro de `<button>` é HTML inválido; se o `UAccordion` renderizar o item inteiro como botão, usar `#trigger`? Verificar na doc do Nuxt UI 4 instalado; fallback: colocar "Marcar todas" como botão irmão fora do trigger (via slot de corpo ou layout próprio com `UCollapsible`). **Spike de 30 min antes de codar.**
- **Rollback:** feature flag desnecessária; reverter o PR restaura as abas (a fase 4 não depende dele).
- **Aceitação:** (reaproveitada do review) ver n/m de cada módulo e total sem trocar de aba; marcar/desmarcar todas por módulo; busca por ação; ordem alfabética; sem "Outros" repetido; 107 ações auditáveis em poucos cliques; mesmo payload de salvar (o diff vem de `permissionState`, inalterado).

### Fase 6: usuários vinculados (F13) + papéis de sistema (6.2), premissa (a)
- **Arquivos:** `[id].vue` (seção "Usuários vinculados", header).
- **Mudanças:** (i) texto da seção: "Vincular e desvincular são aplicados imediatamente; não dependem de 'Salvar alterações'." (`UAlert` info compacto ou texto `description`); (ii) confirmação ao desvincular com `AppConfirmModal` ("Remover {usuário} do papel {papel}? O usuário ficará sem papel e perderá o acesso concedido por ele" **texto sujeito à validação do comportamento real**, ver O3); (iii) botão `+` com rótulo textual "Vincular" e `aria-label`; (iv) toasts existentes mantidos ("Vínculo atualizado"/"removido") com `description` citando usuário e papel; (v) botão de remover com `aria-label="Desvincular {nome}"` (tooltip já existe); (vi) exibir `employee_name` sem forçar caixa alta de CSS (o MAIÚSCULO vem do dado; tratar com `capitalize`/normalização só se aprovado); (vii) `UAlert` de papel de sistema e remoção do gradiente do header (F9) se aprovado.
- **Riscos:** baixo; o fluxo `updateUserRoleLink` permanece. Cuidado: o `refresh()` após vínculo não pode mais zerar edições (resolvido na fase 4, portanto **fase 6 depende da 4**).
- **Rollback:** reverter.
- **Aceitação:** a seção informa que o vínculo é imediato; desvincular exige confirmação com consequência; botões com nome acessível; chamada `POST /api/users/update-fields` com o mesmo corpo `{ user_id, role_id }`.

### Fase 7: lista de papéis (F6, F10, F11, F12)
- **Arquivos:** `app/pages/app/settings/roles/index.vue`; opcional `server/api/roles/index.get.ts` (somente se aprovado, ver seção 2).
- **Mudanças:** sem backend: trocar lista de cards por `UTable` (colunas Papel+descrição, Tipo, Ações) em `md+` e cards compactos em `<md`; `UBadge` com texto legível para "Sistema" (tamanho `sm`) e "Personalizado" (outline); botões com texto: "Editar" (se `canUpdate`) ou "Ver" (abre `RoleDetailsSlideover` como hoje); exclusão via `UDropdownMenu` (⋯) com item "Excluir" em `color="error"`, mantendo `canDelete && !is_system_role` e o `AppConfirmModal`; "Sem descrição" no lugar de "-"; tooltip/explicação para papel de sistema ("Somente leitura; crie um papel próprio para personalizar"); alvos >= 44 px em toque. Decisão sobre `openPermissions`/`actionsData` (item 1.4) separada e explícita.
- **Riscos:** médio, maior superfície visual; regressão nos gates (`canUpdate`, `canDelete`, `canCreate`) — manter as mesmas expressões `v-if`. O "olho" e o "lápis" continuam sendo duas ações distintas (slideover vs. página de edição), então não remover sem decisão do PO.
- **Rollback:** reverter; não afeta o editor.
- **Aceitação:** papel de sistema distinguível com texto legível e a razão da falta de edição clara; excluir exige confirmação; ícones têm rótulo; sem scroll horizontal em 360 px; se contagens forem aprovadas, fase 7b (backend aditivo) com testes de handler.

### Fase 8 (opcional): acessibilidade/contraste transversal (F14, F15)
- Revisar `text-[11px]`, `text-xs text-muted` em badges e contagens, tamanhos mínimos, espaçamento do topo; só após medir no navegador (design-review). Sem fase própria se as anteriores já cumprirem.

## 6. Acessibilidade e responsividade

- **Foco/teclado:** acordeão operável por Enter/Espaço; ordem de tab: busca, "só marcadas", itens do módulo; foco visível mantido (não remover outline do Nuxt UI). Após "Descartar" ou "Marcar todas", manter foco no controle acionado.
- **Rótulos:** todo botão-ícone com `aria-label`; "marcar todas" com nome do módulo; contador n/m com `aria-label="3 de 4 permissões liberadas"`; contador total e barra de dirty em região `aria-live="polite"`.
- **Alvos:** linha de permissão `min-h-11` em toque (`@media (pointer: coarse)` ou breakpoint `<md`), ação da lista >= 44 px.
- **Contraste:** não depender de cor para o estado (checkbox marcado já comunica); texto secundário `text-muted` com tamanho >= 12 px; medir badges no navegador.
- **Breakpoints:**
  - 360 px: coluna única; cards de métricas 1 coluna horizontal; busca em linha própria; barra sticky com 2 linhas (status em cima, botões `w-full`/lado a lado abaixo); tabela da lista vira cards; sem scroll horizontal.
  - 768 px: métricas 3 colunas; busca + "só marcadas" na mesma linha; lista em tabela.
  - 1280 px: conteúdo com largura máxima confortável (evitar ~830 px centrados desperdiçando espaço, F15), acordeão em uma coluna ou duas colunas de ações por módulo se a altura justificar (não obrigatório).
- Respeitar `prefers-reduced-motion` (padrão do Nuxt UI para o acordeão).

## 7. Estratégia de testes (convenções de `tests/`)

Contexto: Vitest `fast` em Node, sem jsdom/test-utils. **Não adicionar dependência de teste de componente** (sem justificativa suficiente); empurrar a lógica para funções puras e cobrir a UI por E2E/validação manual.

| Camada | O que | Onde |
|---|---|---|
| Unitário (fast) | `useRoleResources` (importável sem Nuxt): os 5 novos resources, fallback `Outros (x)`, iterar fixture `tests/static/fixtures/actions-prod-103.json` e exigir 0 rótulos "Outros"; ordem pt-BR | `tests/fast/lib/role-resources.test.ts` |
| Unitário (fast) | `app/utils/role-permissions.ts`: `groupActionsByResource`, contagem n/m, `diffPermissions` (igual ao `changedActions` atual), `filterActions` (acento, vazio, só marcadas), `setGroup` | `tests/fast/lib/role-permissions.test.ts` |
| Estático | Catraca opcional: todo `resource` do catálogo possui rótulo (já coberto pelo unitário via fixture; só adicionar a `tests/static/` se o time preferir catracas lá) | `tests/static/` |
| Handler (fast) | Só se a fase 7b (contagens) for aprovada: handler real com Supabase falso (padrão `tests/fast/settings/handlers.test.ts`), checando isolamento de tenant e plano | `tests/fast/settings/` |
| E2E (Playwright) | Já existe smoke de `/app/settings/roles` (`app-smoke.e2e.ts`). Acrescentar, no arquivo de fluxo apropriado (novo `tests/e2e/roles-permissions.e2e.ts`, requer Supabase local): criar papel, editar permissão → indicador dirty → Descartar → sai sem pergunta; editar → sair → modal; salvar → persiste (`POST /actions` por ação alterada); papel de sistema somente leitura; vincular usuário não apaga edição pendente. Usa `world.ts` (admin da org A) | `tests/e2e/` |
| Validação visual | design-review no navegador (abaixo) | `docs/reviews/design/` |

Rodar: `pnpm test` (focado: `pnpm vitest run --project fast tests/fast/lib/role-`) a cada fase; `pnpm test:stack --only=e2e --grep roles` nas fases 4 a 7; `pnpm typecheck`/lint conforme scripts do projeto. `graphify update .` após merge das fases com novos arquivos.

### O que validar com design-review (navegador) depois
1. 360/768/1280: métricas (F1), linha de permissão, acordeão, barra sticky (por que o review a viu fora de vista, item 1.1), tabela/cards da lista.
2. Contraste medido (badges, texto secundário, checkbox desmarcado) e tamanho real dos alvos de toque.
3. Foco e teclado no acordeão (incluindo o "marcar todas" dentro do cabeçalho, risco R6).
4. Estado ativo da aba "Permissões" nas rotas de detalhe (F16/O6 do review).
5. Fluxo guarda de saída: Voltar, sidebar, abas, recarregar.
6. Papel de sistema em somente leitura e mensagens.

## 8. Riscos consolidados

| Id | Risco | Mitigação |
|---|---|---|
| R1 | Refatorar `syncForm` quebra recarga pós-salvar | Teste E2E salvar→limpo; `syncForm()` explícito |
| R2 | Guarda de rota assíncrona com navegação dupla | Retornar `Promise<boolean>`, testar sidebar/abas |
| R3 | Salvar parcial (várias chamadas `POST /actions` em paralelo) | Não alterar; dirty recalculado após `refresh` |
| R4 | Muitos checkboxes | `computed` por grupo; sem watch profundo |
| R5 | Salto de layout no filtro "só marcadas" | Lista congelada até mudar filtro |
| R6 | Controle interativo dentro do trigger do acordeão (HTML/a11y) | Spike na fase 5; controle irmão fora do trigger |
| R7 | Rótulos dos 5 resources não aprovados | Fase 1 só após confirmação (ou entrega com fallback bruto) |
| R8 | `granted_actions_count` do servidor diverge do total filtrado por plano | Calcular no cliente |
| R9 | `GET /api/roles` sem `requireOrgPermission` | Encaminhar a `security-analyst`; fora de escopo |
| R10 | Remover chamada `GET /roles/:id/actions` ao clicar na linha (1.4) | Só com aprovação; não incluir por padrão |

## 9. Se a decisão do vínculo for (b): só ao salvar

Mudaria: o vínculo passaria a fazer parte do estado dirty (`pendingLinks: {add: userId[], remove: userId[]}`), `isDirty` e o contador incluiriam vínculos, "Descartar" os restauraria e a guarda de saída os cobriria. `saveRole` passaria a chamar `/api/users/update-fields` por usuário alterado (mesmo endpoint, mesmo corpo, mas em momento novo), `assignedUsers` exibido seria `server ± pendências` (lista otimista, com marcação "pendente de salvar"), e o correto tratamento de falha parcial entre PUT do papel, `POST /actions` e `update-fields` exigiria decisão de consistência (sem transação; ordem e rollback manual). Sai a confirmação ao desvincular (substituída por "Descartar") e o toast imediato. A fase 6 cresce de "baixo" para "médio/alto", entra no escopo de teste E2E e na revisão do `data-integrity-auditor`, e quebra a restrição "mesmas chamadas/payload" em timing (não em contrato). Por isso a recomendação segue (a).

## 10. Perguntas abertas restantes

- O1. Confirmar rótulos e ícones dos 5 resources (sugeridos: Membros, Organização, Maquininhas, Devoluções, Assinatura) e conferir contra a tabela `actions` real (banco pode divergir das migrations).
- O2. Decisão (a)/(b) do vínculo (premissa a).
- O3. O que acontece com usuários vinculados ao excluir papel / desvincular (ficam sem `role_id`)? Confirmar no `DELETE /api/roles/:id` antes de escrever o texto de consequência.
- O4. Contagens de usuários/permissões na lista: aprovar fase 7b (backend aditivo) ou omitir colunas?
- O5. Remover o gradiente/mini-cards (F9) e usar resumo em linha: aprovar visual com o PO.
- O6. "Descartar" com ou sem modal de confirmação; "Marcar todas" sob filtro age só nos resultados visíveis (regra proposta)?
- O7. Remover a chamada não utilizada `openPermissions`/`GET /roles/:id/actions` da lista (item 1.4)?
- O8. Por que a barra sticky parecia não fixa e por que a aba "Permissões" não fica ativa no detalhe: validar no navegador.
- O9. Descrição duplicada de "Anderson" e caixa alta de `employee_name` são dados: corrigir no cadastro.

## 11. Critérios de aceitação globais

- Nenhum rótulo de métrica quebra ou vaza de 360 a 1440 px.
- Nenhum grupo "Outros" anônimo; módulos em ordem alfabética pt-BR.
- n/m por módulo e total visíveis sem trocar de aba; marcar/desmarcar todas e busca disponíveis.
- Uma linha por ação: rótulo único + checkbox, clicável, alvo >= 44 px em toque.
- Salvar visível; "Alterações não salvas (N)"; Descartar restaura; sair com alterações pede confirmação (dados + permissões apenas).
- Papel de sistema em somente leitura com explicação; vínculo informa que é imediato; desvincular e excluir pedem confirmação com consequência.
- Mesmos gates `workshop.can(ActionCode.X)`, mesmas chamadas de API e mesmo payload de salvar. Contraste >= 4,5:1 e foco visível.
