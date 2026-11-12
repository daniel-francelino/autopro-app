# Auditoria de chaves, permissões e rotas da API (2026-11-12)

Status: **análise somente leitura**. Nenhum código, migração ou baseline foi alterado.
Escopo: catálogo de actions (`app/constants/action-codes.ts`), migrações de seed, guards em `server/api/**` (265 handlers), testes estáticos de ratchet.
Restrição: o sistema **já está em produção**. Toda recomendação abaixo é compatível (aditiva) ou marcada como **alto risco**, com plano de rollback.

Documentos relacionados: [Plano do painel do owner](../admin/owner-panel-plan.md) (fase 0 de segurança da API), [known-failures](../testing/known-failures.md) (KF-09, KF-R2, KF-07).

---

## 1. Como o controle funciona hoje (verificado)

- **Autenticação:** `requireAuthUser` e `resolveOrganizationId` (`server/utils/organization.ts`). Recusa usuário inativo, oficina suspensa e funcionário desligado. Não verifica papel.
- **Action:** `requireOrgPermission(userId, code, event)` (`server/utils/require-org-permission.ts:42-135`), nesta ordem:
  1. Gate de plano (`ACTION_PLAN_REQUIREMENTS`, linhas 9-22).
  2. `is_owner` e a role de sistema `admin` passam **sem consultar** `role_actions` (linhas 87-104).
  3. Demais roles: a action precisa existir em `actions` e ter `role_actions.is_granted`. Código inexistente no catálogo responde 403 "Permissão não reconhecida" (linhas 106-114).
- **Owner da plataforma:** `requireOwner` por handler e `server/middleware/owner-guard.ts:8-11` cobrindo `/api/admin/**`. Os 42 handlers admin têm o guard.
- **Ratchets:** `tests/static/codebase.test.ts` impede aumento de `unguarded-routes.json` (hoje vazio) e de `write-routes-without-permission.json` (KF-09).
- **Tenant:** o cliente é service-role, então a RLS não se aplica nas rotas. O isolamento depende de `.eq('organization_id', ...)` em cada handler.
- **Front:** telas são gateadas com `ActionCode` (`useWorkshopPermissions`, `workshop-permission.ts`). O servidor não repete essas checagens na maioria dos casos.

---

## 2. Inconsistências de catálogo e permissões (product owner)

