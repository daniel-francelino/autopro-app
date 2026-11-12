# Cenários de teste por endpoint, lote G1

Domínios: bank-accounts (4 handlers), payment-terminals (4), bonuses (13), employees (10). Total: **31 handlers**.
Escopo: apenas desenho. Nenhum teste foi implementado, escrito ou executado. Nenhum código de produção foi alterado.
**Revisão obrigatória por `test-reviewer` antes da implementação.**

## Notas gerais

- As colunas "teste dedicado" em `docs/testing/domains/*.md` podem estar desatualizadas, e a suíte não foi executada nesta análise. O status abaixo vem de busca textual em `tests/` (grep), não de execução.
- Já provado em `tests/fast/access/guard-matrix.test.ts` (referenciado, não duplicado): 401 sem sessão (M1) e rotas admin só para owner. Por isso nenhuma linha abaixo repete "sem sessão".
- Helpers: `tests/support/handler-harness.ts`, `fake-supabase.ts`, `factories.ts`. Guard: `server/utils/require-org-permission.ts`. Padrão de referência: `tests/fast/service-orders/money-flows.test.ts`.
- Camada padrão: `fast` (handler real + fake-supabase). `db` somente para RLS, constraint única, transação. Sem E2E.
- Evidência existente: só uso incidental de `POST /api/bank-accounts` e `POST /api/employees` como fixture em `tests/e2e/*` (ex.: `tests/e2e/money-flows.e2e.ts`, `tests/e2e/service-orders/support/order-fixtures.ts`, `catalog.ts`), e `POST /api/bonuses` em `tests/fast/audit/derive-and-sanitize.test.ts` (só mapeamento de auditoria). Nada disso verifica o comportamento do handler, então o status é **gap** em todas as linhas.
- Baseline KF-09 (`tests/static/baselines/write-routes-without-permission.json`) lista 11 escritas deste lote sem permissão: bank-accounts POST/PUT/DELETE, payment-terminals POST/PUT/DELETE, employees POST/PUT/DELETE/export-commissions/grant-access. Para elas, "funcionário sem permissão -> 403" é o comportamento correto, marcado **KF-09 (candidato it.fails)**.
- Nomes das chaves de permissão de bank-accounts, payment-terminals e employees não existem no código. Ver G1-OQ-01. Nas linhas, `<perm>` = chave a definir pelo product-owner. Bonuses já usa `bonuses.read|create|update|delete`.
- Legenda de papéis: owner, admin, emp-sem (funcionário sem a permissão), emp-com (funcionário com a permissão).
- Tenant: org vem da sessão via `resolveOrganizationId`, nunca do corpo. Toda linha "iso" usa duas orgs (A logada, B dona do registro) com `createFakeSupabase`.

---

## 1. bank-accounts (4 handlers: 0 covered, 4 gap)

Fonte: `server/api/bank-accounts/`. Todas as escritas usam `requireAuthUser` + `resolveOrganizationId`, sem `requireOrgPermission`. DELETE é soft (`deleted_at`, `deleted_by`) e chama `recordAudit`. PUT repassa `current_balance` e `initial_balance` direto do corpo. POST exige `account_name` e `account_type`.

