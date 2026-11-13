# Comissões — confirmação dos achados com dados de produção (snapshot 2026-11-13)

Método: scripts Node locais, somente leitura, sobre os JSONs exportados (employee_financial_records 2.327 linhas, service_orders 1.348, financial_transactions 6.467, bank_account_statements, installments, plans/versions). A lógica de `server/api/reports/commissions.get.ts` foi reproduzida (L90-140: bônus por `reference_date`, demais pela `entry_date` de OS não deletada; sem filtro `deleted_at` nos registros). Privacidade: só agregados; OS citadas por número. Origem = achados CR-xx de `docs/reviews/code/comissoes-bugs.md`.

Base: 2.323 comissões ativas (1.987 pagas R$ 206.057,62; 336 pendentes R$ 42.676,39), 3 registros `salary`, 1 bônus soft-deletado (R$ 500,00).

## Resumo

| ID | Origem | Veredito | Contagem / R$ | Severidade real |
|---|---|---|---|---|
| PC-01 | CR-02 | CONFIRMADO | 14 comissões pagas com 2 despesas ativas; R$ 2.555,29 em despesa a mais (sem extrato; pagamento real em dobro não comprovado) | Alta |
| PC-02 | CR-11 | CONFIRMADO | 186 pagamentos com `payment_date` = dia seguinte; R$ 17.225,33 | Média |
| PC-03 | CR-14 | CONFIRMADO | 1.919 de 2.323 comissões em OS multi-item (R$ 230.351,53); 0 casam item | Média |
| PC-04 | CR-06/CR-08 | CONFIRMADO (impacto pequeno) | 1 linha, R$ 500,00 | Baixa |
| PC-05 | CR-07 | CONFIRMADO (impacto pequeno) | 11 linhas mês diferente (R$ 1.480,97); 145 dia diferente no mesmo mês | Baixa |
| PC-06 | CR-13 | CONFIRMADO | 203 OS sem forma; 112 OS bank_slip/check sem opção | Média |
| PC-07 | CR-03 | **OCORRE** (corrigido) | 16 despesas órfãs com vínculo nulo (R$ 4.301,11); 14 repagas (R$ 3.337,74), incluindo novembro/2026 | Crítica |
| PC-08 | CR-01 | NÃO OCORRE | 0 `financial_transaction_id` vazio; 0 divergência de valor | — |
| PC-09 | CR-05 | NÃO OCORRE hoje | 0 pendentes de não-responsável, OS cancelada ou deletada | — |
| PC-10 | CR-04 | NÃO OCORRE | 0 OS com override; KF-24: 0 parcelas `partial` | — |
| PC-11 | CR-12 | INCONCLUSIVO | ver abaixo | — |
| PC-12 | CR-15 | INCONCLUSIVO | 22 OS com registros > `commission_amount` (R$ 242,98) | a investigar |
| PC-13 | extra | INCONCLUSIVO | 425 pagas sem extrato bancário (R$ 47.207,79; valor corrigido) | a investigar |
| — | CR-09/10 | NÃO MENSURÁVEL | falhas de UI não deixam rastro nos dados | — |

## Detalhes

### PC-01 (CR-02) — pagamento em duplicidade: CONFIRMADO, severidade Alta
- 14 registros `commission` com mais de uma transação de despesa ativa (`employee_financial_record_id` repetido), valor igual ao do registro, criadas com 0 a 2 minutos de diferença, mesma conta. Só uma é referenciada por `financial_transaction_id`.
- Excesso pago: R$ 2.555,29. Das 14, as 11 primeiras inspecionadas são todas de 2026-02-23 (OS 4007, 4009, 4060, 4062, 4070 x2, 4088, 4092, 4105, 4112...). Cenário compatível com duplo clique/duas abas ou lote repetido (L40-57 de `pay.post.ts` e leitura-escrita sem trava).
- Não verifiquei se o saldo bancário foi debitado duas vezes (depende dos extratos), nem se alguma despesa foi estornada depois. Ação: conferir esses 14 casos manualmente e estornar o excedente.

### PC-02 (CR-11) — data de pagamento em UTC: CONFIRMADO, Média
- 685 pagamentos foram criados quando o dia UTC difere do dia BRT (após 21h BRT). Em 186 deles (R$ 17.225,33) `payment_date` = dia UTC (um dia à frente do dia real). Os outros ~499 têm `payment_date` diferente de ambos (data escolhida pelo usuário/estratégia `reference_date`). Todos os 186 ocorreram na hora 21 BRT.
- Impacto: pagamento e extrato aparecem datados no dia seguinte (competência/caixa deslocados, inclusive entre meses no fim do mês). Não há soma no KPI afetada, mas relatórios de caixa por dia/mês divergem.

### PC-03 (CR-14) — detalhe mostra item errado: CONFIRMADO, Média
- 831 OS com mais de um item concentram 1.919 comissões (82,6%; R$ 230.351,53). `item_name` começa com `#` em 1.411 registros e em nenhum coincide com nome de item (0 de 2.323) -> `isCurrentRecord` nunca casa por nome; com vários itens o detalhe cai em `breakdown[0]`. Impacto: o detalhe de quase todas as comissões mostra o cálculo do primeiro item.
- Além disso, 19 pares funcionário/OS têm mais de um registro (parcelas), em que o breakdown mostra o direito total, não a fatia.

