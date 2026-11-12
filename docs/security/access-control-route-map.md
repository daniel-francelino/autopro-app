# Mapa rota x tela x código (Fase 0)

Data: 2026-11-12. Fonte: `docs/engineering/access-control-rollout-plan.md` (seções 1, 2, 3, 8) e `docs/security/access-control-audit-2026-11-12.md` (3.2 e 9). Só documentação: nenhum código, migração, baseline ou banco foi alterado.

Legenda de evidência: **Verificado** = lido no código em 2026-11-12 (arquivo:linha). **Hipótese** = inferido. **Não verificado** = não confirmado nesta passada.

Convenções das colunas:
- **Front hoje**: ActionCode que o front checa para exibir o botão/tela (`app/`). "sem gate" = nenhuma checagem além de a tela existir.
- **Servidor vai exigir**: R3 (paridade com o front). D1: GET de lista auxiliar exige só org.
- **Quem tem (não-admin)**: só `anderson` (A, 31 concessões) e `marcineia` (M, 55), conforme plano seção 2. `manager` (68) e `employee` (27) são globais, sem perfis; a **composição de concessões deles não foi fornecida nem consultada** ("mgr/emp: não verificado"), exceto onde o plano afirma.
- Gates de página inteira: `canRead`/`canView` em cada `app/pages/app/**` mostra "sem permissão" e o menu (`app/layouts/app.vue:73-169`) usa o `*_READ`/`*_VIEW` do domínio.

## Divergências (resumo, ver detalhes nas tabelas)

Tipo A = quem usa a tela hoje **perderia acesso** se o plano for seguido ao pé da letra. Tipo B = plano diverge do front (R3) mas **nenhum perfil conhecido perde**. Tipo C = falta de gate no front / rota sem tela.

