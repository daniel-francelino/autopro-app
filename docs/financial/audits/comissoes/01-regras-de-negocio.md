# Auditoria de Comissões — 01 Regras de Negócio

Data: 2026-11-13. Escopo: regras de negócio (não segurança/código). Somente leitura; nenhum código alterado.
Legenda: [V] verificado no código/doc; [H] hipótese não comprovada. KF-xx = achados já abertos em `docs/testing/known-failures.md` (linhas 129-158), referenciados e não duplicados.

## 1. Fluxo ponta a ponta (verificado)

1. Configuração: Financeiro > Comissões. Plano (`employee_commission_plans`) -> versões com `effective_from` (sempre dia 1) -> regras (percentual sobre `revenue`/`profit`, ou `fixed_amount` por unidade) -> categorias + 1 regra default. Atribuição plano-funcionário sem data de vigência. Doc: `docs/finance/commissions-configuration-architecture.md` §4, §10.
2. Regra aplicável por item: categoria específica, senão default, senão sem comissão (`lib/utils/employee-commission-engine.ts:116-125`). Valor: `:154-163`. Desconto e impostos são rateados sobre o subtotal elegível do funcionário (`:268-285`). Lucro = max(0, receita - custo - impostos).
3. Geração: não ocorre na criação da OS. Só no recebimento (parcela paga, avulso, plano com modo `full`) ou manualmente em `generate-commissions`, via `releaseServiceOrderCommissions` (`server/utils/service-order-commissions.ts:243-601`). Libera `total x recebido/total_amount` (`:422-426`) como registros `pending` em `employee_financial_records`.
4. Data de referência das regras = mês de `entry_date` da OS (`:306`), não a data de conclusão nem a de pagamento.
5. Pagamento: `reports/commissions/[id]/pay.post.ts` e `financial/pay-commissions-bulk.post.ts` criam despesa "Salários", movimentam o saldo e marcam `paid`.
6. Estados reais: apenas `pending` e `paid` (CHECK em `supabase/migrations/20240101000020_create_employee_financial_records.sql:72-73`). Não existem aprovada, cancelada nem estornada. Reversão = DELETE do registro.
7. Reversões automáticas: estorno de recebimento recalcula e recolhe pendentes (`service-order-commissions.ts:535-563`). Cancelar pagamento apaga todas as comissões, mas é bloqueado se houver `paid` (`payment.delete.ts:46-60`; `service-order-receipt-reversal.ts:65-79`; `installments/[installmentId].delete.ts:99-118`). Cancelar a OS apaga as comissões (`cancel.post.ts:120-157`).

## 2. Findings

### BR-01 — Estados do ciclo de vida não existem (Alta) [V]
O negócio fala em pendente/aprovada/paga/cancelada/estornada, mas o schema só aceita `pending|paid` (migration 20:72-73). Não há aprovação gerencial. Cancelar ou estornar significa apagar a linha (`cancel.post.ts:155`, `payment.delete.ts:107`, `service-order-commissions.ts:527,548`). Isso perde o histórico de "por que sumiu". Cliente que espera ver "cancelada/estornada" não vê. (KF-33 menciona "cancelada" no gráfico, o que é incoerente com o CHECK.)

### BR-02 — Comissão paga não tem fluxo de estorno; o impasse é resolvido apagando (Alta) [V]
Estornar recebimento, cancelar pagamento ou cancelar OS com comissão `paid` retorna 409 pedindo "resolver manualmente / estornar a comissão" (`payment.delete.ts:58`, `service-order-receipt-reversal.ts:77`). Não existe endpoint de estorno de comissão paga. A saída disponível é `DELETE /reports/commissions/:id`, que apaga sem olhar o status e deixa a despesa e o saldo (`reports/commissions/[id].delete.ts:20-37`; KF-44). Regra ausente: devolução, desconto retroativo ou adiantamento de comissão (compensar no próximo pagamento). Fonte provável de reclamação: o cliente fica sem caminho legítimo.

### BR-03 — Cancelar OS com comissão paga apaga o pago e reverte o banco (Alta) [V]
`cancel.post.ts:120-157` remove todo registro, inclusive `paid`, e estorna o extrato, sem checar o status. É alcançável no modo `full` (KF-40). Contradiz o guard de `payment.delete.ts`: duas regras opostas para o mesmo evento.