### PC-04 (CR-06, CR-08) — soft-deletados e bônus no relatório: CONFIRMADO, Baixa
- Endpoint devolve 2.323 linhas; o correto seria 2.322. A linha extra é um bônus pendente soft-deletado de R$ 500,00 (origem `employee_financial_records.manual_delete`), com `entry` em 2026-08.
- KPI de comissões = R$ 248.699,01 (correto, não inclui bônus). Soma do gráfico por funcionário/linhas = R$ 249.199,01 (+R$ 500,00). Por mês, KPI = gráfico em todos os meses exceto 2026-08 (R$ 22.081,43 vs R$ 22.581,43). Nenhuma outra linha deletada; 0 pagos deletados.
- Hoje o dano é pequeno; o bug cresce a cada bônus excluído.

### PC-05 (CR-07) — `reference_date` x data da OS: CONFIRMADO, Baixa
- 11 registros (10 pagos, 1 pendente; R$ 1.480,97, 0,5%) têm `reference_date` em mês diferente da `entry_date` da OS (OS 4343, 4214, 29, 4739); caem em outro período no filtro. 145 registros diferem apenas por dia dentro do mês, o que altera só a ordenação.
- Também: 1 comissão (R$ 35,00, pendente) pertence a OS ausente/deletada ou funcionário removido; some do relatório geral.

### PC-06 (CR-13) — filtro de forma de pagamento: CONFIRMADO, Média
- Valores reais em OS ativas: pix 687, cash 241, `null` 203, check 64, bank_slip 48, credit_card 36. Nenhuma OS tem `no_payment_method`; o filtro "Sem pagamento" envia esse valor e o servidor compara com `no_payment` -> 203 OS sem forma nunca são encontradas. Além disso, `bank_slip` (48) e `check` (64) não existem nas opções da UI.

### PC-07/PC-08 (CR-03, CR-01) — integridade pagamento/lançamento: NÃO OCORRE
- 1.989 pagas ativas (R$ 214.057,62 incluindo salários): todas têm transação existente, ativa e com valor igual ao do registro; 0 `financial_transaction_id` vazio.
- **Correção (validação de 2026-11-13) para CR-03:** a conclusão "nenhuma exclusão de comissão paga deixou despesa órfã" está errada. O delete físico zera `employee_financial_record_id` (FK `ON DELETE SET NULL`), então a despesa não "aponta para registro inexistente": fica com vínculo nulo. Há 16 despesas assim (R$ 4.301,11, 14 com extrato), e 14 foram repagas, inclusive em novembro/2026 (PD-01). CR-03 está **confirmado em produção**. CR-01 segue sem ocorrência.

### PC-09/PC-10 — NÃO OCORRE
- CR-05: 336 pendentes (R$ 42.676,39): 0 de funcionário fora dos responsáveis, 0 em OS cancelada, 0 em OS deletada. CR-04: 0 OS com override (29 OS com log de ajuste manual). KF-24: 0 parcelas `partial`.

### PC-11 (CR-12) — conta usada: INCONCLUSIVO
- 7 contas ativas. Pagas por conta: d87834c0 1.472 (R$ 155.068,16), 23fdf3f6 449, 674c064d 34, demais ≤4; 25 transações de pagamento sem `bank_account_id` (R$ 2.479,77; 2025-09, 2025-10, 2026-02). Não dá para saber, pelos dados, se o uso da conta foi escolha explícita ou fallback "primeira conta ativa". Desde agosto/2026 três contas receberam pagamentos (570/167/27), compatível com escolha explícita no lote.

### PC-12 (CR-15) — registros acima do total da OS: INCONCLUSIVO
- 22 OS (quase todas concluídas e pagas, sem log manual) têm soma dos registros de comissão maior que `service_orders.commission_amount`, excesso total R$ 242,98 (exemplos: OS 4169 +R$ 63,20; OS 4947 +R$ 16,20). Pode ser arredondamento entre parcelas, edição posterior da OS ou corrida de recálculo. Há 1 grupo de registros duplicados (mesma OS/funcionário/valor/parcela). Requer análise caso a caso.

### PC-13 — pagas sem extrato bancário: INCONCLUSIVO
- Valor corrigido na validação de 2026-11-13: **425 comissões pagas (R$ 47.207,79)** têm transação vinculada sem extrato (2025-09: 2, 2025-10: 8, 2026-01: 45, 2026-02: 149, 2026-03: 221). A contagem anterior (400, R$ 44.728,02) deixava de fora parte dos casos. Coincide com o histórico do código (o endpoint individual "antes só virava o status e não mexia no saldo"). Verificar se o saldo dessas contas foi ajustado de outra forma.

### CR-16/CR-17
- Todas as 26 versões de regra têm `effective_from` no dia 01 (0 fora do padrão): sem impacto hoje. Planos: 22, 12 deletados, 0 inativos.

## Recomendações (ordem)
1. PC-01: conferir/estornar os 14 pagamentos duplicados e corrigir CR-02 (idempotência/trava no pagamento, filtro `status != 'paid'` no update).
2. PC-02: gravar data de pagamento no fuso local (BRT).
3. PC-03/PC-06/PC-04: corrigir detalhe, opções/valor do filtro de pagamento e filtro `deleted_at` no relatório.
4. Investigar PC-12 e PC-13.
