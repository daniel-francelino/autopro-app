# Auditoria de código — fluxo de Comissões (bugs)

Data: 2026-11-13. Escopo: revisão estática (sem execução de testes, sem alterar código). Linhas marcadas com `~` são aproximadas (lidas em trechos). Itens "Hipótese" não foram comprovados por execução.

Arquivos revisados: `server/api/reports/commissions.get.ts`, `reports/commissions/[id].get.ts|delete.ts|[id]/pay.post.ts`, `reports/export-commissions.post.ts` (parcial), `financial/pay-commissions-bulk.post.ts`, `server/utils/service-order-commissions.ts`, `employee-commission-plans.ts`, `employee-commission-report.ts`, `lib/utils/employee-commission-engine.ts`, `server/api/commissions/*`, `app/pages/app/reports/commissions.vue`, `useCommissionsReportList.ts`, `CommissionsFilters.vue`.
Não revisados a fundo: `sales-item-commissions.ts`, `preview.post.ts`, `index.get.ts`, páginas `financial/commissions/*`, componentes de OS.

## Resumo por severidade
Alta: CR-01, CR-02, CR-03, CR-04, CR-05. Média: CR-06 a CR-12. Baixa: CR-13 a CR-17.

## Findings

### CR-01 (Alta) Pagamento em lote ignora erros de insert/update e corrompe saldo
- Evidência: `server/api/financial/pay-commissions-bulk.post.ts` ~L118-165: os `insert` de `financial_transactions` e `bank_account_statements` e o `update` de `bank_accounts` não checam `error` (só o update final do registro é checado).
- Cenário: insert da transação falha (ex.: categoria/constraint) -> `lancamento = null` -> o saldo da conta é debitado mesmo assim, extrato é inserido com `financial_transaction_id: ''` (falha silenciosa) e o registro é marcado `paid` com `financial_transaction_id = ''`. Resultado: comissão "paga", dinheiro debitado, sem lançamento rastreável; o rollback não reverte nada porque `lancamento` é null.
- Contraste: `pay.post.ts` (individual) checa todos os erros.

### CR-02 (Alta) Pagamento não é atômico nem protegido contra concorrência (duplo pagamento / saldo perdido)
- Evidência: `pay.post.ts` ~L40 (checa `status==='paid'` só na leitura) e ~L105-130; bulk ~L120-150. Saldo é lido e gravado como `current_balance = lido - valor` (read-modify-write). O update final do registro não filtra `status != 'paid'`.
- Cenário A: dois cliques/abas pagam a mesma comissão ao mesmo tempo -> dois lançamentos de despesa e dois débitos; o segundo update de registro também "sucede".
- Cenário B: dois pagamentos simultâneos em contas iguais -> o segundo sobrescreve o saldo do primeiro (lost update).
- Rollback "best-effort" restaura `previousBalance` absoluto, podendo apagar movimentações concorrentes.
- Teste existente cobre duplo clique só sequencial (C38).

### CR-03 (Alta) Excluir comissão paga deixa despesa e saldo bancário órfãos
- Evidência: `server/api/reports/commissions/[id].delete.ts` L19-37: `DELETE` físico do registro sem checar `status`, sem reverter `financial_transaction_id`/extrato/saldo; UI permite (`commissions.vue` botão Excluir com `canDelete`, sem filtrar por status; exclusão em lote idem ~L350).
- Cenário: comissão R$ 500 paga -> usuário exclui -> registro some do relatório, mas a despesa "Salários" e o débito no banco permanecem; histórico/auditoria perdidos (hard delete; o restante do sistema usa `deleted_at`).
- Também não filtra `deleted_at`.

### CR-04 (Alta) Override manual "apply" usa só as regras do plano escolhido; pagamentos seguintes usam override + regras padrão
- Evidência: `service-order-commissions.ts` L343-353 (apply -> `planRulesByPlanId.get(...)` substitui tudo) vs `employee-commission-engine.ts` `resolveEffectiveCommissionRules` (override à frente das regras padrão, "patch").
- Cenário: funcionário com padrão 20% "motor" e 9% "cabeçote"; override com 15% só "cabeçote". Recalcular com apply: motor passa a render 0 (sem regra) e comissão pendente do motor é apagada (L526-528 apaga pendentes e reinsere só o novo total). No próximo recebimento de parcela, o cálculo volta a incluir motor a 20% -> comissão sobe sem ação do usuário. Valores divergem entre a chamada manual e as automáticas.
- Teste C32 usa uma regra padrão simples (`pct(30)`), por isso não detecta a diferença (hipótese sobre o formato de `pct`; a divergência de código é verificada).

### CR-05 (Alta) Recálculo automático não recolhe comissão pendente quando o funcionário deixa de ter direito
- Evidência: `service-order-commissions.ts` L192 (`result.total <= 0` -> sem entitlement), L405-412 (retorno antecipado quando não há entitlements), L500 (itera só entitlements).
- Cenário: funcionário removido dos responsáveis, plano desativado, itens removidos ou desconto zera a base -> comissão pendente antiga permanece e continua paga/exibida. Já registrado como KF-25/KF-26 (`it.fails` em `tests/fast/commissions/commissions-release.test.ts` L293-310) — bug confirmado e ainda aberto.
- Relacionado KF-24: parcela `partial` não conta no recebido (somente `status='paid'`, L414-422) -> comissão proporcional subestimada.
- Relacionado KF-36: recálculo manual sem regra aplicável apaga pendentes sem confirmação (L388-403 + L526-528; incidente de R$ 7.130,99).

