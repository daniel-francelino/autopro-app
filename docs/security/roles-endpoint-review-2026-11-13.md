# Revisão de segurança: `GET /api/roles` (contagens por papel) e handlers de `server/api/roles/**`

- Data: 2026-11-13
- Tipo: revisão defensiva, somente leitura (sem alterar código, sem testes destrutivos, sem subir servidor, sem acesso a dados de produção)
- Escopo: mudança em staging (`git diff --cached`) em `server/api/roles/index.get.ts` e `server/utils/role-counts.ts`; comparação com `server/api/roles/[id].get.ts`, `[id].put.ts`, `[id].delete.ts`, `index.post.ts`, `[id]/actions.get.ts`, `[id]/actions.post.ts`; autorização de papéis em `server/api/users/update-fields.post.ts` -> `server/utils/user-role.ts`.
- Referências: `docs/engineering/access-control-rollout-plan.md` (R4, D14), `docs/security/access-control-route-map.md` (linhas 69-81, V15), `docs/architecture/permissions-layout-implementation-plan.md` (R9).

## Resumo

| ID | Severidade | Título | Origem |
|----|-----------|--------|--------|
| RE-01 | Alta | Filtro `is_system_role.eq.true` devolve papéis "de sistema" de **outras organizações** (vazamento entre tenants) | Pré-existente; ampliado pela mudança (contagens e mais consultas) |
| RE-02 | Média | `GET /api/roles` sem `requireOrgPermission` devolve `select('*')` + contagens a qualquer membro ativo da org, além do que D14/R4 autorizou ("lista de nomes") | Pré-existente (auth); a mudança aumenta a superfície |
| RE-03 | Média | Amplificação de custo/disponibilidade: `in('role_id', roleIds)` cresce com o número de tenants (consequência de RE-01) | Introduzido pela mudança |
| RE-04 | Média (regra de negócio a confirmar) | Quem tem `roles.manage_members` pode atribuir a si mesmo o papel `admin` de sistema (bypass total) | Pré-existente, fora da mudança |
| RE-05 | Baixa | Contagens ignoram soft delete (`actions`, `role_actions`, `user_profiles`) | Introduzido (mesmo padrão de `[id].get.ts`) |
| RE-06 | Baixa | Paginação por offset depende de `max_rows` = 1000 e não é atômica | Introduzido |
| RE-07 | Baixa | Mensagens cruas do PostgREST devolvidas ao cliente (`statusMessage: error.message`) | Pré-existente; replicado no novo `fetchAllPages` |
| RE-08 | Informativo | Todas as rotas usam service role; isolamento depende só dos filtros do handler, que divergem da RLS | Pré-existente |

Itens verificados sem achado: contagem de usuários filtrada por `organization_id` do chamador; `organizationId` vem do banco (não do cliente); `update-fields` não aceita org/e-mail/funcionário do corpo e valida mesma org do alvo e do papel.

---

## Findings

### RE-01 (Alta) - Papéis de sistema de outras organizações vazam na listagem

**Evidência (verificada no código):**

- `server/api/roles/index.get.ts:30-35`: `select('*')` em `roles` com `.or(\`organization_id.eq.${organizationId},is_system_role.eq.true\`)`. O segundo ramo **não restringe organização**.
- Papéis de sistema são criados **por organização**, com `organization_id` preenchido e `is_system_role: true`:
  - `server/api/stripe/webhook.post.ts:232-240` (insere `organization_id: organizationId, name: 'admin', is_system_role: true`).
  - `supabase/functions/stripe-webhook/index.ts:445-452` (fallback que cria admin "org-scoped" com `is_system_role: true`).
  - `server/utils/employee-access.ts:25-28` e `server/api/employees/[id]/grant-access.post.ts:62-65` buscam um papel `employee` com `organization_id = org` **e** `is_system_role = true`, indicando que também existem papéis de sistema por org (local de criação não localizado; hipótese).
