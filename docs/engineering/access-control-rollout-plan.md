# Plano faseado de implantação: controle de acesso

Status: **concluído em 2026-11-12 (Fases 0 a 7 implementadas, revisadas e commitadas, decisões D1 a D16).** A Fase 8, as decisões em aberto, a ordem de deploy e as lacunas conhecidas estão em [access-control-pending.md](access-control-pending.md).
Fonte: `docs/security/access-control-audit-2026-11-12.md`. Este plano não altera código, migração, baseline nem banco.

O sistema está em produção e é usado todo dia por perfis não-admin. Cada fase é um lançamento independente, reversível sozinho.

## 1. Regras de impacto mínimo

Valem para todas as fases. Uma fase que viole uma regra fica bloqueada.

| Regra | Conteúdo |
|---|---|
| R1 | Código novo só entra junto com a lista de quem o recebe, **na mesma migração**. |
| R2 | Código dividido em vários: quem tem o código original recebe todos os novos, na mesma migração. |
| R3 | **Paridade com o front:** o guard do servidor usa o mesmo código que o front já checa para exibir aquele botão ou tela. Quando a auditoria sugerir outro código, vale o do front, salvo decisão registrada. Assim quem usa a tela hoje não perde nada. |
| R4 | GET de lista auxiliar (lida por outra tela, ex.: contas e maquininhas no recebimento de OS) exige só pertencer à organização (D1). |
| R5 | Ordem: o que não afeta ninguém primeiro; o que afeta os operadores diários por último. |
| R6 | Antes de cada fase de guard, refazer as consultas da seção 10 (concessões e uso). Se mudou, revisar a tabela de impacto da fase. |
| R7 | Ativação com bloqueio direto (D8), sem modo sombra. Compensado por R3, teste manual com perfil de teste e rollback por reversão de commit. |

## 2. Fatos verificados em produção (leitura, 2026-11-12)

Consultas somente GET com a service role. Nenhuma escrita.

**Catálogo**
- `actions`: 103 linhas. Os 7 códigos da migração 104 **não existem** em produção: a migração 104 não foi aplicada.
- Enum sem correspondente no banco (10): `orders.finish`, `inventory.adjust`, `purchases.authorize`, `bank_accounts.create`, `bank_accounts.read`, `bank_accounts.delete`, `members.remove`, `roles.view`, `roles.manage_permissions`, `roles.manage_members`.
- Banco sem correspondente no enum (7): `bank_accounts.view`, `employees.pay`, `fiscal.manage`, `members.delete`, `orders.pay`, `roles.read`, `subscription.manage`.
- Das 103 actions de produção, **só `fiscal.manage` está semeada em migração**. O teste `every code passed to requireOrgPermission(...) exists in the migrations` não tem baseline: todo guard novo exige o código em migração. Por isso a Fase 2 sincroniza o catálogo antes de qualquer guard.

**Roles e concessões** (`is_granted = true`, nenhuma negada)

| Role | Escopo | Concessões | Perfis |
|---|---|---|---|
| `admin` | global | 103 (passa sem consultar `role_actions`) | 3 |
| `manager` | global | 68 | 0 |
| `employee` | global | 27 | 0 |
| `anderson` | org `fda7436b…` | 31 | 1 |
| `marcineia` | org `fda7436b…` | 55 | 1 |

- `anderson`: `appointments.*`, `authorizations.create/read/update`, `customers.*`, `inventory.create/update/delete` (sem `read`), `orders.create/read/update/delete/cancel/pay`, `products.*`, `reports.commissions/customers`, `taxes.view/update`, `vehicles.read/update/delete`. **Não tem** `financial.*`, `bank_accounts.*`, `payment_machines.*`, `employees.*`, `settings.*`.
- `marcineia`: `bank_accounts.view/update`, `customers.*`, `employees.create/read/update/pay`, `financial.*`, `inventory.*`, `orders.*` (inclui `correct` e `pay`), `products.*`, `reports.*` (exceto `employees`), `service_invoice.*`, `settings.view/update`, `suppliers.*`, `taxes.*`, `vehicles.*`. **Não tem** `appointments.*`, `authorizations.*`, `purchases.*`, `returns.*`, `commissions.*`, `payment_machines.*`.

**Uso real** (`created_by`/`updated_by` nas tabelas; o `audit_logs` tem só 19 linhas desde 2026-11-09 e nenhuma de não-admin, então não serve como fonte de 30 dias)

| Perfil | O que faz | Volume | Último registro |
|---|---|---|---|
| `anderson` | cria OS | 802 criadas, 185 alteradas | 2026-11-12 |
| `anderson` | cria produto-mestre (`master_products`) | 113 | 2026-11-10 |
| `anderson` | cadastra cliente e produto | 85 e 37 | 2026-11-11 |
| `marcineia` | lançamentos financeiros | 970 criados | 2026-11-12 |
| `marcineia` | registros financeiros de funcionário (comissão/folha) | 909 | 2026-11-11 |
| `marcineia` | parcelas de OS | 536 criadas, 549 alteradas | 2026-11-10 |
| `marcineia` | altera OS | 395 | 2026-10-06 (criação) |
| `marcineia` | `bank_accounts.updated_by` | 5 | provável efeito colateral de pagamento (saldo é alterado por 6 rotas de pagamento) |
| ninguém não-admin | compras, solicitações, fornecedores, peças, maquininhas, impostos, veículos, agendamentos | 0 | n/a |

**Paridade front x servidor que muda a recomendação da auditoria**
- Telas de OS (`CreateModal`, `PaymentModal`, `DownPaymentModal`, `ExtraPaymentModal`, `OSInstallmentsCard`) leem `/api/employees`, `/api/taxes`, `/api/master-products`, `/api/bank-accounts`, `/api/payment-terminals`, `/api/organizations`. O `anderson` não tem `employees.read`, `bank_accounts.view` nem `payment_machines.view`. Restringir esses GET pela action do domínio quebraria a criação e o recebimento de OS (D1).
- `reports/commissions.vue:165-166` libera pagar e excluir comissão com `financial.update`/`financial.delete`. A auditoria sugeria `commissions.update`/`delete`, que a `marcineia` não tem. Vale o front.
- `settings/company.vue:18-19` usa `settings.view/update`. A auditoria sugeria `organization.update`, que a `marcineia` não tem. Vale o front.
- `settings/employees/index.vue:479` chama `employee-auth-status`, numa tela com `employees.read`. A auditoria sugeria `members.view`, que a `marcineia` não tem. Vale o front.
- `settings/subscription.vue` **não tem gate no front**: qualquer membro vê os botões de cancelar e de abrir o portal. A Fase 3 precisa esconder os botões, não só bloquear no servidor.
- O menu "Contas bancárias" (`layouts/app.vue:120`) checa `bank_accounts.read`, que não existe: hoje a `marcineia` não vê o menu, embora tenha `view` e `update`.