| ID | Sev. | Evidência | Impacto | Ação sugerida |
|---|---|---|---|---|
| PO-01 | Crítica | `supabase/migrations/20240101000003_create_actions.sql`; `supabase/seeders/demo/README.md:39` (23 actions); `demo.meta.json:12` (103) | ~76 códigos do enum sem seed em nenhuma migração. Ambiente novo ou restauração não reproduz o catálogo. Hipótese: foram inseridos manualmente em produção. | Confirmar `public.actions` em produção (leitura). Seed aditivo `ON CONFLICT (code) DO NOTHING`. |
| PO-02 | Crítica | `docs/testing/known-failures.md:54` (KF-09); `docs/admin/owner-panel-plan.md:97`; `tests/fast/taxes/handlers.test.ts:373`; `tests/fast/purchases/handlers.test.ts:454` | Maioria das escritas sem guard (bank-accounts, payment-terminals, taxes, purchases). Números divergem entre docs (109 e 131). | Priorizar `requireOrgPermission` nas rotas de dinheiro. Exige comunicação e período de validação. |
| PO-03 | Alta | `server/utils/financial-transaction-deletion.ts:9-18`; `server/utils/audit/config.ts:74-76` | `financial.manual_delete`, `service_orders.*`, `financial.pay_bulk` etc. não estão no enum nem em migração. Se usados como guard: 403 para não-admins. Se só auditoria: exclusões sem controle. **Hipótese a confirmar.** | Cadastrar os códigos efetivamente usados como guard. Não renomear existentes. |
| PO-04 | Média | `app/constants/action-codes.ts` (`ORDERS_*`); `service_orders.*`; `service_order.*` | Três prefixos para o mesmo domínio. | **Alto risco** se renomeado (está em `role_actions`). Manter e documentar mapa canônico. |
| PO-05 | Média | `server/utils/require-org-permission.ts:24`; migração `20240101000100` | `fiscal.manage` existe no servidor e no seed, mas não no enum. Front não consegue checar. | Incluir `FISCAL_MANAGE` no enum. Baixo risco. |
| PO-06 | Média | `app/composables/usePlans.ts:57-60`; `server/utils/license.ts:18` | Gate de plano para `product_invoice` sem código no catálogo e sem uso. | Pergunta de negócio (Q4). |
| PO-07 | Média | `app/pages/app/financial/accounts.vue:48` | `bank_accounts.update` existe no banco (corrigido na seção 9), mas não está em migração; servidor não checa. | Seed + guard (junto com PO-02). |
| PO-08 | Alta | `docs/testing/known-failures.md:39,46` (KF-R2); `server/utils/audit/config.ts:71-72` | Escalada de privilégio: quem gerencia membros pode conceder permissões a si mesmo. | Exigir `roles.manage_permissions` para alterar `role_actions`; impedir auto-concessão. Mudança de comportamento: comunicar antes. |
| PO-09 | Média | `tests/fast/access/financial-permissions.test.ts` (`it.fails`, KF-09) | Testes de permissão não exercitam o guard real; passam mesmo com a falha. | Corrigir o teste antes de declarar cobertura. |
| PO-10 | Média | `server/utils/require-owner.ts:12`; `server/api/admin/audit-logs/[id].get.ts:11` | "Somente org" não é conceito do catálogo. Rotas de plataforma usam `requireOwner`. Interpretação de "somente org" é hipótese. | Pergunta Q1. Documentar quais códigos são só de plataforma. |
| PO-11 | Média | `server/utils/employee-access.ts:27`; `server/api/employees/[id]/grant-access.post.ts:62`; `server/api/stripe/webhook.post.ts:226-236` | Role de sistema `employee` referenciada mas não criada em migração nem no webhook. `emp-com` aparece só em testes (commit `f4507a9`). Hipótese: `employee` pode não existir em produção. | Pergunta Q2. Verificar `roles` em produção (leitura). |
| PO-12 | Baixa | `app/constants/action-codes.ts` | 85 códigos do enum sem guard literal no servidor. Falsa sensação de controle. | Documentar cobertura servidor/UI por código. |
| PO-13 | Baixa | `supabase/migrations/20240101000104_seed_missing_action_codes.sql:4-6,17-19` | Roles personalizadas existentes não recebem as novas permissões. Decisão de produto. | Pergunta Q3. Não conceder em lote sem decisão. |

---

## 3. Auditoria de rotas (software architect)

### 3.1 Classificação

- **(a)** pública intencional; **(b)** autenticada sem action; **(c)** exige action; **(d)** isolamento de tenant: a consulta e a escrita devem filtrar por `organization_id` da sessão, para que uma org (ou um usuário sem org) nunca acesse dados de outra. Isolamento não depende de papel nem de action.

Públicas e owner (sem lacuna):
- `auth/*`, `metrics/track`, `stripe/webhook` (valida assinatura), `supabase/health` → (a). Allowlist em `codebase.test.ts:20-31`.
- `GET /llms.txt` → (a) hipótese de conteúdo público; não foi aberto.
- 42 rotas `/api/admin/**` → (c) owner da plataforma, com guard duplicado de propósito.

Autoescopo (org-only/self, sem action é adequado): `auth/profile`, `auth/password`, `auth/avatar`, `auth/account` (DELETE), `profile`, `settings/*`, `notifications/*`, `feedback/*`. Ponto a validar: quem pode excluir conta de dono de org (Q8).

Já corretas (c): `bonuses/**`, `commissions/**`, `product-categories/**`, `roles` POST/PUT/DELETE, `roles/:id/actions` POST, `fiscal/nfse/**`, `fiscal/company/sync`, `users/update-role`, subrotas de `employees/:id` com permissão.

