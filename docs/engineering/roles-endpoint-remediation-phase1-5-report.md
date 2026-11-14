# Relatório: remediação de roles, fases 1 e 5 (+ extras)

Data: 2026-11-13. Plano: `docs/security/roles-endpoint-remediation-plan.md`. Sem commit/push. Fases 2, 3, 4 e 6 NÃO implementadas.

## Status por item

| Item | Status |
|---|---|
| Fase 1: helper único `organization_id.is.null` nas 3 rotas | Concluído |
| Fase 1: `or()` real no fake Supabase + testes de isolamento | Concluído |
| Fase 1: teste em `tests/db` | Escrito, NÃO executado |
| Fase 5: a11y do acordeão e `confirmLeave` | Concluído |
| Descrições de uma linha por permissão (mapa, fallback, busca, testes) | Concluído (códigos ambíguos listados abaixo) |
| Remoção do card "Total de ações" em `[id].vue` | Concluído |
| Lista de papéis em cards, sem descrição | Concluído (sem validação em navegador) |

## Arquivos alterados/criados

Fase 1
- `server/utils/role-scope.ts` (novo: `roleScopeFilter`, `applyRoleScope`)
- `server/api/roles/index.get.ts`, `server/api/roles/[id].get.ts`, `server/api/roles/[id]/actions.get.ts` (usam o helper)
- `tests/support/fake-supabase.ts` (`or()` interpreta `col.op.valor` com eq/neq/is/ilike/gt/gte/lt/lte; expressão não suportada, como `now()` ou and()/or() aninhado, continua no-op)
- `tests/fast/roles/tenant-isolation.test.ts` (novo)
- `tests/db/roles-scope.test.ts` (novo, só Supabase local via `adminDb()`)

Fase 5
- `app/components/roles/RolePermissionsAccordion.vue`: `aria-controls` só com painel aberto e id seguro (`permissionPanelId`); `aria-disabled` + tooltip durante a busca; `aria-label` do checkbox de grupo gerado por `groupCheckboxLabels` (começa com o texto visível).
- `app/pages/app/settings/roles/[id].vue`: `confirmLeave` resolve a Promise anterior com `false` antes de criar outra.
- `app/utils/role-permissions.ts` (`permissionPanelId`, `groupCheckboxLabels`, `permissionDescription`); `tests/fast/lib/role-permissions.test.ts`.

Descrições
- `app/constants/action-descriptions.ts` (novo): `Record<ActionCode, string>` cobrindo os 107 códigos do enum (103 do catálogo + `bank_accounts.create/delete`, `roles.manage_permissions/manage_members`). Tipagem exige cobertura total.
- Linha da permissão: descrição do mapa; fallback para `description` da API se diferir de título/código; senão sem segunda linha. Código só em `title` da linha e texto `sr-only`. Busca (`filterActions`) inclui nome, código, descrição da API e descrição do mapa, sem acento.
- `tests/fast/lib/action-descriptions.test.ts` (novo).

Header e lista
- `[id].vue`: card "Total de ações" removido; grade de 2 colunas (`grid-cols-2`, cards em coluna). Removido `total_actions_count` do tipo/default local da página (única referência); payload do servidor intacto. O total segue no resumo "N de M permissões" do acordeão.
- `app/pages/app/settings/roles/index.vue`: UTable substituída por grade de cards (1 col, `md` 2, `xl` 3), um só markup; sem descrição ("Sem descrição" removido); nome com `break-words`; badge de tipo; contagens "Usuários" e "Permissões liberadas". Removidos `columns`, `openPermissions`, `fetchRolePermissions`, `selectedPermissionsRoleId`, `actionsData`, `isLoadingActions` e tipos `ActionItem/RoleAction/RoleActionsResponse` (usados só pela tabela/seleção de linha).
- `app/components/roles/RoleRowActions.vue`: alvos `min-h-11/min-w-11` em todos os tamanhos; `flex-wrap`.

## Comandos e resultados reais