**Organizações**
- `fda7436b…`: `is_active=false`, sem `suspended_at`, 4 perfis (2 admin, um deles `is_owner`; `anderson`; `marcineia`). Estado intencional (auditoria 8.2).
- `386614c4…`: `is_active=true`, um admin sem `is_owner`.

## 3. Decisões

| # | Tema | Decisão | Efeito para usuários atuais |
|---|---|---|---|
| D1 | Leituras (Q9) | GET de lista auxiliar exige só org. Escritas exigem action. Telas próprias (relatórios, exportações, extrato financeiro) exigem leitura. | Nenhum |
| D2 | Nomes (G0/G1) | Enum passa a usar os códigos do banco: `BANK_ACCOUNTS_VIEW = 'bank_accounts.view'`, `ROLES_READ = 'roles.read'`, `MEMBERS_DELETE = 'members.delete'`. Entram no enum `ORDERS_PAY`, `EMPLOYEES_PAY`, `FISCAL_MANAGE`, `SUBSCRIPTION_MANAGE`. | `marcineia` passa a ver o menu Contas bancárias (já tinha a permissão) |
| D3 | Contas bancárias (Q16) | Semear `bank_accounts.create` e `bank_accounts.delete` e conceder a quem tem `bank_accounts.update` (R2). Saldo continua editável com `bank_accounts.update`. | Nenhum (`marcineia` e `manager` recebem create/delete) |
| D4 | Receber OS (Q4) | Parcela, entrada e pagamento extra de OS exigem `orders.pay`. | Nenhum |
| D5 | Cancelar e excluir OS (Q13) | Só `orders.cancel`/`orders.delete`. Registrar na auditoria os lançamentos e comissões removidos. | Nenhum |
| D6 | Códigos sem uso | Remover do enum e da migração 104: `orders.finish`, `inventory.adjust`, `purchases.authorize`, `members.remove`, `bank_accounts.read`. Finalizar OS segue `orders.update`; ajuste de estoque segue `inventory.update`. A 104 fica com `bank_accounts.create` e `bank_accounts.delete`. | Nenhum |
| D7 | Aprovar e recusar compra (Q6) | `authorizations.approve`. | Nenhum (ninguém não-admin usa) |
| D8 | Ativação | Bloqueio direto, sem modo sombra. | n/a |
| D9 | Leitura de cobrança | `billing/status` e `billing/invoices` exigem `subscription.view`, com a mesma exceção do checkout para usuário sem organização. O item "Assinatura" de `settings.vue` passa a checar `SUBSCRIPTION_VIEW`. | `anderson` e `marcineia` deixam de ver a página Assinatura (plano e faturas). Nenhum dos dois tem `subscription.view`. |
| D10 | OS cria agendamento e veículo pela tela de clientes | Aceito: `service-orders` POST cria agendamento com `orders.create`, sem exigir `appointments.create`. O modal de veículos da tela de clientes passa a checar `vehicles.*` no front e no servidor. | `anderson` perde criar veículo pelo modal de clientes (não tem `vehicles.create`; nenhum veículo criado por ninguém desde 2026-03-25). Se precisar, conceder `vehicles.create` a ele. |
| D11 | Fase 8 | Fica como está, só com o registro de TODO na seção 9. | Nenhum |
| D12 | Rotas mistas (mapa V1, V2, V4, V16) | O servidor exige só o código do plano. O front passa a esconder o botão ou a ação de quem não tem esse código (sem 403 visível). Sem helper "um de vários". | `anderson` perde pagar comissão pelo card da OS (nunca usou). `marcineia` perde relatório e exportação de funcionário dentro do detalhe do funcionário. Quem tem `bonuses.update` sem `financial.update` perde pagar comissão pela tela de bônus (ninguém conhecido). |
| D13 | `reports/dashboard-stats` (home, V3) | Só organização. | Nenhum |
| D14 | `roles` GET (V15) | `GET /api/roles` (lista de nomes) só organização (R4). `GET /roles/:id` e `/roles/:id/actions` exigem `roles.read`. | Nenhum |
| D15 | `feedback/[id].responses` get/post | TODO, fora do escopo (seção 9). | Nenhum |
| D16 | Relatório do funcionário (2026-11-12) | Proposta de refatoração ("ficha do funcionário", [employee-data-access-refactor.md](employee-data-access-refactor.md)) **adiada por decisão do responsável**: o modelo atual (quem acessa as telas de funcionário vê todos, não só o próprio) fica como está. **D12 continua valendo** para `GET reports/employees` (`reports.employees`), `GET reports/commissions/:id` (`reports.commissions`), `POST reports/export-employees` (`reports.employees`) e `POST employees/:id/export-commissions` (`employees.read`). | `marcineia` perde, no detalhe do funcionário, o relatório e a exportação de funcionário (tem `employees.read` e não tem `reports.employees`), como já previsto em D12 |

Já decididas antes: Q2 (`subscription.manage` na cobrança), Q3 (`members.invite` no `grant-access`), Q12 (`product_invoice.*` é resíduo), Q15 (não unificar prefixos de OS).

Aplicadas por R3 (paridade com o front), sem decisão nova: comissões com `financial.update/delete`; empresa e logo com `settings.update`; `employee-auth-status` com `employees.read`; exportar financeiro com `financial.read`; exportar OS com `orders.read` (Q5); `parts` sob `inventory.*` e `master-products` sob `orders.*` (Q7).

## 4. Visão geral