- A RLS de `roles` usa `organization_id IS NULL` como critério de papel global, não `is_system_role` (`supabase/migrations/20240101000058_allow_null_organization_id_in_roles.sql`, policy `roles_select_same_org`). O handler usa service role (`index.get.ts:25`), então a RLS não protege e o filtro do handler diverge dela.
- `server/utils/user-role.ts:38` já aplica a regra correta (`organization_id !== null && organization_id !== organizationId` => 404), confirmando a intenção do projeto.

**Impacto:** qualquer usuário autenticado e ativo de qualquer oficina recebe, para cada outra oficina com papel de sistema próprio:

- `id`, `organization_id` (enumeração dos UUIDs de todos os tenants), `name`, `display_name`, `description`, `created_at/updated_at/deleted_*`;
- `created_by` / `updated_by` (`[id].put.ts` grava `updated_by: authUser.email` e permite editar o papel de sistema da própria org, logo o **e-mail do admin de outra oficina** pode aparecer; condicional aos dados);
- **novo nesta mudança:** `granted_actions_count` desses papéis (quantidade de permissões configuradas em outra org). `assigned_users_count` vem 0 para eles porque a consulta de usuários é filtrada pela org do chamador (`index.get.ts:59-67`), o que não vaza contagem de usuários, mas exibe linhas "Administrador" duplicadas na UI.

O mesmo filtro aparece em `server/api/roles/[id].get.ts:22` e `server/api/roles/[id]/actions.get.ts:23`: com `roles.read`, é possível ler o `role` e **todas as `role_actions`** de um papel de sistema de outra org a partir do id obtido na listagem (`[id].get.ts:38-41`, `[id]/actions.get.ts:41-44`). Usuários atribuídos continuam filtrados por org (`[id].get.ts:45`). Escrita está protegida: `[id].put.ts`, `[id].delete.ts`, `[id]/actions.post.ts:18-24` usam `.eq('organization_id', organizationId)`; atribuição está protegida por `user-role.ts:38`.

**Não verificado:** existência real de papéis de sistema com `organization_id` preenchido no banco de produção (sem acesso a dados). O caminho de código que os cria está confirmado.

**Recomendação (não implementada):** trocar o filtro nas três rotas por `organization_id.eq.<org>,organization_id.is.null` (mesma regra da RLS e de `user-role.ts:38`), e projetar colunas explícitas em vez de `select('*')`. Adicionar teste de isolamento: org A não vê papel de sistema de org B.

### RE-02 (Média) - Listagem sem `requireOrgPermission` e exposição além de "lista de nomes"

**Evidência:**

- `server/api/roles/index.get.ts:24-27`: só `requireAuthUser` + `resolveOrganizationId`. Todos os demais handlers de roles exigem permissão: `[id].get.ts:9` (`roles.read`), `[id]/actions.get.ts:9` (`roles.read`), `index.post.ts:8` (`roles.create`), `[id].put.ts:8` (`roles.update`), `[id].delete.ts:8` (`roles.delete`), `[id]/actions.post.ts:9` (`roles.manage_permissions`).
- A ausência é uma **decisão registrada**: `docs/engineering/access-control-rollout-plan.md:88` (D14) "`GET /api/roles` (lista de nomes) só organização (R4)", motivada por V15 (`docs/security/access-control-route-map.md:69,81`): `app/pages/app/settings/employees/index.vue:83` consome a lista sob `employees.read`, e exigir `roles.read` quebraria o modal de funcionários.
- `resolveOrganizationId` (`server/utils/organization.ts:17-69`) barra usuário inativo, oficina suspensa e funcionário desligado, então o acesso é "qualquer membro ativo da org" (incluindo papéis sem nenhuma permissão, ex.: funcionário operacional). Usuários de outras orgs só alcançam os dados de RE-01.

