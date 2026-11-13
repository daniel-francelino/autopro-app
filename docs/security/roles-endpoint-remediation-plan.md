# Plano de remediação: achados RE-01 a RE-08 (`server/api/roles/**`)

- Data: 2026-11-13
- Tipo: plano de implementação (nada foi implementado; nenhum código de produção, teste ou schema alterado)
- Entradas: `docs/security/roles-endpoint-review-2026-11-13.md`, `docs/reviews/code/permissions-layout-review-2026-11-13.md`, `docs/architecture/permissions-layout-implementation-plan.md`
- Implementação: delegar ao `developer`; revisão independente pelo `code-reviewer` e `security-analyst` ao final da Fase 1.

## 1. Verificação com dados (somente leitura)

Método: consultas de leitura via API REST com a credencial do `.env` (script temporário só no scratchpad, nada gravado no repositório). Nenhum INSERT/UPDATE/DELETE/DDL/RPC. Saída apenas agregada.

**Ambiente:** o `.env` aponta para um projeto Supabase **hospedado** (não local). Não foi possível afirmar se é produção ou desenvolvimento; tratado como produção (apenas contagens). Volume muito pequeno (2 organizações, 8 perfis), compatível com ambiente de desenvolvimento/piloto.

Agregados observados:

| Tabela | Linhas | Com `deleted_at` preenchido |
|---|---|---|
| `roles` | 5 | 0 |
| `organizations` | 2 | 0 |
| `actions` | 107 | 0 |
| `role_actions` | 290 (todas `is_granted=true`) | 0 |
| `user_profiles` | 8 | 0 |

Distribuição de `roles`: 3 papéis `is_system_role=true` com `organization_id` nulo (códigos `admin`, `manager`, `employee`, 1 de cada); 2 papéis de organização (`is_system_role=false`) em 1 organização; **0 papéis de sistema com `organization_id` preenchido**; 0 papéis não-sistema com organização nula; 0 `role_actions` ligadas a papéis de sistema com organização. `max_rows` efetivo: uma leitura sem `Range` de `role_actions` devolveu as 290 linhas (limite efetivo >= 290; não prova que seja 1000, apenas que não é menor que o volume atual).

### Status por achado

| ID | Status | Evidência |
|---|---|---|
| RE-01 | **Confirmado no código; vazamento NÃO materializado nos dados atuais (latente)** | Nenhum papel de sistema com `organization_id` no banco consultado, então hoje o filtro `is_system_role.eq.true` só devolve os 3 globais (corretos). O caminho que cria o problema existe e é ativo: `server/api/stripe/webhook.post.ts:222-240` busca admin com `.eq('organization_id', org)`; como o admin de sistema é global (org nula), a busca não o encontra e **insere um admin `is_system_role=true` por organização** a cada nova assinatura (o comentário "roles.organization_id is NOT NULL" está desatualizado pela migration `20240101000058`). Os dados atuais não têm isso, provavelmente porque as 2 orgs não passaram por esse fluxo no banco consultado. Em produção real com assinaturas Stripe, o vazamento aparece na primeira assinatura via webhook. Gravidade: Alta mantida como risco, prioridade alta, sem urgência de correção de dados. |
| RE-02 | Confirmado (código) | Sem dados a verificar; decisão D14 e `employees/index.vue:83` confirmam o consumidor. |
| RE-03 | Descartado como problema atual; risco latente | 5 papéis, 290 `role_actions`: custo desprezível hoje. Passa a existir só se RE-01 se materializar (N orgs => N admins na URL do `in()`). A correção de RE-01 elimina a causa. |
| RE-04 | Não verificado (regra de negócio) | Decisão do PO. Dados: 8 perfis, não avaliado quantos têm `roles.manage_members` (sem valor para a decisão). |
| RE-05 | Descartado no estado atual; risco latente | 0 linhas com `deleted_at` em `actions`, `role_actions`, `user_profiles`. Correção é barata e preventiva. |
| RE-06 | Parcialmente verificado | Volumes (290 linhas) muito abaixo de 1000; truncamento não ocorre hoje. `max_rows` do projeto hospedado ainda não comprovado (só se sabe que é >= 290). Confirmar no dashboard (Settings > API) é tarefa manual. |
| RE-07 | Confirmado (código) | Sem dados. |
| RE-08 | Confirmado (código), informativo | Sem dados. |

