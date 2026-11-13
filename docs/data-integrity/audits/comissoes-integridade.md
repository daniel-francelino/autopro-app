# Auditoria de Integridade de Dados — Comissões

- Data: 2026-11-13
- Escopo: geração, liberação, pagamento, estorno e exclusão de comissões de OS (`employee_financial_records`, `record_type='commission'`), planos de comissão, migrations.
- Método: leitura estática de código e migrations. Nenhum teste executado e nenhum dado de produção acessado. Nenhum código alterado.
- Motivação: o cliente relata que as comissões "não estão dando certo".

## Fora do escopo / não verificado

- Comissões de venda de itens (`server/utils/sales-item-commissions.ts`), relatórios (`employee-commission-report.ts`, `reports/commissions*.get.ts`), bônus e o motor puro `lib/utils/employee-commission-engine.ts` (fórmulas/arredondamento) não foram lidos linha a linha. A precisão das fórmulas fica com o `financial-auditor`.
- `softDeleteFinancialTransaction` (`server/utils/financial-transaction-deletion.ts`) não foi lido por inteiro.

## Modelo resumido (verificado)

- O ledger fica em `employee_financial_records` (`supabase/migrations/20240101000020_create_employee_financial_records.sql:11-74`): `amount numeric(15,2)`, `status IN ('paid','pending')`, soft delete (`deleted_at`), FK `service_order_id ON DELETE SET NULL`, FK `employee_id ON DELETE CASCADE`.
- A liberação fica centralizada em `releaseServiceOrderCommissions` (`server/utils/service-order-commissions.ts:243-601`). Ela recalcula o direito total de cada funcionário, multiplica pela razão recebida (`receivedRatio`), compara com a soma dos registros existentes e insere um delta `pending` ou faz claw-back nos `pending`.
- Quem chama: process-payment (`process-payment.post.ts:124,255`), pagamento de parcela (`installments/[installmentId]/pay.post.ts:241`), recebimento avulso (`receive-extra-payment.post.ts:121`), exclusão de parcela (`installments/[installmentId].delete.ts:189`), estorno de recebimento (`service-order-receipt-reversal.ts:148`) e recálculo manual (`generate-commissions.post.ts:75`).

---

## Findings

Severidades: Crítica, Alta, Média, Baixa. Cada finding indica se é **Verificado** (evidência no código) ou **Hipótese**.

### DI-01 — Nenhuma idempotência ou constraint contra comissão duplicada; liberação sujeita a race condition (Crítica, Verificado)

- `releaseServiceOrderCommissions` faz read-compute-write sem transação nem lock. Ela lê os registros existentes (`service-order-commissions.ts:428-433`), calcula `delta = released - existingSum` (`:511-513`) e insere um novo registro (`:533-534`, `:446-498`).
- Não existe chave única nem chave de idempotência em `employee_financial_records`. Nenhuma migration cria UNIQUE para (service_order_id, employee_id, installment) (`20240101000020...sql:46-74`; grep em `supabase/migrations` não encontrou nada).
- Os gatilhos não têm proteção contra duplo envio. Exemplo: `pay.post.ts:54` faz a checagem `installment.status === 'paid'` (TOCTOU) e depois os updates não são condicionais (`:141-144`, `:221-224`).
- Impacto: dois pagamentos ou recálculos simultâneos (duplo clique, duas abas, retry de rede) leem o mesmo `existingSum` e cada um insere o mesmo delta. Resultado: comissão em dobro.
- Correção recomendada: mover a liberação para uma função SQL (RPC) transacional com `SELECT ... FOR UPDATE` na OS (ou `pg_advisory_xact_lock(order_id)`), além de updates condicionais de status nas parcelas.
- Testes de regressão:
  - (integração) duas chamadas concorrentes a `releaseServiceOrderCommissions` para a mesma OS resultam em soma de comissão = direito × razão, sem duplicata;
  - pagar a mesma parcela duas vezes em paralelo cria apenas uma transação e um delta.

### DI-02 — O claw-back e o recálculo manual apagam ou alteram registros sem checar o status; corrida com o pagamento destrói comissão paga (Crítica, Verificado)