### 3.2 Rotas de org sem action (mutam ou expõem dados)

| Rota (guard em) | Lacuna | Action sugerida | Org-only | Compat |
|---|---|---|---|---|
| `bank-accounts` GET/POST/PUT/DELETE (`:6-7`) | Expõe saldos; PUT altera `current_balance` e `initial_balance` | `bank_accounts.read/create/update/delete` (`update` não semeada) | Não | **R** |
| `payment-terminals` GET/POST/PUT/DELETE (`:6`) | Altera taxas sem permissão | `payment_machines.view` / `.update` (não semeadas) | Não | **R** |
| `taxes` GET/POST/PUT/DELETE (`:6`) | Sem permissão | `taxes.view` / `.update` (não semeadas) | Não | **R** |
| `financial/*` (`:11-129`) | Muta e expõe financeiro (pagar, estornar, excluir, lote, recorrência) | `financial.read/create/update/delete` (não semeadas) | Não | **R** |
| `financial/export` (`:66`) | Exporta dado financeiro | `reports.financial` (não semeada) | Não | **R** |
| `service-orders/*` (`:6-48`) | Maior superfície: cancelar, excluir, estornar, receber, parcelas, comissões | `orders.*` (`finish` semeada; demais não). Recebimento: Q4 | Não | **R** |
| `reports/commissions/[id]/pay` (`:31`), DELETE `reports/commissions/[id]` (`:12`) | Paga e apaga comissão | `commissions.update` / `commissions.delete` | Não | **R** |
| `reports/*` GET/POST e `export-*` | Dado financeiro e pessoal. Gate de plano existe via `enforceReportAccess`; gate de role não | `reports.*` (não semeadas) | Não | **R** |
| `employees` GET/POST, `:id` PUT/DELETE, `:id/commissions`, `:id/export-commissions` | Dado pessoal e folha | `employees.read/create/update/delete` | Não | **R** |
| **`employees/:id/grant-access` (`:17`)** | **Cria usuário e vincula role sem permissão. Escalada de privilégio (L2)** | `members.invite` ou `roles.manage_members` (Q3) | Não | **R** |
| `users/list-organization` (`:11`), `employee-auth-status` (`:12`) | Lista usuários e e-mails da org | `members.view` (não semeada) | Não | **R** |
| `purchases/*`, `purchase-returns/*`, `purchase-requests` (`:6-11`) | Sem permissão (KF-09, G2-SD-06) | `purchases.*`, `returns.*` (`purchases.authorize` semeada) | Não | **R** |
| `purchase-requests/:id/authorize` e `reject` (`:11`) | Qualquer usuário autoriza ou rejeita | `purchases.authorize` (Q6) | Não | **R** |
| `clients*`, `vehicles*`, `appointments*`, `suppliers*`, `products*`, `parts*`, `master-products*` | Dado pessoal (CPF/CNPJ, telefone) e escrita sem action. Front já gateia com `*_READ` | `customers.*`, `vehicles.*`, `appointments.*`, `suppliers.*`, `products.*` (`parts`/`master-products`: Q7) | Não | **R** |
| `vehicles/lookup-plate` (`:44`) | Consulta externa com custo; sem login antes (KF-07, corrigido) | `vehicles.read` | Sim (sugestão) | C |
| `organizations` PUT (`:6`), `organizations/logo` POST (`:6`) | Qualquer membro altera razão social, CNPJ e logo | `organization.update` (não semeada) | Não | **R** |
| `organizations` GET, `complete-onboarding` (`:28`) | Dados da própria org | n/a | **Sim** | C |
| `billing/cancel` (`:13`), `billing/checkout` (`:16`), `billing/portal` (`:7`), `stripe/cancel-subscription` (`:13`), `stripe/checkout` (`:15`) | **Qualquer membro cancela a assinatura da org** (L1) | `subscription.manage` (já existe no banco; seção 9) | Não | **R** |
| `billing/status` (`:26`), `billing/invoices` (`:27`) | Expõe cobrança | `subscription.view` (não semeada) | Não | **R** |
| `fiscal/*` consultas externas | Consomem cota de API fiscal | `fiscal.manage` opcional em `sync-status`; lookups org-only | Sim (lookups) | C |
| `roles` GET, `roles/:id`, `roles/:id/actions` GET (`:6-7`) | Leitura de papéis da própria org | `roles.view` (semeada) | Não | **R** |
| `users/initial-data` (`:12`) | Dados do próprio usuário | n/a | **Sim** | C |