| ID | Método e caminho | Pri | Camada | Pré-condições | Passos | Resultado esperado | Integridade de dados | Status | Evidência |
|---|---|---|---|---|---|---|---|---|---|
| BAN-06 | GET /api/bank-accounts | P1 | fast | Org A com 3 contas (1 inativa, 1 soft-deleted), org B com 1 | GET sem filtro; com `is_active=false`; com `search`; `page_size=500`; `sort_by=invalid` | 200; exclui deletadas e de B; `is_active` filtra; `page_size` limitado a 100; sort inválido cai em `account_name`; `total` correto | Nenhuma escrita | gap | - |
| BAN-04a | GET /api/bank-accounts | P0 | fast | Idem, org B com conta | GET logado como A | Itens só de A; query `organization_id` na URL ignorada | - | gap | - |
| BAN-07 | GET /api/bank-accounts | P2 | fast | Qualquer papel sem permissão de contas | GET como emp-sem | Hoje 200 (só login). Comportamento correto depende de G1-OQ-01 | - | gap (it.todo, aguarda G1-OQ-01) | - |
| BAN-08 | POST /api/bank-accounts | P1 | fast | Org A | POST `{account_name, account_type}` | 200 `{item}`; `organization_id`=A, `created_by`=email da sessão | `initial_balance` default 0 | gap | - |
| BAN-09 | POST /api/bank-accounts | P1 | fast | - | POST sem `account_name`; sem `account_type`; corpo vazio; `account_name` não string | 400 nas duas primeiras e na vazia. Tipo errado: 400 (hoje não validado, ver G1-SD-04) | Nada inserido | gap | - |
| BAN-09b | POST /api/bank-accounts | P1 | fast | - | `initial_balance` negativo / string / NaN; `account_type` fora do conjunto | 400 (comportamento correto; hoje sem validação, G1-SD-04) | Nada inserido | gap | - |
| BAN-03 | POST /api/bank-accounts | P1 | fast | Org A | POST com `initial_balance=500` | Saldo atual = 500 e extrato de abertura conforme regra definida (G1-OQ-02) | `current_balance` == `initial_balance`; se houver extrato, soma do extrato == saldo | gap (it.todo, aguarda G1-OQ-02) | - |
| BAN-01a | POST /api/bank-accounts | P0 | fast | - | POST com `initial_balance=0` e `current_balance=999` | Correto: `current_balance` do corpo não deve ser aceito, ou deve gerar ajuste com extrato (G1-SD-01). Candidato it.fails | Saldo == soma dos extratos (I1) | gap | - |
| BAN-05a | POST /api/bank-accounts | P2 | fast | Perfis owner/admin/emp-sem/emp-com | POST como cada perfil | owner/admin/emp-com 200; emp-sem 403. KF-09 (candidato it.fails para emp-sem) | - | gap | `tests/static/baselines/write-routes-without-permission.json` (só catraca estática) |
| BAN-04b | POST /api/bank-accounts | P0 | fast | Org A logada | POST com `organization_id`=B no corpo | Registro criado com org A (corpo ignorado) | Nenhuma linha em B | gap | - |
| BAN-10 | PUT /api/bank-accounts/:id | P1 | fast | Conta de A | PUT `{account_name, notes, is_active:false}` | 200; só campos enviados mudam; `updated_by` preenchido | Saldo inalterado | gap | - |
| BAN-11 | PUT /api/bank-accounts/:id | P1 | fast | - | id inexistente; id soft-deleted | 404 `Registro não encontrado` | Nada alterado | gap | - |
| BAN-01b | PUT /api/bank-accounts/:id | P0 | fast | Conta com saldo 100 e extratos somando 100 | PUT `{current_balance: 9999}` | Correto: rejeitar, ou criar ajuste com extrato; saldo não diverge do extrato. Candidato it.fails (G1-SD-01) | Saldo == soma dos extratos | gap | - |
| BAN-11b | PUT /api/bank-accounts/:id | P1 | fast | Conta com movimentos | PUT `{initial_balance: 5000}` | Correto: não reescreve histórico sem ajuste (G1-OQ-02). Candidato it.fails | `current_balance - initial_balance` == soma do extrato | gap (it.todo, aguarda G1-OQ-02) | - |
| BAN-04c | PUT /api/bank-accounts/:id | P0 | fast | Conta de B; logado em A | PUT com id de B | 404, conta de B inalterada | Linha de B idêntica ao antes | gap | - |
| BAN-05b | PUT /api/bank-accounts/:id | P2 | fast | Perfis | PUT como cada perfil | emp-sem 403 (KF-09, candidato it.fails); demais 200 | - | gap | - |
| BAN-12 | PUT /api/bank-accounts/:id | P2 | fast | Corpo com `organization_id`=B | PUT | Org da conta não muda (campo não está na lista de updates) | `organization_id` igual ao antes | gap | - |
| BAN-02a | DELETE /api/bank-accounts/:id | P0 | fast | Conta sem movimentos | DELETE | 200 `{success}`; `deleted_at`/`deleted_by` setados; some do GET; `recordAudit` com `before` | Soft delete, linha preservada | gap | - |
| BAN-02b | DELETE /api/bank-accounts/:id | P0 | fast | Conta com extratos, ou usada por maquininha ativa | DELETE | Correto: bloqueia (409) ou arquiva sem perder histórico (G1-OQ-03). Hoje apaga sem checar (G1-SD-02). Candidato it.fails | Extratos e saldo preservados | gap (it.todo, aguarda G1-OQ-03) | - |
| BAN-13 | DELETE /api/bank-accounts/:id | P1 | fast | Conta já deletada | DELETE de novo | 404 (idempotência: segunda chamada não altera `deleted_at`) | `deleted_at` original mantido | gap | - |
| BAN-04d | DELETE /api/bank-accounts/:id | P0 | fast | Conta de B | DELETE logado em A | 404; conta de B sem `deleted_at` | Linha de B intacta | gap | - |
| BAN-05c | DELETE /api/bank-accounts/:id | P2 | fast | Perfis | DELETE | emp-sem 403 (KF-09, it.fails); demais 200 | - | gap | - |
| BAN-14 | Todas | P1 | fast | Org suspensa ou assinatura expirada | Chamar GET e POST | Comportamento conforme regra de bloqueio da org (G1-OQ-04); registrar o que ocorre hoje | - | gap (it.todo, aguarda G1-OQ-04) | - |

---

## 2. payment-terminals (4 handlers: 0 covered, 4 gap)

Fonte: `server/api/payment-terminals/`. Sem `requireOrgPermission`, sem `recordAudit`. DELETE é soft. POST exige só `terminal_name`. `bank_account_id` e `rates` não são validados nem checados quanto à org.