**Impacto real:** a decisão D14 cobre "lista de nomes", mas o endpoint devolve `select('*')` (descrição, colunas de auditoria com e-mails de quem criou/alterou papéis) e, agora, `assigned_users_count` e `granted_actions_count`. Um membro sem `roles.read` passa a saber quantos usuários são administradores e o tamanho de cada conjunto de permissões, informação útil para engenharia social e reconhecimento interno. Não expõe identidade de usuários nem quais permissões cada papel tem. Impacto intra-tenant, baixo a moderado.

**Recomendação (não implementada), em ordem de preferência:**

1. Manter R4 para a lista, mas projetar só `id, name, display_name, is_system_role` (o que `employees/index.vue:70-75` usa) para quem não tem `roles.read`; incluir `description`, auditoria e contagens apenas quando o chamador tiver `roles.read` (checagem não lançadora, ou endpoint/flag separado para a tela de papéis).
2. Alternativa: exigir `roles.read` OU `employees.read` (any-of), registrando a exceção no route map.
3. Atualizar D14/route map para refletir o contrato novo, qualquer que seja a escolha.

### RE-03 (Média) - Amplificação de consultas proporcional ao número de tenants

**Evidência:** `index.get.ts:40` monta `roleIds` a partir da lista (que, por RE-01, inclui papéis de sistema de todas as orgs). Esses ids vão em `in('role_id', roleIds)` na URL do PostgREST (`index.get.ts:54`, `:64`) e `role_actions` de todos eles é carregado (`index.get.ts:50-58`) via service role, a cada abertura da tela de papéis e do modal de funcionários.

**Impacto:** custo e latência crescem com o número de clientes; com muitos tenants, a URL pode exceder limites (erro 414/400) e a rota inteira falha com 500, quebrando também `employees/index.vue` (que engole o erro silenciosamente, `:86`). Disponibilidade e custo, sem vazamento adicional na resposta além de RE-01.

**Recomendação:** corrigir RE-01 resolve a maior parte. Para robustez, preferir agregação no banco (RPC/view com `count` por `role_id`, filtrada por org) em vez de trazer linhas para contar em memória.

### RE-04 (Média, regra de negócio a confirmar) - Autopromoção a admin via `roles.manage_members`

**Evidência:** `server/api/users/update-fields.post.ts:11-27` -> `server/utils/user-role.ts:12-45`. Verifica `roles.manage_members` (`:13`), mesma org do alvo (`:27`) e papel da org ou global (`:38`). Não impede `targetProfileId` = próprio chamador nem atribuição do papel `admin` de sistema. `server/utils/require-org-permission.ts:105-106` concede bypass total a `name === 'admin' && is_system_role`.

**Impacto:** um usuário com `roles.manage_members` (sem ser admin) pode se tornar admin, ganhando todas as permissões. Pode ser intencional (quem gerencia membros é de confiança); não há regra documentada encontrada que confirme ou negue.

**Recomendação:** decisão do PO. Se não for intencional: bloquear autoatribuição e/ou exigir que só admin/owner atribua o papel admin de sistema. Registrar a decisão no route map.

### RE-05 (Baixa, integridade) - Contagens ignoram soft delete

**Evidência:** `index.get.ts:48` (`actions` sem `.is('deleted_at', null)`), `:50-58` (`role_actions` sem filtro de `deleted_at`; coluna existe em `supabase/migrations/20240101000004_create_role_actions.sql:46`), `:60-67` (`user_profiles` sem filtro de `deleted_at`; coluna em `20240101000037_create_user_profiles.sql:48`). `require-org-permission.ts:113` desconsidera ações excluídas, então `granted_actions_count` pode superestimar as permissões efetivas. `assigned_users_count` inclui inativos, coerente com `[id].get.ts:44-47` e com o 409 de `[id].delete.ts:25-31` (que também não filtra `deleted_at`).

**Recomendação:** alinhar com a regra efetiva de autorização (filtrar `actions.deleted_at IS NULL`); decidir com o `data-integrity-auditor` se usuários excluídos/inativos entram na contagem, e aplicar igual em `[id].get.ts` e `[id].delete.ts`.

