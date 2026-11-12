# Falhas conhecidas reveladas pelos testes

> Criado em 2026-11-09 junto com a primeira implementação de `docs/testing/test-plan.md`.
> Cada item abaixo é um **defeito real do produto** (ou pendência de infraestrutura) que um teste automatizado revelou.
> Nenhum foi corrigido nesta entrega: o objetivo era travar o comportamento atual e deixar o conserto registrado.

## Como a trava funciona (para não quebrar o CI)

| Mecanismo | O que faz | Como "fechar" um item |
|---|---|---|
| `it.fails(...)` | O teste descreve o comportamento **correto** e hoje falha. O Vitest conta como sucesso. | Corrigir o código. O Vitest passa a acusar *"unexpected pass"*: trocar `it.fails` por `it`. |
| Catraca (`tests/static/baselines/*.json`) | Lista das exceções atuais. O teste falha se **surgir** exceção nova **ou** se uma antiga for corrigida (para a lista encolher). | Corrigir a rota/migration e rodar `UPDATE_BASELINE=1 pnpm test` para regravar a lista. |

Referências nos testes: procure por `KF-nn` no código.

## Prioridade

- **P0** — vazamento entre oficinas, escalonamento de privilégio, dinheiro com saldo errado. Corrigir antes de qualquer lançamento.
- **P1** — risco real, mas exige condição específica.
- **P2** — higiene.

---

## Segurança e isolamento (R1/R2)

### KF-14 · ✅ corrigido em 2026-11-09 (Fase 0a do painel do owner) · `POST /api/users/assign-organization` permite tomar uma oficina
Qualquer usuário logado **sem organização** pode se vincular a **qualquer** `organization_id` com **qualquer** `role_id` (inclusive o papel `admin` dela). O handler só confere que `user_email == employee_email` (o próprio e-mail) e que o alvo ainda não tem organização. Não valida que o usuário tem permissão na oficina, nem que `role_id`/`employee_id` pertencem a ela.
- Teste: `tests/fast/users/users-roles-security.test.ts` → *"usuário sem organização NÃO pode se vincular a uma oficina arbitrária como admin"*.
- Correção sugerida: remover a rota se não for mais usada (vínculo hoje nasce em `employees/:id/grant-access`); senão exigir `requireOrgPermission('employees.update')` e validar que `employee_id`/`role_id` são da organização de quem chama.

### KF-13 · ✅ corrigido em 2026-11-09 (Fase 0a do painel do owner) · `POST /api/users/update-fields` altera qualquer usuário
Aceita `user_id`, `organization_id`, `role_id`, `employee_id`, `email` do corpo e atualiza `user_profiles` **sem checar organização nem permissão**. Qualquer usuário logado pode trocar a oficina ou o papel de qualquer outro (e o próprio).
- Testes (3): outra organização · trocar o próprio `organization_id` · colega sem permissão.
- Correção: restringir ao mesmo `organization_id` da sessão, exigir permissão e **nunca** aceitar `organization_id` do corpo.

### KF-11 · ✅ corrigido em 2026-11-09 (Fase 0a do painel do owner) · `POST /api/users/update-role` sem checagem de permissão
Verifica só que o alvo é da mesma oficina. Um funcionário comum consegue promover colega — ou a si mesmo — para `admin`.
- Testes (2): colega · autopromoção.
- Correção: `requireOrgPermission('roles.update')` (ou equivalente).

### KF-12 · ✅ corrigido em 2026-11-09 (Fase 0a do painel do owner) · `update-role` aceita `role_id` de outra oficina
O `role_id` não é validado contra a organização. Pode-se apontar um usuário para um papel de outra oficina.
- Correção: `roles` filtrado por `organization_id` antes do update.

### KF-15 · ✅ corrigido em 2026-11-09 (Fase 0a do painel do owner) · `POST /api/roles/:id/actions` — funcionário se dá permissões
Sem `requireOrgPermission`. Um funcionário concede a si mesmo qualquer ação concedendo-a ao próprio papel (R2 do plano).

### KF-16 · ✅ corrigido em 2026-11-09 · `DELETE /api/roles/:id` apaga papel de sistema
Não verifica `is_system_role` nem se o papel está em uso. Um usuário pode excluir `admin`/`employee`, quebrando `resolveEmployeeRoleId` e o acesso da oficina.

### KF-17 · ✅ corrigido em 2026-11-09 (Fase 0a do painel do owner) · `POST /api/roles` sem permissão
Qualquer logado cria papéis na própria oficina.

### KF-09 · P0 · (parcial: 123 → 109) rotas de escrita sem `requireOrgPermission`/`requireOwner`
Mapeadas em `tests/static/baselines/write-routes-without-permission.json` (catraca: só pode diminuir). Inclui rotas de dinheiro (`process-payment`, `pay`, `payment.delete`…). Um funcionário sem papel consegue, por API, receber/estornar pagamentos.
- Teste ilustrativo: `money-flows.test.ts` → *"M4: funcionário sem permissão de OS não deveria receber pagamento"*.
- Correção: ir removendo rota por rota da lista, na ordem dinheiro → equipe/papéis → cadastros.

### KF-05 · ✅ corrigido em 2026-11-09 (Fase 0a do painel do owner) · `GET /api/consulta` expõe lançamentos financeiros por CPF, sem login
Devolve nome, `tax_id` e até 100 lançamentos de `employee_financial_records` (valor, datas, observações, `service_order_id`) para quem informar um CPF de 11 dígitos. Enumerável.
- Já previsto no plano (§7.2, "supabase/health, consulta"). Registrado na catraca `unguarded-routes.json`.
- Correção: exigir autenticação do funcionário ou remover.

### KF-06 · ✅ corrigido em 2026-11-09 (Fase 0a do painel do owner) · `POST /api/reports/export-file` sem login
Gera PDF/CSV a partir de qualquer corpo. Permite abuso de CPU (PDF) e uso do domínio para gerar documentos arbitrários. Combina com KF-04 (injeção de fórmula).

### KF-07 · ✅ corrigido em 2026-11-09 (Fase 0a do painel do owner) · `GET /api/vehicles/lookup-plate` sem login
Consome o token pago do provedor de placas (`WDAPI_TOKEN`) para qualquer visitante.

### KF-08 · ✅ corrigido em 2026-11-09 (Fase 0a do painel do owner) · `server/api/fiscal/zip_code/index.get.ts` está vazio (0 bytes)
Rota fantasma. Existe só `zip_code/[zip_code].get.ts`.