| ID | Método e caminho | Pri | Camada | Pré-condições | Passos | Resultado esperado | Integridade de dados | Status | Evidência |
|---|---|---|---|---|---|---|---|---|---|
| PAY-04 | GET /api/payment-terminals | P1 | fast | A com 3 terminais (1 deletado), B com 1 | GET; `search`; `page_size=500`; `sort_by` inválido | Só A, sem deletados; `page_size` <= 100; sort inválido cai em `terminal_name`; `total` correto | - | gap | - |
| PAY-03a | GET /api/payment-terminals | P0 | fast | Idem | GET como A com `organization_id`=B na query | Só itens de A | - | gap | - |
| PAY-05 | POST /api/payment-terminals | P1 | fast | Conta bancária de A | POST `{terminal_name, bank_account_id, payment_receipt_days:30, rates}` | 200; `organization_id`=A; `created_by` | Rates persistidos como enviados | gap | - |
| PAY-06 | POST /api/payment-terminals | P1 | fast | - | Sem `terminal_name`; `terminal_name` vazio/espaços; `payment_receipt_days` negativo ou string; `rates` com taxa <0 ou >100 | 400 para o primeiro; demais 400 (correto; hoje só o nome é validado, G1-SD-04) | Nada inserido | gap | - |
| PAY-07 | POST /api/payment-terminals | P0 | fast | Conta bancária de B; logado em A | POST com `bank_account_id` de B | Correto: 400/404, terminal não pode apontar para conta de outra org. Candidato it.fails (G1-SD-03) | Sem FK cruzada entre orgs | gap | - |
| PAY-03b | POST /api/payment-terminals | P0 | fast | Logado em A | POST com `organization_id`=B no corpo | Criado em A | Nada em B | gap | - |
| PAY-03c | POST /api/payment-terminals | P2 | fast | Perfis | POST por perfil | emp-sem 403 (KF-09, it.fails); demais 200 | - | gap | - |
| PAY-08 | PUT /api/payment-terminals/:id | P1 | fast | Terminal de A | PUT `{terminal_name, is_active:false}` | 200; só campos enviados mudam | Terminais antigos referenciados em parcelas não mudam | gap | - |
| PAY-09 | PUT /api/payment-terminals/:id | P1 | fast | - | id inexistente; deletado | 404 | Nada alterado | gap | - |
| PAY-01 | PUT /api/payment-terminals/:id | P0 | fast | Terminal com taxa 3%, OS/parcela recebida com `terminal_fee_amount` gravado | PUT `rates` para 5% | Parcelas/recebimentos antigos mantêm `terminal_fee_amount` e saldo. Regra de refletir ou não no saldo/relatório depende de G1-OQ-05 | Valores históricos imutáveis; saldo e extratos inalterados | gap (it.todo, aguarda G1-OQ-05) | - |
| PAY-07b | PUT /api/payment-terminals/:id | P0 | fast | Conta bancária de B | PUT `bank_account_id` de B | Correto: rejeitado (G1-SD-03). Candidato it.fails | Sem FK cruzada | gap | - |
| PAY-03d | PUT /api/payment-terminals/:id | P0 | fast | Terminal de B, logado em A | PUT com id de B | 404, B inalterado | Linha de B idêntica | gap | - |
| PAY-03e | PUT /api/payment-terminals/:id | P2 | fast | Perfis | PUT por perfil | emp-sem 403 (KF-09, it.fails) | - | gap | - |
| PAY-02a | DELETE /api/payment-terminals/:id | P1 | fast | Terminal sem uso | DELETE | 200; `deleted_at`/`deleted_by`; some do GET | Soft delete | gap | - |
| PAY-02b | DELETE /api/payment-terminals/:id | P1 | fast | Terminal usado por parcelas | DELETE | Correto: regra definida em G1-OQ-06 (bloquear ou arquivar). Parcelas existentes mantêm taxa e referência legível | Parcelas intactas | gap (it.todo, aguarda G1-OQ-06) | - |
| PAY-10 | DELETE /api/payment-terminals/:id | P1 | fast | Já deletado | DELETE de novo | 404; `deleted_at` original mantido | - | gap | - |
| PAY-03f | DELETE /api/payment-terminals/:id | P0 | fast | Terminal de B | DELETE logado em A | 404; B sem `deleted_at` | Linha de B intacta | gap | - |
| PAY-03g | DELETE /api/payment-terminals/:id | P2 | fast | Perfis | DELETE por perfil | emp-sem 403 (KF-09, it.fails) | - | gap | - |

---

## 3. bonuses (13 handlers: 0 covered, 13 gap)

Fonte: `server/api/bonuses/`. Todos com `requireOrgPermission` (`bonuses.read|create|update|delete`). Motor puro de bônus já coberto por `bonuses.test.ts` (utilitário `server/utils/bonuses`), mas nenhum handler. Matriz de papéis para cada endpoint (linha "authz"): owner 200, admin 200, emp-sem 403, emp-com 200. A fake-supabase deve simular `requireOrgPermission` (ver como `guard-matrix.test.ts` faz). `fetchBonus` filtra por organização, então bônus de outra org resulta em 404.

Nota de numeração (bonuses): nas linhas de bonuses, o sufixo "05" (BON-05a a BON-05j) marca isolamento de tenant. As linhas funcionais de atribuições BON-05d (POST assignments) e BON-05f (DELETE assignments) carregam "05" por legado e não são de isolamento; as linhas de isolamento dessas rotas são BON-05e e BON-05g. Não renumeradas para evitar quebra de referências.