| # | Tipo | Divergência | Evidência |
|---|---|---|---|
| V1 | A | **Pagar comissão pelo card de comissões da OS**: o botão "Pagar" é liberado por `orders.update` (`OSCommissionsCard.vue:133`, recebe `canUpdate` de `detail/Modal.vue:450`) e chama `POST financial/pay-commissions-bulk` (`OSCommissionsCard.vue:49`). O plano (Fase 5) exige `financial.update`. `anderson` tem `orders.update` e **não** tem `financial.update`: perde pagar comissão pela OS. Nenhuma comissão paga por ele (uso: 0), mas a capacidade existe hoje. A mesma rota também é chamada de `reports/commissions.vue:271` (gate `financial.update`). Decisão necessária: aceitar a perda (sem uso observado) ou manter gate por origem. | Verificado |
| V2 | A | **`reports/employees` GET e `export-employees` na tela de detalhe do funcionário**: `settings/employees/[id].vue:199` e `:475` chamam `reports/employees` e `reports/export-employees`; a tela é gateada por `employees.read` (`[id].vue:162`). O plano (Fase 7) exige `reports.employees`. `marcineia` tem `employees.read` e **não** tem `reports.employees` (plano seção 2): perderia o detalhe do funcionário (relatório e exportação). Uso não-aferido para essa tela. | Verificado |
| V3 | A (condicional) | **`reports/dashboard-stats`** é a home `/app` (`pages/app/index.vue:36`) e **não tem gate no front**. O plano diz "`reports/*` -> `reports.<tipo>`", mas dashboard-stats não tem tipo. `anderson` não tem `reports.view`. Guardar com `reports.view` quebraria a home dele. Recomendação: tratar como tela própria sem exigência de action (só org) até decisão. | Verificado (front, server sem guard); recomendação é hipótese |
| V4 | A (condicional) | **`reports/commissions/[id]` GET** é chamado de `reports/commissions.vue:255` (`reports.commissions`) e de `settings/employees/[id].vue:458` (`employees.read`). Exigir `reports.commissions` só quebra quem tem `employees.read` sem `reports.commissions`: M e A têm `reports.commissions`; **mgr/emp: não verificado**. | Verificado (chamadores) |
| V5 | B | **Receber OS (D4 `orders.pay`) x front**: o front **não** usa `orders.pay`. `process-payment`, `down-payment`, `receive-extra-payment`, `installments/*/pay` e `payment.delete` são liberados por `orders.update` (`OSHeader.vue:49-70`, `OrderCard.vue:98-107`, `OSInstallmentsCard.vue:340`). `orders.pay` nem existe no enum hoje. Pelo R3 valeria `orders.update`; D4 pede `orders.pay`. M e A têm os dois: ninguém perde. **mgr/emp: não verificado** (se tiverem `orders.update` sem `orders.pay`, perdem). | Verificado |
| V6 | B | **Estorno de pagamento** (`payment.delete`) e **desfazer recebimento** (`financial-transactions/*` DELETE): front usa `orders.update` (`OSHeader.vue:55-58`, `OSInstallmentsCard.vue:402`), plano (Fase 6) agrupa em `orders.cancel` (D5). Ninguém conhecido perde (A e M têm ambos). | Verificado |
| V7 | B | **Excluir parcela** (`installments/[id]` DELETE): front usa `financial.delete` (`service-orders.vue:34` -> `OSInstallmentsCard.vue:357,367`), não `orders.*`. Plano não lista essa rota. Pelo R3 o servidor exige `financial.delete`: `anderson` já não vê o botão hoje (não perde). | Verificado |
| V8 | B | **`orders.correct`**: **Confirmado** que o front não libera nada com `orders.correct`. `ORDERS_CORRECT` só existe no enum (`action-codes.ts:18`); nenhuma tela nem rota do servidor o usa (grep em `app/`, `server/`, `tests/`). Não existe rota "corrigir OS finalizada". A edição de OS concluída usa o mesmo `POST service-orders` com `orderId` (`utils/service-orders.ts:74-80`, liberada por `orders.update`). Logo `anderson` (sem `orders.correct`) **já edita OS concluída sem pagamento hoje**. Usar `orders.correct` nessa rota o bloquearia. | Verificado |
| V9 | B | **`POST service-orders` serve criar e editar** (`index.post.ts:31,40` `isUpdate = !!orderId`) e avançar status (`service-orders.vue:204`, `orders.update`). Um único `requireOrgPermission` fixo não cobre R3: o servidor precisa escolher `orders.create` (sem `orderId`) ou `orders.update` (com `orderId`). Duplicar OS usa POST sem `orderId` com `orders.create` (`service-orders.vue:545`, `OrderCard.vue:287`). | Verificado |
| V10 | B | **`financial/categories` POST/PUT**: front usa `financial.update` para criar/editar categoria (`categories.vue:215,271,282`); plano diz "criar -> `financial.create`". M tem ambos. Categorias também são geridas por `entries/CategoryModal.vue` (aberto de dentro do formulário de lançamento, `FormModal.vue:776`) sem gate próprio. | Verificado |
| V11 | C | **Sem gate no front**: `settings/subscription.vue` (cancelar `:58`, portal `:111`); modal de veículos de clientes (`customers/VehiclesModal.vue:143,146,167`, aberto de `customers.vue:617-625` sem `v-if`); importar clientes (`customers.vue:513-520`, abre `ImportModal` -> `clients/batch`); editar/excluir agendamento (`appointments/FormModal.vue:181,206`; só `appointments.create` é checado no clique de célula, `appointments.vue:98`). | Verificado |
| V12 | C | Rotas **sem tela identificada em `app/`**: `stripe/cancel-subscription`, `service-orders/export-csv`, `employees/[id]/export-commissions`, `users/update-role`. Tratadas como sem uso não-admin (risco da seção 11 do plano). | Verificado (grep sem ocorrência em `app/`) |
| V13 | B | **`bank-accounts` GET (D1)**: o menu e a tela Contas bancárias checam `bank_accounts.read`, código inexistente (`app/layouts/app.vue:120`, `accounts.vue:46`). Alinhado pela Fase 2. Telas de OS, compras, comissões e financeiro lêem `GET bank-accounts` como lista auxiliar (org-only por D1). | Verificado |
| V14 | A (fora do plano) | **Checkout por usuário com organização**: `billing/checkout` é chamado por `BillingPricingPlans.vue:59`, usado em `/pricing` (qualquer logado, inclusive membro de org) e `app/subscribe.vue:44`. Exigir `subscription.manage` bloqueia membro de org (A, M) que use `/pricing` para trocar plano; sem uso observado. `stripe/checkout` é só do fluxo sem organização (`/subscription`, bloqueado pelo middleware para quem tem org, `auth.global.ts:94-98`). Detalhes na seção "Checkout". | Verificado |