### KF-22 · P1 · 31 handlers com service role que não citam `organization_id`
Lista em `tests/static/baselines/admin-client-without-org.json`. Muitos são legítimos (feedback é global), mas **precisam de revisão manual** — é exatamente o padrão de R1. Cada revisão remove uma linha da lista.

---

## Dinheiro (R3)

### KF-19 · ✅ corrigido em 2026-11-09 · Desfazer pagamento com várias parcelas na mesma conta deixa o saldo errado
`DELETE /api/service-orders/:id/payment` (e `reverseServiceOrderReceipt`) restauram `current_balance = statement.previous_balance` **de cada extrato, em sequência**. Com 3 parcelas de R$ 100 (1000→1100→1200→1300), o saldo termina em 1200, não em 1000.
- Teste: `tests/fast/flows/undo-payment.test.ts` → *"3 parcelas pagas na mesma conta"*.
- Correção: subtrair o `amount` do saldo atual (`saldo - valor`) dentro de uma RPC transacional, em vez de gravar um saldo antigo (decisão D2 do plano).

### KF-02 · ✅ corrigido em 2026-11-09 · Estorno de recebimento sobrescreve movimentos posteriores
Mesma causa de KF-19, caso unitário: `reverseServiceOrderReceipt` grava `previous_balance`; se a conta teve outro lançamento depois, ele é perdido.
- Teste: `payments-l2.test.ts` → *"estorna só o valor do recebimento, preservando movimentos posteriores"*.

### KF-18 · ✅ corrigido em 2026-11-09 · `POST /api/financial/:id/pay` não movimenta saldo nem extrato
Só muda `status` para `paid`. Já `pay-entries-bulk` e `pay-commissions-bulk` atualizam `current_balance`. Não há gatilho no banco (conferido nas migrations). O mesmo lançamento gera resultados diferentes conforme a tela usada.
- Teste: `money-flows.test.ts` → *"pagar um lançamento com conta bancária movimenta o saldo e gera extrato"*.

> KF-02/KF-19: `server/utils/bank-balance.ts` (`revertStatementOnAccount`) desfaz o efeito do extrato sobre o saldo atual (saldo − efeito) nos 6 pontos de estorno. KF-18: `financial/:id/pay` agora gera extrato e movimenta o saldo (sem duplicar). KF-03: sem assinatura ativa vale o limite do plano starter. KF-16: papel de sistema ou em uso não pode ser excluído. KF-01/04: recorrência ancorada no dia original; `csvEscape` prefixa `'` em textos que começam com `= + - @`.

### Observação (sem teste de falha): atualização de saldo não é atômica
`createIncomeTransaction` lê o saldo, soma e grava (read-modify-write). Dois recebimentos simultâneos na mesma conta podem perder um deles. Só dá para provar com Postgres real (KF-00).

### KF-03 · ✅ corrigido em 2026-11-09 · Organização sem assinatura ativa tem funcionários ilimitados
`resolveOrgLicense` devolve `maxEmployees = null` quando não há assinatura ativa, e `enforceEmployeeLimit` trata `null` como "sem limite". Já `enforceReportAccess` trata a mesma situação como **bloqueio**. Comportamentos opostos para o mesmo estado.
- Teste: `guards-l2.test.ts` → *"sem assinatura ativa não deveria liberar funcionários ilimitados"*.

---

## Correção de cálculo e dados

### KF-01 · ✅ corrigido em 2026-11-09 · Recorrência mensal no dia 29/30/31 "transborda" para o mês seguinte
`expandRecurrence` usa `setUTCMonth(+1)`: 31/01 → `03/03`, não `28/02`. Despesas recorrentes mensais nesses dias ficam fora do mês certo e deslocam todas as seguintes.
- Teste: `recurrence.test.ts`.

### KF-04 · ✅ corrigido em 2026-11-09 · `csvEscape` não neutraliza injeção de fórmula
Células iniciando em `=`, `+`, `-` ou `@` são interpretadas pelo Excel/Planilhas. Esperado pelo plano (§5.5): prefixar com `'`.
- Testes (4) em `reports.test.ts`.

### KF-10 · ✅ corrigido em 2026-11-09 (a segunda ...093 virou ...099, idempotente) · Timestamp de migration duplicado: `20240101000093`
`..._add_commission_manual_adjustments_log_to_service_orders.sql` e `..._drop_legacy_employee_commission_columns.sql`. A ordem entre elas depende da ordem alfabética — frágil em banco limpo.
- Teste: `codebase.test.ts` (`it.fails` + catraca que impede novas duplicações). Correção: renumerar a segunda (a que remove colunas) para depois da que adiciona o log.

### KF-21 · P1 · Ações base de permissão não estão nas migrations
92 códigos de `ActionCode` (`customers.*`, `orders.*`, `employees.*`, `financial.*`, `appointments.*`…) **não aparecem em nenhuma migration**; só bonus/commission/product_categories/fiscal têm `seed_*`. A tabela `actions` do projeto real foi populada fora do repositório e `supabase/seeders/` está vazio.
- Consequências: (1) um banco limpo sobe **sem permissões** e `requireOrgPermission` devolve *"Permissão não reconhecida"* para todos os não-admins; (2) o plano de testes `api` precisa semear `actions` por conta própria.
- Lista: `tests/static/baselines/action-codes-not-seeded.json`. Correção: migration `seed_base_actions` gerada do banco de produção.

---

## Núcleo financeiro: OS, pagamentos, comissões e relatórios (reforço de 2026-11-09)

> Encontrados pelos testes de [financial-core-test-analysis.md](financial-core-test-analysis.md). Cada item tem um `it.fails` descrevendo o comportamento correto. Todos **abertos**.

### Comissão
- **KF-24 · P0 · Parcela parcialmente recebida não libera comissão.** `releaseServiceOrderCommissions` soma só parcelas `status='paid'`; o recebido numa parcela `partial` é ignorado. Causa provável de "comissão faltando". Testes: `commissions-release` (KF-24), `service-order-payments` (P26 e E2E). Correção: somar `financial_transactions` pagas por OS (ou o recebido por parcela) em vez de `installments.status='paid'`.
- **KF-25 · P1 · Quem deixou de ser responsável pela OS mantém a comissão pendente.** O fluxo automático só olha os responsáveis atuais.
- **KF-26 · P1 · Regra que passou a render 0 não recolhe o pendente antigo (fluxo automático).** `if (result.total <= 0) continue` pula o funcionário.
- **KF-36 · P0 · Recálculo manual de funcionário sem regra aplicável apaga os pendentes sem confirmação.** Incidente real de 10/09/2026 (R$ 7.130,99 em 21 OS) — ver `docs/finance/auditoria-arredondamento-comissoes-2026-09-10.md`. Correção sugerida: recusar com mensagem clara ou exigir confirmação explícita no corpo.