Papéis de sistema por organização: nascem em (a) `server/api/stripe/webhook.post.ts:232-240` (admin), (b) fallback `supabase/functions/stripe-webhook/index.ts:445-452` (admin) e (c) `employee` por org é **buscado** em `server/utils/employee-access.ts:25-28` e `server/api/employees/[id]/grant-access.post.ts:62-65` (filtro `organization_id = org AND is_system_role`); nos dados atuais o `employee` é global (org nula), logo essa busca não o encontra e `grant-access` cairia em 422 ("papel não encontrado"). **Achado adicional (RE-09, hipótese forte, a confirmar com o `developer`):** `resolveEmployeeRoleId` procura um papel que, no banco consultado, não existe por organização. Decidir se deve aceitar `organization_id.is.null` também (o mesmo conserto de RE-01 pelo lado oposto). Verificar `grant-access.test.ts` antes. Fora do escopo dos RE, mas relacionado a "onde nascem papéis de sistema".

## 2. Decisão estrutural: papéis de sistema globais vs. por organização

Modelo vigente (migrations, RLS, `user-role.ts:38`, dados atuais): **papel de sistema = global, `organization_id IS NULL`**. O webhook do Stripe diverge desse modelo ao criar cópias por organização.

Recomendação (decisão D-1 abaixo): manter o modelo global e **parar de criar admin por org** no webhook, passando a localizar o admin global (`organization_id IS NULL AND name='admin' AND is_system_role`). Motivos: um só ponto de manutenção de permissões do admin, as migrations 87/90 já "concedem ações aos admin roles" (precisam atingir só os globais), a RLS e `user-role.ts` já tratam global como regra.

Mesmo com a correção do filtro (RE-01), papéis de sistema por org continuariam sendo exibidos corretamente para a própria org e invisíveis para as demais; a duplicação ("Administrador" global + "Administrador" da org) é só um problema de UX/consistência. Portanto:

- **Correção de dados/migration não é necessária hoje** (0 linhas afetadas no banco consultado). Antes de qualquer migration, rodar a consulta de diagnóstico abaixo em cada ambiente real (produção, staging) e só criar a migration se retornar linhas.
- Diagnóstico (somente leitura): `select organization_id, name, count(*) from roles where is_system_role and organization_id is not null and deleted_at is null group by 1,2;` mais a contagem de `user_profiles` por esses `role_id`.
- **Se houver linhas em algum ambiente**, migration segura e reversível, em 3 passos independentes:
  1. (Backup lógico) criar tabela de rollback `_roles_sysorg_backup_20261113` com cópia das linhas de `roles` e `role_actions` afetadas (CREATE TABLE AS), sem apagar nada.
  2. Reapontar `user_profiles.role_id` desses papéis para o papel global de mesmo `name`, **em transação**, apenas quando o conjunto de `role_actions` concedidas for idêntico ao do global; se divergir (a organização personalizou o admin), **não migrar** e listar para decisão manual (o `[id].put.ts` permite editar o papel de sistema da própria org).
  3. Soft delete (`deleted_at`) das cópias órfãs, nunca DELETE físico. Rollback: restaurar `deleted_at = NULL` e `user_profiles.role_id` a partir da tabela de backup.
  - Pré-condição: o webhook já não cria novas cópias (Fase 2), senão a migration é desfeita pelo próximo cliente.
  - Aprovar com `data-integrity-auditor`; aplicar primeiro em staging.

## 3. Plano por achado

### RE-01 (Alta) Filtro de papéis de sistema entre tenants