Pontos obrigatórios:
1. Rotas sem tela identificada: **Confirmado** (V12).
2. GET financeiro chamado de tela de OS: **Confirmado que não há GET**. Em `app/components/service-orders/**` e `app/pages/app/service-orders.vue` não há chamada a `GET /api/financial*`; só há **POST** `financial/pay-commissions-bulk` (V1). Os GET de `bank-accounts` e `payment-terminals` são listas auxiliares (D1).
3. `orders.correct`: **Confirmado** o front não libera nada com ele (V8).
4. Checkout sem organização: ver seção "Checkout".
5. Perdas de acesso: V1, V2, V3, V4 (condicional) e V14.

## Checkout (exceção da Fase 3)

| Rota | Chamador | Quem chama | Verificação |
|---|---|---|---|
| `POST stripe/checkout` | `app/pages/subscription.vue:31` | Usuário logado **sem organização** (middleware redireciona quem tem org para `/app` ou `/onboarding`, `auth.global.ts:94-98`; quem não tem org em `/app` vai para `/subscription`, `:80-90`). | Verificado. Servidor: o handler seleciona `user_profiles.organization_id` (`stripe/checkout.post.ts:34`); a org é criada depois pelo webhook (comentário `:10-12`). |
| `POST billing/checkout` | `components/billing/BillingPricingPlans.vue:59` | `/pricing` (`pages/pricing.vue:39`, página pública, exige login para o clique) e `/app/subscribe` (`pages/app/subscribe.vue:44`, layout app, exige org). Portanto atende **usuário sem org e membro de org**. | Verificado. O handler só usa `requireAuthUser` e `user_profiles` sem `organization_id` (`billing/checkout.post.ts`). |
| `POST billing/portal`, `billing/cancel` | `settings/subscription.vue:111`, `:58` | Membro de org; sem gate no front. | Verificado |
| `GET billing/status` | `composables/useBilling.ts:62`, `settings/subscription.vue:41` | Página Assinatura e middleware `subscription.global.ts` (plano: só roda nessa página ou com `?checkout=success`). | Parcial: `useBilling.ts` não foi lido por inteiro; demais afirmações do plano **não reverificadas** |
| `GET billing/invoices` | `settings/subscription.vue:149` | Página Assinatura | Verificado |

Exceção a implementar: `stripe/checkout` e `billing/checkout` só exigem `subscription.manage` quando o usuário **tem** organização; sem organização passam (primeira assinatura). A mesma exceção vale para `billing/status` e `invoices` (D9).

## Fase 3: configuração e cobrança (23 rotas)

| Rota | Tela (arquivo:linha) | Front hoje | Servidor vai exigir | Quem tem (não-admin) |
|---|---|---|---|---|
| POST `billing/cancel` | `settings/subscription.vue:58` | sem gate | `subscription.manage` (esconder botão) | ninguém |
| POST `billing/checkout` | `BillingPricingPlans.vue:59` | sem gate | `subscription.manage` se tem org; livre sem org (V14) | ninguém |
| POST `billing/portal` | `settings/subscription.vue:111` | sem gate | `subscription.manage` | ninguém |
| POST `stripe/cancel-subscription` | sem tela identificada | n/a | `subscription.manage` | ninguém |
| POST `stripe/checkout` | `pages/subscription.vue:31` | sem gate (rota só para quem não tem org) | `subscription.manage` se tem org; livre sem org | ninguém |
| GET `billing/status` | `useBilling.ts:62`, `subscription.vue:41` | sem gate | `subscription.view` (D9), exceção sem org | ninguém (A e M perdem a página, aceito em D9) |
| GET `billing/invoices` | `subscription.vue:149` | sem gate | `subscription.view` (D9) | ninguém |
| POST `employees/:id/grant-access` | `settings/employees/index.vue:504` | tela `employees.read` (`:15`); o botão específico não foi inspecionado: não verificado | `members.invite` | mgr (plano) |
| POST `users/employee-auth-status` | `settings/employees/index.vue:479` | `employees.read` (tela, `:15`) | `employees.read` (R3) | M; mgr (plano) |
| POST `users/list-organization` | `settings/roles/[id].vue:112` | `roles.view` (tela, `:83`; código inexistente, vira `roles.read` na Fase 2) | `members.view` | mgr (plano); tela só admin |
| PUT `organizations` | `settings/company.vue:145,160` | `settings.update` (`:19`) | `settings.update` | M |
| POST `organizations/logo` | `settings/company.vue:115` | `settings.update` (`:19`) | `settings.update` | M |
| GET `roles` | `settings/employees/index.vue:82` (lista de roles no modal de funcionário), `settings/roles/index.vue:52` | **divergência**: `employees/index.vue:82` roda com `employees.read`, `roles/index.vue` com `roles.view` | `roles.read`; **V15**: o chamador em `employees/index.vue:82` perderia a lista de roles | ninguém (só admin) |
| GET `roles/:id` | `components/roles/RoleDetailsSlideover.vue:120`, `settings/roles/[id].vue:100` | `roles.view` (tela) | `roles.read` | ninguém |
| GET `roles/:id/actions` | `settings/roles/index.vue:184` | `roles.view` (tela) | `roles.read` | ninguém |
| POST `purchase-requests/:id/authorize` | `products/purchase-requests.vue:314` | `authorizations.approve` (`:66,746`) | `authorizations.approve` (D7) | mgr (plano); A: não (tem create/read/update) |
| POST `purchase-requests/:id/reject` | `purchase-requests.vue:340` | `authorizations.approve` | `authorizations.approve` | idem |
| POST `payment-terminals` | `financial/machines/FormModal.vue:67` | `payment_machines.update` (`machines.vue:273`) | `payment_machines.update` | ninguém |
| PUT `payment-terminals/:id` | `machines/FormModal.vue:64` | `payment_machines.update` (`:315,323`) | idem | ninguém |
| DELETE `payment-terminals/:id` | `machines.vue:182,200` | `payment_machines.update` (`:262,355,363`) | idem | ninguém |
| POST `taxes` | `financial/taxes/FormModal.vue:67` | `taxes.update` (`taxes.vue:285`) | `taxes.update` | A, M, mgr (plano) |
| PUT `taxes/:id` | `taxes/FormModal.vue:64` | `taxes.update` | idem | A, M, mgr |
| DELETE `taxes/:id` | `taxes.vue:182,200` | `taxes.update` (`:274,364,372`) | idem | A, M, mgr |