### RE-06 (Baixa, integridade) - Paginação por offset

**Evidência:** `index.get.ts:7-21`. O loop para quando uma página volta com menos de `PAGE_SIZE` (1000). `supabase/config.toml:18` define `max_rows = 1000` (ambiente local). Se o projeto hospedado tiver `max_rows` menor (configuração de dashboard, **não verificada**), a primeira página vem curta e o loop encerra cedo, **truncando contagens sem erro**. As páginas não formam snapshot: inserções/remoções concorrentes podem pular ou duplicar linhas; `role_actions` é deduplicado (`role-counts.ts:23-28`), `user_profiles` não.

**Recomendação:** usar contagem agregada no banco (ver RE-03) ou `count: 'exact'` e iterar até atingir o total. Confirmar `max_rows` no projeto hospedado.

### RE-07 (Baixa) - Vazamento de mensagens internas

**Evidência:** `index.get.ts:17` e `:38` devolvem `error.message` do PostgREST no `statusMessage`; mesmo padrão em `[id].get.ts:27,52,55,58`, `index.post.ts` (após insert), `[id].put.ts`, `[id].delete.ts`, `[id]/actions.get.ts:38,47`. Expõe nomes de tabela/coluna/constraint e, em `[id]` com id não-UUID, o erro de cast do Postgres. Contraste: `organization.ts:27` usa mensagem genérica.

**Recomendação:** mensagem genérica ao cliente e log do detalhe no servidor; validar `id` como UUID antes da consulta (400).

### RE-08 (Informativo) - Service role em todas as rotas de papéis

**Evidência:** `getSupabaseAdminClient()` em `index.get.ts:25` e em todos os handlers de `server/api/roles/**`. A RLS de `roles`/`role_actions`/`user_profiles` não se aplica; o isolamento depende só dos filtros escritos à mão, e RE-01 é exatamente uma divergência entre handler e RLS.

**Recomendação:** para leituras, considerar cliente com JWT do usuário (RLS ativa) ou, no mínimo, testes de isolamento por tenant para cada rota de papéis.

---

## Pontos verificados sem achado

- **Contagem de usuários isolada por tenant:** `index.get.ts:62-64` filtra `user_profiles.organization_id = organizationId`; `computeRoleCounts` só conta `role_id` presentes em `roleIds` (`role-counts.ts:31-34`).
- **Origem do tenant:** `organizationId` vem de `user_profiles` pelo `user_id` autenticado (`organization.ts:20-24`), não do cliente; a interpolação em `.or()` usa valor do banco (sem injeção de filtro a partir de entrada).
- **Entrada:** `GET /api/roles` não lê body/query/params.
- **Escrita em papéis:** `[id].put.ts`, `[id].delete.ts`, `[id]/actions.post.ts` restringem a `organization_id` do chamador; `index.post.ts` força `is_system_role: false`.
- **`update-fields`:** ignora `organization_id`, `employee_id`, `email` do corpo (`update-fields.post.ts:15`); valida tipo de `role_id` (`:23`), mesma org do alvo (`user-role.ts:27`) e papel da org ou global (`user-role.ts:38`), rejeitando papéis de sistema de outra org.
- **Filtro por plano:** contagem de permissões usa `filterActionsByPlan` com o plano da org do chamador (`index.get.ts:70-72`), mesma regra de `[id].get.ts:83`.

## O que não foi verificado

- Dados reais: existência e quantidade de papéis de sistema com `organization_id` preenchido, conteúdo de `created_by/updated_by` em produção.
- `max_rows` e limites de URL do projeto Supabase hospedado.
- Comportamento em execução (servidor não iniciado; nenhuma requisição feita); testes não executados.
- Local de criação dos papéis `employee` de sistema por org.
- Se `roles.manage_members` deve permitir atribuir o papel admin (RE-04) - regra de negócio não documentada.
- Desempenho real das 3 consultas extras.