| Fase | Conteúdo | Quem perde acesso | Rollback |
|---|---|---|---|
| 0 | Mapa rota x código e correção da auditoria (só docs) | ninguém | reverter commit |
| 1 | Filtro de tenant em UPDATE/DELETE | ninguém | reverter commit |
| 2 | Catálogo: sincronizar as 103 actions em migração, 104 enxuta, concessões R2, enum alinhado | ninguém (`marcineia` ganha um menu) | reverter commit do enum; concessões por `created_by` |
| 3 | Guards de configuração e cobrança | `anderson` e `marcineia` deixam de ver a página Assinatura (D9) | reverter commit |
| 4 | Guards de escrita em cadastros | `anderson` perde criar veículo pelo modal de clientes, sem uso (D10) | reverter commit |
| 5 | Guards de financeiro, contas e comissões | ninguém | reverter commit |
| 6 | Guards de OS | ninguém | reverter commit |
| 7 | Guards de leitura em telas próprias | ninguém | reverter commit |
| 8 | **Pendente, fora do escopo (D11):** decisões de cadastro. Ver [access-control-pending.md](access-control-pending.md), seção 1 | ninguém | n/a |

"Quem perde acesso" considera os perfis de 2026-11-12. As fases 5 e 6 tocam o trabalho diário dos dois operadores: por R5 ficam por último entre os guards de escrita.

Dependências: 1 é independente e pode sair a qualquer momento. 3 a 7 exigem 2 em produção.

## 5. Fase 0: mapa e documentação

**Status: concluída.** Mapa em `docs/security/access-control-route-map.md` (109 handlers do baseline mais os GET citados). As divergências V1 a V16 do mapa foram decididas em D12 a D14; as demais (V5 a V11) não fazem ninguém conhecido perder acesso e entram nas fases correspondentes. Pontos de atenção do mapa para as Fases 3 a 7:
- V9: `POST service-orders` serve criar e editar; o guard escolhe `orders.create` ou `orders.update` conforme venha `orderId`.
- V10: o front usa `financial.update` para criar e editar categoria financeira; seguir o front (R3).
- V14: `billing/checkout` também é usado por membros de organização em `/pricing` e `/app/subscribe`; exigir `subscription.manage` bloqueia esses membros (ninguém usa hoje).
- `orders.correct` não é usado pelo front nem por rota; não exigir na edição de OS (bloquearia o `anderson`).
- Sem gate no front (V11), a adicionar junto do guard: página Assinatura, modal de veículos da tela de clientes, importar clientes, editar e excluir agendamento.
- Não verificado no mapa: composição de `manager`/`employee` por tela, gates de `master-products` e do modal `grant-access`.

**Escopo original**
- Gerar `docs/security/access-control-route-map.md`: para cada handler de escrita em `write-routes-without-permission.json` e para cada GET de tela própria, registrar a tela que chama, o código que o front checa (R3), o código que o servidor vai exigir e quais roles têm o código. Linhas em que o front não checa nada (ex.: `subscription.vue`) ficam marcadas como "sem gate no front".
- Corrigir a auditoria nos pontos da seção 2 (feito nesta revisão, ver auditoria seção 9).

**Validação:** revisão. Nenhum teste muda.

## 6. Fase 1: tenant em UPDATE e DELETE

**Status: implementada no working tree, revisada, não commitada (2026-11-12).** 11 handlers com `+1/-0` linha (`.eq('organization_id', organizationId)`): `clients/[id]` put e delete, `bank-accounts/[id]` put e delete, `payment-terminals/[id]` put e delete, `parts/[id]` put e delete, `products/[id]` put e delete, `users/employee-auth-status` (SELECT de `user_profiles` e auto-heal). Testes novos em `tests/fast/**/tenant-write-scope-*.test.ts` e `tests/fast/users/employee-auth-status-tenant.test.ts`, com igualdade exata dos filtros; 15 arquivos, 113 testes passando. O baseline `admin-client-without-org.json` tem 22 arquivos (não 20) e não mudou: os demais operam só em dados do próprio usuário ou em tabelas sem `organization_id`. Em produção, 0 linhas com `organization_id` nulo nas 5 tabelas e 0 perfis com `employee_id` e organização nula. Pendente: normalização de fim de linha de `products/[id].put.ts` (LF no disco), fora do escopo.

- Acrescentar `.eq('organization_id', organizationId)` em `clients/[id].delete.ts`, `bank-accounts/[id].put.ts:51`, `bank-accounts/[id].delete.ts:26`, `payment-terminals/[id].put.ts:40`, `parts/[id].put.ts:52`, `products/[id].put.ts:52`. Revisar o restante de `admin-client-without-org.json` (20 arquivos) e o `employee-auth-status` (`user_profiles` por `employee_id` sem filtro de org).
- Pré-checagem em leitura: `organization_id IS NULL` em `clients`, `bank_accounts`, `payment_terminals`, `parts`, `products` deve retornar 0.
- Testes: um caso por handler tentando alterar ou excluir `id` de outra org (esperado 404, sem mudança). `npx vitest run tests/static/codebase.test.ts` e `npm test`.
- Baseline: `admin-client-without-org.json` pode encolher.
- Pós-deploy: acompanhar 404 nessas rotas por 48 h.

## 7. Fase 2: catálogo e concessões

**Status: implementada no working tree, revisada e executada em Postgres local, não commitada (2026-11-12).**
- Migrações: `104` reduzida (só `bank_accounts.create/delete`), `105` (103 actions de produção, `created_by` normalizado para `'migration'` para não levar e-mail pessoal ao repositório), `106` (concessão R2 a quem tem `bank_accounts.update`, ignorando roles deletadas, marcador `migration-104`), `107` (`roles.manage_permissions` e `roles.manage_members`, sem concessão). A concessão ficou na 106 e não na 104 porque a 104 roda antes de a 105 criar `bank_accounts.update` em banco novo.
- Enum alinhado ao banco (D2, D6) e usos atualizados em 5 arquivos do front. Baseline `action-codes-not-seeded.json` vazia.
- Testes: `tests/static/action-catalog.test.ts` (105 contra fixture campo a campo, sem `@`, sem escrita em `role_actions` nas 104/105/107, 106 limitada a create/delete). `npm test` 1551 passando; `tests/static` 50 passando.
- Prova de execução: 106 migrações aplicadas do zero em Postgres local sem erro; simulação da 106 em transação com rollback (3 roles com `update` mais uma deletada, uma negada e uma sem `update`): 6 linhas, idempotente, nada fora do esperado; `npm run test:db`: 16 passando. Ainda não existe teste de banco permanente para a 106 (o `supabase-js` não executa SQL arbitrário).
- Observação: a migração 100 já semeia `roles.view`, que a produção não tem; em banco novo ele fica como código inerte ao lado de `roles.read`.
- Contagens esperadas em produção após aplicar: `actions` 103 para 107 (`bank_accounts.create/delete`, `roles.manage_permissions/manage_members`), `role_actions` 284 para 290.