V15 (tipo A, achado novo): `GET roles` é lido por `settings/employees/index.vue:82` (tela `employees.read`); `marcineia` tem `employees.read` e não tem `roles.read`. Exigir `roles.read` quebra a lista de roles do modal de funcionários dela. Pelo R4 (lista auxiliar) o `GET roles` deveria ficar só org, ou o plano deve registrar a exceção. Verificado (chamada); uso real do modal pela M **não verificado**.

## Fase 4: escrita em cadastros (38 rotas)

| Rota | Tela (arquivo:linha) | Front hoje | Servidor vai exigir | Quem tem (não-admin) |
|---|---|---|---|---|
| POST `clients` | `customers/FormModal.vue:257` | `customers.create` (`customers.vue:543`) | `customers.create` | A, M |
| PUT `clients/:id` | `customers/FormModal.vue:254` | `customers.update` (`:610,677`) | `customers.update` | A, M |
| DELETE `clients/:id` | `customers.vue:320,439` | `customers.delete` (`:532,636,704`) | `customers.delete` | A, M |
| POST `clients/batch` | `customers/ImportModal.vue:134` | **sem gate** (`customers.vue:513-520`) | `customers.create` (V11) | A, M |
| POST `vehicles` | `vehicles/FormModal.vue:203`; `customers/VehiclesModal.vue:146` | página: `vehicles.create` (`vehicles.vue:486`); modal de clientes: **sem gate** | `vehicles.create` | M; A **não** (D10) |
| PUT `vehicles/:id` | `vehicles/FormModal.vue:200`; `VehiclesModal.vue:143` | página `vehicles.update` (`:558,623`); modal: sem gate | `vehicles.update` | A, M |
| DELETE `vehicles/:id` | `vehicles.vue:268,363`; `VehiclesModal.vue:167` | página `vehicles.delete` (`:469,566,632`); modal: sem gate | `vehicles.delete` | A, M |
| GET `vehicles/lookup-plate` | `vehicles/FormModal.vue:93` | herda a abertura do formulário (`create`/`update`); sem checagem própria | `vehicles.read` | A, M |
| POST `products` | `products/ProductsFormModal.vue:255` | `products.create` (`products/index.vue:545`) | `products.create` | A, M |
| PUT `products/:id` | `ProductsFormModal.vue:252` | `products.update` (`:621`) | `products.update` | A, M |
| DELETE `products/:id` | `products/index.vue:334,374` | `products.delete` (`:522,631`) | `products.delete` | A, M |
| POST `products/import` | `ProductsImportModal.vue:100` | `products.create` (`:512`) | `products.create` | A, M |
| POST `parts` | `products/inventory.vue:508` | `inventory.create` (`:793`) | `inventory.create` | A, M |
| PUT `parts/:id` | `inventory.vue:502` | `inventory.update` (`:870,919`) | `inventory.update` | A, M |
| DELETE `parts/:id` | `inventory.vue:544,592` | `inventory.delete` (`:770,880,929`) | `inventory.delete` | A, M |
| POST `master-products` | `service-orders/create/MasterProductEditor.vue:51` | tela de OS; gate específico **não verificado** | `orders.create` (R3 do plano) | A, M |
| PUT `master-products/:id` | `MasterProductEditor.vue:52` | idem, não verificado | `orders.update` | A, M |
| DELETE `master-products/:id` | `create/MasterProductManager.vue:45` | idem, não verificado | `orders.delete` | A, M |
| POST `suppliers` | `products/suppliers.vue:478` | `suppliers.create` (`:781`) | `suppliers.create` | M |
| PUT `suppliers/:id` | `suppliers.vue:472` | `suppliers.update` (`:867,916`) | `suppliers.update` | M |
| DELETE `suppliers/:id` | `suppliers.vue:542,590` | `suppliers.delete` (`:767,877,926`) | `suppliers.delete` | M |
| POST `suppliers/import` | `SupplierImportModal.vue:132` | `suppliers.create` (`:756`) | `suppliers.create` | M |
| POST `employees` | `settings/employees/index.vue:402` | `employees.create` (`:16`) | `employees.create` | M |
| PUT `employees/:id` | `employees/index.vue:396` | `employees.update` (`:17`) | `employees.update` | M |
| DELETE `employees/:id` | `employees/index.vue:440` | `employees.delete` (`:18`) | `employees.delete` | nenhum (M sem `delete`) |
| POST `appointments` | `appointments/FormModal.vue:184` | `appointments.create` (`appointments.vue:98`) | `appointments.create` | A |
| PUT `appointments/:id` | `FormModal.vue:181` | sem gate além de `appointments.read` da página (V11) | `appointments.update` | A |
| DELETE `appointments/:id` | `FormModal.vue:206` | idem | `appointments.delete` | A |
| POST `purchases` | `products/purchases.vue:641` | `purchases.create` (`:811`) | `purchases.create` | ninguém |
| PUT `purchases/:id` | `purchases.vue:635` | `purchases.update` (`:895,951`) | `purchases.update` | ninguém |
| DELETE `purchases/:id` | `purchases.vue:677,725` | `purchases.delete` (`:797,905,961`) | `purchases.delete` | ninguém |
| POST `purchases/:id/pay` | `purchases.vue:425` | `purchases.update` + pendente (`:883,939`) | `purchases.update` | ninguém |
| POST `purchase-returns` | `purchase-returns.vue:624` | `returns.create` (`:794`) | `returns.create` | ninguém |
| PUT `purchase-returns/:id` | `purchase-returns.vue:618` | `returns.update` (`:874,923`) | `returns.update` | ninguém |
| DELETE `purchase-returns/:id` | `purchase-returns.vue:660,708` | `returns.delete` (`:780,884,933`) | `returns.delete` | ninguém |
| POST `purchase-requests` | `purchase-requests.vue:525` | `authorizations.create` (`:696`) | `authorizations.create` | A |
| PUT `purchase-requests/:id` | `purchase-requests.vue:519` | `authorizations.update` (`:767,832`) | `authorizations.update` | A |
| DELETE `purchase-requests/:id` | `purchase-requests.vue:561,609` | `authorizations.delete` (`:682,777,844`) | `authorizations.delete` | nenhum (A só tem create/read/update) |