- **Solução:** nas 3 leituras trocar `organization_id.eq.${org},is_system_role.eq.true` por `organization_id.eq.${org},organization_id.is.null` (mesma regra da RLS `roles_select_same_org` e de `user-role.ts:38`). Opcional de endurecimento: exigir também `is_system_role.eq.true` no ramo global? Não: a RLS e `user-role.ts` tratam "org nula" como global; manter igual para não criar quarta regra.
- Extrair o filtro para um helper único (por exemplo `server/utils/role-scope.ts`, função que aplica o escopo ao query builder ou devolve a string), usado por `index.get.ts`, `[id].get.ts` e `[id]/actions.get.ts` e conferido contra `user-role.ts:38`. Evita nova divergência (causa raiz de RE-01 e RE-08).
- Substituir `select('*')` por colunas explícitas (ver RE-02) em `index.get.ts`.
- **Arquivos:** `server/api/roles/index.get.ts:33`, `server/api/roles/[id].get.ts:22`, `server/api/roles/[id]/actions.get.ts:23`; novo helper opcional; `server/api/users/update-fields.post.ts`/`server/utils/user-role.ts` apenas conferidos (sem alteração).
- **Consumidores/impacto:** `employees/index.vue:83` e `settings/roles/index.vue`/`[id].vue` passam a ver apenas globais + da própria org. Com os dados atuais o resultado não muda (0 cópias por org), mudança é segura. Papéis `employee` por org (se existirem em algum ambiente) deixam de aparecer para outras orgs e continuam aparecendo para a própria.
- **Cuidado:** a leitura de `role_actions` via `[id]/actions.get.ts` deixa de funcionar para papéis de sistema de outra org (retorna 404), comportamento desejado.
- **Rollback:** reverter o commit (mudança de uma linha por rota; sem estado).
- **Aceitação:** org A não lista, não lê `[id]` e não lê `[id]/actions` de papel de sistema com `organization_id` da org B (404); org A continua vendo globais e os seus; testes passam.

### RE-02 (Média) Payload da lista sem `roles.read`

- **Solução recomendada (opção 1 da revisão):** manter R4/D14 (sem permissão obrigatória) e dividir o payload por permissão:
  - Sem `roles.read`: `id, name, display_name, is_system_role` apenas (o que `employees/index.vue:70-75` usa); **sem** contagens, `description` e colunas de auditoria.
  - Com `roles.read`: lista completa explícita (`id, organization_id, name, display_name, description, is_system_role, created_at, updated_at`) **sem** `created_by/updated_by` (não usados pelas telas; confirmar no `index.vue`) mais as contagens.
  - Checagem não lançadora de permissão: verificar se existe helper (por exemplo o usado em `require-org-permission-if-member`); se não, criar uma função `hasOrgPermission(event, code)` reutilizando a lógica de `require-org-permission.ts` (sem duplicar a regra de bypass do admin).
- Efeito colateral positivo: o membro sem `roles.read` não dispara as 3 consultas de contagem (menos custo).
- **Arquivos:** `server/api/roles/index.get.ts`, `server/utils/require-org-permission.ts` (helper não lançador, se necessário), `docs/security/access-control-route-map.md` e `docs/engineering/access-control-rollout-plan.md` (D14 atualizado), tipo `Role` em `app/pages/app/settings/roles/index.vue` (contagens já opcionais).
- **Impacto em consumidores:** `index.vue` (tela de papéis) exige `roles.read` na página, logo recebe o payload completo; modal de funcionários usa só os 4 campos básicos. Conferir se `[id].vue` ou outro componente consome `description` da lista.
- **Rollback:** reverter a divisão (volta ao payload atual).
- **Aceitação:** usuário com só `employees.read` recebe exatamente 4 campos por item e nenhum `*_count`; com `roles.read` recebe contagens; D14 atualizado.

### RE-03 / RE-06 (Média/Baixa) Custo, paginação e consultas em lote

- **Solução:** após RE-01 o volume é limitado ao catálogo global + papéis da org; manter `fetchAllPages` mas torná-lo robusto sem trocar a arquitetura:
  1. Usar `count: 'exact'` na primeira página e iterar até atingir o total, em vez de parar quando a página vem menor que 1000 (corrige truncamento silencioso se `max_rows` < 1000).
  2. Em `actions` (tabela global pequena, 107 linhas), basta `select('id, resource').is('deleted_at', null)`; confirmar se `actions` tem `deleted_at` (migrations) antes.
  3. Como o `in('role_id', ids)` tem poucos ids após RE-01, o risco de URL longa some. Registrar teto defensivo: se `roleIds.length > 100`, dividir em lotes (chunk) de 100.