### Pagamento
- **KF-27 · P1 · Recebimento avulso não é limitado ao saldo da OS.** `receive-extra-payment` aceita qualquer valor > 0.
- **KF-28 · P1 · Avulso antes do plano bloqueia `process-payment`** ("já tem plano"), porque só `down_payment` é reconciliado. Tratar `extra` como o sinal, ou impedir o avulso antes do plano.
- **KF-29 · P1 · O plano aceita linhas negativas ou zeradas** desde que a soma feche (ex.: 1300 + (−300)).
- **KF-30 · P2 · Saldo somado em ponto flutuante** em `createIncomeTransaction` (`previous + amount` sem `roundMoney`): 10 × R$ 0,10 não dá R$ 1,00. `pay.post.ts` (KF-18) já arredonda.
- **KF-31 · P0 · `payment_status` olha as linhas, não os valores.** Avulso de R$ 100 numa OS de R$ 1.000 a deixa `paid` e ela some dos devedores. Correção: derivar de `Σ recebido ≥ total_amount`.

### OS (edição)
- **KF-37 · P0 · `POST /service-orders` (edição) aceita `payment_status` do corpo.** Qualquer cliente da API pode marcar uma OS como paga sem entrada de dinheiro, inflando/limpando relatórios.
- **KF-38 · P0 · Editar valor/itens depois de receber não reconcilia as comissões já liberadas** (ficam velhas até o próximo pagamento). Chamar `releaseServiceOrderCommissions` após a edição quando a OS tem recebimentos.
- **KF-39 · P0 · Aumentar o total de OS quitada mantém `payment_status='paid'`.** Re-derivar o status após a edição.

### Pagamentos fora da OS e cancelamento (2ª rodada, 2026-11-09)
> Testes: `tests/fast/financial/financial-payments.test.ts`. Os quatro primeiros (KF-40 a KF-42 e KF-44) têm `it.fails`; o KF-43 é só caracterização.

- **KF-40 · P0 · `cancel` da OS apaga comissão já paga e estorna o dinheiro.** O laço de `cancel.post.ts` remove todo registro `commission` da OS (inclusive `paid`), reverte o extrato e apaga a despesa. Viola a invariante I3. Alcançável com `commission_release_mode='full'`, em que a comissão é paga antes de a OS receber algo. Correção: recusar (409) quando houver comissão paga, como o estorno de pagamento já faz.
- **KF-41 · P2 · `pay-entries-bulk` soma o saldo em ponto flutuante** (sem `roundMoney`): 10 × R$ 0,10 dá 1001.0000000000002. Mesmo defeito do KF-30, em outro caminho. `pay-commissions-bulk` e `commissions/:id/pay` têm o mesmo padrão (`saldo − valor`).
- **KF-42 · P1 · Excluir um lançamento pago (`DELETE /financial/:id`) não devolve o saldo nem estorna o extrato.** Só faz soft delete; para lançamento de OS há `reverseServiceOrderReceipt`, para os demais não. A conta fica com o saldo movimentado por um lançamento excluído (quebra I10).
- **KF-44 · P0 · `DELETE /reports/commissions/:id` apaga comissão já paga.** Não olha o status: o registro some do relatório, mas a despesa "Salários" e o saldo ficam (quebra I3). Correção: recusar (409) quando `status='paid'`. Teste: `financial-payments.test.ts`.
- KF-43 (caracterização, decisão de produto): **`purchases/:id/pay` só muda `payment_status`.** Não cria lançamento, extrato nem mexe no saldo, apesar de `bank_account_id` ser obrigatório na compra. Compras pagas aparecem no relatório de compras e não entram em despesas/caixa (`overview`, `profit-cash-flow`, `costs-profit`). Decidir se é desejado.

### Relatórios
- **KF-32 · P1 · Comissão pendente de OS excluída some do relatório de comissões** mas continua em `employee_financial_records` (o relatório exige a OS viva).
- **KF-33 · P2 · Gráfico "por funcionário" soma comissão *cancelada* como pendente**; o resumo não.
- **KF-34 · P1 · Devedores: OS sem plano com sinal pago aparece pelo total**, sem descontar o sinal.
- KF-35 (caracterização, sem `it.fails`): "Lucro pelas OS" sem filtro de status soma orçamento e cancelada. Decidir se o padrão deve ser só OS concluídas.

### KF-09, visão financeira (teste novo)
- `tests/fast/access/financial-permissions.test.ts` prova que **10 rotas de dinheiro respondem 200 a um usuário sem nenhuma permissão**: `financial/:id/pay`, `pay-entries-bulk`, `pay-commissions-bulk`, `reports/commissions/:id/pay`, `down-payment`, `process-payment`, `receive-extra-payment`, `cancel`, `purchases/:id/pay` e `DELETE financial/:id`. São `it.fails` (um por rota) e mais uma varredura estática (26 escritas financeiras sem `requireOrgPermission`/`requireOwner`). Ao corrigir uma rota, troque o `it.fails` dela por `it`.

### bank-accounts (lote G1, PR 1)
> Testes: `tests/fast/bank-accounts/handlers.test.ts`. Cenários: `docs/testing/endpoint-scenarios-g1.md` §1.

- **KF-45 · P0 · `POST` e `PUT /api/bank-accounts` aceitam `current_balance` direto do corpo, sem extrato de ajuste** (G1-SD-01). Quebra I1 (saldo == saldo inicial + soma dos extratos). Testes `it.fails`: BAN-01a (POST) e BAN-01b (PUT). A correção não está decidida (rejeitar ou gerar ajuste com extrato); os testes só exigem a invariante. Relacionado: BAN-03 e BAN-11b (G1-OQ-02), ainda `it.todo`.
- **KF-46 · P1 · `POST /api/bank-accounts` não valida tipo nem faixa** (G1-SD-04). Só testa campos falsy: `account_name` não string, `initial_balance` negativo/string/NaN e `account_type` fora de qualquer conjunto são gravados; corpo ausente vira `TypeError` (500) em vez de 400. Testes `it.fails`: BAN-09 (corpo ausente, nome não string) e BAN-09b (4 casos). O conjunto válido de `account_type` e se saldo inicial negativo é permitido precisam de confirmação do product-owner.
- **KF-47 · P2 · bank-accounts POST/PUT/DELETE sem permissão por papel** (faceta do KF-09, G1-OQ-01 define a chave). Funcionário sem permissão recebe 200. Testes `it.fails`: BAN-05a, BAN-05b, BAN-05c (emp-sem -> 403).