Notas: "Quem tem" para `suppliers`, `employees`, `appointments`, `purchases`, `returns` vem do plano seção 2 (A/M); mgr/emp: não verificado. `master-products`: o gate no front dos botões do editor/gerenciador não foi inspecionado (a tela de OS que os abre é `orders.create`/`update`); o `anderson` criou 113 produtos-mestre.

## Fase 5: financeiro, contas bancárias e comissões (17 rotas)

| Rota | Tela (arquivo:linha) | Front hoje | Servidor vai exigir | Quem tem (não-admin) |
|---|---|---|---|---|
| POST `financial` | `financial/entries/FormModal.vue:596-614`; duplicar `financial/index.vue:673` | `financial.create` (`index.vue:1000`) | `financial.create` | M |
| PUT `financial/:id` | `FormModal.vue:591` | `financial.update` (`index.vue:1131`) | `financial.update` | M |
| POST `financial/update-recurring` | `FormModal.vue:586` | `financial.update` | `financial.update` | M |
| POST `financial/:id/extend-recurrence` | `financial/index.vue:739` | `financial.create` (`:1110`) | `financial.create` (plano diz `create/update`; R3 vale o front) | M |
| POST `financial/:id/pay` | `index.vue:505` | `financial.update` (`:1097`) | `financial.update` | M |
| POST `financial/pay-entries-bulk` | `index.vue:527` | `financial.update` (`:944`) | `financial.update` | M |
| DELETE `financial/:id` | `index.vue:600,634` | `financial.delete` (`:958,1141`) | `financial.delete` | M |
| POST `financial/categories` | `financial/categories.vue` (botão `:215`); `entries/CategoryModal.vue:67` | `financial.update`; modal sem gate próprio (V10) | `financial.update` | M |
| PUT `financial/categories/:id` | `categories/FormModal.vue:61`; `CategoryModal.vue:106` | `financial.update` (`:271`) | `financial.update` | M |
| DELETE `financial/categories/:id` | `categories.vue:111`; `CategoryModal.vue:134` | `financial.delete` (`:292`) | `financial.delete` | M |
| POST `financial/categories/:id/migrate` | `categories.vue:161` | `financial.update` (`:271`) | `financial.update` | M |
| POST `financial/pay-commissions-bulk` | `reports/commissions.vue:271`; **`service-orders/detail/OSCommissionsCard.vue:49`** | `financial.update` (relatório) / `orders.update` (OS, **V1**) | `financial.update` | M (A perde via OS) |
| POST `bank-accounts` | `financial/accounts/FormModal.vue:87` | `bank_accounts.create` (`accounts.vue:426`) | `bank_accounts.create` | M (após Fase 2) |
| PUT `bank-accounts/:id` | `accounts/FormModal.vue:84` | `bank_accounts.update` (`:499,561`) | `bank_accounts.update` | M |
| DELETE `bank-accounts/:id` | `accounts.vue:248,278` | `bank_accounts.delete` (`:409,507,569`) | `bank_accounts.delete` | M (após Fase 2) |
| POST `reports/commissions/:id/pay` | `reports/commissions.vue:305,319`; `financial/bonuses/[id].vue:223` | `financial.update` (`:165`); bonuses: `bonuses.update` (**não conferido o gate do botão**) | `financial.update` | M |
| DELETE `reports/commissions/:id` | `reports/commissions.vue:337,363` | `financial.delete` (`:166`) | `financial.delete` | M |