### 3.3 Tenant

- Verificado por amostragem: o `find` da entidade principal filtra `organization_id` na maioria dos handlers.
- **Padrão frágil:** UPDATE/DELETE filtram só por `id` em `clients/[id].delete.ts`, `bank-accounts/[id].put.ts:51`, `bank-accounts/[id].delete.ts:26`, `payment-terminals/[id].put.ts:40`, `parts/[id].put.ts:52`, `products/[id].put.ts:52`. Hoje o `find` impede acesso cruzado; se o `find` for removido, o filtro some. Adicionar `.eq('organization_id', organizationId)` é compatível e de risco nulo (L8).
- `employee-auth-status`: leitura de `user_profiles` por `employee_id` sem filtro de org (`:34-38`). Baixo risco; hipótese de não explorável.
- RLS no banco não foi verificada. Revisão de tenant foi por amostragem, não completa.

---

## 4. Lacunas priorizadas

| # | Sev. | Lacuna |
|---|---|---|
| L1 | P0 | Qualquer membro cancela, faz checkout ou abre o portal da assinatura |
| L2 | P0 | `grant-access` cria acesso e role sem permissão |
| L3 | P0 | Financeiro inteiro sem action (pagamento, estorno, exclusão, saldo) |
| L4 | P0 | Contas bancárias e maquininhas editáveis por qualquer membro |
| L5 | P1 | Dados pessoais e exportações sem action |
| L6 | P1 | `authorize` e `reject` de compra sem permissão própria |
| L7 | P1 | ~75 códigos usados no front não semeados. Enforcement novo daria 403 "Permissão não reconhecida" a roles não-admin |
| L8 | P1 | Isolamento de tenant: UPDATE/DELETE filtram só por `id` em alguns handlers, e a revisão de tenant foi por amostragem, não completa. Como o objetivo declarado é isolamento, este item sobe de prioridade. |
| L9 | P2 | `organizations` PUT e logo sem `organization.update` |
| L10 | P2 | `roles` GET sem `roles.view` |

---

## 5. Perguntas de decisão de negócio

Consolidadas dos dois relatórios (numeração do architect e do product owner se sobrepõem). **As respostas verificadas para as perguntas 4 a 17 estão na seção 8.3.** Aqui ficam as perguntas; o que falta é só a decisão de negócio indicada em cada uma.

1. **Resolvida pelo negócio:** "org-only" é isolamento de tenant, não restrição por papel. Objetivo: nenhuma organização, nem usuário sem organização, acessa dados de outra. Não cria action nova; exige que toda consulta e escrita filtre por `organization_id`. (Q1 arq.)

2. **Decidida:** cancelar, assinar e abrir o portal de cobrança passam a exigir `subscription.manage`. Criar essa action é uma decisão de produto tomada. Requisitos:
   - `subscription.manage` **já existe no banco** (leitura de produção, 2026-11-12), então não precisa ser criada. Hoje só a role de sistema `admin` tem `subscription.manage` e `subscription.view`, ambas concedidas. O admin também passa pelo `requireOrgPermission` sem consultar `role_actions`.
   - Quem já tem permissão de cobrança hoje mantém o acesso. Pelo banco, esse conjunto é só a role `admin`, então o backfill da onda 1 fica sem linhas a conceder. A interpretação de "já ter permissão" está confirmada pelos dados. Se novas roles forem criadas com cobrança, o backfill deve ser refeito.
   - Membros sem a action perdem cancelar, checkout e portal (L1). `billing/status` e `billing/invoices` ficam como estão, até decisão separada.
   (Q2 arq.)