Pré-requisito de todos os guards. Uma única entrega com três partes, na ordem.

**2.1 Migração de sincronização do catálogo** (`20240101000105_sync_actions_catalog.sql`)
- `INSERT ... ON CONFLICT (code) DO NOTHING` das 103 actions exatamente como estão em produção (code, name, resource, action_type, description), geradas por leitura. Em produção não muda nenhuma linha. Em ambiente novo reproduz o catálogo (PO-01).
- Efeito no ratchet: `action-codes-not-seeded.json` encolhe para os códigos do enum ainda ausentes; o teste exige atualizar no mesmo PR.
- Efeito colateral aceito: orgs novas já recebem todas as actions pelo webhook; nada muda para elas.

**2.2 Migração 104 enxuta e concessões R2** (editar a 104, ainda não aplicada em produção)
- Manter só `bank_accounts.create` e `bank_accounts.delete` (D3, D6).
- Na mesma migração, conceder os dois códigos a toda role que tenha `bank_accounts.update` concedida e não deletada (hoje `manager` e `marcineia`; `admin` também recebe, para manter o catálogo completo da role). `INSERT ... SELECT ... ON CONFLICT (role_id, action_id) DO NOTHING`, `is_granted = true`, `created_by = 'migration-104'`. A condição é dinâmica: se outra role ganhar `bank_accounts.update` antes do deploy, também recebe.
- Ambientes onde a 104 antiga já rodou (local, testes) ficam com 5 linhas a mais em `actions`, inertes. Sem efeito de acesso.
- `manager` é global: a concessão vale para todas as orgs. Sem perfis hoje; está coerente com R2.

**2.3 Enum alinhado com o banco** (`app/constants/action-codes.ts`, D2 e D6)
- Trocar `BANK_ACCOUNTS_READ` por `BANK_ACCOUNTS_VIEW = 'bank_accounts.view'`; `ROLES_VIEW` por `ROLES_READ = 'roles.read'`; `MEMBERS_REMOVE` por `MEMBERS_DELETE = 'members.delete'`.
- Remover `ORDERS_FINISH`, `INVENTORY_ADJUST`, `PURCHASES_AUTHORIZE`.
- Adicionar `ORDERS_PAY`, `EMPLOYEES_PAY`, `FISCAL_MANAGE`, `SUBSCRIPTION_MANAGE`.
- Atualizar os usos: `layouts/app.vue:120,169`, `financial/accounts.vue:46`, `settings.vue:51`, `settings/roles/index.vue:13`, `settings/roles/[id].vue:83`.
- `roles.manage_permissions` e `roles.manage_members` ficam no enum e passam a ser semeados (sem concessão), porque o servidor já os exige e só o admin passa. Isso não muda acesso; a concessão é decisão da Fase 8 (Q14).

**Impacto**

| Perfil | Antes | Depois |
|---|---|---|
| `marcineia` | sem menu Contas bancárias | vê o menu e a tela; pode criar, editar e excluir conta (já podia pelo servidor, sem guard) |
| `anderson` | sem mudança | sem mudança |
| admin | sem mudança | sem mudança |

Comunicar à `marcineia` que o menu aparece.

**Validação antes de subir:** `npx vitest run tests/static/codebase.test.ts` (migrações, enum, unicidade) e `npm test`. Se houver stack local, `npm run test:db`.

**Validação em produção (leitura)**
```sql
SELECT count(*) FROM public.actions;                         -- 103 antes; 107 depois
SELECT r.name, a.code FROM public.role_actions ra
JOIN public.roles r ON r.id = ra.role_id JOIN public.actions a ON a.id = ra.action_id
WHERE ra.created_by = 'migration-104';                       -- admin, manager, marcineia x create, delete = 6 linhas
SELECT count(*) FROM public.role_actions;                    -- 284 antes; 290 depois
```

**Rollback**
- Enum: reverter o commit.
- Concessões: `DELETE FROM public.role_actions WHERE created_by = 'migration-104';` (conferir antes com `SELECT count(*)`).
- Actions: não apagar. A FK é `ON DELETE CASCADE` e apagaria concessões.

## 8. Fases 3 a 7: guards por domínio

Comum a todas:
- O código de cada rota vem do mapa da Fase 0 (R3). Se o mapa divergir desta tabela, o mapa vale e a tabela é corrigida.
- Cada PR: `requireOrgPermission` nas rotas, `write-routes-without-permission.json` atualizado com `UPDATE_BASELINE=1`, teste unitário 403 para role sem o código e 200 para role com o código.
- Front: o botão ou a tela que chama a rota checa o mesmo código. Onde o front não checa (ex.: assinatura), adicionar o gate no mesmo PR.
- Antes do deploy: consultas da seção 10. Depois do deploy: teste manual com perfil de teste que replique as concessões de `anderson` e de `marcineia`, cobrindo as telas de uso diário (criar OS, receber parcela, lançar e pagar financeiro, pagar comissão).
- Rollback: reverter o commit do domínio, incluindo o baseline.

### Fase 3: configuração e cobrança