### BR-04 — "Comissão faltando" por parcela parcial (Alta) [V]
O recebido é calculado só com `service_order_installments.status='paid'` (`service-order-commissions.ts:414-422`). Pagamento parcial de parcela não libera nada (KF-24). Regra de negócio não documentada: a base do pagamento proporcional é o recebido real ou só parcelas quitadas. É a causa mais provável de "não está dando certo".

### BR-05 — Comissão só nasce no recebimento; não há regra documentada de gatilho (Média) [V]
Não está definido no doc se a comissão é devida na conclusão da OS, no faturamento ou no recebimento. O código usa o recebimento proporcional, com exceção `commission_release_mode='full'` (`process-payment.post.ts:79-88`). Esse modo é irreversível ("one-way switch") e libera 100% sem recebimento, o que permite pagar comissão antes de entrar dinheiro. Também não há regra para venda sem OS ou para OS paga à vista fora do fluxo (hipótese [H]: verificar `sales`/PDV, não localizados em `server/api`).

### BR-06 — Edição da OS após recebimento não reconcilia comissões (Alta) [V]
`POST /service-orders` recalcula o snapshot `items[].commissions` e `commission_amount` (`index.post.ts:184-193`), mas não chama `releaseServiceOrderCommissions`. Os `employee_financial_records` ficam com o valor antigo até o próximo pagamento (KF-38). Não há trava de edição pós-pagamento no endpoint (verificado por grep: nenhum 409 em `index.post.ts`). O valor exibido na OS diverge do valor a pagar.

### BR-07 — Regras vigentes mudam o resultado de OS antigas (Alta) [V/H]
Cada liberação recalcula o direito total com as regras atuais do mês de `entry_date` e a atribuição atual (`:306-312`). Atribuição não tem vigência (doc §4.2). Consequências: desatribuir o funcionário, inativar ou excluir o plano (`commissions/[id].delete.ts:31-38`) ou publicar versão retroativa muda o total de OS parcialmente recebidas. O doc promete "comissão gerada não muda" (§4.3, §9), mas isso vale só para registros já criados; o delta futuro usa a regra nova. [H] Pode gerar valores mistos na mesma OS.

### BR-08 — Funcionário deixa de ter comissão em silêncio (Alta) [V]
Funcionário sem regra aplicável é pulado (`:172-175`, `:192`). No fluxo automático, a comissão pendente antiga não é recolhida (KF-26) e o ex-responsável mantém a pendente (KF-25). No manual, o recálculo sem regra apaga pendentes sem confirmação (incidente de 10/09, R$ 7.130,99; KF-36; `service-order-commissions.ts:388-403,525-528`). Após o Step 10, as colunas legadas foram removidas (`:127-135`), então quem não foi migrado para um plano passa a ganhar zero sem alerta. [H] Verificar o backfill no ambiente do cliente.

### BR-09 — Sem regra default, item fica sem comissão (Média) [V]
`:124` retorna null sem default. O doc admite que isso muda o legado ("sempre contava", architecture §4.5, §9; step8 §6). Plano só com regras por categoria deixa itens sem categoria ou de outras categorias com 0, sem aviso na OS. [H] Ocorrência em produção.

### BR-10 — Conflito entre planos validado só na atribuição (Média) [V]
`findCommissionConflicts` é usado só em `assignments.post.ts:70`. Publicar nova versão (`versions.post.ts`) não revalida contra os outros planos do funcionário (nenhuma referência no arquivo). Com dois planos cobrindo a mesma categoria, `rules.find` pega o primeiro do array, e a ordem é arbitrária [H]. Resultado ambíguo.

### BR-11 — `fixed_amount` mudou de semântica (Média) [V]
Antes: valor dividido pelos itens ou fixo por OS. Agora: por unidade vendida (`engine:154-160`; step8 §4.1). Diferenças entre o que o cliente cadastrou antes e o que recebe agora são esperadas. Percentual: sem teto, mas > 100% é bloqueado (`employee-commission-plans.ts:342`). Lucro nunca é negativo (`max(0, ...)` em `engine:285`), então item com prejuízo não gera estorno nem desconto.