### bonuses (lote G1, PR 2)
> Testes: `tests/fast/bonuses/financial-records.test.ts` e `tests/fast/bonuses/generate.test.ts`. Cenários: `docs/testing/endpoint-scenarios-g1.md` §3.

- **KF-48 · P0 · `DELETE /api/bonuses/:id/financial-records/:recordId` apaga registro pago sem estornar quando a transação vinculada não é encontrada** (G1-SD-11). Se `status=paid` e a transação está deletada (soft) ou ausente, o bloco de estorno é pulado em silêncio: o registro recebe `deleted_at`, mas o extrato do pagamento e o saldo reduzido permanecem, e a resposta é 200. Testes `it.fails`: BON-02c (2 cenários: transação soft-deleted e transação ausente). O teste não escolhe a solução: rejeitar (4xx, registro intacto) ou estornar o extrato antes de apagar passam. Erros dos deletes de extrato e de `bonus_generations` também não são checados e o fluxo não é atômico (não coberto: o fake `failNext` não permite falhar a escrita específica).
- **KF-49 · P1 · `POST /api/bonuses/:id/generate` aceita `referenceMonth` em qualquer dia** (G1-SD-08). O dedupe compara a string crua: `"2026-11-15"` e `"2026-11-01"` geram dois registros financeiros de bônus para o mesmo funcionário e mês. Teste `it.fails`: BON-19. Aceita normalizar para o dia 01 ou rejeitar. Faceta relacionada (progress, financial-records, generations, value-versions) fica nos BON-17/BON-18 das PRs seguintes.

### taxes (lote G3, PR 3)
> Testes: `tests/fast/taxes/handlers.test.ts`. Cenários: `docs/testing/endpoint-scenarios-g3.md` §1.

- **KF-65 · P1 · `POST` e `PUT /api/taxes` não validam `rate` nem o tipo de `name`/`type`** (G3-SD-01). Alíquota negativa, maior que 100, `'abc'` e `NaN` são gravadas (isso vale para o fake de teste: em Postgres numérico `'abc'` daria erro 500, e `NaN` não é alcançável via HTTP/JSON, pois `JSON.stringify(NaN)` vira `null`, que cai no 400 do TAX-08); `name`/`type` numérico, objeto ou array também. Alíquota inválida entra no `total_taxes_amount` da OS e na base de comissão. Testes `it.fails`: TAX-01a (5 valores), TAX-01b (name e type x 3 tipos), TAX-01c (PUT: -1, 150, 'abc', null, ''). `'5'` (G3-OQ-02) e `type` fora do conjunto (G3-OQ-03) ficam `it.todo`. Uma constraint de banco pode mitigar (confirmar em `db`).
- **KF-66 · P1 · `PUT /api/taxes/:id` aceita `name`/`type` vazio ou null** (G3-SD-02). O POST exige não vazio; o PUT só checa `!== undefined`. Testes `it.fails`: TAX-01d (`name ''`, `name null`, `type ''`).
- **KF-67 · P2 · taxes POST/PUT/DELETE sem permissão por papel** (faceta do KF-09; chave definida por G3-OQ-01). Funcionário sem permissão recebe 200. Testes `it.fails`: TAX-11, TAX-14, TAX-17 (emp-sem -> 403).

### payment-terminals (lote G1, PR 4)
> Testes: `tests/fast/payment-terminals/handlers.test.ts`. Cenários: `docs/testing/endpoint-scenarios-g1.md` §2.

- **KF-68 · P0 · `POST` e `PUT /api/payment-terminals` aceitam `bank_account_id` de conta de outra organização** (G1-SD-03). Nenhum dos dois consulta a conta: o terminal de A pode apontar para a conta de B (FK cruzada entre orgs; recebimentos por maquininha poderiam movimentar saldo de outro tenant). Testes `it.fails`: PAY-07 (POST) e PAY-07b (PUT); esperam 400/404 e nenhuma linha criada/alterada.
- **KF-69 · P1 · `POST /api/payment-terminals` só valida `terminal_name` falsy** (G1-SD-04). `terminal_name` só com espaços, `payment_receipt_days` negativo ou string e `rates` com `rate_percentage` < 0 ou > 100 são gravados. Testes `it.fails`: PAY-06 (espaços, 2 de `payment_receipt_days`, 2 de `rates`). Obrigatoriedade de `payment_receipt_days` e shape de `rates` ficam `it.todo`. Obs.: o PUT também não valida nada (sem teste próprio; mesma causa).
- **KF-70 · P2 · payment-terminals POST/PUT/DELETE sem permissão por papel** (faceta do KF-09, mesmo mecanismo do KF-47/KF-67; G1-OQ-01 define a chave). Funcionário sem permissão recebe 200. Testes `it.fails`: PAY-03c, PAY-03e, PAY-03g (emp-sem -> 403).

### purchase-requests (lote G2, PR 5)
> Testes: `tests/fast/purchase-requests/handlers.test.ts`. Cenários: `docs/testing/endpoint-scenarios-g2.md` §3.

- **KF-55 · P1 · `POST /api/purchase-requests` converte preço de item inválido em 0 e aceita negativo** (G2-SD-11). `parseFloat(...)||0`: `estimated_total_price` `"abc"` vira 0 e `-10` entra na soma, sempre com 200 e `total_request_amount` sem sentido. Testes `it.fails`: PRQ-12b (um por valor: `"abc"` e `-10`); esperam 400 e nada inserido. O PUT também aceita `total_request_amount` sem recalcular (PRQ-15, `it.todo` G2-OQ-09/G2-OQ-11).
- **KF-56 · P0 · `POST` e `PUT /api/purchase-requests` aceitam `supplier_id` de fornecedor de outra organização** (G2-SD-01). Nenhum dos dois consulta o fornecedor: a solicitação de A pode apontar para o fornecedor de B (FK cruzada entre orgs). Testes `it.fails`: PRQ-03b (POST) e PRQ-03d (PUT em solicitação própria); esperam 400/404 e nada criado/alterado. O PUT em solicitação de B já é 404 (teste normal). `purchase_id` cruzado no PUT segue a mesma causa e não tem teste próprio.
- **KF-57 · P1 · `authorize` e `reject` de purchase-requests só exigem login** (faceta do KF-09; G2-SD-06; G2-OQ-01 define a chave). Funcionário sem permissão autoriza/recusa e fica gravado como `authorized_by`. Testes `it.fails`: PRQ-01c (authorize) e PRQ-01f (reject), emp-sem -> 403. Faceta emp-com 200 fica `it.todo` (G2-OQ-01).
- **KF-58 · P2 · purchase-requests POST/PUT/DELETE sem permissão por papel** (faceta do KF-09, mesmo mecanismo do KF-47/KF-67/KF-70; G2-OQ-01 define a chave). Funcionário sem permissão recebe 200. Testes `it.fails`: PRQ-03c, PRQ-03e, PRQ-03f (emp-sem -> 403).