**Status: implementada, revisada e commitada (2026-11-12).** Guard em 22 handlers (códigos da tabela abaixo); `GET /roles` da lista, `GET` de impostos e de maquininhas ficam só org (D1, D14). Helper `server/utils/require-org-permission-if-member.ts`: sem perfil ou sem organização (e sem erro) passa, preservando a primeira assinatura; erro de consulta lança 503 (corrigido na revisão, antes liberava). `user-provisioning.ts` recusa (409) perfil existente com outra role, admin ou owner quando há `roleId`, e lança 503 se a checagem falhar, sem escrever. Front: item Assinatura só com `SUBSCRIPTION_VIEW`; cancelar e portal só com `SUBSCRIPTION_MANAGE`; contratar desabilitado para membro sem `subscription.manage`; botão "Gerenciar acesso" só com `MEMBERS_INVITE`. Testes: `tests/fast/access/phase3-config-guards.test.ts` (14 rotas), `tests/fast/billing/permission-guard.test.ts`, `require-org-permission-if-member.test.ts`, `user-provisioning.test.ts`; os `it.fails` de KF-09 das três rotas viraram `it`. `write-routes-without-permission.json` encolheu 16 rotas; ficam `billing/checkout` e `stripe/checkout` (o scanner estático não reconhece o helper condicional; não remover da lista sem trocar o scanner) e `organizations/complete-onboarding` (só org, por decisão). `typecheck`: 444 erros, idêntico ao baseline por arquivo e código.
- **Quem perde acesso:** `anderson` e `marcineia` perdem a página Assinatura e o botão de contratar em `/pricing` e `/app/subscribe`. Mais ninguém conhecido.
- **Verificação manual antes de subir** (o front só foi verificado por leitura): com `anderson` ou `marcineia`, o menu não mostra Assinatura e `/pricing` está desabilitado; com admin e com usuário sem organização, tudo funciona; abrir a página de funcionários com a `marcineia` e conferir que "Gerenciar acesso" some.
- **Ressalva já existente:** o front trata qualquer role de sistema (`is_system_role`) como admin, enquanto o servidor consulta `role_actions` (initial-data.post.ts). `manager` e `employee`, sem perfis hoje, veriam Assinatura e levariam 403. Tratar na Fase 8 (8.1).

| Rota | Código | Quem tem (não-admin) | Impacto |
|---|---|---|---|
| `billing/cancel`, `billing/checkout`, `billing/portal`, `stripe/cancel-subscription`, `stripe/checkout` | `subscription.manage` | ninguém | nenhum uso observado. **Exceção:** usuário sem organização mantém `stripe/checkout` e `billing/checkout` (primeira assinatura). Front: esconder cancelar e portal em `subscription.vue` sem `SUBSCRIPTION_MANAGE`. |
| `billing/status`, `billing/invoices` | `subscription.view` (D9) | ninguém | `anderson` e `marcineia` deixam de ver a página Assinatura. Só `subscription.vue` e o middleware `subscription.global.ts` chamam `billing/status`, e o middleware só roda nessa página ou com `?checkout=success`; ele ignora erro diferente de 401. Mesma exceção do checkout para usuário sem organização. Front: o item "Assinatura" de `settings.vue:23-27` passa a checar `SUBSCRIPTION_VIEW`, para não abrir uma página que responde 403. |
| `employees/:id/grant-access` | `members.invite` | `manager` | hoje responde 422 em todas as orgs. Corrigir o `upsert` de `user-provisioning.ts:45-46` para recusar perfil com outra role ou admin. |
| `users/employee-auth-status` | `employees.read` (R3) | `marcineia`, `manager` | nenhum |
| `users/list-organization` | `members.view` | `manager` | só a tela de roles chama, e ela exige `roles.read` (só admin) |
| `organizations` PUT, `organizations/logo` | `settings.update` (R3) | `marcineia` | nenhum |
| `roles` GET, `roles/:id`, `roles/:id/actions` GET | `roles.read` | ninguém | tela já restrita a admin no front |
| `purchase-requests/:id/authorize`, `reject` | `authorizations.approve` (D7) | `manager` | nenhum uso não-admin |
| `payment-terminals` POST/PUT/DELETE | `payment_machines.update` | ninguém | GET fica só org (D1) |
| `taxes` POST/PUT/DELETE | `taxes.update` | `anderson`, `marcineia`, `manager` | nenhum |

### Fase 4: escrita em cadastros

**Status: implementada no working tree e revisada, não commitada (2026-11-12). As Fases 0 a 3 já foram commitadas.**
- 38 handlers guardados, +2 linhas cada (import e `requireOrgPermission` logo após `requireAuthUser`), sem outra mudança; os filtros de organização da Fase 1 ficaram intactos. Códigos exatamente como na tabela abaixo; `purchases/[id]/pay` exige `purchases.update` (é o que `purchases.vue` usa), `suppliers/import` e `products/import` e `clients/batch` exigem o `create` do domínio. `POST service-orders` não foi tocado (D10). As listas `GET` (clients, vehicles, products, parts, master-products) ficam só org (D1).
- Front: botão "Importar clientes" só com `customers.create`; `VehiclesModal` (criar, editar, excluir) com `vehicles.*`; `MasterProductManager` (novo, editar, excluir) com `orders.*`; `appointments/FormModal` (salvar na edição, excluir) com `appointments.update/delete`.
- **Falha encontrada na revisão e corrigida:** três componentes usavam `ActionCode.` sem importá-lo; o Nuxt não importa `app/constants` sozinho, então abrir esses modais daria `ActionCode is not defined`. ESLint e testes de handler não detectam. Corrigido e coberto por `tests/static/action-code-imports.test.ts` (todo arquivo de `app/` que usa `ActionCode.` precisa importá-lo).
- Testes: `tests/fast/access/phase4a-registry-guards.test.ts` (20 rotas) e `phase4b-registry-guards.test.ts` (18 rotas e 5 listas GET), 4 cenários por rota; 13 `it.fails` de KF-09 viraram `it` e 13 testes que afirmavam "sem guard = 200" foram removidos; ajustados `financial-permissions.test.ts` e `financial-payments.test.ts` por causa de `purchases/:id/pay`. Baseline `write-routes-without-permission.json`: 93 para 56 rotas, nenhuma entrou; sobram `employees/[id]/export-commissions`, `reports/export-employees` e `reports/export-purchases`, que são da Fase 7. `npm test`: 1890 passando.
- **Quem perde acesso:** só `anderson`, e só criar veículo (também em `/app/vehicles`). `anderson` e `marcineia` não usavam compras, devoluções, fornecedores, agendamentos nem funcionários (a `marcineia` perde `employees.delete`, que o front já escondia). Verificação manual antes de subir: abrir o modal de agendamento, o modal de veículos em Clientes e o gerenciador de produto-mestre dentro da criação de OS, com `anderson` e com admin.
- Lacuna baixa conhecida: em `BasicInfoCard.vue` os botões "Novo produto master" e "Gerenciar" não têm gate; só afetariam quem tem `orders.read` sem `orders.create` (ninguém hoje).

