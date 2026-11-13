# Relatório: refatoração de Configurações > Permissões (fases 1 a 8)

Data: 2026-11-13. Plano: `docs/architecture/permissions-layout-implementation-plan.md`. Sem commit, sem servidor/navegador, sem E2E.

## Validação realmente executada
- `pnpm vitest run --project fast tests/fast/lib/role- tests/fast/roles tests/fast/access tests/fast/users`: 18 arquivos, 955 testes, todos passaram.
- `pnpm typecheck` (nuxt typecheck): terminou com exit 0.
- `npx eslint` nos arquivos alterados/novos (páginas, componentes, utils, composable, server/api/roles, server/utils/role-counts, testes): sem erros.
- NÃO validado: comportamento no navegador (layout 360/768/1280, sticky, foco/teclado, contraste medido, guarda de saída, UTable `@select`/`meta.class.tr`, UDropdownMenu), E2E Playwright (spec do plano NÃO escrito), handler de `GET /api/roles` (só a função pura de contagem tem teste).

## Por fase
1. Mapeamento de resources: `app/composables/useRoleResources.ts` (enum `ResourceType` ganhou MEMBERS, ORGANIZATION, PAYMENT_MACHINES, RETURNS, SUBSCRIPTION; mapa `EXACT_RESOURCE_META` chaveado pelo enum, checado antes dos `includes`; fallback `Outros (valor)`). Teste: `tests/fast/lib/role-resources.test.ts` (inclui fixture de 103 ações: 0 "Outros"). Os `includes` existentes não foram tocados; o teste da fixture cobre a não-regressão. **Rótulos/ícones são sugestão não confirmada pelo stakeholder; ajustar somente em `EXACT_RESOURCE_META`.**
2. Cards de métricas: `[id].vue` (rótulos curtos, sem uppercase/tracking, truncate/min-w-0, `tabular-nums`, layout horizontal em coluna única). Gradiente do header mantido (não aprovado).
3. Linha de permissão: feita dentro de `RolePermissionsAccordion.vue` (junto da fase 5): um `UCheckbox` com label/description, sem badge Permitido/Bloqueado nem ícone por linha; código da ação como descrição quando não há descrição distinta (e `title`).
4. Dirty/Descartar/guarda: `[id].vue`. `isDirty`, contador "Alterações não salvas (N)", "Descartar" (sem modal, com toast), `onBeforeRouteLeave`/`onBeforeRouteUpdate` com `AppConfirmModal`, `beforeunload`. Bug do `syncForm`: o `watch` foi trocado por `syncForm()` inicial + `watch(role.id)` + `syncForm()` explícito após salvar; vincular/desvincular não apaga edições. `changedPermissionIds` (via `diffPermissions`) alimenta dirty e payload (mesmo payload).
5. Acordeão: novo `app/components/roles/RolePermissionsAccordion.vue` + `app/utils/role-permissions.ts` (funções puras) + `tests/fast/lib/role-permissions.test.ts`. Busca (sem acento), "Só marcadas" (lista congelada), n/m por módulo, total, marcar todas tri-state (sob filtro age nos resultados), ordem pt-BR, estados vazios. Papel de sistema: `UAlert` + tudo disabled.
6. Usuários vinculados: texto "aplicado imediatamente", botão "Vincular", `aria-label`s, confirmação ao desvincular (`AppConfirmModal`), toasts com descrição. `POST /api/users/update-fields` com mesmo corpo.
7. Lista: `index.vue` com `UTable` (md+) e cards (<md), `RoleRowActions.vue` (Editar/Ver, olho, menu ⋯ com Excluir), badges legíveis, "Sem descrição", colunas Usuários e Permissões. Mantidos os gates `canUpdate/canDelete/canCreate`, o `AppConfirmModal` e a chamada `GET /api/roles/:id/actions` (`openPermissions` via `@select`). O diálogo de exclusão avisa e desabilita a confirmação quando há usuários vinculados (verificado: `DELETE /api/roles/:id` responde 409 nesse caso, então O3 está respondida).
8. Acessibilidade (só telas de roles): badges `xs` para `sm`, `text-[11px]` para `text-xs` no slideover, alvos 44 px em toque (remover vínculo, ações da lista, linhas do acordeão `min-h-11`), `aria-live`/`role=status`, `aria-label`s.

## Mudança de backend (para revisão)
- `server/api/roles/index.get.ts`: resposta mantém todos os campos e ganha, ADITIVAMENTE, `assigned_users_count` e `granted_actions_count` por papel. 3 consultas em lote (sem N+1), paginadas em 1000: `actions(id, resource)`, `role_actions(role_id, action_id, is_granted)` com `role_id in (...)` e `is_granted = true`, `user_profiles(role_id)` com `organization_id = <org do chamador>` e `role_id in (...)`. Contagem de permissões filtrada por plano (`filterActionsByPlan`, mesma regra de `GET /api/roles/:id`). Autorização do endpoint NÃO foi alterada (continua sem `requireOrgPermission`; encaminhar ao security-analyst). Papéis de sistema são compartilhados entre organizações: suas permissões são globais e as contagens de usuários só incluem a org do chamador.
- Novo `server/utils/role-counts.ts` (função pura) com `tests/fast/roles/role-counts.test.ts`.

## Desvios do plano
- Fases 3 e 5 implementadas juntas no componente; sem passo intermediário com abas.
- Acordeão próprio (botão com `aria-expanded` + checkbox irmão) em vez de `UAccordion`, para evitar checkbox dentro de botão (R6); sem spike no navegador.
- Modal de saída usa os botões fixos do `AppConfirmModal` ("Cancelar" / "Sair sem salvar"), não "Continuar editando".
- Prop `readonly` do acordeão não criada; só `disabled`. Cards de métricas mantidos (O5 pendente) e ainda usam `summary` do servidor.
- Texto de desvincular não afirma consequência sobre acesso (O3 só confirmada para exclusão).
- `RoleUnsavedBar` não extraído (página abaixo de ~600 linhas de lógica).

## Riscos
- UTable: assinatura de `@select` e `meta.class.tr` passaram no typecheck mas não foram exercitadas em runtime.
- A linha da tabela abre/seleciona permissões via request ao clicar (comportamento antigo preservado).
- `GET /api/roles` agora faz 3 consultas extras; sem medição de desempenho.
- Guarda de rota assíncrona (R2) e salto de layout do filtro (R5) precisam de verificação no navegador.
- Arquivos desta tarefa aparecem como staged no git (não fui eu que fiz `git add`); nenhum commit foi feito.