### purchases (lote G2, PR 7)
> Testes: `tests/fast/purchases/handlers.test.ts`. Cenários: `docs/testing/endpoint-scenarios-g2.md` §1. `pay` (PUR-01a/b/c/d) já está em `financial-payments.test.ts` e `financial-permissions.test.ts`.

- **KF-59 · P1 · `POST /api/purchases` valida só presença dos campos** (G2-SD-02). `total_amount` negativo, string `"abc"` e `NaN`, `purchase_date` `"abc"` e `payment_status` fora do conjunto (`"banana"`) respondem 200 e são gravados. Testes `it.fails`: PUR-12b (5 valores, um teste por valor); esperam 400 e nada inserido. `NaN` só é alcançável chamando o handler direto (via JSON vira `null` e cai no 400 de PUR-12). O PUT também não valida nada (sem teste próprio; mesma causa). Regras de total/arredondamento (PUR-04) e de `payment_date` no pay (PUR-01g) ficam `it.todo` (G2-OQ-03, G2-OQ-10).
- **KF-60 · P0 · `POST` e `PUT /api/purchases` aceitam `supplier_id` e `bank_account_id` de outra organização** (G2-SD-01). Nenhum dos dois consulta fornecedor ou conta: a compra de A pode apontar para o fornecedor/conta de B (FK cruzada entre orgs; pagamento poderia ser atribuído à conta de outro tenant). Testes `it.fails`: PUR-06b (POST, `supplier_id` e `bank_account_id` de B) e PUR-06d (PUT em compra própria, os dois campos); esperam 400/404 e nada criado/alterado. O PUT em compra de B já é 404 (teste normal).
- **KF-61 · P2 · purchases POST/PUT/DELETE sem permissão por papel** (faceta do KF-09, mesmo mecanismo do KF-47/KF-58/KF-67/KF-70; G2-OQ-01 define a chave). Funcionário sem permissão recebe 200. Testes `it.fails`: PUR-06c, PUR-06e, PUR-06f (emp-sem -> 403). O `pay` está no `it.fails` de `financial-permissions.test.ts`. Faceta emp-com 200 fica `it.todo` (G2-OQ-01).

### purchase-returns (lote G2, PR 9)
> Testes: `tests/fast/purchase-returns/handlers.test.ts`. Cenários: `docs/testing/endpoint-scenarios-g2.md` §2. Numeração: KF-63/KF-64 (livres) e KF-71/KF-72 (próximos livres após KF-70).

- **KF-63 · P0 · `POST /api/purchase-returns` não compara quantidade nem valor devolvido com a compra** (G2-SD-05). O handler não consulta a compra: devolver qtd 6 de item qtd 5, devolver 3 + 3 (acumulado 6 > 5) e `total_returned_amount` (900) acima do total da compra (500) respondem 200 e são gravados. Testes `it.fails`: PRT-01 (qtd 6; 3+3) e PRT-01b (valor); esperam 400 e nada criado. Os testes usam o formato de `returned_items` da UI (`app/pages/app/products/purchase-returns.vue`: `purchase_item_index`, `part_id`, `description`, `quantity`, `unit_price`, `total_price`, `notes`); o comentário SQL da migration `20240101000024_create_purchase_returns.sql` diverge da UI. O handler aceita qualquer array e não casa por índice, então o 400 esperado vem só da regra de quantidade/valor excedido. Ajuste de estoque/financeiro ao completar: `it.todo` PRT-02 (G2-OQ-02).
- **KF-64 · P1 · `POST /api/purchase-returns` converte `status` inválido em `pending` e não valida `total_returned_amount`** (G2-SD-10). `status: 'xyz'` responde 200 e vira `pending`; `total_returned_amount` negativo (`-10`) e string (`"abc"`) respondem 200 e são gravados (só a presença é checada). Cobertura: G2-SD-10 (status) e PRT-12b (total, sem SD próprio). Testes `it.fails`: PRT-12b (3 valores, um teste por valor); esperam 400 e nada inserido. O PUT repassa `status` e `total_returned_amount` sem validar (sem teste próprio; PRT-15 `it.todo`, G2-OQ-09).
- **KF-71 · P0 · `POST` e `PUT /api/purchase-returns` aceitam `purchase_id`/`supplier_id` de outra organização ou de compra soft-deleted** (G2-SD-01). Nenhum dos dois consulta compra ou fornecedor: a devolução de A pode apontar para a compra/fornecedor de B (FK cruzada entre orgs) ou para compra excluída. Testes `it.fails`: PRT-03b (POST com `purchase_id` de B e com `supplier_id` de B), PRT-03c (POST com compra soft-deleted) e PRT-03e (PUT em devolução própria com `purchase_id` de B); esperam 400/404 e nada criado/alterado. O PUT em devolução de B já é 404 (teste normal) e `organization_id` do corpo é ignorado (teste normal).
- **KF-72 · P2 · purchase-returns POST/PUT/DELETE sem permissão por papel** (faceta do KF-09, mesmo mecanismo do KF-47/KF-52/KF-58/KF-61/KF-67/KF-70; G2-OQ-01 define a chave). Funcionário sem permissão recebe 200. Testes `it.fails`: PRT-03d, PRT-03f, PRT-03g (emp-sem -> 403), com controles que caracterizam o 200 atual. Faceta emp-com 200 fica `it.todo` (G2-OQ-01).
- **Sem KF (ficou `it.todo` ou limitação do fake):** PRT-02, PRT-13, PRT-15 e PRT-16b (completed) aguardam G2-OQ-02/G2-OQ-09; PRT-10/PRT-03a busca por fornecedor/compra não provável (`or()` é no-op no fake).

### settings (lote G3, PR 10)
> Testes: `tests/fast/settings/handlers.test.ts`. Cenários: `docs/testing/endpoint-scenarios-g3.md` §2. Settings é por usuário (`user_id` da sessão), não por organização (KF-22 é desenho legítimo). Numeração: KF-73 a KF-75 (próximos livres após KF-72; a faixa G3 KF-65 a KF-70 já foi consumida por taxes e payment-terminals).