3. **Recomendada:** `grant-access` exige `members.invite`. (Q3 arq.)
   - Motivo: o endpoint cria um novo acesso para uma pessoa e não escolhe role; atribui sempre a role `employee`. `roles.manage_members` serve para trocar a role de quem já é membro.
   - `members.invite` existe no banco. `roles.manage_members` **não existe no banco**: exigi-la daria 403 "Permissão não reconhecida" para não-admins.
   - Pré-requisitos antes de liberar a permissão: (a) criar a role `employee` por organização, porque hoje existe só como role global e o endpoint responde 422 para todas as organizações; (b) recusar o provisionamento quando o perfil já existente tiver outra role ou for admin da organização, porque o `upsert` em `user_profiles` (`server/utils/user-provisioning.ts:45-46`) sobrescreve `role_id`.
4. Pagar lançamento, baixa em lote e receber parcela exigem `financial.update`, `orders.update`, ou ambas? (Q4 arq.; Q4 PO é o gate de `product_invoice`)
5. Qual action cobre `export-csv` de OS e `financial/export`? (Q5 arq.)
6. `reject` de compra usa `purchases.authorize` ou outra? (Q6 arq.)
7. `parts` e `master-products` ficam sob `products.*` ou `inventory.*`? (Q7 arq.)
8. Quem pode excluir a própria conta quando é dono da org? (Q8 arq.)
9. Listas (GET) exigem action de leitura, ou só escritas? (Q9 arq.)
10. Org suspensa ou assinatura vencida deve bloquear escritas? (Q10 arq.)
11. Quais roles personalizadas existem hoje em produção e quais actions devem manter? Exige consulta ao banco. (Q11 arq.; Q3 PO trata a migração 104)
12. `product_invoice.*` está no roadmap ou é resíduo? (Q4 PO)
- Resíduo
13. Quem pode excluir ou cancelar lançamentos e OS? Há papel que hoje tenha essas chaves em produção? (Q5 PO)
14. Quem pode alterar o papel de outros usuários? Bloquear auto-concessão? (Q6 PO)
15. Manter os três prefixos `orders`/`service_orders`/`service_order` com mapa, ou unificar em projeto futuro? (Q7 PO)
16. Quem pode editar saldo de conta bancária? (Q8 PO)
17. `employee` existe em produção? `emp-com` é papel real ou só de teste? (Q2 PO)

---

## 6. Plano compatível para produção (por ondas)

Cada onda é reversível isoladamente.

| Onda | Compat | Conteúdo |
|---|---|---|
| 0 | C | Seed idempotente de actions faltantes (`INSERT ... ON CONFLICT DO NOTHING`). `bank_accounts.update`, `subscription.manage` e `payment_machines.*` já existem em produção; falta só tê-los em migração (seção 9). Não muda acesso. |
| 1 | C | Backfill em `role_actions` para roles não-admin que já usam cada tela, com `created_by='migration-<ticket>'`. Depende da Q11. Hipótese: `can()` do front espelha o acesso real. |
| 2 | **R** | Adicionar `requireOrgPermission` nas rotas, por domínio. Ordem: L1 e L2, depois L3 e L4, depois o restante. Antes de cada rodada, consultar log de auditoria dos últimos 30 dias para ver quais roles usam cada rota. |
| 3 | C | Filtro de `organization_id` em UPDATE/DELETE (L8). |

**Quem é afetado pela onda 2:** roles não-admin e não-owner. Owner, admin e `/api/admin/**` não são afetados. Integrações que usem usuário de role restrita: hipótese, não encontrada no código.

**Rollback:**
- Código: reverter o commit da onda. O enforcement é uma chamada por handler, sem estado.
- Dados: seeds podem ficar. Backfill se desfaz com `DELETE FROM role_actions WHERE created_by = 'migration-<ticket>'`. Não deletar linhas sem esse marcador.

**Ratchets:** ao corrigir uma rota, `write-routes-without-permission.json` falha até o baseline ser atualizado (`UPDATE_BASELINE=1`). Atualizar no mesmo PR.

