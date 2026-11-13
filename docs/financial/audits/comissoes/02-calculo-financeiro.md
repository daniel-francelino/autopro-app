# Auditoria de Comissões — 02. Cálculo Financeiro

- Data: 2026-11-13
- Escopo: motor de cálculo, liberação proporcional ao recebido, pagamento (individual e em lote), estornos/cancelamentos, relatório de comissões.
- Método: leitura do código-fonte e verificação numérica independente em Node (script local, fora do repositório). Nenhum código, teste ou dado foi alterado.
- Referência anterior: `docs/finance/auditoria-arredondamento-comissoes-2026-09-10.md`. Os achados de lá não são repetidos aqui, a menos que esta auditoria acrescente evidência nova.

Legenda: **[V]** = verificado no código e/ou numericamente. **[H]** = hipótese, ainda depende de confirmação com dados ou execução.

## Modelo de cálculo (como está hoje)

1. Por funcionário e por OS, cada item é associado a uma regra. A regra específica da categoria tem prioridade e, na falta dela, vale a regra padrão (`lib/utils/employee-commission-engine.ts:116-125`).
2. O desconto e os impostos da OS são rateados proporcionalmente ao total de cada item (`employee-commission-engine.ts:268-282`).
   - Receita = total do item − desconto rateado.
   - Lucro = max(0, receita − custo − impostos rateados) (`:284-285`).
3. Tipos de regra:
   - Percentual: `round2(base × % / 100)`.
   - Valor fixo: `round2(valor × quantidade)` (`:154-163`).
   - O arredondamento é feito por item (`:287-291`).
4. Direito total do funcionário = soma dos itens (`server/utils/service-order-commissions.ts:149-225`).
5. Valor liberado = direito × `receivedRatio`, onde `receivedRatio` = soma das **parcelas com status `paid`** ÷ `order.total_amount`. No modo `full`, a razão é sempre 1 (`service-order-commissions.ts:414-426`, `:511-513`).
6. Cada evento de recebimento grava um registro `pending` com a diferença (delta). Quando há estorno de recebimento, o sistema recupera (claw-back) primeiro dos registros pendentes; registros já pagos nunca são editados (`:533-564`).

Importante: a comissão é calculada sobre a **receita faturada** da OS (ou sobre o lucro, conforme a regra). Ela é **liberada** na proporção do **caixa recebido**. As duas grandezas não se misturam no cálculo, mas o critério de "recebido" tem falhas (FC-01).

## Findings

### FC-01 — Recebimentos parciais de parcela não liberam comissão [V] — Severidade: ALTA

- **Evidência:**
  - `server/utils/service-order-commissions.ts:414-422` soma apenas `service_order_installments` com `status = 'paid'`, usando o valor **cheio** da parcela (`installment.amount`).
  - `server/api/service-orders/[id]/installments/[installmentId]/pay.post.ts:206-211` grava a parcela como `partial` quando o recebimento não quita o saldo, e em seguida chama a liberação (`:241`), que ignora parcelas `partial`.
  - O mesmo vale para o estorno: `server/utils/service-order-receipt-reversal.ts:125`.
- **Exemplo numérico:** OS de R$ 1.000,00 em parcela única, comissão total de R$ 100,00. O cliente paga R$ 600,00.
  - Liberado pelo sistema: **R$ 0,00**.
  - Esperado pela regra documentada ("proporcional ao recebido"): **R$ 60,00**.
  - Quando a parcela é quitada, o valor liberado salta para R$ 100,00 de uma vez.
- **Impacto:** a comissão fica "faltando" durante o mês, o que é coerente com a queixa do cliente. O efeito é de cronologia de liberação (o valor final não muda), mas desloca a comissão entre competências e fechamentos.
- **Recomendação:** basear `receivedTotal` nas `financial_transactions` com status `paid` ligadas à OS ou à parcela. Hoje o cálculo usa o status da parcela.

### FC-02 — Ao aplicar a "comissão manual" (override), o cálculo diverge das liberações seguintes [V] — Severidade: ALTA

- **Evidência:**
  - No momento do `apply`, as regras do funcionário são **substituídas** pelas do plano de override (`service-order-commissions.ts:343-352`).
  - Em todas as chamadas seguintes (pagamento de parcela, estorno, edição), `resolveEffectiveCommissionRules` faz um **patch**, ou seja, override + regras padrão (`employee-commission-engine.ts:467-484`, usado em `service-order-commissions.ts:341` e `server/api/service-orders/index.post.ts:182`).