- O claw-back faz `delete().eq('id', record.id)` (`service-order-commissions.ts:548`) e `update({ amount })` (`:551-554`) filtrando só por id. Ele não usa `.eq('status','pending')`. O recálculo manual também apaga `pending` só por id (`:526-528`).
- Os endpoints de pagamento também não condicionam o update ao status `pending`: `reports/commissions/[id]/pay.post.ts:143-155` e `financial/pay-commissions-bulk.post.ts:178-183`.
- Cenário: o release lê o registro como `pending`, o financeiro paga esse registro e em seguida o release apaga o registro ou reduz o `amount`. Isso deixa um pagamento real (transação de despesa e extrato) apontando para um registro apagado (FK `ON DELETE SET NULL`, `20240101000021...sql:71-74`) ou com valor menor que o pago.
- No sentido inverso: o pagamento lê o `amount` antigo, o release reduz o valor e o pagamento debita o valor antigo do banco.
- Correção: usar `.eq('status','pending')` em todo delete/update do release e `.eq('status','pending')` com checagem de linhas afetadas nos pagamentos, idealmente dentro da mesma transação do DI-01.
- Testes:
  - um claw-back depois que o registro virou `paid` não altera esse registro;
  - pagar um registro cujo `amount` mudou após a leitura falha ou usa o valor atual.

### DI-03 — Pagamento de comissão sem guarda de concorrência: débito bancário duplicado (Crítica, Verificado)

- `reports/commissions/[id]/pay.post.ts:48` checa `status === 'paid'` e depois insere a despesa (`:91-109`), atualiza o saldo de forma absoluta (`:114-117`, `nextBalance = previousBalance - amount`, `:80`) e só no fim marca o registro como pago, sem condição de status (`:143-155`). O bulk segue o mesmo padrão (`pay-commissions-bulk.post.ts:103`, `:133-158`).
- Impacto: um duplo clique gera duas despesas e dois extratos. Além disso, o saldo é sobrescrito por valor absoluto (lost update), e o rollback restaura `previousBalance` absoluto (`pay.post.ts:174-176`, `bulk:203`), apagando movimentos concorrentes de outras operações.
- Teste: duas chamadas simultâneas de pay para o mesmo id geram exatamente uma despesa, e o saldo cai uma única vez.

### DI-04 — Pagamento parcial de parcela não libera comissão (Alta, Verificado)

- `pay.post.ts:206-213` marca a parcela como `partial` quando o recebimento é parcial, e a transação de receita é criada (`:190-204`).
- Porém `receivedTotal` em `service-order-commissions.ts:414-422` soma apenas parcelas com `status='paid'` e usa o `amount` da parcela, não o dinheiro efetivamente recebido.
- Impacto: dinheiro recebido em parcelas parciais não gera comissão até a parcela quitar. O usuário vê o recebimento, mas não vê a comissão correspondente. É candidato forte à queixa "não está dando certo".
- Correção: calcular `receivedTotal` a partir de `financial_transactions` com `status='paid'`, `deleted_at IS NULL` e vínculo com a OS/parcela. Isso precisa de decisão de negócio: liberar proporcional ao recebido parcial ou só na quitação. Não inventar a regra; validar com o PO.
- Teste: em uma OS de 1000 com uma parcela de 1000 paga em 400, a comissão liberada é 40% do direito (ou 0, se a regra decidida for "só na quitação"), com assert explícito.

### DI-05 — Edição da OS não recalcula o ledger: `commission_amount` diverge dos registros (Alta, Verificado)

- `service-orders/index.post.ts:150-219` recalcula o snapshot de itens e `service_orders.commission_amount` ao editar itens, desconto, responsáveis, `entry_date` ou `total_amount`. O endpoint não chama `releaseServiceOrderCommissions` e não tem guarda contra edição de OS já paga: só existe `payment_status` via `keepExisting` (`:127`), sem bloqueio.
- Impacto: depois de pago, a OS editada mostra uma comissão (card e itens) diferente do que existe em `employee_financial_records`. A divergência só é corrigida se alguém clicar em "Recalcular" ou se houver novo recebimento.
- Também verificado: o payload aceita `status`, `payment_status` e `total_amount` vindos do cliente (`:126-127`, `:138`). Isso permite levar a OS a `cancelled` sem passar por `cancel.post.ts`, e as comissões não são removidas.
- Testes:
  - editar os itens de uma OS paga dispara a reconciliação ou é bloqueado;
  - enviar `status:'cancelled'` pelo index.post é rejeitado.

### DI-06 — Funcionário removido dos responsáveis mantém comissão `pending` órfã (Alta, Verificado)

- O release só itera sobre `targetEntitlements` (`service-order-commissions.ts:500`), que vêm de `computeEmployeeEntitlements`. Esse cálculo ignora quem não está mais em `responsible_employees`, quem está inativo ou excluído (`:172`) e quem ficou sem regras (`:175`, `:192`).
- Registros existentes de funcionários fora dessa lista nunca entram no claw-back (`recordsByEmployee`, `:435-441`, é consultado só por entitlement).
- O mesmo vale quando a OS fica sem itens ou sem responsáveis: o retorno antecipado em `:405-412` não reverte nada.
- Impacto: comissão `pending` continua para quem saiu da OS e pode ser paga indevidamente.
- Teste: trocar o responsável A por B e liberar resulta em `pending` de A = 0 e B com o direito correto.