**Ordem sugerida:**
1. Confirmar estado real de `public.actions`, `roles` e `role_actions` em produção (leitura).
2. Responder perguntas 1 a 17.
3. Onda 0.
4. Onda 1.
5. Onda 2 (L1, L2, L3, L4 e restante).
6. Onda 3 a qualquer momento.

---

## 7. Evidência verificada x hipótese

**Verificado no código:** mecanismo de guard e bypass de owner/admin; `unguarded-routes.json` vazio; `/api/admin/**` com `requireOwner`; rotas da seção 3.2 sem action (conferidas por linha de guard, com amostra aberta); gate de plano de reports via `enforceReportAccess`; padrão find-com-org/update-por-id; lista de códigos não semeados.

**Hipótese (não verificada):**
- `metrics/track` e `supabase/health` públicos não permitem abuso.
- `llms.txt` não vaza dado de tenant.
- `can()` do front reflete o acesso desejado.
- Exploração real de escalada (PO-08).
- Corrida TOCTOU no padrão find/update (G2-SD-09).

**Verificado em produção (leitura, 2026-11-12):** lista de `actions` (103), roles e concessões, perfis, organizações e assinaturas. Ver seção 8.

**Não coberto:** corpo completo das 265 rotas; RLS no banco; corpo de `changeUserRole`; triggers de cascata em `auth.users`; logs de auditoria dos últimos 30 dias.

---

## 8. Estado de produção (leitura, 2026-11-12)

Consultas somente GET com a chave do `.env`. Nenhuma escrita. E-mails mascarados.

### 8.1 Fatos

- `actions`: 103 códigos. **Faltam no banco** os códigos do enum: `bank_accounts.create`, `bank_accounts.read`, `bank_accounts.delete`, `roles.manage_members`, `roles.manage_permissions`, `roles.view`, `orders.finish`, `purchases.authorize`, `members.remove`, `inventory.adjust`.
- **Existem no banco e não no enum:** `orders.pay`, `employees.pay`, `fiscal.manage`, `members.delete`, `roles.read`, `subscription.manage`, `bank_accounts.view`.
- `bank_accounts.update` e `bank_accounts.view` **existem** no banco. A linha da onda 0 e o item PO-07 que diziam "não semeada" estão errados neste ponto.
- Roles de sistema `admin`, `manager` e `employee` têm `organization_id` nulo (globais). Não existe `employee` por organização, então `grant-access` responde 422.
- Concessões: `admin` 103; `manager` 68; `marcineia` 55; `anderson` 31; `employee` (global) 27. Nenhuma linha negada.
- Roles personalizadas `anderson` e `marcineia` estão na organização `fda7436b…` e **não são equivalentes a admin**: não têm `roles.*`, `members.*`, `subscription.*` nem `organization.update`.
- `subscription.manage` e `subscription.view` são concedidas só à role global `admin`.
- Perfis: 8 no total. 3 com `admin` (um com `is_owner=true` na `fda7436b…`; um sem `is_owner` na `386614c4…`), 1 `anderson`, 1 `marcineia`, 3 sem role e sem organização (um com `is_owner=true`, owner da plataforma). Nenhum perfil usa `manager` ou `employee`.

### 8.2 Organizações e assinaturas

| Organização | `is_active` | Assinatura | Plano | Próximo pagamento | Usuários operando |
|---|---|---|---|---|---|
| `386614c4…` | true | active | pro | 2026-12-04 | sim |
| `fda7436b…` | **false** | active | fiscal | **2026-09-04 (vencido)** | 4 perfis |

**Estado da `fda7436b…`: intencional**, segundo informado pelo responsável pelo produto. Não foi verificado no código o motivo do estado.

Consequência verificada no código: nenhuma rota lê `organizations.is_active`. Só `suspended_at` bloqueia (`server/utils/organization.ts:34-36`). Por isso o estado intencional de `is_active=false` **não bloqueia** nada hoje. Se a intenção for bloquear essa organização, há uma lacuna. Se a intenção for só marcar a organização como inativa para o painel administrativo, o estado atual está correto. Decidir qual dos dois vale.