| Rotas (POST/PUT/DELETE e import) | Código | `anderson` | `marcineia` |
|---|---|---|---|
| `clients*` | `customers.create/update/delete` | tem | tem |
| `vehicles*` | `vehicles.create/update/delete` | sem `create`: perde criar pelo modal de clientes (D10) | tem |
| `vehicles/lookup-plate` | `vehicles.read` | tem | tem |
| `products*` | `products.*` | tem | tem |
| `parts*` | `inventory.create/update/delete` | tem | tem |
| `master-products*` | `orders.create/update/delete` (R3: só a tela de OS usa) | tem (113 criados) | tem |
| `suppliers*` | `suppliers.*` | não tem (não usa) | tem |
| `employees*` (exceto `grant-access`) | `employees.*` | não tem (não usa) | tem (sem `delete`) |
| `appointments*` | `appointments.*` | tem | não tem (não usa; último agendamento em 2025) |
| `purchases*`, `purchase-returns*`, `purchase-requests` (criar e editar) | `purchases.*`, `returns.*`, `authorizations.create/update/delete` (R3) | só `authorizations.*` | não tem (não usa) |

Ordem interna: um PR por entidade, começando pelas sem uso não-admin (compras, fornecedores, agendamentos), depois `parts`, `products`, `master-products`, `vehicles`, `clients`.

Verificado (2026-11-12):
- A criação de OS não cria cliente nem veículo. `BasicInfoCard.vue:111-144` só seleciona registros existentes por `GET /api/clients` e `GET /api/vehicles`, que são listas auxiliares e ficam só org (D1).
- `service-orders/index.post.ts:235-263` cria um **agendamento** junto com a OS, com o cliente do Supabase de serviço. Fica coberto por `orders.create`, sem exigir `appointments.create` (D10).
- O modal de veículos da tela de clientes (`customers.vue:617-625` → `customers/VehiclesModal.vue:143-167`) chama `POST/PUT/DELETE /api/vehicles` **sem gate no front**: hoje quem vê Clientes cria, edita e exclui veículo. Neste PR o botão e as ações do modal passam a checar `VEHICLES_CREATE/UPDATE/DELETE`. O `anderson` mantém editar e excluir e perde criar (D10).

### Fase 5: financeiro, contas bancárias e comissões

**Status: implementada no working tree e revisada, não commitada (2026-11-12).**
- 17 handlers guardados, +2 linhas cada (import e `requireOrgPermission` logo após `requireAuthUser`); a lógica de pagamento e o bug de rollback (`pending-bulk-payment-rollback.md`) não foram tocados; os filtros de organização da Fase 1 em `bank-accounts` foram preservados.
  - `financial.create`: `financial/index.post` e `[id]/extend-recurrence.post` (o front usa create para estender recorrência; a tabela abaixo dizia "create/update").
  - `financial.update`: `[id].put`, `[id]/pay`, `pay-entries-bulk`, `pay-commissions-bulk`, `update-recurring`, categorias (criar, editar, migrar, V10) e `reports/commissions/[id]/pay`.
  - `financial.delete`: `[id].delete`, `categories/[id].delete` e `reports/commissions/[id].delete`.
  - `bank_accounts.create/update/delete` em `bank-accounts` POST/PUT/DELETE (o saldo continua editável com `bank_accounts.update`, D3). `GET` de `bank-accounts` segue só org (D1).
- Front: `accounts/FormModal` (Salvar com `create` ao criar e `update` ao editar); `OSCommissionsCard` (Pagar exige também `financial.update`, V1); `bonuses/[id].vue` (Pagar exige `bonuses.update` e `financial.update`, V16); `entries/FormModal` (botão "Gerenciar categorias" só com `financial.update`).
- Testes: `phase5a-financial-guards.test.ts` (12 rotas), `phase5b-bank-commission-guards.test.ts` (5 rotas e o GET); `financial-permissions.test.ts` (conjunto `GUARDED`), `financial-payments.test.ts`, `bank-accounts/handlers.test.ts` e `service-orders/money-flows.test.ts` ajustados com a concessão necessária; os `it.fails` de KF-09 das rotas guardadas viraram `it`. Baseline `write-routes-without-permission.json`: 56 para 39 rotas, nenhuma entrou; ficam `financial/export` (Fase 7) e a exclusão de lançamento de OS (Fase 6). `npm test`: 1985 passando.
- **ORDEM DE DEPLOY (obrigatória):** aplicar as migrações 104 a 107 em produção ANTES de subir o código da Fase 5. Sem a 106, `bank_accounts.create` e `bank_accounts.delete` não existem no catálogo e a `marcineia` recebe 403 "Permissão não reconhecida" ao criar ou excluir conta (editar conta e saldo continuam funcionando). O front esconde os botões, mas o servidor recusa.
- **Quem perde acesso:** a `marcineia` não perde nada. O `anderson` perde só o botão "Pagar" comissão no card da OS (nunca usou). `employee` (sem perfis) passa a receber 403 nas rotas financeiras.
- Lacunas baixas conhecidas: o botão de excluir categoria dentro de `entries/CategoryModal.vue` não tem gate próprio (quem tem `financial.update` sem `financial.delete` leva 403 com toast; o servidor protege); os testes de guard cobrem a org-a e concessão `true`/ausente, não `is_granted=false` nem outra organização.
- Verificação manual antes de subir, com a `marcineia` (ou um perfil com as mesmas concessões): lançar, pagar e excluir lançamento; pagar comissão em `/app/reports/commissions`; pagar comissão pela tela de bônus; abrir o card de comissões de uma OS; editar uma conta e seu saldo; e, depois da migração 106, criar e excluir conta.