Observação **V16** (tipo A condicional, Verificado): `financial/bonuses/[id].vue:223` chama `reports/commissions/:id/pay` com o botão "Pagar" liberado por `bonuses.update` (`:76,840`). Exigir `financial.update` na rota tira o pagamento de bônus de quem tem `bonuses.update` sem `financial.update`. A e M não têm `bonuses.*` (plano seção 2), então nenhum perfil conhecido perde; mgr/emp: não verificado.

## Fase 6: OS (12 rotas)

| Rota | Tela (arquivo:linha) | Front hoje | Servidor vai exigir | Quem tem (não-admin) |
|---|---|---|---|---|
| POST `service-orders` (criar) | `CreateModal.vue:923`; duplicar `service-orders.vue:235` | `orders.create` (`service-orders.vue:545`; `OrderCard.vue:287`) | `orders.create` (sem `orderId`, V9) | A, M |
| POST `service-orders` (editar/avançar/NFS-e) | `detail/Modal.vue:92,244`; `service-orders.vue:204`; `NfseIssueModal.vue:140` | `orders.update` (`OSHeader.vue:75`, `OrderCard.vue:95-98`) | `orders.update` (com `orderId`) | A, M |
| DELETE `service-orders/:id` | `service-orders.vue:356`; `detail/Modal.vue:218` | `orders.delete` (`OrderCard.vue:313`, `OSHeader.vue:228`) | `orders.delete` | A, M |
| POST `service-orders/:id/cancel` | `service-orders.vue:321`; `detail/Modal.vue:192` | `orders.cancel` (`OrderCard.vue:300`, `OSHeader.vue:217`) | `orders.cancel` | A, M |
| DELETE `service-orders/:id/payment` | `detail/Modal.vue:166` | `orders.update` (`OSHeader.vue:55-58`) | `orders.update` (R3) ou `orders.cancel` (plano D5): V6 | A, M |
| POST `service-orders/:id/process-payment` | `PaymentModal.vue:363` | `orders.update` (`OrderCard.vue:98-107`, `OSHeader.vue:49`) | `orders.update` (R3) ou `orders.pay` (D4): V5 | A, M |
| POST `service-orders/:id/down-payment` | `DownPaymentModal.vue:164` | `orders.update` (`OSHeader.vue:61`) | idem V5 | A, M |
| POST `service-orders/:id/receive-extra-payment` | `ExtraPaymentModal.vue:164` | `orders.update` (`OSHeader.vue:66`) | idem V5 | A, M |
| POST `service-orders/:id/installments/:iid/pay` | `OSInstallmentsCard.vue:134` | `orders.update` (`:340`) | idem V5 | A, M |
| PATCH `service-orders/:id/installments/:iid` | `OSInstallmentsCard.vue:177` | `orders.update` + pendente (`:358`) | `orders.update` | A, M |
| DELETE `service-orders/:id/installments/:iid` | `OSInstallmentsCard.vue:213` | **`financial.delete`** (`service-orders.vue:34`, `:357,367`) | `financial.delete` (V7) | M; A não vê o botão hoje |
| DELETE `service-orders/:id/financial-transactions/:tid` | `OSInstallmentsCard.vue:253` | `orders.update` (`:402`) | `orders.update` (V6) | A, M |
| POST `service-orders/:id/generate-commissions` | `OSResponsiblesCard.vue:206,282,336` | `orders.update` (`:452,464,476`) | `orders.update` | A, M |