| ID | Método e caminho | Pri | Camada | Pré-condições | Passos | Resultado esperado | Integridade de dados | Status | Evidência |
|---|---|---|---|---|---|---|---|---|---|
| BON-07 | GET /api/bonuses | P1 | fast | A com 2 bônus (1 deletado) e atribuições ativas/removidas; B com 1 | GET | Só bônus vivos de A com valores vigentes e funcionários atribuídos ativos | - | gap | - |
| BON-06a | GET /api/bonuses | P0 | fast | Perfis | GET por perfil | emp-sem 403 (`bonuses.read`); emp-com 200; iso: nunca vê B | - | gap | - |
| BON-08 | POST /api/bonuses | P1 | fast | Org A | POST válido `{name, commissionBase, goalAmount, bonusAmount, dueDay}` | 200; bônus com `organization_id`=A e 1 `bonus_value_versions` inicial | Versão criada com os mesmos valores | gap | - |
| BON-09 | POST /api/bonuses | P1 | fast | - | `name` vazio; `commissionBase` inválido; `goalAmount` 0, negativo, NaN, string; `bonusAmount` idem; `dueDay` 0, 32, 1.5 | 400 em cada caso | Nada inserido | gap | - |
| BON-10 | POST /api/bonuses | P1 | fast | Fake que falha no insert da versão | POST | 500 e o bônus recém-criado é removido (compensação) | Sem bônus órfão sem versão | gap | - |
| BON-06b | POST /api/bonuses | P1 | fast | Perfis | POST por perfil | emp-sem 403 (`bonuses.create`); emp-com 200 | - | gap | - |
| BON-11 | POST /api/bonuses | P0 | fast | Logado em A | `organization_id`=B no corpo | Criado em A | Nada em B | gap | - |
| BON-12 | GET /api/bonuses/:id | P1 | fast | Bônus de A | GET; id inexistente; deletado | 200 com versões e funcionários; 404 nos outros | - | gap | - |
| BON-05a | GET /api/bonuses/:id | P0 | fast | Bônus de B, logado A | GET | 404 | - | gap | - |
| BON-06c | GET /api/bonuses/:id | P1 | fast | Perfis | GET | emp-sem 403 | - | gap | - |
| BON-13 | PUT /api/bonuses/:id | P1 | fast | Bônus de A | PUT `{name}`; `name` vazio; `dueDay` 0/32/1.5; id inexistente | 200 / 400 / 400 / 404 | Valores (versões) não mudam por este endpoint | gap | - |
| BON-05b | PUT /api/bonuses/:id | P0 | fast | Bônus de B | PUT logado A | 404; B inalterado | Linha de B idêntica | gap | - |
| BON-06d | PUT /api/bonuses/:id | P1 | fast | Perfis | PUT | emp-sem 403 (`bonuses.update`) | - | gap | - |
| BON-14 | DELETE /api/bonuses/:id | P1 | fast | Bônus de A com atribuições e pagamentos gerados | DELETE | 200; `deleted_at`/`deleted_by`; some das listas. Efeito sobre pagamentos já gerados: G1-OQ-07 | Registros financeiros existentes não são apagados nem estornados por este endpoint | gap (it.todo, aguarda G1-OQ-07) | - |
| BON-05c | DELETE /api/bonuses/:id | P0 | fast | Bônus de B | DELETE logado A | 404; B sem `deleted_at` | Intacto | gap | - |
| BON-06e | DELETE /api/bonuses/:id | P1 | fast | Perfis | DELETE | emp-sem (com só `update`) 403 (`bonuses.delete`); emp-com 200 | - | gap | - |
| BON-05d | POST /api/bonuses/:id/assignments | P1 | fast | Bônus e funcionário de A | POST `{employeeId}`; de novo; após remoção | 200 na primeira; 409 se já ativo; reativa (`active=true`, `deleted_at=null`) se removido; sem duplicar linha | 1 linha por (bônus, funcionário) | gap | - |
| BON-15 | POST /api/bonuses/:id/assignments | P1 | fast | - | Sem `employeeId`; funcionário inexistente; funcionário deletado | 400; 404; 404 | Nada inserido | gap | - |
| BON-05e | POST /api/bonuses/:id/assignments | P0 | fast | Funcionário de B; bônus de B | (a) bônus de B com A logado; (b) bônus de A com `employeeId` de B | 404 em ambos | Nenhuma atribuição criada | gap | - |
| BON-06f | POST /api/bonuses/:id/assignments | P1 | fast | Perfis | POST | emp-sem 403 (`bonuses.update`) | - | gap | - |
| BON-05f | DELETE /api/bonuses/:id/assignments/:employeeId | P1 | fast | Atribuição ativa | DELETE; de novo; funcionário nunca atribuído | 200 (soft: `deleted_at`, `active=false`); segunda e inexistente: 404 `Atribuição não encontrada` | Pagamentos já gerados permanecem | gap | - |
| BON-05g | DELETE /api/bonuses/:id/assignments/:employeeId | P0 | fast | Bônus de B | DELETE logado A | 404; atribuição de B intacta | Intacta | gap | - |
| BON-06g | DELETE /api/bonuses/:id/assignments/:employeeId | P1 | fast | Perfis | DELETE | emp-sem 403 | - | gap | - |
| BON-16 | GET /api/bonuses/:id/financial-records | P1 | fast | Registros de bônus (pagos, pendentes, deletados) em 2 meses | GET sem filtro; `referenceMonth` | Só vivos, do bônus, da org, filtrados por mês, com nome do funcionário | - | gap | - |
| BON-06h | GET /api/bonuses/:id/financial-records | P0 | fast | Bônus de B / perfis | GET logado A; emp-sem | 404; 403 | - | gap | - |
| BON-04 | GET /api/bonuses/:id/progress | P1 | fast | Mesmos dados de OS/comissão usados pelo teste do util | GET | `achievedAmount` por funcionário == `sumAchievedAmount` do util para os mesmos dados; status de geração do mês refletido | - | gap | - |
| BON-17 | GET /api/bonuses/:id/progress | P1 | fast | - | `referenceMonth` ausente / inválido; bônus inexistente | Ausente: mês corrente; inválido: 400 correto (G1-SD-08); inexistente: 404 | - | gap | - |
| BON-06i | GET /api/bonuses/:id/progress | P0 | fast | Bônus de B / emp-sem | GET | 404; 403. Verificar que OS/comissões de B nunca entram no cálculo de A | - | gap | - |
| BON-03a | POST /api/bonuses/:id/value-versions | P1 | fast | Bônus com versão vigente desde mês M | POST nova versão `effectiveFrom` M+1 | 200; `resolveEffectiveVersion` do mês M continua com a antiga | Versões antigas não alteradas | gap | - |
| BON-03b | POST /api/bonuses/:id/value-versions | P1 | fast | Versão já existe em `effectiveFrom`=M | POST mesmo mês | 200, substitui a linha do mesmo mês (caminho 23505 -> update), sem duplicar | Apenas 1 versão por (bônus, mês) | gap | - |
| BON-03c | POST /api/bonuses/:id/value-versions | P0 | fast | Mês fechado com geração já criada (`bonus_generations`) | POST versão retroativa para esse mês | Correto: geração/pagamento do mês fechado não é reescrito (G1-OQ-08) | `goal_amount`/`bonus_amount` gerados inalterados | gap (it.todo, aguarda G1-OQ-08) | - |
| BON-18 | POST /api/bonuses/:id/value-versions | P1 | fast | - | `commissionBase` inválido; `goalAmount`/`bonusAmount` 0, negativo, NaN; `effectiveFrom` "abc" ou "2026-11-15" | 400 nos números/base; `effectiveFrom` inválido ou fora de dia 1: 400 correto (G1-SD-08, it.fails) | Nada inserido | gap | - |
| BON-05h | POST /api/bonuses/:id/value-versions | P0 | fast | Bônus de B | POST logado A | 404; sem versão criada em B | - | gap | - |
| BON-06j | POST /api/bonuses/:id/value-versions | P1 | fast | Perfis | POST | emp-sem 403 | - | gap | - |
| BON-01a | POST /api/bonuses/:id/generate | P0 | fast | 2 funcionários atribuídos, 1 atingiu a meta, 1 não | POST (mês corrente) | `generated` para o que atingiu (registro `employee_financial_records` pendente, `record_type=bonus`, valor == `bonus_amount` da versão do mês, data == `resolveDueDate`); `goal_not_met` para o outro (geração sem registro) | 1 registro financeiro por (bônus, funcionário, mês); sem alteração de saldo bancário (pendente) | gap | - |
| BON-01b | POST /api/bonuses/:id/generate | P0 | fast | Já gerado no mês | POST de novo; modo `employeeId` depois do modo em lote | `already_generated`; nenhum registro novo | Contagem de registros e de `bonus_generations` não muda | gap | - |
| BON-01c | POST /api/bonuses/:id/generate | P1 | fast | Sem versão vigente no mês; `employeeId` não atribuído | POST | `no_value_configured`; 404 `Funcionário não está atribuído` | Nada inserido | gap | - |
| BON-01d | POST /api/bonuses/:id/generate | P0 | db | Banco local, 2 chamadas concorrentes para o mesmo (bônus, funcionário, mês) | Disparar em paralelo | Correto: 1 só registro financeiro e nenhum registro órfão; a perdedora não deixa pendência (G1-SD-09). Candidato it.fails | Constraint única `bonus_generations` + sem `employee_financial_records` órfão | gap | - |
| BON-19 | POST /api/bonuses/:id/generate | P1 | fast | - | `referenceMonth` "2026-11-15" e depois "2026-11-01" | Correto: normalizar ou rejeitar, sem burlar o dedupe (G1-SD-08). Candidato it.fails | Sem duplicata por mês | gap | - |
| BON-05i | POST /api/bonuses/:id/generate | P0 | fast | Bônus/OS/funcionários de B; emp-sem | (a) bônus de B logado A; (b) emp-sem | 404; 403. Dados de B nunca contam | Nada criado em B | gap | - |
| BON-01e | DELETE /api/bonuses/:id/generations/:employeeId | P0 | fast | Geração `goal_not_met` (sem `financial_record_id`) | DELETE `?referenceMonth=` | 200; só a linha de `bonus_generations` é removida; pode gerar de novo | Registros financeiros e saldos intocados | gap | - |
| BON-01f | DELETE /api/bonuses/:id/generations/:employeeId | P0 | fast | Geração com `financial_record_id` | DELETE | 409, nada removido | Registro e geração intactos | gap | - |
| BON-20 | DELETE /api/bonuses/:id/generations/:employeeId | P1 | fast | Nada gerado | DELETE | 404 `Nada foi gerado` | - | gap | - |
| BON-05j | DELETE /api/bonuses/:id/generations/:employeeId | P0 | fast | Bônus de B / emp-sem | DELETE | 404; 403; geração de B intacta | Intacta | gap | - |
| BON-02a | DELETE /api/bonuses/:id/financial-records/:recordId | P0 | fast | Registro pago: conta com saldo S, extrato e transação financeira vinculados | DELETE `{reason}` | 200; saldo da conta volta ao valor exato via `revertStatementOnAccount`; extrato removido; transação com soft delete (`deletion_source`); registro com `deleted_at`+`deletion_reason`; `bonus_generations` removida | Saldo final == saldo antes do pagamento; sem extrato órfão; soma de extratos == saldo | gap | - |
| BON-02b | DELETE /api/bonuses/:id/financial-records/:recordId | P0 | fast | Registro pendente (sem transação) | DELETE `{reason}` | 200; nenhum saldo muda; geração liberada para reprocessar | Saldos intactos | gap | - |
| BON-02c | DELETE /api/bonuses/:id/financial-records/:recordId | P0 | fast | Registro pago, mas transação vinculada já deletada ou ausente | DELETE | Correto: não pode apagar registro pago sem estorno silencioso (G1-SD-11). Candidato it.fails | Saldo coerente com extratos | gap | - |
| BON-02d | DELETE /api/bonuses/:id/financial-records/:recordId | P1 | fast | - | Sem `reason`, só espaços; sem corpo; `recordId` de outro bônus; já deletado | 400; 400; 404; 404 (idempotência: segunda chamada não estorna de novo) | Saldo não é estornado duas vezes | gap | - |
| BON-02e | DELETE /api/bonuses/:id/financial-records/:recordId | P0 | fast | Registro pago de B | DELETE logado A | 404; saldo de B intacto | Intacto | gap | - |
| BON-06k | DELETE /api/bonuses/:id/financial-records/:recordId | P1 | fast | Perfis | DELETE | emp-sem (só `update`) 403 (`bonuses.delete`) | - | gap | - |