| Rotas | Código | `anderson` | `marcineia` |
|---|---|---|---|
| `financial/*` criar, pagar, estornar, lote, recorrência | `financial.create/update` | não tem (0 lançamentos) | tem |
| `financial/*` excluir | `financial.delete` | não tem | tem |
| `bank-accounts` POST / PUT / DELETE | `bank_accounts.create` / `update` / `delete` (D3) | não tem | tem |
| `reports/commissions/[id]/pay`, `pay-commissions-bulk` | `financial.update` (R3) | não tem | tem |
| DELETE `reports/commissions/[id]` | `financial.delete` (R3) | não tem | tem |

Antes desta fase: o bug de rollback silencioso do pagamento em lote (`docs/engineering/pending-bulk-payment-rollback.md`) continua fora do escopo de acesso.

### Fase 6: OS

**Status: implementada no working tree e revisada, não commitada (2026-11-12).**
- 12 handlers de escrita de `server/api/service-orders` guardados (só `export-csv` fica, Fase 7); `requireOrgPermission` logo após `requireAuthUser`, antes de qualquer leitura do body ou escrita. `orders.pay`: `process-payment`, `down-payment`, `receive-extra-payment`, `installments/*/pay` (D4). `orders.cancel`: `cancel`, `payment.delete` (estorno) e `financial-transactions/*.delete` (desfazer recebimento) (D5, V6). `orders.delete`: `[id].delete`. `orders.update`: `installments/*.patch` e `generate-commissions`. `financial.delete`: `installments/*.delete` (V7, é o que o front já usava). `POST service-orders` (V9): `orders.update` quando vem `orderId`, senão `orders.create`; o `readBody` passou a ser lido antes do guard, uma única vez; o agendamento interno não exige `appointments.create` (D10).
- `orders.correct` não é exigido em nenhuma rota (não existe rota "corrigir OS"; exigi-lo bloquearia o `anderson`).
- D5 feito: `cancel` e `[id].delete` gravam em `extra.removed` do `recordAudit` as comissões, parcelas e lançamentos removidos (ids, valores, status); sem mudança de cálculo, tabela ou migração; `recordAudit` não lança.
- Front: botões de receber (pagar, entrada, extra, parcela) só com `orders.pay` além do gate antigo; "Cancelar pagamento" e "Desfazer recebimento" só com `orders.cancel`; props `canReceive` e `canCancel` passadas por `service-orders.vue`, `Modal`, `OSHeader`, `OSInstallmentsCard`, `OrderCard` e pelo demo da landing.
- Testes: `phase6a-os-payment-guards.test.ts` e `phase6b-os-guards.test.ts` (4 cenários por rota; criar e editar pelo mesmo POST; 2 testes de D5); seeds ajustados em `money-flows`, `service-order-payments`, `service-order-edit`, `flows/undo-payment` e `financial-payments`; `financial-permissions.test.ts` converteu 4 rotas de OS para `it`. Baseline `write-routes-without-permission.json`: 39 para 27 rotas, nenhuma entrou. `npm test`: 2057 passando.
- **Quem perde acesso:** `anderson` e `marcineia` não perdem nada (ambos têm `orders.create/update/delete/cancel/pay`). `employee` (sem perfis) perde cancelar, estornar e excluir, que o front já escondia.
- Achado baixo: `NfseIssueModal` marca a OS como faturada com um `POST` que agora exige `orders.update`; quem tem `service_invoice.create` e `orders.create` sem `orders.update` leva 403, que o modal engole, e a OS fica sem o status "faturada". Não afeta os dois usuários conhecidos.
- Lacunas baixas conhecidas: os testes de sucesso conferem só o status 200; os de D5 não cobrem `financial_transaction_ids` nem valores de parcelas; faltam casos de outra organização, `is_granted=false` e 401 nas rotas novas.
- **Verificação manual antes de subir** (a mais importante de todas as fases): com o `anderson` e com a `marcineia`, criar uma OS, editar e avançar o status, receber pagamento, dar entrada, receber parcela, cancelar uma OS sem pagamento, estornar um pagamento e, só com um perfil de teste, excluir uma OS. Com o `anderson`, abrir o gerenciador de produto-mestre dentro da criação de OS.

Maior superfície e uso diário dos dois operadores. Um PR para recebimento, outro para o restante.

| Rotas | Código | `anderson` | `marcineia` |
|---|---|---|---|
| criar e editar OS, mudar status (inclui finalizar, D6) | `orders.create` / `orders.update` | tem | tem |
| receber parcela, entrada, pagamento extra (`installments/*/pay`, `receive-extra-payment`, entrada) | `orders.pay` (D4) | tem | tem |
| cancelar, estornar | `orders.cancel` (D5) | tem | tem |
| excluir | `orders.delete` (D5) | tem | tem |
| corrigir OS finalizada | `orders.correct` | não tem; conferir no mapa se o front libera para ele hoje | tem |

D5: o cancelamento e a exclusão passam a gravar na auditoria os lançamentos e comissões removidos.

### Fase 7: leitura em telas próprias