### DI-07 — Consulta de registros existentes ignora soft delete (Alta, Verificado)

- `service-order-commissions.ts:428-433` não aplica `.is('deleted_at', null)`. Já `generate-commissions.post.ts:68` aplica esse filtro, o que torna as duas leituras inconsistentes.
- Impacto: se um registro for soft-deleted (a coluna existe e há fluxos de exclusão auditada, migration `...084`), ele continua contando em `existingSum`. A comissão então não é regenerada (gap) e o claw-back pode "apagar" registros que já estavam excluídos.
- As guardas de comissão paga também não filtram `deleted_at`: `payment.delete.ts:46-52`, `service-order-receipt-reversal.ts:65-72`, `installments/[installmentId].delete.ts:106-113`, `cancel.post.ts:121-126`.
- Teste: um registro com `deleted_at` preenchido não entra em `existingSum`, e o release recria o valor devido.

### DI-08 — Exclusão manual de comissão é hard delete, não reverte o pagamento e é "desfeita" pelo próximo release (Alta, Verificado)

- `reports/commissions/[id].delete.ts:20-35` busca o registro sem filtrar `deleted_at`, `record_type` nem `status`, e faz `delete()` físico.
- Se o registro estava `paid`, a despesa e o extrato ficam órfãos (FK SET NULL, `20240101000021...sql:71-74`) e o saldo bancário não é revertido. Não há motivo obrigatório, ao contrário da intenção da migration `...084:1-19`.
- Se o registro estava `pending`, o próximo gatilho de release vê `existingSum` menor e reinsere o delta (`service-order-commissions.ts:511-534`). A exclusão "não pega", o que é um sintoma provável da queixa.
- Teste:
  - excluir um registro `paid` é bloqueado ou reverte a despesa;
  - um `pending` excluído não reaparece no próximo pagamento de parcela, ou o comportamento é documentado e a UI orienta a usar override.

### DI-09 — Cancelamento de OS e cancelamento de pagamento apagam comissões fisicamente (Média, Verificado)

- `cancel.post.ts:121-157` apaga todas as comissões da OS, inclusive `paid`, com `delete()` físico (`:155`). Para as pagas, o código reverte o extrato e o saldo (`:140-153`), ou seja, desfaz um pagamento ao funcionário que de fato ocorreu.
- `payment.delete.ts:87-109` também faz hard delete (`:107`), mas esse fluxo bloqueia antes quando há comissão paga (`:46-60`).
- Impacto: perda de trilha histórica (só sobra o `recordAudit`). Em `cancel.post.ts` não há guarda equivalente para comissão paga.
- Teste: cancelar uma OS com comissão `paid` é bloqueado (409), igual ao payment.delete.

### DI-10 — `commission_release_mode='full'` persiste após falha e após cancelamento do pagamento (Média, Verificado)

- `process-payment.post.ts:79-88` grava `full` antes das validações de plano (`:103-105`, `:112-117`, `:141-148`). Se a requisição falhar, o modo fica `full` sem plano criado.
- `payment.delete.ts:160-170` não reseta o modo. Com `full`, `receivedRatio = 1` (`service-order-commissions.ts:424-426`), então qualquer "Recalcular" libera 100% da comissão com zero recebido. Estornos de recebimento (`service-order-receipt-reversal.ts:148`) também nunca fazem claw-back nesse modo.
- Teste:
  - um process-payment que falha na validação mantém o modo `proportional`;
  - depois de payment.delete, o recálculo libera 0.

### DI-11 — Ausência de atomicidade e erros ignorados em gravações intermediárias (Média, Verificado)

- Erros ignorados em leituras: `existingRecords` (`service-order-commissions.ts:428`) e `paidInstallments` (`:414`). Se a leitura de `existingRecords` falhar, ela vira lista vazia e o release reinsere todo o valor (duplicata). Se a leitura de `paidInstallments` falhar, a razão vira 0 e o claw-back apaga os `pending`.
- Erros ignorados em escritas: update da OS (`:372-375`), deletes (`:527`, `:548`) e update do log (`:588-591`).
- O recálculo manual apaga os `pending` (`:526-528`) antes de inserir o novo registro (`:530-531`). Se o insert falhar, a comissão some.
- process-payment cria parcelas e transações em loop (`:154-230`). Se houver exceção no meio, ficam parcelas sem liberação de comissão (gap).
- Bulk: o erro do insert da transação é ignorado (`pay-commissions-bulk.post.ts:140-156`). O saldo é debitado mesmo assim e só é revertido se o update final falhar.
- Teste (com mocks de falha do Supabase): uma falha na leitura de `existingRecords` aborta sem inserir; uma falha no insert durante o recálculo manual preserva os `pending` anteriores.