---

## 4. employees (10 handlers: 0 covered, 10 gap)

Fonte: `server/api/employees/`. Sem permissão (só login): GET lista, POST, PUT, DELETE, commissions GET, commission-rules GET, export-commissions POST, grant-access POST. Com permissão: bonuses GET (`bonuses.read`), commission-plans GET (`commissions.read`). `POST` chama `enforceEmployeeLimit` antes de validar campos. `PUT` e `DELETE` chamam `syncEmployeeLinkedUserAccess`. `commission-rules`, `bonuses` e `commission-plans` não verificam se o funcionário pertence à org (ver G1-SD-06).

| ID | Método e caminho | Pri | Camada | Pré-condições | Passos | Resultado esperado | Integridade de dados | Status | Evidência |
|---|---|---|---|---|---|---|---|---|---|
| EMP-07 | GET /api/employees | P1 | fast | A com ativo, desligado (`termination_date` passado), futuro, deletado; B com 1 | GET; `include_terminated=true`; `search` | Padrão: exclui desligado e deletado; com flag inclui desligado; `search` filtra; nunca B | - | gap | `tests/e2e/service-orders/permissions-isolation.e2e.ts` (uso incidental) |
| EMP-06a | GET /api/employees | P0 | fast | Logado A | `organization_id`=B na query | Só A | - | gap | - |
| EMP-08 | POST /api/employees | P1 | fast | Plano com folga | POST completo | 200; `organization_id`=A; strings aparadas; defaults (`has_salary=false`) | - | gap | `tests/e2e/service-orders/support/catalog.ts` (fixture) |
| EMP-09 | POST /api/employees | P1 | fast | - | Sem `name`, `person_type`, `tax_id`, `phone`; só espaços; tipos não string | 400 em cada (correto: tipo não string 400; hoje pode virar 500, G1-SD-04) | Nada inserido | gap | - |
| EMP-10 | POST /api/employees | P0 | fast | Org no limite do plano / sem assinatura (limite starter, KF-03) | POST | Bloqueado pelo limite, nada inserido; com folga, passa | Contagem de funcionários não excede o limite | gap | - |
| EMP-11 | POST /api/employees | P1 | fast | Funcionário com mesmo `tax_id` na org | POST duplicado | Regra de duplicidade em G1-OQ-09; registrar comportamento atual | - | gap (it.todo, aguarda G1-OQ-09) | - |
| EMP-06b | POST /api/employees | P0 | fast | Logado A | `organization_id`=B no corpo | Criado em A | Nada em B | gap | - |
| EMP-06c | POST /api/employees | P2 | fast | Perfis | POST por perfil | emp-sem 403 (KF-09, it.fails) | - | gap | - |
| EMP-12 | PUT /api/employees/:id | P1 | fast | Funcionário de A sem usuário | PUT `{phone, role}`; `termination_date` | 200; só campos da lista permitida mudam; `updated_by` | - | gap | - |
| EMP-13 | PUT /api/employees/:id | P1 | fast | Funcionário com usuário vinculado | PUT com `email` diferente; com mesmo email | 400; 200 | E-mail não muda | gap | - |
| EMP-03a | PUT /api/employees/:id | P1 | fast | Funcionário vinculado | PUT `termination_date` passada | `syncEmployeeLinkedUserAccess` desativa acesso do usuário | Perfil vinculado inativo | gap | - |
| EMP-14 | PUT /api/employees/:id | P1 | fast | - | id inexistente; deletado | 404 | - | gap | - |
| EMP-01c | PUT /api/employees/:id | P0 | fast | Funcionário vinculado; `role_id` de papel da org B; caller emp-sem | PUT `{role_id}` | Correto: 403 sem permissão e 400/404 para papel de outra org; não permite auto-promoção (G1-SD-05). Candidato it.fails | `user_profiles.role_id` só aponta papel da própria org | gap | - |
| EMP-06d | PUT /api/employees/:id | P0 | fast | Funcionário de B | PUT logado A | 404; B inalterado; `user_profiles` de B inalterados | Intacto | gap | - |
| EMP-06e | PUT /api/employees/:id | P2 | fast | Perfis | PUT por perfil | emp-sem 403 (KF-09, it.fails) | - | gap | - |
| EMP-04a | DELETE /api/employees/:id | P1 | fast | Funcionário com comissão pendente e paga, bônus atribuído | DELETE | 200 soft; registros de comissão preservados (pendentes e pagas); efeito em pendentes e atribuições: G1-OQ-10 | Comissões e valores pagos intactos | gap (it.todo, aguarda G1-OQ-10) | - |
| EMP-03b | DELETE /api/employees/:id | P1 | fast | Funcionário vinculado a usuário | DELETE | `syncEmployeeLinkedUserAccess` desativa o usuário; não aparece em listas e seleções | - | gap | - |
| EMP-15 | DELETE /api/employees/:id | P1 | fast | Já deletado / inexistente | DELETE | 404; `deleted_at` original mantido | - | gap | - |
| EMP-06f | DELETE /api/employees/:id | P0 | fast | Funcionário de B | DELETE logado A | 404; B intacto | Intacto | gap | - |
| EMP-06g | DELETE /api/employees/:id | P2 | fast | Perfis | DELETE por perfil | emp-sem 403 (KF-09, it.fails) | - | gap | - |
| EMP-02a | GET /api/employees/:id/commissions | P0 | fast | Funcionário com comissões em OS vivas e período | GET `dateFrom`/`dateTo` | Totais == `reports/commissions` filtrado pelo mesmo funcionário e período (reusar `getEmployeeCommissionReport`) | Totais batem; bônus não entra no total de comissões | gap | - |
| EMP-02b | GET /api/employees/:id/commissions | P1 | fast | Comissão pendente de OS excluída (KF-32) | GET | Correto: coerente com o relatório e com `employee_financial_records`. Divergência conhecida KF-32 (candidato it.fails) | - | gap | - |
| EMP-16 | GET /api/employees/:id/commissions | P1 | fast | - | id inexistente; funcionário de B | 404 `Funcionário não encontrado` nos dois | - | gap | - |
| EMP-06h | GET /api/employees/:id/commissions | P0 | fast | Logado A, funcionário de B | GET | 404, sem dados de B | - | gap | - |
| EMP-05a | GET /api/employees/:id/commission-plans | P1 | fast | Funcionário com 2 planos atribuídos (1 deletado) | GET | Só planos vivos da org atribuídos ao funcionário | - | gap | - |
| EMP-06i | GET /api/employees/:id/commission-plans | P0 | fast | Funcionário de B; emp-sem | GET logado A; emp-sem | Correto: 404 (hoje retorna lista vazia, G1-SD-06); emp-sem 403 (`commissions.read`) | - | gap | - |
| EMP-05b | GET /api/employees/:id/commission-rules | P1 | fast | Planos vigentes por mês | GET sem e com `referenceDate` | Regras do mês corrente / do mês informado, coerentes com planos atribuídos | - | gap | - |
| EMP-06j | GET /api/employees/:id/commission-rules | P0 | fast | Funcionário de B | GET logado A | Nenhuma regra de B vaza (200 vazio ou 404; ver G1-SD-06) | - | gap | - |
| EMP-05c | GET /api/employees/:id/bonuses | P1 | fast | Funcionário com 2 bônus atribuídos (1 removido, 1 deletado) | GET `referenceMonth` | Só bônus vivos e ativos, com status de geração do mês | - | gap | - |
| EMP-06k | GET /api/employees/:id/bonuses | P0 | fast | Funcionário de B; emp-sem | GET logado A; emp-sem | Correto: 404 (G1-SD-06); 403 (`bonuses.read`) | - | gap | - |
| EMP-17 | POST /api/employees/:id/export-commissions | P1 | fast | Funcionário com comissões | POST `{format:'csv'}`, `'pdf'`, formato inválido, `dateFrom` | CSV/PDF com conteúdo e headers corretos; formato inválido cai em CSV; células com `= + - @` prefixadas (KF-04) | Total do arquivo == `commissions.get` | gap | - |
| EMP-18 | POST /api/employees/:id/export-commissions | P1 | fast | - | id inexistente | 404 | - | gap | - |
| EMP-06l | POST /api/employees/:id/export-commissions | P0 | fast | Funcionário de B | POST logado A | 404, sem arquivo de B | - | gap | - |
| EMP-06m | POST /api/employees/:id/export-commissions | P2 | fast | Perfis | POST por perfil | emp-sem 403 (KF-09, it.fails) | - | gap | - |
| EMP-01a | POST /api/employees/:id/grant-access | P0 | fast | Funcionário de A com e-mail, papel de sistema `employee` existe | POST | 200; usuário criado, perfil vinculado a A com `employee_id` e papel `employee`; e-mail de redefinição enviado | 1 usuário e 1 perfil por e-mail | gap | - |
| EMP-01b | POST /api/employees/:id/grant-access | P0 | fast | Caller emp-sem (sem permissão de gestão) | POST | Correto: 403 (KF-09, it.fails). Papel concedido é sempre `employee`, nunca acima do de quem concede | Nenhum usuário criado | gap | - |
| EMP-01d | POST /api/employees/:id/grant-access | P0 | fast | Org no limite de usuários do plano | POST | Correto: respeita o limite do plano (G1-OQ-11, G1-SD-07). Candidato it.fails | Contagem de usuários <= limite | gap (it.todo, aguarda G1-OQ-11) | - |
| EMP-01e | POST /api/employees/:id/grant-access | P1 | fast | E-mail já existe como usuário/perfil | (a) na mesma org; (b) em outra org; (c) POST repetido | (a) reaproveita e vincula, sem criar usuário novo; (b) 400 `outra organização`; (c) idempotente | 1 só perfil por e-mail | gap | - |
| EMP-01f | POST /api/employees/:id/grant-access | P1 | fast | Sem e-mail; sem papel `employee`; funcionário deletado; falha no envio do e-mail | POST | 400; 422; 404; 500 com vínculo já criado e mensagem explicando | - | gap | - |
| EMP-06n | POST /api/employees/:id/grant-access | P0 | fast | Funcionário de B | POST logado A | 404; nenhum usuário criado | Nada criado | gap | - |