### CR-06 (Média) Relatório inclui registros soft-deletados (bônus) e divergem de outras telas
- Evidência: `commissions.get.ts` L69-73 `fetchAllOrganizationRows('employee_financial_records')` sem `nullColumns: ['deleted_at']`. `bonuses/[id]/financial-records/[recordId].delete.ts` ~L110 faz soft delete nesta mesma tabela. `employee-commission-report.ts` filtra `deleted_at`; `pay.post.ts` também.
- Cenário: bônus excluído continua na lista, em `count`, no gráfico por funcionário e fica impossível de pagar/abrir (404). Total do funcionário no relatório geral != total na ficha do funcionário. (Detalhe `[id].get.ts` também não filtra `deleted_at`.)

### CR-07 (Média) Filtro/ordenação "Referência" usa data da OS, não `reference_date`
- Evidência: `commissions.get.ts` L102-105 (filtro por `order.entry_date`), L224-226 (ordenação por `order_entry_date || reference_date`); coluna da UI "Referência" mostra `reference_date`. Em `employee-commission-report.ts` o filtro usa `reference_date`.
- Cenário: registro com `reference_date` diferente da entrada da OS (ajustes manuais, pagamento com `dateStrategy`) aparece em período diferente do exibido; comissões de OS excluídas (soft) somem do relatório geral (L102 retorna false se não há ordem) mas aparecem na ficha do funcionário.
- Exportação (`export-commissions.post.ts`) filtra bônus fora (exige ordem) enquanto a tela inclui bônus -> totais da tela != arquivo exportado; `sortBy` 'order' não aceito na exportação (cai em 'date').

### CR-08 (Média) Gráfico por funcionário e contador misturam bônus e tratam não-pago como pendente
- Evidência: `commissions.get.ts` L164 (`count` inclui bônus), L172-181 (soma bônus em `total` por funcionário e qualquer status != paid vai a `pending`), L186-189 (distribuição usa só comissões). O comentário L147-150 diz que o total nunca mistura, mas gráfico e `count` misturam.
- Cenário: sem filtro de tipo, KPI "Total" = R$ 1.000 (só comissões) e gráfico por funcionário soma R$ 1.300 (com bônus).

### CR-09 (Média) Pagamento em lote: UI reporta sucesso mesmo com falhas
- Evidência: `commissions.vue` `handleBulkPay` ~L255-270 ignora `paidCount/failedCount/skippedCount` da resposta; toast "Comissões pagas com sucesso!" sempre; seleção limpa de todos os ids.
- Cenário: 5 selecionadas, 3 falham -> usuário vê sucesso, perde a seleção, só percebe ao ver pendentes.

### CR-10 (Média) Exclusão em lote com `Promise.all` e sem tratamento parcial
- Evidência: `commissions.vue` `handleBulkDelete` ~L352-365. Primeira falha rejeita o `Promise.all`, as demais exclusões já enviadas continuam; toast de erro genérico, seleção mantida (incluindo itens já apagados), sem `softRefresh()` no erro -> lista desatualizada.

### CR-11 (Média) Datas de pagamento em UTC
- Evidência: `pay.post.ts` ~L47 e bulk ~L73: `new Date().toISOString().split('T')[0]`. Servidor em UTC: após 21h (BRT) a data de pagamento/competência vira o dia seguinte. Também `service-order-commissions.ts` L306/L456 (fallback sem `entry_date`). O cliente (`daysSince`, `commissions.vue` L13-19) usa data local -> alerta "comissão antiga" pode divergir do servidor.
- Hipótese: impacto depende do TZ do runtime de produção.

### CR-12 (Média) Pagamento individual sem confirmação nem escolha de conta
- Evidência: `commissions.vue` `payCommission` ~L295-312 chama `/pay` sem `bankAccountId` (exceto o fluxo "antigo"); `pay.post.ts` ~L62-72 usa a primeira conta ativa arbitrária (`limit(1)` sem ordem).
- Cenário: organização com várias contas -> débito vai para conta imprevisível. Um clique paga imediatamente.

### CR-13 (Média) Filtro de forma de pagamento "Sem pagamento" nunca casa
- Evidência: `CommissionsFilters.vue` L78 envia `no_payment_method`; servidor compara com `'no_payment'` (`commissions.get.ts` L128, `export-commissions.post.ts` ~L132).
- Cenário: selecionar "Sem pagamento" retorna lista vazia (OS sem forma de pagamento viram `no_payment`). Hipótese: o valor `no_payment_method` pode existir gravado em alguma OS; não verificado.