Ponto a confirmar: o vencimento em 2026-09-04 com assinatura `active` pode ser parte do motivo do estado intencional, ou um dado a ser corrigido. Não tratar como resolvido sem essa confirmação.

### 8.3 Respostas às perguntas 4 a 17

| # | Resposta | Confiança | Pendência de negócio |
|---|---|---|---|
| 4 | Pagar lançamento: `financial.update` (front). Receber parcela de OS: não identificado se é `orders.pay` ou `orders.update`. Servidor sem guard em `pay-entries-bulk`, `financial/[id]/pay` (inferido) e `receive-extra-payment`. | média | Receber parcela de OS: `orders.pay` ou `orders.update`? Precisa de `financial.*` também? |
| 5 | `financial/export` e `service-orders/export-csv` sem guard. Front: `financial.read` para exportar financeiro. `reports.financial` existe no banco. | média | Exportar financeiro: `financial.read` ou `reports.financial`? OS: `orders.read`? |
| 6 | `reject` e `authorize` de compra sem guard. Front usa `authorizations.approve`, que existe no banco e é concedida a admin e manager. `purchases.authorize` não existe no banco. | alta | Recomendação: `authorizations.approve` para aprovar e recusar. `purchases.authorize` vira resíduo? |
| 7 | `parts` segue `inventory.*` (uso no front). `master-products` sem gate próprio; front usa a tela da OS. | média | `master-products`: `products.*` ou `orders.*`? |
| 8 | `auth/account.delete` não verifica dono, não cancela Stripe e não trata o perfil. Hipótese: sem cascata, perfil e organização ficam órfãos. | alta (código); média (dados) | Dono com outros membros: bloquear ou transferir? Cancelar assinatura ao excluir? Excluir perfil também? |
| 9 | Contagem exata não calculada. Front gateia telas com `*_READ`; servidor não repete. Faltam no banco `bank_accounts.read` (existe `.view`) e `roles.view` (existe `.read`). | média | Exigir leitura no servidor? Ajustar enum ou seed antes. |
| 10 | Código bloqueia só `suspended_at`. Assinatura vencida só afeta gates de plano (`license.ts:45-64`). Nenhum middleware bloqueia escrita por assinatura. | alta | Bloquear escritas? Só leitura? Qual `status` bloqueia? Há carência? |
| 11 | `anderson` e `marcineia` existem, não são equivalentes a admin, e não receberam o backfill da migração 104. | alta | Manter ou remover? Conceder o que falta (ex.: `appointments.*` à `marcineia`)? |
| 12 | `product_invoice.*` é resíduo: só mapas de plano. Não há rotas de NF-e de produto. | alta | Está no roadmap? Se não, remover os mapas. |
| 13 | `financial.delete`: admin, manager, marcineia. `orders.delete` e `orders.cancel`: admin, manager, anderson, marcineia. Rotas sem guard. | alta | Aceitar `anderson` cancelar OS que remove lançamentos e comissões sem `financial.delete`? |
| 14 | `roles/:id/actions` exige `roles.manage_permissions`, que não existe: só admin passa. `users/update-role` documenta `roles.manage_members`, também inexistente. `changeUserRole` não lido. | média | Semear os dois códigos e dar a quem? Bloquear auto-concessão? Proteger o último admin ou dono? |
| 15 | No banco só `orders.*`. `service_orders.*` aparece só como chave de auditoria. `service_order.*` não localizado. | alta (banco); média (código) | Não unificar agora. Documentar mapa. Não cadastrar `service_orders.*` como action. |
| 16 | `PUT bank-accounts` aceita `current_balance` e `initial_balance` sem guard. `bank_accounts.update` existe e é concedida a admin, manager e marcineia. | alta | Quem pode alterar saldo direto? Deve gerar lançamento ou auditoria? Criar e excluir conta: `update` ou `create`/`delete`? |
| 17 | `employee` existe só como global, sem perfis. `emp-com` não existe em produção; é persona de teste (`tests/fast/employees/employees-seed.ts:4,10`). | alta | `manager` e `employee` globais são o modelo por organização? O conjunto de 27 ações do `employee` está certo? |