- **Alternativa de médio prazo (só com evidência de lentidão, não agora):** view/RPC de leitura que agrega `count(*)` por `role_id` no banco. Decisão: **não fazer agora**, volume atual (290 linhas) não justifica (Lean Build). Reavaliar quando `role_actions` > ~20 mil linhas ou p95 do endpoint > 500 ms.
- **Arquivos:** `server/api/roles/index.get.ts`; `server/utils/role-counts.ts` só se o chunking for extraído.
- **Tarefa manual:** confirmar `max_rows` no projeto hospedado (Dashboard > Settings > API) e anotar neste documento.
- **Rollback:** reverter commit.
- **Aceitação:** teste com fake Supabase que retorna páginas menores que 1000 (simulando `max_rows` baixo) mantém a contagem correta; teste de chunking.

### RE-05 (Baixa) `deleted_at`

- **Solução:** `actions`: `.is('deleted_at', null)` (conforme `require-org-permission.ts:113`); `role_actions`: `.is('deleted_at', null)`; `user_profiles`: **decisão D-3** (contar inativos/excluídos?). Recomendação: contar apenas `deleted_at IS NULL` na contagem exibida **e** manter o bloqueio de exclusão do papel (`[id].delete.ts:25-31`) coerente com o mesmo critério. Se hoje o 409 conta usuário excluído, o papel fica indeletável por um fantasma; alinhar os dois e `[id].get.ts:44-47`.
- Os dados atuais têm 0 linhas excluídas, então a mudança não altera nenhum número observável hoje (baixo risco).
- **Arquivos:** `server/api/roles/index.get.ts`, `server/api/roles/[id].get.ts`, `server/api/roles/[id].delete.ts`.
- **Aceitação:** linhas com `deleted_at` não entram nas contagens nem no 409; teste correspondente.

### RE-07 (Baixa) Mensagens de erro

- **Solução:** criar helper `server/utils/safe-error.ts` (por exemplo `internalError(event, context, error)`) que faz `console.error` com o detalhe e lança `createError({ statusCode: 500, statusMessage: 'Falha ao processar a solicitação' })`. Aplicar em todos os handlers de `server/api/roles/**` (lista do achado). Validar `id` como UUID antes da consulta (`400` com mensagem fixa) em `[id].get.ts`, `[id].put.ts`, `[id].delete.ts`, `[id]/actions.get.ts`, `[id]/actions.post.ts`.
- Escopo: restringir a `roles/**` agora; o padrão existe no projeto inteiro (não é regressão deste PR). Registrar como pendência transversal em `docs/engineering/pending.md`.
- **Cuidado:** testes existentes podem afirmar `statusMessage` literal do PostgREST; procurar com grep antes (`tests/fast/users/users-roles-security.test.ts`, `tests/fast/access/*`).
- **Aceitação:** nenhuma resposta de `roles/**` contém texto do PostgREST/Postgres; id inválido => 400.

### RE-04 (Média) Autopromoção a admin via `roles.manage_members` (decisão para o PO)

- **Riscos:** escalonamento de privilégio horizontal-vertical; auditabilidade (quem se promoveu). Pode ser intencional.
- **Opções para o PO:** (A) manter e documentar; (B) bloquear `targetProfileId = chamador` ao atribuir papel; (C) só quem já é admin de sistema atribui o papel `admin`; (D) B + C.
- **Recomendação técnica:** C (ou D) com mínimo atrito: o papel `admin` é bypass total, e `manage_members` não deveria concedê-lo. Implementação trivial em `server/utils/user-role.ts` (após validar o papel, se `role.name==='admin' && is_system_role` exigir que o chamador seja admin).
- **Sem implementação até a decisão.** Registrar em `access-control-route-map.md`.

### RE-08 (Informativo) Service role