### CR-14 (Média) Detalhe da comissão mostra cálculo do item errado
- Evidência: `reports/commissions/[id].get.ts` ~L236-250: `isCurrentRecord` compara `item_name` do registro (gravado como `#<número da OS>`, `service-order-commissions.ts` L465) com o nome dos itens; nunca casa e, com mais de um item, `currentBreakdown = breakdown[0]`.
- Cenário: OS com 3 itens -> "Cálculo" exibe venda/custo/lucro/base do primeiro item como se fosse o desta comissão. Valores de breakdown são do direito integral, não da parcela liberada (múltiplos registros por OS).

### CR-15 (Média) Corrida na geração/recálculo; operações sem transação e sem checagem de erro
- Evidência: `service-order-commissions.ts` L372-375 (update de OS sem checar erro nem `organization_id`), L526-528 e L548 (deletes sem erro), L428-433 (leitura de existentes sem `deleted_at` — hipótese de impacto se houver soft delete de comissões).
- Cenário: duas parcelas pagas quase simultaneamente (ambas leem a mesma soma existente) -> dois registros delta duplicados e comissão acima do devido. Recálculo manual apaga pendentes e, se o insert falhar, perde a comissão sem rollback.
- Não há travamento/idempotência por OS.

### CR-16 (Baixa) Versões de regra: `effectiveFrom` sem validação/normalização no servidor
- Evidência: `commissions/[id]/versions.post.ts` ~L60-66 e `commissions/index.post.ts` ~L66-68 aceitam qualquer string. A resolução usa `effective_from <= primeiro dia do mês da OS` (`employee-commission-engine.ts` `resolveEffectiveCommissionVersion`, `toCommissionMonthStart`).
- Cenário (via API): `2026-03-15` -> OS de março não enxergam a versão (15 > 01). Data inválida -> 500 do banco (e em `index.post` o plano é criado e depois apagado). A UI envia `YYYY-MM-01`, então só afeta chamadas diretas. Conflitos de categoria/regra padrão só são validados na atribuição (`assignments.post.ts`), não ao criar nova versão -> versão nova pode criar conflito para funcionários já atribuídos; ordem de plano então decide qual regra vence (primeiro encontrado).

### CR-17 (Baixa) Robustez/defesa em profundidade nos endpoints de plano
- `commissions/[id].put.ts` L35: `body` indefinido -> TypeError 500; `description` não-string -> TypeError. Updates em L44 e delete usam só `.eq('id')` (org validada antes por `fetchCommissionPlan`; faltaria `organization_id` como defesa).
- `commissions/[id].delete.ts`: exclui plano com atribuições ativas e OS abertas sem aviso (cenário COM-01 do doc de testes).
- Funcionário desligado (soft delete) aparece como "Unknown" no relatório (`commissions.get.ts` L173/L195) e como "Funcionário" no detalhe.
- Paginação de `fetchAllOrganizationRows` ordena por coluna não única (`reference_date`/`created_at`): com >1000 linhas pode duplicar/omitir registros entre páginas (hipótese; depende do plano de execução do Postgres).
- `status` do registro só aceita `paid|pending` (migração `...020` L72-73); o código trata `cancelled` (inalcançável hoje) — código morto, não bug.

## Permissões / tenant
- Todas as rotas lidas chamam `requireOrgPermission` e filtram por `organization_id`. Atenção: `employees/[id]/commission-rules.get.ts` é deliberadamente sem `commissions.read`, e `employees/[id]/commissions.get.ts` usa `employees.read`. Nenhum bypass confirmado.
- O relatório e o pagamento usam permissões distintas (`reports.commissions` vs `financial.update`), coerente.

## Cobertura de testes e lacunas
Existentes: `tests/fast/commissions/commissions-release.test.ts` (35 casos, 4 `it.fails` KF-24/25/26/36), `employee-commission-engine.test.ts` (50), `financial-payments.test.ts` (pagamento individual/lote C37-C42, rollback), guardas de permissão (`phase5a/5b/7b`, `financial-permissions`), `employees/commissions.test.ts` (paridade com o relatório), e2e de OS/preview.
Lacunas:
1. Nenhum teste dedicado das rotas `/api/commissions/*` (docs/testing/domains/commissions.md: 0 de 11).
2. Sem teste do relatório `reports/commissions.get.ts` para filtros (status, tipo, forma de pagamento, `no_payment_method`), ordenação, paginação, bônus soft-deletado, período por `reference_date` (CR-06/07/08/13).
3. Sem teste de bulk pay com falha de insert/ update (CR-01), concorrência (CR-02), exclusão de comissão paga (CR-03).
4. Override com regras por categoria (CR-04) e consistência entre apply manual e liberações seguintes.
5. Sem testes de frontend (`useCommissionsReportList`, `commissions.vue`: toast de lote, seleção, refresh) (CR-09/10).
6. Sem teste de fuso horário em datas de pagamento (CR-11) nem de detalhe com múltiplos itens (CR-14).
7. Concorrência e unicidade pertencem a `tests/db` (não existe).

## Prioridade de correção sugerida
CR-01, CR-03, CR-02, CR-04, CR-05 primeiro (integridade financeira); depois CR-06/07/08/09/13; demais conforme risco.