---

## 5. Defeitos suspeitos (SD) e perguntas de negócio (OQ)

### Defeitos suspeitos

Verificado = confirmado lendo o código; hipótese = precisa de teste ou de decisão para confirmar. Nenhum foi executado. Todos viram `it.fails` com entrada em `known-failures.md` (KF novo, numeração a cargo do test-engineer), exceto os já cobertos por KF-09.

| ID | Status | Descrição | Cenário |
|---|---|---|---|
| G1-SD-01 | Verificado (código) | `bank-accounts` POST e PUT aceitam `current_balance` e `initial_balance` direto do corpo, sem extrato de ajuste. Quebra I1 (saldo == extrato). | BAN-01a, BAN-01b, BAN-11b |
| G1-SD-02 | Hipótese | DELETE de conta com extratos ou maquininhas ativas não verifica dependências. | BAN-02b, PAY-02b |
| G1-SD-03 | Verificado (código) | `payment-terminals` POST e PUT gravam `bank_account_id` sem checar que a conta é da org (FK entre tenants). | PAY-07, PAY-07b |
| G1-SD-04 | Verificado (ausência de validação no handler) | Faltam validações de tipo e faixa: `account_type`, `initial_balance`, `payment_receipt_days`, `rates`, campos de funcionário não string. Pode resultar em 500 em vez de 400, ou em dado inválido persistido. Constraints de banco podem mitigar (confirmar em `db`). | BAN-09b, PAY-06, EMP-09 |
| G1-SD-05 | Verificado (código) | `employees` PUT aceita `role_id` sem permissão e sem validar que o papel é da mesma org. Funcionário comum pode se promover. Relacionado ao KF-09. | EMP-01c |
| G1-SD-06 | Verificado (código) | `commission-plans`, `bonuses` e `commission-rules` de funcionário não checam se o funcionário pertence à org; retornam vazio em vez de 404. Sem vazamento de dados confirmado, mas contrato inconsistente. | EMP-06i, EMP-06j, EMP-06k |
| G1-SD-07 | Verificado (código) | `grant-access` não tem permissão (KF-09) nem verifica limite de usuários do plano (`enforceEmployeeLimit` só no POST do funcionário). | EMP-01b, EMP-01d |