- **Recomendação:** não migrar para cliente com JWT agora (grande, risco de regressão, fora de escopo). Mitigar com: helper único de escopo (RE-01) e **testes de isolamento por tenant em todas as rotas de `roles/**`** (Fase 1). Registrar como decisão arquitetural (ADR curto em `docs/architecture/`) para o PO/tech-lead: aceitar service role + filtros testados.

### Ressalvas menores do code review (vale corrigir)

| Item | Correção | Arquivo |
|---|---|---|
| m2 a11y: `aria-controls` aponta para id inexistente com grupo fechado e usa `resource` cru | Renderizar sempre o contêiner do painel (com `v-show`/`hidden`) ou omitir `aria-controls` quando fechado; gerar id seguro (`useId()` por grupo ou slug do resource). Manter `aria-expanded`. | `app/components/roles/RolePermissionsAccordion.vue:150-151,187` |
| m3: `aria-expanded=true` durante a busca com clique inoperante | Desabilitar o botão (`aria-disabled`) durante a busca e/ou indicar "Abertos pela busca" | mesmo arquivo `:52-61` |
| m1: `confirmLeave` com Promise pendente | Se `leaveResolver` já existe, resolver a anterior com `false` antes de criar a nova (ou reutilizar a mesma Promise) | `app/pages/app/settings/roles/[id].vue:267-285` |
| m7: `resolveOrgLicense` ignora erro | Ler `error`; em erro, lançar 500 genérico (ou, no `index.get.ts`, retornar sem contagens de permissões) em vez de `planKey=null` silencioso. Cuidado: `license.ts` é usado por `enforceEmployeeLimit` e outros; **alterar só com função nova** (`resolveOrgLicenseStrict`) ou parâmetro opcional para não mudar o comportamento herdado dos outros chamadores sem teste. | `server/utils/license.ts:42-57` |
| B1 (bloqueante do review, se ainda aberto) | Verificar se foi corrigido (imports de `RolePermissionsAccordion` e `RoleRowActions`); ver status do review. | `[id].vue`, `index.vue` |
| m4, m5, m6, M1, M2 | Fora do escopo deste plano (opcional: teste de montagem do acordeão, m5 com acentos). | |

## 4. Fases (ordem por risco)

**Fase 0: pré-requisitos (sem código):** confirmar B1 do review resolvido; consultar `max_rows` no dashboard; rodar a consulta de diagnóstico (seção 2) em produção/staging; o PO decide D-1 a D-5.

**Fase 1: isolamento (RE-01 + testes de isolamento RE-08), prioridade alta, risco baixo.** Helper de escopo + 3 rotas; testes de isolamento por tenant. Entregável independente e mínimo.

**Fase 2: fonte dos papéis duplicados (D-1):** alterar `stripe/webhook.post.ts` e `supabase/functions/stripe-webhook/index.ts` para usar o admin global; ajustar `resolveEmployeeRoleId` (RE-09) conforme decisão. Só aqui há impacto de negócio (onboarding por assinatura); exige teste do webhook e revisão do `developer` com `security-analyst`. Migration de dados apenas se o diagnóstico da Fase 0 encontrar linhas.

**Fase 3: payload e erros (RE-02, RE-07):** divisão de payload por permissão; helper de erro + validação de UUID; atualizar D14 e route map.

**Fase 4: robustez e integridade (RE-03/06, RE-05, m7 de `license`):** paginação por `count: 'exact'`/chunking, filtros de `deleted_at`, tratamento de erro da licença.

**Fase 5: front (a11y e `confirmLeave`):** independente das fases de servidor; pode ocorrer em paralelo com a Fase 3.

**Fase 6 (condicionada a decisão do PO):** RE-04.

Cada fase = um commit/PR separado, reversível por `git revert`.

## 5. Estratégia de testes

Convenções (`tests/README.md`): projeto `fast` com handlers reais e Supabase falso em memória (`tests/support/fake-supabase.ts`, `handler-harness.ts`); `tests/db` contra Postgres local; padrão de tenant em `tests/fast/bank-accounts/tenant-write-scope-*.test.ts` e `tests/fast/users/users-roles-security.test.ts`.