- **Exemplo numérico:**
  - Plano padrão: Motor 20% e Cabeçote 9%. Override: só Cabeçote 15%.
  - Itens da OS: Motor R$ 1.000,00 e Cabeçote R$ 500,00. Modo `full`.
  - No `apply`, o direito calculado é **R$ 75,00** (o Motor some).
  - No próximo pagamento de parcela, o direito passa a ser **R$ 275,00**, e o sistema gera automaticamente um delta de +R$ 200,00.
  - O log do recálculo registra `new_amount` = 75, que não corresponde ao valor efetivo final.
- **Impacto:** o valor mostrado logo após o ajuste manual está errado. Depois aparece um "aumento misterioso", e a trilha de auditoria fica inconsistente.

### FC-03 — A regra padrão do plano de override não tem prioridade sobre a regra específica do plano padrão [V] — Severidade: MÉDIA

- **Evidência:** `getApplicableCommissionRule` (`employee-commission-engine.ts:120-124`) procura primeiro **qualquer** regra específica em toda a lista combinada e só depois as regras padrão. O comentário em `:454-461` afirma o contrário ("override: específica, depois sua catch-all, só então as regras padrão").
- **Exemplo verificado em script:** override só com regra padrão de 10%, e plano padrão com Motor 20%. Para um item de Motor, a regra escolhida é `stdMotor` (20%), e não o override.
- **Impacto:** um override "geral" não tem efeito nas categorias que já têm regra específica no plano padrão. O usuário acredita que aplicou 10%, mas o sistema paga 20%.
- **Também afeta funcionários com vários planos:** se dois planos cobrem a mesma categoria, vence o primeiro do array, e essa ordem não é garantida. **[H]** A ordenação em `server/utils/employee-commission-plans.ts` ainda precisa ser confirmada.

### FC-04 — Arredondamento por `toFixed` erra em casos de meio centavo [V] — Severidade: BAIXA (complementa o relatório de 2026-09-10)

- **Evidência:** `roundMoney` e `roundCurrency` usam `Number(x.toFixed(2))` (`employee-commission-engine.ts:75-77`, `service-order-commissions.ts:83-85`, `service-order-item-commissions.ts:22-24`, `server/utils/report-helpers.ts:67-69`). Pela representação binária, o arredondamento não é half-up consistente.
- **Exemplos executados:**
  - Receita de R$ 20,10 × 5% = 1,005, arredondado para **1,00** (half-up daria 1,01).
  - `2.675` vira 2,67 e `1.005` vira 1,00.
  - Em compensação, R$ 100,50 × 1,5% = 1,5075 vira 1,51 (correto).
- **Impacto:** diferença de até R$ 0,01 por item, sempre para baixo nesses casos. Explica divergências de centavos em conferências manuais.
- **Recomendação:** usar aritmética em centavos inteiros com half-up explícito, por exemplo `Math.round((x + Number.EPSILON) * 100) / 100` ou uma biblioteca decimal, num helper único.

### FC-05 — Edição de OS já paga ou liberada não reajusta o razão de comissões [V] — Severidade: ALTA

- **Evidência:** `server/api/service-orders/index.post.ts:150-202` recalcula apenas o snapshot por item e `commission_amount`. A função não chama `releaseServiceOrderCommissions`, e não há trava de edição por `payment_status`/`completed` no handler (busca por `payment_status`/`completed`/409 sem guarda).
- **Exemplo:** OS em modo `full`, comissão de 10% liberada sobre R$ 1.000,00, ou seja, R$ 100,00 pendentes. O usuário aplica R$ 300,00 de desconto.
  - Os itens e o `commission_amount` passam a mostrar R$ 70,00.
  - O razão (`employee_financial_records`) continua com **R$ 100,00 pendentes** até o próximo evento de recebimento ou um "Recalcular" manual.
  - Se esses R$ 100,00 forem pagos antes disso, o excedente nunca é recuperado: o claw-back só emite um *warning* (`service-order-commissions.ts:559-563`).
- **Impacto:** a OS e o relatório de comissões divergem, e pode haver pagamento a maior.

### FC-06 — `total_amount`, `discount` e `total_taxes_amount` da OS vêm do cliente, sem reconciliação no servidor [V/H] — Severidade: MÉDIA

- **Evidência:** `index.post.ts:137-140` usa `pickValue`/`keepExisting` com valores do body. O servidor não recalcula `total_amount` a partir dos itens. Esse campo é o denominador de `receivedRatio` (`service-order-commissions.ts:423-426`).
- **[H] Impacto:** se o total gravado divergir de Σitens − desconto + impostos (bug no front, cliente antigo, chamada via API), a liberação proporcional sai distorcida. Exemplo: total gravado de R$ 1.200,00 para itens líquidos de R$ 1.000,00 quitados em R$ 1.000,00 dá razão de 0,833, e só 83,3% da comissão é liberada.