(A tabela lista 13 linhas porque `service-orders` POST aparece como criar e editar; é 1 handler. Contagem de handlers: 12.)

`orders.correct`: sem tela e sem rota (V8). `orders.pay`: zero uso no front (V5).

## Fase 7: leituras de tela própria (25 rotas: 7 escritas de exportação + 18 GET)

| Rota | Tela (arquivo:linha) | Front hoje | Servidor vai exigir | Quem tem (não-admin) |
|---|---|---|---|---|
| POST `financial/export` | `financial/index.vue:768` | `financial.read` (tela/menu `app.vue:114`) | `financial.read` | M |
| GET `financial` | `financial/index.vue:184,274` | `financial.read` | `financial.read` | M |
| GET `financial/summary` | `financial/index.vue:196` | `financial.read` | `financial.read` | M |
| GET `financial/:id` | `entries/DetailSlideover.vue:70` | `financial.read` (tela) | `financial.read` | M |
| GET `financial/categories` | `financial/categories.vue:40`; `financial/index.vue:307`; `entries/FormModal.vue:84` | `financial.read` (tela de categorias); lista usada no formulário de lançamento | `financial.read` (decidido na Fase 7: todos os chamadores estão sob `financial/index.vue` e `financial/categories.vue`, ambas com `canRead`; nenhuma tela de OS chama) | M |
| POST `service-orders/export-csv` | **sem tela identificada** | n/a | `orders.read` | A, M |
| POST `reports/export-commissions` | `reports/commissions.vue:380` | menu `reports.commissions` | `reports.commissions` | A, M |
| POST `reports/export-employees` | `reports/employees/EmployeesAccordionPanel.vue:250`; **`settings/employees/[id].vue:475`** | `reports.employees` (menu); no detalhe do funcionário o front passou a esconder relatório e exportar sem `reports.employees` (D12/D16, Fase 7) | `reports.employees` -> **V2** | nenhum (M sem `reports.employees`) |
| POST `reports/export-purchases` | `reports/purchases.vue:174` | `reports.purchases` (menu) | `reports.purchases` | M |
| POST `reports/export-sales-items` | `reports/sales-items.vue:309` | `reports.sales` (menu; plano Pro) | `reports.sales` | M |
| POST `employees/:id/export-commissions` | **sem tela identificada** | n/a | `employees.read` | M |
| GET `employees/:id/commissions` | `settings/employees/[id].vue:185` | `employees.read` (`:162`) | `employees.read` | M |
| GET `reports/commissions` | `useCommissionsReportList.ts:76` | menu `reports.commissions` | `reports.commissions` | A, M |
| GET `reports/commissions/:id` | `reports/commissions.vue:255`; `settings/employees/[id].vue:458` | `reports.commissions` / `employees.read` | `reports.commissions` (V4) | A, M |
| GET `reports/costs-profit` | `reports/costs.vue:104,155` | `reports.costs` | `reports.costs` | M |
| GET `reports/customers` | `reports/customers.vue:40` | `reports.customers` | `reports.customers` | A, M |
| GET `reports/debtors` | `reports/debtors.vue:150` | `reports.debtors` | `reports.debtors` | M |
| GET `reports/employees` | `reports/employees/EmployeesAccordionPanel.vue:96`; **`settings/employees/[id].vue:199`** | `reports.employees` / `employees.read` | `reports.employees` -> V2 | nenhum |
| GET `reports/overview` | `reports/index.vue:37` | `reports.view` | `reports.view` | M (A não tem `reports.view`) |
| GET `reports/profit-by-order` | `reports/profit.vue:75` | `reports.profit` | `reports.profit` | M |
| GET `reports/profit-cash-flow` | `reports/profit.vue:76` | `reports.profit` | `reports.profit` | M |
| GET `reports/purchases` | `reports/purchases.vue:110` | `reports.purchases` | `reports.purchases` | M |
| GET `reports/sales-items` | `reports/sales-items.vue:172,275` | `reports.sales` | `reports.sales` | M |
| GET `reports/suppliers` | `reports/suppliers.vue:90,147` | `reports.suppliers` | `reports.suppliers` | M |
| GET `reports/dashboard-stats` | `pages/app/index.vue:36` | **sem gate** (home) | só org (V3) | todos |