- **Lacuna importante:** o fake de Supabase implementa `or()` como **no-op** (`tests/support/fake-supabase.ts:109`). Um teste de isolamento de RE-01 com o fake passaria mesmo com o filtro errado. Opções: (a) implementar parse mínimo de `.or('a.eq.x,b.is.null')` no fake (preferido, beneficia outros testes; cuidado para não quebrar testes que dependem do no-op: rodar a suíte `fast` inteira); (b) testar o helper de escopo como função pura (string exata) mais um teste em `tests/db` com Postgres real (org A não vê sistema da org B). Recomenda-se (a)+(b).
- Novos testes `tests/fast/roles/`: `tenant-isolation.test.ts` (3 rotas de leitura; org A vs org B com papel de sistema por org e global), `index-payload.test.ts` (4 campos vs completo; contagens só com `roles.read`), `index-pagination.test.ts` (páginas curtas, chunking, `deleted_at`), `error-sanitization.test.ts` (nenhum `statusMessage` cru; UUID inválido => 400).
- Existentes a rodar sempre: `tests/fast/roles/role-counts.test.ts` (não muda o contrato de `computeRoleCounts`), `tests/fast/users/users-roles-security.test.ts`, `tests/fast/employees/grant-access.test.ts`, `tests/fast/access/*` (guard matrix: nova checagem não lançadora não pode alterar a matriz), `tests/static` (varredura de código, pode exigir registro do helper).
- Webhook (Fase 2): teste do fluxo "org nova usa admin global, não cria cópia".
- Front: `pnpm vitest run --project fast tests/fast/lib/role-` mais verificação manual das telas (index, [id], modal de funcionários) e, se possível, um teste de montagem do acordeão (resolveria M1/B1).
- Comando: `pnpm vitest run --project fast tests/fast/roles tests/fast/users tests/fast/access tests/fast/employees`, depois `pnpm test`; `pnpm typecheck` e `pnpm lint` com exit code real (sem `| tail`).

## 6. Rollback

- Fases 1, 3, 4, 5: `git revert` do commit da fase; sem estado.
- Fase 2: reverter o código do webhook; admins já criados continuam válidos (global). Se a migration de dados for aplicada: restaurar a partir da tabela `_roles_sysorg_backup_20261113` (seção 2) e remover a tabela só após a janela de observação.
- Fase 3: o contrato de `GET /api/roles` encolhe para quem não tem `roles.read`; se algum consumidor ainda usar `description`/contagens sem a permissão, reverter somente essa fase.

## 7. Critérios de aceitação globais

1. Nenhum papel de sistema de outra organização é retornado por `GET /api/roles`, `GET /api/roles/:id`, `GET /api/roles/:id/actions` (404 para o id de outra org), comprovado por teste que falha com o filtro antigo.
2. Membro sem `roles.read` recebe apenas `id, name, display_name, is_system_role`.
3. Contagens corretas com páginas curtas e sem contar registros `deleted_at`.
4. Nenhum texto de erro do PostgREST nas respostas de `roles/**`.
5. Webhook novo não cria papéis de sistema por org (se D-1 = global); `grant-access` funciona nos dois modelos.
6. A11y: `aria-controls` sempre válido; `confirmLeave` não deixa Promise pendente.
7. `pnpm test`, `pnpm typecheck`, `pnpm lint` verdes; code-review independente; route map e D14 atualizados.

## 8. Decisões abertas para o stakeholder (PO)

- **D-1:** papel de sistema é global (recomendado) ou por organização? Define Fase 2 e RE-09.
- **D-2:** RE-02: confirmar opção 1 (payload reduzido sem `roles.read`) ou opção 2 (any-of `roles.read`/`employees.read`).
- **D-3:** usuários excluídos/inativos contam em "usuários vinculados" e no bloqueio de exclusão do papel?
- **D-4:** RE-04: quem pode atribuir o papel `admin` e se há autoatribuição permitida (A/B/C/D).
- **D-5:** RE-08: aceitar service role com filtros testados (recomendado) ou planejar migração para RLS com JWT em leituras (esforço grande).
- **D-6:** O `.env` aponta para produção ou desenvolvimento? Define se o diagnóstico da seção 2 precisa ser repetido em outro ambiente.