### 8.4 Achados novos

1. **Alta, intencional segundo o responsável:** `fda7436b…` com `is_active=false` e assinatura `active` vencida. Ver 8.2. Lacuna real se a intenção for bloquear.
2. **Alta:** enum usa `bank_accounts.read` e `roles.view`, que não existem no banco. Exigir essas actions daria 403 a não-admins.
3. **Média:** `orders.pay` existe no banco, concedida a `anderson` e `marcineia`, mas está fora do enum e do código. Pode ser a action correta para receber pagamento de OS.
4. **Média:** a organização `386614c4…` tem um único admin sem `is_owner`. Qualquer proteção baseada em `is_owner` não o reconhece.
5. **Baixa:** a migração 065 cita `product_invoice.*` no comentário, mas não insere essas actions.

---

## 9. Segunda leitura de produção e correções (2026-11-12)

Leitura somente GET. As decisões resultantes estão em `docs/engineering/access-control-rollout-plan.md` (seção 3).

### 9.1 Correções deste documento

| Onde | Dizia | Correto |
|---|---|---|
| PO-07, 3.2 (`bank-accounts`), onda 0 | `bank_accounts.update` não semeada | Existe no banco (admin, manager, marcineia). Falta em migração. |
| 3.2 (cobrança), onda 0 | `subscription.manage` "novo" | Existe no banco, só admin. |
| 3.2 (`reports/commissions` pay/DELETE) | `commissions.update`/`delete` | O front (`reports/commissions.vue:165-166`) usa `financial.update`/`delete`. A `marcineia` paga comissões (909 registros) e não tem `commissions.*`. Usar `commissions.*` a bloquearia. |
| 3.2 (`organizations` PUT e logo) | `organization.update` | O front (`settings/company.vue:18-19`) usa `settings.update`, que a `marcineia` tem. |
| 3.2 (`employee-auth-status`) | `members.view` | Chamado pela tela de funcionários (`employees.read`). `members.view` bloquearia a `marcineia`. |
| 3.2 (`roles` GET) | `roles.view` (semeada) | `roles.view` não existe; o banco tem `roles.read`. |
| 3.2 (`bank-accounts`, `payment-terminals`, `taxes`, `employees` GET) | exigir action de leitura | São listas lidas pelas telas de OS. O `anderson` não tem `bank_accounts.view`, `payment_machines.view` nem `employees.read`. GET de lista auxiliar fica só org. |
| 5, item 12 | resposta solta "Resíduo" | Q12 respondida: `product_invoice.*` é resíduo. |

### 9.2 Fatos novos

- **Migração 104 não aplicada:** nenhum dos 7 códigos existe em produção.
- **Catálogo fora das migrações:** das 103 actions de produção, só `fiscal.manage` está semeada. O teste estático de códigos do servidor não tem baseline, então todo guard novo exige o código em migração.
- **Uso real** (por `created_by`/`updated_by`): o `anderson` criou 802 OS (a última em 2026-11-12), 113 produtos-mestre, 85 clientes e 37 produtos. A `marcineia` criou 970 lançamentos financeiros, 909 registros financeiros de funcionário e 536 parcelas de OS. Nenhum não-admin criou compras, fornecedores, peças, maquininhas, impostos, veículos ou agendamentos.
- **`audit_logs`** tem 19 linhas, desde 2026-11-09, nenhuma de não-admin. Não serve como fonte de uso de 30 dias.
- **Menu Contas bancárias** checa `bank_accounts.read`, que não existe: hoje a `marcineia` não vê o menu, apesar de ter `view` e `update`.
- **`settings/subscription.vue` não tem gate no front:** qualquer membro vê os botões de cancelar e de abrir o portal.
- **Saldo de conta** é alterado por 6 rotas de pagamento além do PUT; as 5 alterações da `marcineia` em `bank_accounts` são provavelmente efeito colateral.