Verificação pendente G1-SD-07: a ausência de checagem de limite de usuários vem de grep por "enforce" apenas. Confirmar leitura completa de grant-access.post.ts antes de tratar como verificado.
| G1-SD-08 | Verificado (código) | `referenceMonth` (generate, progress, financial-records, generations) e `effectiveFrom` (value-versions) aceitam qualquer string, inclusive dia diferente de 01. Pode burlar o dedupe por mês e criar versões fora da vigência mensal. | BON-17, BON-18, BON-19 |
| G1-SD-09 | Hipótese (precisa de `db`) | `generate` insere o registro financeiro antes da linha de `bonus_generations`, sem transação. Chamadas concorrentes podem gerar erro 500 e deixar registro pendente órfão (bônus duplicado). | BON-01d |
| G1-SD-10 | Hipótese | `employees` DELETE não trata comissões pendentes nem atribuições de bônus ativas. | EMP-04a |
| G1-SD-11 | Verificado (código) | Em `bonuses/:id/financial-records/:recordId` DELETE, se o registro está `paid` mas a transação vinculada não é encontrada, o bloco de estorno é pulado em silêncio e o registro é apagado. Erros dos deletes de extrato e de `bonus_generations` não são checados e o fluxo não é atômico. | BON-02c |
| G1-SD-12 | Verificado (código) | Escritas de bank-accounts, payment-terminals e employees (exceto bônus) sem permissão: KF-09 já registrado. `payment-terminals` e `employees` não chamam `recordAudit` (bank-accounts chama), ver G1-OQ-12. | Linhas KF-09 |