- **KF-73 · P1 · `PUT /api/settings/preferences` e `PUT /api/settings/notifications` não validam tipos** (G3-SD-02). `primary_color` numérico ou objeto e `channel_email` `'yes'`, `1` ou `null` respondem 200 e vão ao upsert (`null` cai no default via `??`). Testes `it.fails`: SET-02a (2: número e objeto) e SET-02c (3: `'yes'`, `1`, `null`); esperam 400 e nada persistido, com controle positivo de PUT válido. O conjunto válido de `color_mode`, `timezone` e `*_permission` fica `it.todo` (G3-OQ-07).
- **KF-74 · P1 · `habit_reminders` de `settings/notifications` não é persistido** (G3-SD-05). O PUT devolve o valor enviado, mas a coluna não está no upsert nem no `select` do GET: o GET devolve sempre `true` (preferência perdida). Teste `it.fails`: SET-15 (PUT `false` e depois GET deve devolver `false`); controle normal caracteriza o eco `false` do PUT. Obs.: o fake não respeita a lista de colunas do `select`, mas aqui o upsert já não grava a coluna, então o defeito é provado.
- **KF-75 · P2 · `POST /api/settings/notifications/device` é stub que ecoa qualquer corpo** (G3-SD-06). Não valida token nem tipo do corpo e não grava: sem corpo, `null`, string e `token ''` respondem 200 `{ok, receivedAt, device}` (`device: null` sem corpo). Testes `it.fails`: SET-01c (4 casos); esperam 400 e nada ecoado. O comportamento atual (SET-01a, SET-01d: nada gravado, sem associação cruzada) é teste normal.
- **Sem KF (ficou `it.todo` ou limitação do fake):** SET-07 (1 linha por usuário após dois PUTs): o `upsert` do fake ignora `onConflict` e sempre insere, então a idempotência real fica para `tests/db`; SET-02b/SET-14 (merge vs reset; G3-OQ-08, G3-SD-07) são caracterizados/`it.todo`; SET-09, SET-17 e SET-01e aguardam G3-OQ-10; SET-01b aguarda G3-OQ-09. "habit_reminders sempre true" só é provado para linha sem a coluna (o fake devolve a linha inteira no `select`).

### bonuses (lote G1, PR 6)
> Testes: `tests/fast/bonuses/crud.test.ts`, `assignments.test.ts`, `value-versions.test.ts` e `progress.test.ts`. Cenários: `docs/testing/endpoint-scenarios-g1.md` §3.

- **KF-50 · P1 · `POST /api/bonuses/:id/value-versions` e `GET /api/bonuses/:id/progress` aceitam `effectiveFrom`/`referenceMonth` em qualquer formato e dia** (G1-SD-08). Continuação do KF-49 (generate). `effectiveFrom` `"abc"` ou `"2026-11-15"` é gravado como veio, criando versão fora da vigência mensal; `referenceMonth` `"abc"` ou `"2026-11-15"` devolve 200 (esta última com o mês calculado a partir do dia 15). Testes `it.fails`: BON-18 (2: `"abc"` e `"2026-11-15"`) e BON-17 (2: `"abc"` e `"2026-11-15"`); esperam 400 (normalizar para o dia 01 também seria aceitável, mas o cenário pede 400). O `POST /api/bonuses` tem a mesma lacuna em `effectiveFrom` (sem teste próprio nesta PR); `financial-records` e `generations` não foram revalidados aqui.
- **KF-51 · P2 · `DELETE /api/bonuses/:id/assignments/:employeeId` não é idempotente** (divergência do cenário BON-05f, sem SD no plano). O UPDATE casa por `(bonus_id, employee_id)` sem filtrar `deleted_at`; a segunda chamada para uma atribuição já removida responde 200 e regrava `deleted_at`/`deleted_by` (perde a data e o autor da remoção original) em vez de 404 `Atribuição não encontrada`. Teste `it.fails`: BON-05f (segunda chamada). Funcionário nunca atribuído já devolve 404 (teste normal).
- **Sem KF (ficou `it.todo` ou limitação do fake):** BON-14 (G1-OQ-07) e BON-03c (G1-OQ-08) aguardam decisão do product-owner. BON-03b (caminho `23505 -> update` de value-versions) não é alcançável com o fake atual: sem constraint única e sem `error.code`; cobrir em `tests/db` (PR 11) ou estendendo o fake. BON-10 (compensação do POST) foi implementado normalmente: `failNext('bonus_value_versions')` cai no insert da versão.

### employees (lote G1, PR 8)
> Testes: `tests/fast/employees/` (`grant-access`, `commissions`, `crud`, `reads`, `export`). Cenários: `docs/testing/endpoint-scenarios-g1.md` §4. Faixa G1 (KF-45 a KF-54) completada com KF-52 a KF-54; KF-62 foi usado por este lote; KF-63 e KF-64 pertencem ao lote purchase-returns (PR 9).