### FC-07 — Pagamento de comissão sem guarda de concorrência: risco de pagamento em duplicidade [V] — Severidade: ALTA

- **Evidência:**
  - `server/api/reports/commissions/[id]/pay.post.ts:48` verifica `status === 'paid'` e depois faz o update em `:143-155` **sem** `.eq('status','pending')`.
  - O lote faz o mesmo: `server/api/financial/pay-commissions-bulk.post.ts:103` e `:178-183`.
  - O saldo bancário é atualizado por leitura e escrita em memória (`pay.post.ts:78-80,114-117`; `bulk:133-158`), sem operação atômica.
- **Cenário:** dois cliques ou duas abas pagando o mesmo registro de R$ 100,00 geram duas despesas e dois lançamentos de extrato. O saldo cai R$ 200,00, ou cai só R$ 100,00 por *lost update*, deixando o saldo inconsistente com o extrato.
- **Bulk, detalhe adicional:** os erros de `insert` em `financial_transactions` e do update do saldo (`:140-158`) não são verificados.
- **Escopo:** o lote também paga registros que não são de comissão (exclui só `adiantamento`), o que pode ser intencional. **[H]**
- **Relação:** `docs/engineering/pending-bulk-payment-rollback.md` (não versionado) parece tratar parte disso.

### FC-08 — Excluir a OS estorna comissões já pagas, creditando de volta no banco um dinheiro que não voltou [V] — Severidade: ALTA

- **Evidência:**
  - `server/api/service-orders/[id].delete.ts:66-103` apaga **todas** as comissões, inclusive as `paid`.
  - Em seguida reverte os extratos (`revertStatementOnAccount`) e faz soft-delete da despesa, sem a guarda que existe em `payment.delete.ts:46-60` e `service-order-receipt-reversal.ts:65-79`.
- **Exemplo:** comissão de R$ 150,00 paga ao mecânico. A OS é excluída. O saldo bancário sobe R$ 150,00 e a despesa some, embora o caixa tenha saído de fato.
- **Impacto:** saldo bancário superavaliado e despesa de pessoal subavaliada. A exclusão contradiz a política adotada nos outros fluxos de estorno.

### FC-09 — Excluir um registro de comissão deixa despesa e extrato órfãos [V] — Severidade: MÉDIA

- **Evidência:** `server/api/reports/commissions/[id].delete.ts:29-33` faz hard delete de qualquer registro, inclusive `paid`. A `financial_transaction` (com `employee_financial_record_id`) e o extrato continuam existindo.
- **Impacto:** a despesa aparece no caixa, mas some do relatório de comissões. Não existe estorno vinculado.
- **Assimetria:** em registros `pending` de uma OS ativa, o próximo evento de recebimento **recria** o valor como delta (`service-order-commissions.ts:533-534`). Na prática, excluir uma comissão pendente não tem efeito duradouro.

### FC-10 — Pendências de funcionário removido da OS (ou sem regra) nunca são recuperadas no fluxo automático [V] — Severidade: MÉDIA

- **Evidência:** `targetEntitlements` (`service-order-commissions.ts:377-379`) contém apenas funcionários com direito maior que 0. O loop de claw-back (`:500-564`) não visita quem tem registros mas perdeu o direito: foi removido dos responsáveis, teve o funcionário excluído ou a regra deixou de casar.
- **Exemplo:** funcionário A recebe R$ 80,00 pendentes e depois é trocado por B na OS. No pagamento seguinte, B recebe a comissão dele, e os R$ 80,00 de A continuam pendentes. O resultado é pagamento em duplicidade da mesma OS.
- Só o recálculo manual por funcionário limpa esse caso (`:388-403`).

### FC-11 — Relatório: o gráfico por funcionário não bate com os totais do resumo [V] — Severidade: MÉDIA

- **Evidência:** `server/api/reports/commissions.get.ts`.
  - O resumo soma **apenas** `record_type='commission'` (`:151-158`).
  - `byEmployeeMap` soma **todos** os registros filtrados, inclusive `bonus` (`:171-181`).
  - O agrupamento é por **nome**, não por id (`:173`). Homônimos se fundem, e funcionários excluídos (lista com `deleted_at null`, `:80-84`) viram um único "Unknown".
  - As somas não passam por `roundMoney`; ruído de float aparece no front, por exemplo `0.1+0.2+0.3+10.05+7.15` dá 17,8 aqui, mas com outras combinações gera `x.xx000000001`.
  - O filtro de período usa `entry_date` da OS (`:102-105`), e não a data de liberação ou de pagamento.