**Status: implementada e revisada (2026-11-12); código commitado em `4355cce`.**
- 7 exportações `POST` e 17 `GET` guardados, +2 linhas cada, logo após `requireAuthUser`. Exportações: `financial/export` (`financial.read`), `reports/export-commissions` (`reports.commissions`), `export-purchases` (`reports.purchases`), `export-sales-items` (`reports.sales`), `export-employees` (`reports.employees`), `employees/:id/export-commissions` (`employees.read`), `service-orders/export-csv` (`orders.read`). `GET`: `financial` (lista, `summary`, `:id`, `categories`) com `financial.read`; `reports/commissions` e `commissions/:id` com `reports.commissions`; `costs-profit` (`reports.costs`), `customers`, `debtors`, `employees` (`reports.employees`), `overview` (`reports.view`), `profit-by-order` e `profit-cash-flow` (`reports.profit`), `purchases`, `sales-items` (`reports.sales`), `suppliers`; `employees/:id/commissions` (`employees.read`). O guard por permissão se soma ao gate de plano (`enforceReportAccess`) e vem antes dele.
- Ficam só org: `reports/dashboard-stats` (D13), listas de employees, clients, vehicles, products, bank-accounts, payment-terminals, taxes, master-products e roles (D1/D14). Revisão: o único handler em `reports/*` e `financial/*` sem guard é `dashboard-stats`.
- Front: o detalhe do funcionário (`settings/employees/[id].vue`) esconde relatório e exportar sem `reports.employees` e o olho de comissão sem `reports.commissions` (D12/D16); botões de exportar de comissões, compras e itens vendidos com gate; o fetch de categorias em `financial/index.vue` só com `financial.read`. O menu "Relatórios" leva ao primeiro relatório permitido; o `anderson` (sem `reports.view`) não cai na "Visão geral".
- Baseline `write-routes-without-permission.json`: 27 para 20 rotas, nenhuma entrou. O `it.fails` de KF-09 (S6) em `financial-permissions.test.ts` virou `it`: toda escrita financeira tem permissão. `npm test`: 2181 passando.
- **Quem perde acesso:** `anderson`: nada visível (abrir `/app/reports` por URL direta dá 403, pois não tem `reports.view`). `marcineia`: o relatório e a exportação de funcionário na ficha do funcionário (previsto em D12; ela tem `employees.read` e não tem `reports.employees`). `manager`: o mesmo (sem perfis).
- Observação (anterior às Fases deste plano, não é regressão): na ficha do funcionário, `employees/:id/bonuses` e `commission-plans` já exigiam `bonuses.read` e `commissions.read`; a `marcineia` não tem `commissions.*`, então a lista de planos já aparecia vazia para ela.
- Lacunas baixas conhecidas dos testes: o 403 não confere a mensagem (não distingue permissão de plano) e não há teste de plano `starter`; os `GET` só org conferem "não é 403"; faltam casos de `is_granted=false`, outra organização e 401 nas rotas novas.
- **Verificação manual antes de subir:** com a `marcineia`, abrir cada relatório que ela usa e a ficha de um funcionário (renderiza sem o relatório, sem tela quebrada); com o `anderson`, abrir Comissões e Clientes em Relatórios e a home. Com admin, conferir que nada mudou.

Só GET que alimentam a própria tela do domínio. Listas auxiliares ficam só org (D1).

| Rotas | Código | `anderson` | `marcineia` |
|---|---|---|---|
| `financial/*` GET (extrato, totais), `financial/export` | `financial.read` (Q5 por R3) | não tem; o menu já não aparece | tem |
| `service-orders/export-csv` | `orders.read` | tem | tem |
| `reports/*` e `export-*` | `reports.<tipo>` que a tela já checa | `commissions`, `customers` | todos exceto `employees` |
| `employees/:id/commissions`, `export-commissions` | `employees.read` | não tem | tem |

Ponto a confirmar no mapa: algum GET financeiro chamado de tela de OS. Se houver, entra como lista auxiliar.

## 9. Fase 8: TODO

> **TODO (fora do escopo atual, D11).** Os itens abaixo ficam como estão hoje. Nenhuma implementação até serem retomados com decisão escrita.
>
> - 8.1 Roles `manager`/`employee` por organização (Q17). Resolveria o 422 do `grant-access`. Só depois da Fase 3.
> - 8.2 Exclusão de conta do dono (Q8): dono com outros membros, cancelamento no Stripe, perfil.
> - 8.3 Bloqueio por assinatura vencida ou `is_active` (Q10). **Atenção:** se `is_active=false` passar a bloquear, os 4 perfis da `fda7436b…` perdem acesso no deploy.
> - 8.4 Gestão de roles e auto-concessão (Q14): conceder `roles.manage_permissions`/`manage_members`, proteger o último admin.
> - 8.5 Remover os mapas `product_invoice.*` (Q12: resíduo).
> - 8.6 `feedback/[id].responses.get` lista respostas de qualquer `feedback_id` sem checar o dono, e `responses.post` aceita qualquer usuário autenticado e grava `is_admin: true` para quem não é o dono (acesso entre usuários e escalada para papel de suporte). `feedbacks` não tem `organization_id`. Proposta quando retomar: dono ou owner da plataforma lê e responde; `is_admin` só para owner da plataforma. Antes, conferir no banco se há feedbacks de não-admin afetados. (D15)

## 10. Consultas antes de cada fase (somente leitura)

```sql
-- concessões atuais por role não-admin
SELECT r.name, r.organization_id, a.code
FROM public.role_actions ra
JOIN public.roles r ON r.id = ra.role_id
JOIN public.actions a ON a.id = ra.action_id
WHERE ra.is_granted AND ra.deleted_at IS NULL AND r.name <> 'admin'
ORDER BY r.name, a.code;

-- perfis por role
SELECT r.name, p.organization_id, count(*)
FROM public.user_profiles p LEFT JOIN public.roles r ON r.id = p.role_id
GROUP BY 1, 2;

-- negações após deploy (audit_logs disponível desde 2026-11-09)
SELECT actor_role, route_pattern, count(*)
FROM public.audit_logs
WHERE status_code = 403 AND created_at > <instante do deploy>
GROUP BY 1, 2;
```

Se aparecer role ou perfil novo, refazer a tabela de impacto da fase antes de subir.

## 11. Pendências e riscos

**Decisões ainda abertas** (não bloqueiam as Fases 0 a 7)
- Comunicação: canal, prazo e responsável. Mínimo: avisar a `marcineia` do novo menu (Fase 2), os dois operadores da página Assinatura (Fase 3) e os dois antes das Fases 5 e 6.
- Fase 8: TODO (seção 9).

**Riscos**
- R3 depende do mapa da Fase 0 estar completo. Rota sem tela identificada é tratada como sem uso não-admin e precisa de confirmação.
- RLS não verificada; revisão de tenant foi por amostragem.
- `manager` e `employee` são globais: concessões nelas valem para todas as orgs.
- Apagar action apaga concessões (cascade). Nunca usar como rollback.
- `386614c4…` tem admin sem `is_owner`: proteção baseada em `is_owner` não o reconhece.
- O webhook assume `roles.organization_id` NOT NULL, mas as roles de sistema são globais (null). Afeta 8.1.
- Contagens de 2026-11-12. Refazer a seção 10 antes de cada fase.