Notas Fase 7:
- Páginas `reports/*` não têm `requiredPermission` na rota (só `financial/service-invoices.vue:8` tem); o gate é o menu (`useReportsAccess.ts:14-23`, `layouts/app.vue:142-150`). Acesso por URL é livre no front.
- Mapeamento tela->código de relatório vem de `useReportsAccess.ts`; `sales-items` usa `reports.sales`, não `reports.sales_items`.
- `GET employees` (lista) é chamado de telas de OS (`CreateModal.vue:330`, `ServiceOrdersFilters.vue:69`), compras e relatórios: lista auxiliar, só org (D1). `GET clients`, `vehicles`, `products`, `master-products`, `taxes`, `payment-terminals`, `bank-accounts`, `organizations`, `suppliers`, `parts`: idem, só org.

## Fora do escopo das fases 3 a 7 (18 handlers do baseline)

Autoescopo, sem fase (auditoria 3.1): `auth/account.delete`, `auth/avatar.post`, `auth/password.put`, `auth/profile.put`, `profile/index.put`, `settings/notifications.put`, `settings/notifications/device.post`, `settings/preferences.put`, `notifications/read.post`, `notifications/read-all.post`, `feedback/*` (4), `organizations/complete-onboarding.post` (`onboarding.vue:74`), `users/initial-data.post` (`useWorkshopBootstrap.ts:70`), `users/update-fields.post` (`settings/roles/[id].vue:289`), `users/update-role.post` (sem tela identificada, V12). `update-fields` e `update-role` alteram role de usuário: classificação como autoescopo é da auditoria; **não reverificada** aqui.

## Contagem

| Fase | Rotas mapeadas | Detalhe |
|---|---|---|
| 3 | 23 | 18 escritas + 5 GET (billing 2, roles 3) |
| 4 | 38 | 37 escritas + `lookup-plate` GET |
| 5 | 17 | todas escritas |
| 6 | 12 | todas escritas (13 linhas, `service-orders` POST criar/editar) |
| 7 | 25 | 7 escritas de exportação + 18 GET |
| Fora (autoescopo) | 18 | sem fase |
| Baseline total | 109 | 91 escritas nas fases + 18 fora |

## Pendências não verificadas

- Concessões de `manager` e `employee`: composição não consultada; todas as colunas "Quem tem" os omitem salvo menção ao plano.
- Gate no front dos botões de `master-products` (editor/gerenciador) e do botão `grant-access`.
- Gate de abertura do modal `grant-access` (`settings/employees/index.vue:1336`). `master-products`: `MasterProductEditor.vue` e `MasterProductManager.vue` não têm checagem de permissão própria (grep sem ocorrência), herdam o acesso à tela de OS.
- Uso real de `settings/employees/[id].vue` e do modal de funcionários por `marcineia` (V2, V15).
- `useBilling.ts` e `subscription.global.ts` não lidos por inteiro.
- `graphify-out` marcado como possivelmente desatualizado; toda a verificação foi por leitura direta do código.