## 9. Limites desta verificação

- Dados lidos de um único projeto hospedado de pequeno volume; ausência de papéis de sistema por org aqui não prova ausência em produção real.
- `max_rows` efetivo não determinado de forma conclusiva.
- Nada foi executado em runtime (servidor, testes, navegador); o fake de Supabase foi lido, não executado.
- RE-09 e o conserto do webhook são análises de código (hipótese forte), sem reprodução.

## Decisões do stakeholder (2026-11-13)

| # | Decisão | Escolha | Consequência no plano |
|---|---|---|---|
| D-1 | Papéis de sistema | **Globais** (organization_id nulo, somente leitura) | Filtro `organization_id.is.null` (Fase 1). Webhook Stripe e edge function usam o admin global e deixam de criar admin por organização (Fase 2). Migration só se o diagnóstico achar admin por organização. |
| D-2 | Payload de `GET /api/roles` (RE-02) | **Reduzido** | Sem `roles.read`: apenas `id`, `name`, `display_name`, `is_system_role`. Com `roles.read`: lista completa com contagens e sem colunas de auditoria. Atualizar D14 e o route map (Fase 3). |
| D-3 | Contagem de usuários e bloqueio de exclusão | **Só usuários ativos e não excluídos** | Contagem e 409 do DELETE filtram `deleted_at` e inativos. Tratar o caso de usuário reativado depois sem papel (Fase 4). |
| D-4 | Atribuição do papel admin (RE-04) | **Só admin atribui admin; sem autoatribuição** | Comportamento novo na Fase 6: validar no servidor, impedir mudar o próprio papel e garantir que sempre reste ao menos um admin. |
| D-5 | Isolamento (RE-08) | **Service role com filtros testados** | Helper único de filtro por organização e testes de isolamento por tenant (incluindo `.or` real no fake Supabase). Migração para RLS fica fora de escopo. |
| D-6 | Ambiente do `.env` | **Produção** | Só leitura agregada. Qualquer migration (Fase 2) exige backup, janela combinada e rollback testado; o diagnóstico em produção só roda com aprovação explícita. |

Todas as decisões de D-1 a D-6 estão respondidas; nenhuma fase está mais bloqueada por decisão de produto.

## Status de implementação (verificado em 2026-11-13)

Evidência: leitura do código no working tree (alterações staged, sem commit) e execução de `pnpm vitest run --project fast tests/fast/roles tests/fast/lib` (9 arquivos, 96 testes passaram). Relato detalhado em `docs/engineering/roles-endpoint-remediation-phase1-5-report.md`. Legenda: feito / parcial / pendente / bloqueado.

### Por achado

| ID | Status | Evidência |
|---|---|---|
| RE-01 | **Feito** (rotas); origem do problema pendente (Fase 2) | `server/utils/role-scope.ts:9-14` (`organization_id.eq.<org>,organization_id.is.null`); usado em `server/api/roles/index.get.ts:31`, `[id].get.ts:19`, `[id]/actions.get.ts:20`. Testes `tests/fast/roles/tenant-isolation.test.ts`. O relatório informa mutação (filtro antigo faz 4 testes falharem): **não reexecutada nesta verificação**. |
| RE-02 | **Pendente** (Fase 3) | `index.get.ts:32` ainda usa `select('*')` e devolve contagens a qualquer membro. D14 inalterado. |
| RE-03 / RE-06 | **Pendente** (Fase 4) | `fetchAllPages` em `index.get.ts:11-23` ainda para na página < 1000; sem `count: 'exact'` nem chunking. `max_rows` do projeto hospedado: tarefa manual, não confirmada. |
| RE-04 | **Pendente** (Fase 6; decisão D-4 tomada) | Sem alteração em `server/utils/user-role.ts`. |
| RE-05 | **Pendente** (Fase 4) | `index.get.ts` não filtra `deleted_at` em `actions`/`role_actions`/`user_profiles`; `[id].delete.ts:25-31` e `[id].get.ts` sem critério D-3. |
| RE-07 | **Pendente** (Fase 3) | `statusMessage: error.message` permanece em `index.get.ts:18,39`, `[id].get.ts:30-76`, `[id].delete.ts:41`; sem `server/utils/safe-error.ts`; sem validação de UUID. |
| RE-08 | **Parcial** | Helper único (`role-scope.ts`) e testes de isolamento das 3 rotas de leitura feitos; `or()` real no fake (`tests/support/fake-supabase.ts`). Faltam testes de isolamento para as rotas de escrita de `roles/**` e o ADR curto em `docs/architecture/`. |
| RE-09 | **Pendente** (Fase 2) | `server/utils/employee-access.ts:28` e `server/api/employees/[id]/grant-access.post.ts:65` ainda filtram `is_system_role` por org. |