Total: 12 itens (9 verificados, 3 hipóteses: G1-SD-02, G1-SD-09, G1-SD-10). G1-SD-12 está marcado Verificado e é contado entre os 9; ele descreve contexto de KF-09 e auditoria, sem cenário próprio.

### Perguntas em aberto para o product-owner

| ID | Pergunta |
|---|---|
| G1-OQ-01 | Quais chaves de permissão protegem bank-accounts, payment-terminals e employees (criar, editar, excluir, conceder acesso, exportar)? E quem pode ler contas e maquininhas (GET hoje só exige login)? |
| G1-OQ-02 | Saldo inicial na criação gera extrato de abertura? Editar `initial_balance` ou `current_balance` depois deve ser bloqueado ou virar ajuste com extrato? |
| G1-OQ-03 | Excluir conta com movimentos: bloquear (409) ou arquivar mantendo histórico? E se ela é a conta de uma maquininha ativa? |
| G1-OQ-04 | O que deve acontecer em organização suspensa ou com assinatura expirada para leitura e escrita nestes domínios? |
| G1-OQ-05 | A taxa da maquininha deve ser descontada do saldo recebido ou só informada no relatório? Alterar a taxa afeta lançamentos antigos? (Hoje: não deve reescrever histórico.) |
| G1-OQ-06 | Excluir maquininha usada em parcelas: bloquear ou arquivar? Como exibir parcelas antigas? |
| G1-OQ-07 | Excluir um bônus com pagamentos gerados: bloquear, manter pagamentos, ou cancelar pendentes? |
| G1-OQ-08 | Nova versão de valor com `effectiveFrom` retroativo para mês já gerado: bloquear ou apenas valer para meses sem geração? |
| G1-OQ-09 | `tax_id` duplicado de funcionário na mesma org é permitido? |
| G1-OQ-10 | Ao excluir ou desligar funcionário: o que acontece com comissões pendentes, atribuições de bônus e acesso do usuário vinculado? |
| G1-OQ-11 | O limite do plano conta usuários com acesso (grant-access) ou só funcionários cadastrados? |
| G1-OQ-12 | Auditoria (`recordAudit`) é obrigatória em payment-terminals e employees? |

Total: 12 perguntas.

---

## 6. Ordem de implementação para o test-engineer (uma PR por domínio)

Antes de começar: `test-reviewer` revisa este documento. Rodar a suíte atual e confirmar o estado real das colunas "dedicado" em `docs/testing/domains/*.md`.

1. **bank-accounts** (4 handlers). Menor e define o padrão (fake-supabase com duas orgs, matriz de papéis, `it.fails` para G1-SD-01/KF-09). Prioridade: BAN-01a/b, BAN-04a-d, BAN-02a/b, depois P1/P2. Arquivo sugerido: `tests/fast/bank-accounts/handlers.test.ts`.
2. **payment-terminals** (4 handlers). Reusa o padrão; depende de uma conta bancária de duas orgs (G1-SD-03). Arquivo: `tests/fast/payment-terminals/handlers.test.ts`.
3. **bonuses** (13 handlers, maior risco financeiro). Ordem: BON-02a-e (estorno de saldo), BON-01a-f (idempotência de geração), BON-03, BON-05, BON-04, depois CRUD e permissões. BON-01d (concorrência) em `tests/db`, fora da PR `fast` se o ambiente local não estiver disponível. Arquivos sugeridos em `tests/fast/bonuses/`, um por grupo (crud, assignments, generate, financial-records).
4. **employees** (10 handlers). Ordem: EMP-01a-f (grant-access), EMP-02a (paridade com relatório), EMP-10, EMP-01c, depois CRUD, leituras e export. Arquivos em `tests/fast/employees/`.

Em todas as PRs: não alterar código de produção; um `it.fails` por defeito suspeito com KF novo em `docs/testing/known-failures.md`; atualizar as colunas "teste dedicado" dos `docs/testing/domains/*.md` só depois de executar a suíte. Respostas às G1-OQ-xx bloqueiam apenas as linhas que as citam, e essas linhas ficam como `it.todo` até haver decisão.