- **Impacto:**
  - Σ(gráfico por funcionário) ≠ "Total de comissões" sempre que existem bônus no período.
  - O relatório por competência de entrada da OS não concilia com o caixa (despesas por `due_date`/`payment_date`).
  - Comissões de OS excluídas somem do relatório, pois `ordersMap` exclui as excluídas (`:77`).

### FC-12 — O snapshot por item inclui funcionários inativos ou excluídos, e o direito não [V] — Severidade: BAIXA

- **Evidência:** `computeEmployeeEntitlements` filtra por `activeEmployeeIds` (`service-order-commissions.ts:172`). `computeServiceOrderItemsWithCommissionSnapshots` não filtra (`server/utils/service-order-item-commissions.ts:68-73`).
- **Divergência:** `index.post.ts:193` grava `commission_amount` = soma dos itens, enquanto `service-order-commissions.ts:374` grava a soma dos direitos.
- **Impacto:** o valor de "comissão da OS" muda conforme a última operação, e o detalhamento por item pode não somar o total.

### FC-13 — Claw-back com tolerância de R$ 0,01 pode remover 1 centavo a mais [V] — Severidade: INFORMATIVA

- **Evidência:** `service-order-commissions.ts:545-549`. Um registro de R$ 10,01 é apagado quando faltam R$ 10,00. A diferença se autocorrige no próximo evento, com delta de +0,01.

### FC-14 — Valor fixo em itens com total zero: `hasMatchingItems=false` mesmo com comissão maior que 0 [V] — Severidade: BAIXA

- **Evidência:** `employee-commission-engine.ts:295` (`hasMatchingItems: eligibleSale > 0`), enquanto `total` pode ser maior que 0 em regras de valor fixo.
- **[H]** Nenhum consumidor atual de `hasMatchingItems` foi confirmado. O risco é latente.

## Itens verificados sem defeito

- Rateio de desconto: `eligibleDiscount × item/eligibleSale` = `discount × item/subtotal`. É matematicamente correto e não há dupla dedução.
- Os impostos são abatidos só da base "lucro", não da base "receita". Isso é consistente com o desenho documentado.
- O lucro é limitado a 0 por baixo, e comissões negativas são descartadas (`perItem` com amount > 0).
- `payment.delete.ts` e o estorno de recebimento bloqueiam a operação quando já existe comissão paga (boa prática).
- O cancelamento da OS exige ausência de pagamento e de parcelas (`cancel.post.ts:55-94`).

## Testes de regressão recomendados

| Finding | Teste (camada) |
|---|---|
| FC-01 | Integração: parcela de 1000 com recebimento parcial de 600 libera 60% do direito; o estorno do parcial volta a 0. |
| FC-02 | Unidade/integração: `apply` de override parcial gera direito = patch (override + padrão), e uma liberação seguinte com o mesmo recebido gera delta 0. |
| FC-03 | Unidade (`getApplicableCommissionRule`): override só com catch-all × plano padrão com regra específica, conforme a regra de negócio decidida (exige decisão de PO). |
| FC-04 | Unidade: `computeCommissionAmount` percentual com receita 20,10 a 5% resulta em 1,01 (half-up); tabela com casos de .xx5. |
| FC-05 | Integração: editar desconto em OS liberada faz o razão pendente refletir o novo direito (ou a edição ser bloqueada). |
| FC-06 | API: salvar OS com `total_amount` ≠ Σitens − desconto + impostos é rejeitado ou recalculado. |
| FC-07 | Integração: dois POST `/pay` concorrentes no mesmo registro geram exatamente uma despesa e um débito; saldo = anterior − valor. |
| FC-08 | API: DELETE de OS com comissão paga retorna 409 (paridade com `payment.delete`). |
| FC-09 | API: DELETE de comissão paga é bloqueado ou estorna a despesa vinculada. |
| FC-10 | Integração: trocar o responsável A por B e registrar pagamento remove o pendente de A. |
| FC-11 | Unidade/API: Σ `charts.byEmployee.total` = `summary.totalCommissions` com filtro de comissão; homônimos ficam separados por id. |
| FC-12 | Unidade: snapshot por item ignora funcionário excluído; `commission_amount` é igual nos dois caminhos. |

## Limitações

- Não houve acesso a dados de produção. Os exemplos são sintéticos, mas reproduzem fielmente as fórmulas do código.
- Não foram auditados nesta etapa: a ordenação das regras em `server/utils/employee-commission-plans.ts`, `server/utils/employee-commission-report.ts`, `server/utils/sales-item-commissions.ts` (relatório de itens vendidos) e o preview do frontend (`app/utils/service-orders.ts`).
- Os testes existentes (`tests/fast/commissions/*`) não foram executados nesta auditoria.