- **KF-52 · P0 · employees POST/PUT/DELETE, `export-commissions` e `grant-access` sem permissão por papel** (faceta do KF-09, mesmo mecanismo do KF-47/KF-58/KF-61/KF-67/KF-70; G1-OQ-01 define a chave; G1-SD-07). Funcionário sem permissão recebe 200: cria, edita e exclui funcionários, exporta as comissões de qualquer funcionário e **concede acesso de usuário** (cria usuário de autenticação, perfil vinculado à org e e-mail de redefinição de senha). O papel concedido é sempre o `employee` de sistema da org (verificado no controle do EMP-01b), nunca o de quem concede. Testes `it.fails`: EMP-01b (grant-access), EMP-06c (POST), EMP-06e (PUT), EMP-06g (DELETE), EMP-06m (export-commissions); todos emp-sem -> 403. Cada um tem controle positivo "caracteriza comportamento atual". Faceta emp-com 200 fica `it.todo` (G1-OQ-01). A varredura estática do KF-09 já lista estas 5 rotas em `write-routes-without-permission.json`. Severidade P0: o `grant-access` cria usuário de autenticação, o que eleva o risco; os irmãos (KF-47, KF-58, KF-61, KF-67, KF-70) são P2 pelo mesmo mecanismo.
- **KF-53 · P1 · `PUT /api/employees/:id` aceita `role_id` sem permissão e sem validar que o papel é da mesma org** (G1-SD-05). Para funcionário com usuário vinculado, o handler faz `UPDATE user_profiles SET role_id = <corpo>` filtrando só por `employee_id`: quem chama o PUT (inclusive emp-sem) grava um papel de outra organização (ex.: o `admin` de sistema de B) no perfil. Observação verificada no código: em seguida `syncEmployeeLinkedUserAccess` reescreve `role_id` com o papel `employee` de sistema da org do funcionário (se o acesso não está revogado), então o estado final tende a ficar correto; mesmo assim há uma janela com o papel de B gravado, o `UPDATE` não é atômico, e o `role_id` do corpo nunca é validado (se o sync falhar, fica o papel errado). Testes `it.fails`: EMP-01c (2): emp-sem -> 403 e nenhum `user_profiles` alterado (rotulado KF-52 no teste); owner com `role_id` de B -> 400/404 e nenhuma escrita em `user_profiles` com o papel de B. O fake registra em `fake.writes` a escrita de `user_profiles` com `r-admin-b`, e é isso que o teste do owner afirma (a janela em produção não é medida). Severidade P1 (não P0): o efeito real depende de o sync reescrever o papel, e o estado final normalmente fica correto. Caracterização: sem o papel `employee` de sistema na org, o PUT responde 422 mas o `role_id` de B já ficou gravado (teste normal em `crud.test.ts`). A faceta de permissão (emp-sem -> 403) é do KF-52/KF-09.
- **KF-54 · P1 · `GET /api/employees/:id/commission-plans` e `/bonuses` devolvem 200 com lista vazia para funcionário de outra org ou inexistente** (G1-SD-06). As consultas de atribuição filtram só por `employee_id`; a org é aplicada depois nos planos/bônus. Sem vazamento de dados (testes normais "sem vazamento" provam que nada de B aparece), mas o contrato é inconsistente com `commissions` e `export-commissions` (404 `Funcionário não encontrado`). Testes `it.fails`: EMP-06i (B e inexistente) e EMP-06k (B e inexistente); esperam 404. `commission-rules` tem a mesma causa, mas a regra do cenário aceita 200 vazio ou 404 (EMP-06j): ficou `it.todo` à espera da decisão de contrato; se for 404, vira `it.fails` KF-54.
- **KF-62 · P1 · `POST /api/employees` com `name`, `person_type`, `tax_id` ou `phone` que não são string vira erro interno em vez de 400** (G1-SD-04, faceta employees). O handler chama `.trim()` direto no valor do corpo: número, booleano, objeto ou array lançam `TypeError` (500 em produção; status 0 no harness), nunca 400. Faltantes, vazios e só espaços já dão 400 (testes normais). Testes `it.fails`: EMP-09 (6 casos: `name` numérico, booleano e objeto; `person_type` numérico; `tax_id` numérico; `phone` array). Os demais campos do POST (`salary_amount`, `payment_day`, `pix_key_type` etc.) e todo o PUT também não validam tipo nem faixa (sem teste próprio nesta PR; mesma causa).
- **Sem KF (ficou `it.todo` ou limitação do fake):** EMP-01d (limite de usuários do plano no grant-access; G1-OQ-11, G1-SD-07), EMP-11 (`tax_id` duplicado; G1-OQ-09), EMP-04a (DELETE com comissão pendente e bônus atribuído; G1-OQ-10, G1-SD-10), emp-com 200 das escritas (G1-OQ-01) e EMP-06j (contrato 404 vs 200 vazio). EMP-07: o filtro de desligados do GET lista e a contagem de ativos do limite do plano (EMP-10) usam `or()`, que é no-op no fake: "padrão exclui desligado" e `search` ficam `it.todo` (cobrir em `tests/db`). EMP-01e(c) "1 perfil por e-mail": o `upsert` do fake não resolve `onConflict: 'user_id'`; o teste prova que o `user_id` é o mesmo nos dois upserts e que `createUser` é chamado uma vez. EMP-02b/KF-32 reaproveita a entrada KF-32 existente (não há KF novo).
- Observação de leitura, sem teste (não pedida no escopo): `GET /api/reports/commissions` lê `employee_financial_records` sem filtrar `deleted_at`, enquanto `getEmployeeCommissionReport` (usado por `employees/:id/commissions` e pelo export) filtra. Se registros de comissão forem soft-deletados, os dois totais divergem; a paridade EMP-02a foi provada só com registros vivos.

---

## Pendências do núcleo financeiro (migradas de `financial-core-test-analysis.md`)

> O documento de análise foi dado como concluído em 2026-11-09. O que ficou sem teste, sem decisão ou dependente de banco real está aqui. IDs de cenário (E15, P42…) são os do catálogo daquele documento.

### Cenários ainda sem teste automatizado
| ID | O que falta cobrir | Observação |
|---|---|---|
| E15 | Transição de status de OS inválida (ex.: `cancelled` → `completed` sem estorno) | Ler as regras de transição em `service-orders/index.post.ts` antes de escrever. |
| E20 | Editar OS sem permissão de OS → 403 | `service-orders/index.post.ts` está no baseline do KF-09; vira `it.fails` como os da §KF-09 financeira. |
| E21 | Editar itens/custo recalcula `total_cost_amount` e o lucro do relatório | R34 já cobre o relatório; falta a origem do custo (peças/estoque). |
| P42 | Pagamento com maquininha: `terminal_fee_amount` no saldo e nos relatórios | Depende da decisão de produto abaixo. |
| P49 | Transferência entre contas / conciliação mantém a soma dos saldos | Confirmar antes se o recurso existe no produto. |
| C39 | Versão da regra de comissão vigente na data de entrada da OS (virada de mês), ponta a ponta | O motor puro já tem teste unitário; falta o teste com plano+versão+regra reais (projeto `api`). |
| C40 | Bônus × comissão no mesmo funcionário/mês, ponta a ponta | Parcial em `bonuses.test.ts`. |
| R29 | Exportações (`export-*`) batem com a tela (mesmos filtros, mesmos totais) | |
| R30 | `sales-items`, `customers`, `suppliers`, `purchases` respeitam as invariantes I4 a I6 (excluída fora, outra org fora, gráfico = total) | |
| S5 | Funcionário só vê/paga as próprias comissões quando o papel não é financeiro | Definir a regra de negócio primeiro. |
| R31 | Fuso horário | **Não se aplica hoje**: `entry_date` e `due_date` são `date`. Reabrir se um relatório passar a filtrar por `created_at`. |