### Por fase

| Fase | Status | Evidência / observação |
|---|---|---|
| 0 | **Parcial** | B1 resolvido (imports de `RolePermissionsAccordion` em `[id].vue:2` e de `RoleRowActions` em `index.vue:3`). Pendentes e dependentes de ação humana/aprovação: `max_rows` no dashboard e diagnóstico da seção 2 em produção (D-6 exige aprovação explícita). |
| 1 | **Feito**, com ressalva | Helper + 3 rotas + `tenant-isolation.test.ts` + `or()` do fake. Relatório informa suíte `fast` inteira verde (2206 passaram) após o fake `or()`; nesta verificação só o subconjunto roles/lib foi reexecutado. `tests/db/roles-scope.test.ts` escrito e **não executado** (requer Supabase local). Revisão independente (`code-reviewer`, `security-analyst`) **não realizada**. |
| 2 | **Pendente** | `server/api/stripe/webhook.post.ts:222-240` e `supabase/functions/stripe-webhook/index.ts:445-452` ainda criam admin por organização. Agravante: com a Fase 1, cópias por org deixam de aparecer inclusive para a própria org. |
| 3 | **Pendente** | RE-02, RE-07, D14 e route map. |
| 4 | **Pendente** | RE-03/06, RE-05, m7. |
| 5 | **Feito** (sem validação em navegador) | m2/m3: `RolePermissionsAccordion.vue:143-144,177` (`aria-controls` só com painel aberto e id via `permissionPanelId`; `aria-disabled` na busca). m1: `[id].vue:265-279` (`leaveResolver` anterior resolvido com `false`). |
| 6 | **Pendente** | Decisão D-4 tomada; sem implementação. |

### Ressalvas do code review

| Item | Status | Evidência |
|---|---|---|
| m1 | Feito | `app/pages/app/settings/roles/[id].vue:268-273` |
| m2 | Feito | `RolePermissionsAccordion.vue:143,177` |
| m3 | Feito (parcial na UX: botão segue clicável, só `aria-disabled` + tooltip, conforme relatório) | `RolePermissionsAccordion.vue:144` |
| m7 | Pendente | `server/utils/license.ts` sem alteração (fora do git status) |
| B1 | Resolvido | imports presentes (ver Fase 0) |

### Critérios de aceitação globais (seção 7)

| # | Status |
|---|---|
| 1 | Atendido para as 3 rotas de leitura (teste de isolamento passa; falha com filtro antigo segundo o relatório, não reexecutado) |
| 2 | Não atendido (Fase 3) |
| 3 | Não atendido (Fase 4) |
| 4 | Não atendido (Fase 3) |
| 5 | Não atendido (Fase 2) |
| 6 | Atendido (código); sem validação em navegador/leitor de tela |
| 7 | Não atendido: `pnpm test` completo, `pnpm lint` e `pnpm typecheck` não reexecutados aqui (relatório cita typecheck/eslint, rodada final de typecheck sem resultado registrado); sem code review independente; route map e D14 não atualizados (dependem da Fase 3) |

### Itens extras (fora do plano original, feitos junto)

Descrições por permissão (`app/constants/action-descriptions.ts`, `tests/fast/lib/action-descriptions.test.ts`), remoção do card "Total de ações" e lista de papéis em cards (`app/pages/app/settings/roles/*`, `RoleRowActions.vue`). Sem validação visual em navegador.