### DI-12 — Log de ajustes manuais com lost update (Média, Verificado)

- `commission_manual_adjustments_log` é reescrito como `[...existingLog, entry]` a partir de uma leitura feita no início da função (`service-order-commissions.ts:319-321`, `:587-591`). Dois recálculos ou overrides simultâneos perdem uma entrada.
- Como o override ativo é derivado desse log (`getActiveCommissionOverride`, `:323`, `:341`), perder uma entrada muda a regra aplicada.
- Correção: append atômico em SQL (`jsonb || jsonb` no UPDATE) dentro da transação do DI-01.
- Teste: dois overrides concorrentes resultam em um log com 2 entradas.

### DI-13 — Precisão e representação (Baixa, Verificado)

- `employee_commission_rules.commission_amount numeric(15,2)` (`...085:134`) guarda a taxa percentual com 2 casas. Taxas como 9,375% são truncadas ou arredondadas pelo banco.
- O arredondamento em JS usa `Number(value.toFixed(2))` (`service-order-commissions.ts:83-85`), que é binário e tem casos de meio-centavo incorretos.
- As tolerâncias de 0,01 (`:533`, `:535`, `:545`, `:547`) podem deixar resíduos de centavos quando o valor é dividido em vários deltas.
- Teste: uma OS com várias parcelas fecha a soma liberada = direito total exatamente (sem diferença de centavos).

### DI-14 — Isolamento por tenant (Baixa, Verificado com ressalva)

- As leituras principais filtram `organization_id`.
- Alguns updates e deletes usam só `id`, depois de uma leitura que validou a organização: `service-order-commissions.ts:372-375`, `:527`, `:548`, `:551-554`, `:588-591`; `cancel.post.ts:155`, `:160-167`; `pay-commissions-bulk.post.ts:158`, `:178-183`. Como todos os ids vieram de queries escopadas, isso não é exploração direta hoje. O cliente é admin (`getSupabaseAdminClient`), então a RLS (`...020:131-156`) não protege. Recomenda-se defesa em profundidade com `.eq('organization_id', ...)` em toda escrita.
- Hipótese: `override.commissionPlanId` é validado por organização em `fetchCommissionPlan` (`:271`), mas a implementação não foi lida.

### DI-15 — Pagamento em lote aceita qualquer `record_type` (Baixa, Verificado)

- `pay-commissions-bulk.post.ts:95` não filtra `record_type='commission'`. O filtro `'adiantamento'` (`:109`) é código morto, porque a constraint usa `'advance'` (`...020:69-70`).
- Impacto: adiantamentos, descontos ou bônus podem ser "pagos" como comissão, na categoria Salários.

### Hipóteses (não verificadas)

- H-01: excluir pelo Financeiro (`financial/[id].delete.ts:63-70`) uma despesa de pagamento de comissão (sem `service_order_id`) faz soft-delete da transação, mas o registro de comissão pode continuar `paid`, apontando para uma transação excluída. Verificar `softDeleteFinancialTransaction`.
- H-02: o sinal (`down-payment.post.ts`) cria uma parcela `paid` e não chama o release. Isso provavelmente é intencional, porque a OS ainda não está concluída. A liberação só ocorre no process-payment (`:124`).
- H-03: o backfill legado (`...091`) e o drop de colunas legadas (`...099`) podem ter deixado OS antigas sem regra de plano. Nesse caso `rules.length === 0` (`service-order-commissions.ts:175`) e não há comissão gerada. Confirmar com uma query read-only em homologação.

## Consultas de diagnóstico sugeridas (read-only, executar só em ambiente autorizado)

1. Duplicatas: agrupar `employee_financial_records` com `record_type='commission'` e `deleted_at IS NULL` por (service_order_id, employee_id, service_order_installment_id, amount, created_at::date) e listar onde `count(*) > 1`.
2. Órfãs: comissões de OS `cancelled` ou excluídas, ou de funcionários fora de `responsible_employees`.
3. Divergência: `service_orders.commission_amount` × razão recebida comparada com `sum(amount)` dos registros.
4. Pagas sem transação: registros com `status='paid'` e `financial_transaction_id IS NULL`, ou com transação `deleted_at IS NOT NULL`.

## Prioridade de correção sugerida

1. DI-01, DI-02 e DI-03: transação/lock e updates condicionais.
2. DI-04, DI-06, DI-07 e DI-08: os gaps mais prováveis de explicar a queixa.
3. DI-05, DI-09, DI-10 e DI-11.
4. DI-12 a DI-15.

Decisões de negócio pendentes (PO/financeiro): regra de liberação para recebimentos parciais (DI-04), política de edição de OS paga (DI-05) e semântica de "excluir comissão" (DI-08).