- `vitest --project fast tests/fast/roles` (após helper): 14 passaram.
- Verificação de mutação: com o filtro antigo (`is_system_role.eq.true`) no helper, 4 testes de isolamento FALHARAM; filtro restaurado.
- `vitest --project fast` (suíte fast inteira, após fake `or()`): 77 arquivos, 2206 passaram, 108 expected fail, 64 todo, exit 0.
- `vitest --project fast tests/fast/roles users access lib employees` (final): 1180 passaram, 12 expected fail, 8 todo, exit 0.
- `eslint` nos arquivos alterados: exit 0.
- `pnpm typecheck`: exit 0 antes das mudanças de descrições/cards (rodada 1). Resultado da rodada final **não registrado** (não verificado). Obs.: o baseline do repositório registra 444 erros de typecheck pré-existentes (`docs/engineering/pending.md` QLD-1); conferir se "exit 0" se refere a escopo parcial.

## Nota de verificação (2026-11-13)

Afirmações conferidas no código: helper e 3 rotas, a11y do acordeão, `confirmLeave`, B1 resolvido. Reexecutado: `vitest --project fast tests/fast/roles tests/fast/lib` (9 arquivos, 96 passaram). Status consolidado por achado/fase em `docs/security/roles-endpoint-remediation-plan.md` (seção "Status de implementação"). Revisão independente (code-reviewer/security-analyst) ainda não feita.

## Não validado

- `tests/db/roles-scope.test.ts` não executado (nem E2E); não rodou contra nenhum banco.
- Nenhuma validação em navegador: layout de 360/768/1280 px dos cards e do header, ausência de rolagem horizontal, foco/leitor de tela do acordeão, tooltip do código. Verificação apenas por leitura de classes.
- Suíte completa `pnpm test` pós-extras não rodada (fast completa só antes das extras).

## Desvios e observações

- Pontos com `is_system_role` fora do plano, NÃO alterados: `server/utils/employee-access.ts:25-28` e `server/api/employees/[id]/grant-access.post.ts:62-65` (busca `employee` por org com `is_system_role`; RE-09, Fase 2), `server/api/stripe/webhook.post.ts` (cria admin por org, Fase 2), `require-org-permission.ts`, `user-provisioning.ts`, `initial-data.post.ts` (leituras por id, sem o `.or`). Só havia 3 ocorrências do `.or(... is_system_role.eq.true)`, todas corrigidas.
- Interpretação do `or()` no fake pode afetar testes que dependiam do no-op: a suíte fast passou integralmente.
- Papéis de sistema com `organization_id` preenchido (criados pelo webhook) deixam de aparecer para a própria organização também; consistente com D-1 e RLS, mas só relevante se existirem (0 no diagnóstico do plano). Reforça a urgência da Fase 2.
- Nenhuma migration necessária ou criada.
- Alguns arquivos aparecem como staged (`A`/`M ` no git status) por estado prévio do working tree; nada foi commitado por mim.

## Descrições de permissões (revisão do stakeholder)

Descrições neutras baseadas no nome, sem uso identificado no código; confirmar o significado:
- `orders.correct` (Corrigir ordem de serviço), `employees.pay` (pagamentos a funcionários)
- `members.view`, `members.update`, `members.delete` (só `members.invite` e `members.view` têm uso em rotas)
- `organization.view`, `organization.update`, `settings.view`, `settings.update`
- `fiscal.manage` (escopo fiscal exato)
- `consultation.use`, `consultation.view` (consultoria IA)

Inferência por uso no código (confirmar nomenclatura): `authorizations.*` descritas como "solicitações de compra" (rotas `purchase-requests`); `returns.*` como "devoluções de compras ao fornecedor" (rotas `purchase-returns`); `payment_machines.update` abrange cadastrar/alterar/excluir maquininhas; `reports.view` como "abrir a área de relatórios e a visão geral".

## Riscos

- Dados de produção podem ter papéis de sistema por org (webhook); após a Fase 1 eles somem das listagens da própria org até a Fase 2/migração.
- Descrições ficam no front: novos códigos no banco sem entrada no mapa usam o fallback (sem código cru).

## Confirmação de banco

Nenhum dado foi alterado no banco: nenhum INSERT/UPDATE/DELETE/DDL/RPC/migration; credenciais do `.env` não foram usadas; nenhum teste `tests/db` ou E2E foi executado. Todos os testes rodados usam o Supabase falso em memória.
