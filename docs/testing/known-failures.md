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
- Teste: `tests/unit/handlers/users-roles-security.test.ts` → *"usuário sem organização NÃO pode se vincular a uma oficina arbitrária como admin"*.
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
- Teste: `tests/flows/undo-payment.test.ts` → *"3 parcelas pagas na mesma conta"*.
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
> Testes: `tests/unit/handlers/financial-payments.test.ts`. Os quatro primeiros (KF-40 a KF-42 e KF-44) têm `it.fails`; o KF-43 é só caracterização.

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
- `tests/unit/handlers/financial-permissions.test.ts` prova que **10 rotas de dinheiro respondem 200 a um usuário sem nenhuma permissão**: `financial/:id/pay`, `pay-entries-bulk`, `pay-commissions-bulk`, `reports/commissions/:id/pay`, `down-payment`, `process-payment`, `receive-extra-payment`, `cancel`, `purchases/:id/pay` e `DELETE financial/:id`. São `it.fails` (um por rota) e mais uma varredura estática (26 escritas financeiras sem `requireOrgPermission`/`requireOwner`). Ao corrigir uma rota, troque o `it.fails` dela por `it`.

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

### KF-00 · P1 (parcial: `supabase start` + `tests/api` rodam desde 2026-11-09; falta o resto das camadas L3/L4 e E2E autenticado) · Camadas L3/L4 contra Postgres real e E2E autenticado não foram executadas
- **Docker não estava em execução** no ambiente da implementação e **não existe `supabase/config.toml`** (decisão D1 do plano: a primeira tarefa da Fase 0 é `supabase init` e provar que as 97 migrations sobem em banco limpo — **não validado**).
- Escritos mas **nunca rodados**: `tests/api/database.test.ts` (tabelas, RPC `next_service_order_number`, unicidade de OS e de parcela, assinatura única) e o job `api` do CI (fica desligado enquanto não houver `supabase/config.toml`).
- Pendentes por depender de banco real: F1 (cadastro→Stripe→webhook), F5–F12, `describeEndpoint()` completo M2–M11 para as 248 rotas, relatórios com dataset golden, concorrência de `next-number`.
- Playwright: E1 (visitante), E10 (sem rolagem horizontal, mobile) e E11 (páginas públicas, `robots.txt`, `sitemap.xml`) **rodam e passam**. E2–E9 e E12 exigem usuário logado + Supabase local.
  - **Fluxos logados escritos (2026-11-09), ainda não executados:** `auth-session`, `routing-by-profile` (E2/E3), `admin-panel`, `money-flows` (E6 pela API, contra Postgres real) e `app-smoke` em `tests/e2e/`. Rodam só com `E2E_SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY` (Supabase local) e são pulados sem elas. Ao rodar pela primeira vez, esperar ajustes de seletor/payload. Seguem sem teste: E5 (criar cliente/veículo/OS pela tela), E6 pelo modal, E7 (funcionário com papel limitado: depende do KF-09), E8 (exportação baixa arquivo), E12 (Stripe).
- Como rodar (2026-11-09): **`pnpm test:stack`** sobe `docker-compose.e2e.yml` (Postgres + Auth + REST + Storage + gateway, 102 migrations aplicadas, chaves de teste fixas), roda `tests/api` e o Playwright e derruba tudo. O CI usa o mesmo runner (jobs `api` e `e2e`). Manualmente: `pnpm stack:up` e exportar `TEST_SUPABASE_*`/`E2E_SUPABASE_*` (valores em `supabase/e2e/stack.env`). O `global-setup` **recusa** qualquer URL que não seja local.
  - Validado na stack: `tests/api` (16 testes) e a migration 097 (13 testes de `audit-logs.sql.test.ts`).

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