### Precisam de Postgres real (projeto `api`, ver KF-00)
- **E2** número de OS duplicado sugere o próximo (RPC `next_service_order_number`).
- **E17** duas edições simultâneas da mesma OS (quem vence?).
- **P43 / C38 real** duplo clique: duas requisições idênticas em paralelo criam dois recebimentos? Hoje só há teste sequencial; falta chave de idempotência ou trava no banco. Mesma causa da observação "atualização de saldo não é atômica".
- **R32** relatórios com mais de 1000 linhas (paginação interna de `fetchAllOrganizationRows`); o fake não pagina.
- **Atomicidade dos lotes** `pay-entries-bulk` e `pay-commissions-bulk` sob erro no meio do caminho. Hoje cada item é independente e o rollback é "melhor esforço".
- **Regras de comissão reais**: os testes de OS/pagamento mockam `employee-commission-plans`. Falta um teste `api` que semeie plano, versão e regra e confira o resultado fim a fim.
- **Gatilhos** de banco: o fake não tem.

### Decisões de produto em aberto (sem dono)
| Tema | Pergunta | Onde está travado em teste |
|---|---|---|
| KF-35 | O padrão de "Lucro pelas OS" sem filtro deve ser só OS concluídas? | `reports-consistency` (caracterização) |
| KF-43 | Pagar uma compra deve criar lançamento, extrato e mexer no saldo? | `financial-payments` (P45) e `reports-consistency` (R35) |
| P41 | O modo de comissão `full` deve voltar a `proportional` ao desfazer o pagamento? Hoje é "one-way switch" por desenho; depois de desfazer, o próximo recebimento libera 100% da comissão. | `financial-payments` (P41) |
| P42 | A taxa da maquininha entra na receita (líquida) ou como custo? | sem teste ainda |
| Lote | Pagamento em lote deve ser tudo-ou-nada ou por item (como é hoje)? | `financial-payments` (P47, C42) |

### Limites conhecidos da camada de teste
- Banco em memória: sem RPC, joins, gatilhos nem concorrência (por isso a lista "Postgres real" acima).
- O fake ignora `.or()`; handlers que dependem dele precisam de cuidado ao semear.
- `typecheck` e `lint` do repositório continuam vermelhos desde antes (KF-20); os testes novos não pioram.
- Como rodar o bloco financeiro: `pnpm test` (cerca de 40 s; 993 passam e 33 são falhas esperadas na última execução, 2026-11-09).

## Infraestrutura de teste e CI

### KF-00 · P1 (parcial: `supabase start` + `tests/db` rodam desde 2026-11-09; falta o resto das camadas L3/L4 e E2E autenticado) · Camadas L3/L4 contra Postgres real e E2E autenticado não foram executadas
- **Docker não estava em execução** no ambiente da implementação e **não existe `supabase/config.toml`** (decisão D1 do plano: a primeira tarefa da Fase 0 é `supabase init` e provar que as 97 migrations sobem em banco limpo — **não validado**).
- Escritos mas **nunca rodados**: `tests/db/database.test.ts` (tabelas, RPC `next_service_order_number`, unicidade de OS e de parcela, assinatura única) e o job `api` do CI (fica desligado enquanto não houver `supabase/config.toml`).
- Pendentes por depender de banco real: F1 (cadastro→Stripe→webhook), F5–F12, `describeEndpoint()` completo M2–M11 para as 248 rotas, relatórios com dataset golden, concorrência de `next-number`.
- Playwright: E1 (visitante), E10 (sem rolagem horizontal, mobile) e E11 (páginas públicas, `robots.txt`, `sitemap.xml`) **rodam e passam**. E2–E9 e E12 exigem usuário logado + Supabase local.
  - **Fluxos logados escritos (2026-11-09), ainda não executados:** `auth-session`, `routing-by-profile` (E2/E3), `admin-panel`, `money-flows` (E6 pela API, contra Postgres real) e `app-smoke` em `tests/e2e/`. Rodam só com `E2E_SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY` (Supabase local) e são pulados sem elas. Ao rodar pela primeira vez, esperar ajustes de seletor/payload. Seguem sem teste: E5 (criar cliente/veículo/OS pela tela), E6 pelo modal, E7 (funcionário com papel limitado: depende do KF-09), E8 (exportação baixa arquivo), E12 (Stripe).
- Como rodar (2026-11-09): **`pnpm test:stack`** sobe `docker-compose.e2e.yml` (Postgres + Auth + REST + Storage + gateway, 102 migrations aplicadas, chaves de teste fixas), roda `tests/db` e o Playwright e derruba tudo. O CI usa o mesmo runner (jobs `api` e `e2e`). Manualmente: `pnpm stack:up` e exportar `TEST_SUPABASE_*`/`E2E_SUPABASE_*` (valores em `supabase/e2e/stack.env`). O `global-setup` **recusa** qualquer URL que não seja local.
  - Validado na stack: `tests/db` (16 testes) e a migration 097 (13 testes de `audit-logs.sql.test.ts`).

### KF-23 · ✅ corrigido em 2026-11-09 · As migrations não rodavam em banco limpo
`supabase start` falhava na `...012_create_clients.sql`: o FK `clients_employee_responsible_id_fkey` referenciava `public.employees`, criada só na `...013`. Correção (sem renomear arquivos, para não desalinhar bancos que já aplicaram o histórico): o FK saiu da 012 e foi criado no fim da 013 com `ALTER TABLE`. A `...094` (seed de uma oficina de produção) ganhou guarda `IF NOT EXISTS (organização)` e passou a ser no-op em banco novo. Resultado: as 98 migrations aplicam em banco limpo.
- Atenção: alterar o conteúdo de migrations já aplicadas não as reexecuta; bancos existentes não mudam.

### KF-20 · P1 · `lint` e `typecheck` já estavam vermelhos antes dos testes
- `pnpm lint`: **420 erros** no repositório (medido com os arquivos de teste removidos; todos pré-existentes, nenhum em `tests/`).
- `pnpm typecheck`: erros em `nuxt.config.ts` (linhas 128–130, propriedade `robots` em `routeRules`).
- Impacto: o job `static` do CI falha nesses dois passos independentemente dos testes. Os passos foram mantidos como estavam; o passo `pnpm run test` foi adicionado e passa.

---

## Divergências entre o plano e o código (corrigir o plano)

| Plano dizia | Código real |
|---|---|
| F3: "soma das parcelas ≠ total (rejeitar **no servidor**, hoje só o front valida)" | O servidor **já valida** (`process-payment` devolve 400). Há teste cobrindo. |
| §5.5: "escape de caractere especial na busca (`search.ts`)" | `normalizeSearchText` só tira acento/caixa; não monta filtro. O risco de injeção em `.or()/ilike` está nos handlers, ainda **não auditado**. |
| §4: "14 rotas sem guard" | São 15 handlers sem guard: 11 públicos por desenho (allowlist) + 4 indevidos (KF-05..08). |
| §2.2 R3: "lógica de saldo repetida em handlers" | Confirmado, e gera divergência real (KF-18, KF-19). |