### BR-12 — Base de cálculo e rateio têm decisão pendente (Média) [V]
Desconto e imposto rateados sobre o subtotal elegível de cada funcionário (`engine:268-272`). Dois funcionários com categorias diferentes recebem descontos diferentes sobre o mesmo item (step8 §4.2). A decisão foi "manter o legado". Não há regra para: devolução parcial de item (não localizei fluxo de devolução que toque comissão; [H] ausente), frete, comissão sobre item de custo zero, nem se a base inclui o valor recebido em taxa de maquininha.

### BR-13 — Valor da OS e recebido: ratio inconsistente (Média) [V]
`receivedRatio = recebido / total_amount` (`:424-426`). Recebido inclui sinal e avulso. O avulso não é limitado ao saldo (KF-27), e `payment_status` é derivado das linhas (KF-31). Ratio é limitado a 1, mas o excesso de recebimento ou o troco não gera regra de comissão.

### BR-14 — Pagamento de comissão: regras ausentes (Média) [V]
`pay` e `pay-commissions-bulk` pagam registros `pending` sem verificar se a OS está cancelada, excluída ou com recebimento revertido, e sem verificar se o recebimento cobre o valor. Pagam ao funcionário uma comissão cujo cliente ainda não pagou, se o gestor assim quiser (sem alerta). Usam a primeira conta ativa quando nenhuma é informada (`pay.post.ts:66-75`). Saldo em ponto flutuante (KF-41). Não há competência/fechamento de período nem aprovação.

### BR-15 — Override manual por OS: exigências implícitas (Baixa/Média) [V]
Registrado só em log JSON (`commission_manual_adjustments_log`); estado = última entrada. Bloqueado se já há comissão paga (`:503-509`). Remove registros `pending` e recria (`:525-533`), então o id e a data originais se perdem. Exige `commissions.read` para listar (manual-override §8). Aprovação do gestor não é exigida. Doc §13 deixa 7 decisões abertas.

### BR-16 — Relatórios: comissão de OS excluída some (Média) [V]
Pendente de OS excluída continua no ledger mas some do relatório (KF-32). Soma e estados divergem entre resumo e gráfico (KF-33). Cliente vê total diferente do que paga.

### BR-17 — Documentação desatualizada (Baixa) [V]
`docs/README.md:49-50` aponta só config e lista. O doc de arquitetura ainda descreve campos legados e os 4 motores. Step8 §6 prevê fallback legado que o Step 10 removeu. Faltam: regra de gatilho, tabela de estados, política de estorno, política de edição pós-recebimento.

## 3. Cenários prováveis da reclamação (ordem de probabilidade)

1. Cliente recebe parte da parcela e a comissão não aparece (BR-04).
2. Edita a OS depois de receber e a comissão mostrada na OS difere da paga (BR-06).
3. Funcionário sem plano/categoria/default recebe zero sem aviso (BR-08, BR-09).
4. Mudou o plano e as OS antigas pendentes mudam, ou não mudam como esperado (BR-07).
5. Quer estornar/cancelar comissão paga e o sistema só bloqueia ou apaga sem rastro (BR-02, BR-03).
6. Valor fixo calculado diferente do que usava antes (BR-11).
7. Recálculo manual apaga pendentes (BR-08).

## 4. Recomendações (decisão de negócio necessária antes de implementar)

- Definir o gatilho oficial (recebimento proporcional x conclusão) e documentar; decidir o uso do modo `full`.
- Introduzir estados `cancelled`/`reversed` e fluxo de estorno de comissão paga (compensação em folha), em vez de DELETE.
- Reconciliar comissões após editar OS com recebimento; ou travar a edição de valores.
- Dar vigência às atribuições e congelar a regra por OS (snapshot na primeira liberação).
- Alertar na OS quando um responsável não tiver regra aplicável; revalidar conflitos ao publicar versão.
- Corrigir KF-24, 26, 36, 40, 44 (prioridade P0).

## 5. Limitações
Não executei testes nem consultei dados reais. Não analisei bônus, PDV/vendas sem OS, nem permissões (escopo de outras auditorias).
