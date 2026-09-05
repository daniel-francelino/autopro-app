# Fluxo de pagamento de Ordens de Serviço (OS)

Documentação do comportamento **atual** do fluxo de recebimento de pagamento de uma OS, levantada lendo o código (frontend + backend + migrations). Objetivo: servir de base para decidir o que melhorar. Não é uma proposta de mudança — é o "como é hoje", com os pontos frágeis sinalizados ao final.

Veja também: [payment-flow-redesign.md](payment-flow-redesign.md) — proposta de "como deveria ser" para cobrir entrada + parcelado, múltiplos meios de pagamento, pagamento avulso e outros cenários de ERP.

## 1. Visão geral

Pagamento de OS é um módulo **interno** (não usa o Stripe). O Stripe do projeto (`stripe` no `package.json`, `/server/api/billing/*`, `/server/api/stripe/*`) é só para a assinatura SaaS da própria oficina — não tem nenhuma relação com cobrança de cliente. O dinheiro do cliente é controlado por um livro-caixa próprio: `bank_accounts` (saldo por conta) + `financial_transactions` (lançamentos) + `bank_account_statements` (extrato/auditoria com saldo antes/depois).

Existem três operações de pagamento, cada uma com seu próprio endpoint, e elas **não compartilham código** entre si (cada handler repete a lógica de criar transação/atualizar saldo/criar extrato):

| Ação | Onde na UI | Endpoint |
|---|---|---|
| Registrar pagamento da OS (à vista ou parcelado) | [PaymentModal.vue](../app/components/service-orders/PaymentModal.vue) | `POST /api/service-orders/:id/process-payment` |
| Pagar uma parcela específica | [OSInstallmentsCard.vue](../app/components/service-orders/detail/OSInstallmentsCard.vue) | `POST /api/service-orders/:id/installments/:installmentId/pay` |
| Cancelar/desfazer todo o pagamento | [detail/Modal.vue](../app/components/service-orders/detail/Modal.vue) `confirmCancelPayment` | `DELETE /api/service-orders/:id/payment` |
| Pagar comissão de funcionário (separado da OS) | [OSCommissionsCard.vue](../app/components/service-orders/detail/OSCommissionsCard.vue) | `POST /api/financial/pay-commissions-bulk` |

O botão "Receber" só aparece quando (`OSHeader.vue:46-51`, mesma regra duplicada em `OrderCard.vue:99-104`):
```
canUpdate && payment_status === 'pending' && status === 'completed' && !installment_count
```
Ou seja: **só dá pra registrar pagamento de OS concluída** (`status='completed'`), e só quando ainda não tem pagamento (`payment_status='pending'`).

## 2. Registrar pagamento — `PaymentModal.vue` → `process-payment.post.ts`

### Frontend (`app/components/service-orders/PaymentModal.vue`)

O modal coleta:
- **Conta bancária** (obrigatório) — vem de `GET /api/bank-accounts`, pré-seleciona a primeira ativa e herda a `preferred_payment_method` dela.
- **Forma de pagamento**: `pix | cash | credit_card | debit_card | bank_slip | transfer | check`.
- **Maquininha** (`payment_terminal_id`) — só aparece se a forma for cartão (`showTerminalField`, linha 79).
- **À vista ou parcelado** (toggle `form.isInstallment`).
- Se parcelado: número de parcelas (2 a 12) gera linhas editáveis (valor, vencimento, status) via `distributeInstallments` (linha 104-121):
  - Divide o total igualmente, e a **1ª parcela absorve a sobra do arredondamento**.
  - A 1ª parcela já nasce com status `paid`; as demais `pending` — mas o usuário pode editar manualmente o status de qualquer parcela antes de enviar (não há trava na UI impedindo marcar todas como `paid` de uma vez, por exemplo).
  - Vencimentos são `data do pagamento + N meses` (um por parcela).

Validação **só no frontend** antes de enviar (`save()`, linha 265-274):
- conta bancária selecionada;
- se parcelado, soma das parcelas tem que bater com `order.total_amount` (tolerância de R$0,01).

Envia `POST /api/service-orders/:id/process-payment` com `paymentMethod`, `paymentDate`, `bankAccountId`, `paymentTerminalId`, e `installments[]` (omitido quando é à vista).

### Backend (`server/api/service-orders/[id]/process-payment.post.ts`)

1. Busca a OS (`organization_id` + `deleted_at is null`). 404 se não achar.
2. Trava: `status !== 'completed'` → 409. `payment_status === 'paid'` → 409.
3. **Caminho parcelado** (`installments[]` não vazio, linhas 181-251): para cada parcela, na ordem enviada:
   - Cria um `financial_transactions` (`type='income'`, `category='services'`, `status` = igual ao status da parcela). A primeira transação criada se torna `parent_transaction_id` das demais.
   - Se `status==='paid'`: soma o valor no `bank_accounts.current_balance` da conta daquela parcela e grava uma linha em `bank_account_statements` com saldo antes/depois. Se a criação do statement falhar, desfaz o incremento de saldo e apaga a transação (rollback manual, linhas 142-150).
   - Cria a linha em `service_order_installments` (`installment_number`, `amount`, `due_date`, `payment_date` só se pago, `status`, `financial_transaction_id`, `bank_account_id`, `payment_terminal_id`).
   - Ao final, recalcula `service_orders.payment_status`: `paid` se todas pagas, `partial` se algumas, `pending` se nenhuma. Marca `is_installment=true`, `installment_count=N`.
4. **Caminho à vista** (sem `installments[]`, linhas 253-278): cria uma única transação `paid`, soma o saldo, cria o statement, e marca a OS como `payment_status='paid'`, `is_installment=false`.
5. **Sempre** chama `generateServiceOrderCommissions(...)` (linha 281) — ver seção 4.
6. Retorna `{ order, commissions, totalCommission, warnings }`.

Cada parcela pode ter sua própria conta bancária / forma de pagamento / maquininha (o backend aceita isso por parcela), mas a UI hoje sempre usa a mesma conta/forma para todas as parcelas de uma OS — o campo por-parcela existe no schema e no contrato da API, só não é exposto na tela.

## 3. Pagar uma parcela isolada — `OSInstallmentsCard.vue` → `pay.post.ts`

Tela de detalhe mostra um card por parcela (`Pago`/`Pendente`/`Atrasado`, cor success/warning/error) com botão "Pagar" nas pendentes. Confirma num modal (`AppConfirmModal`) e chama `POST /api/service-orders/:id/installments/:installmentId/pay` (body opcional `{ payment_date }`, padrão hoje).

Backend (`server/api/service-orders/[id]/installments/[installmentId]/pay.post.ts`):
1. Busca a parcela pelo `id` + `service_order_id` + `organization_id`. 404 se não achar. 409 se já está `paid`.
2. Marca a parcela `paid` + `payment_date`.
3. Atualiza a `financial_transactions` ligada para `status='paid'` (também sobrescreve `due_date` da transação com a data de pagamento, linha 63 — não é um bug grave, mas mistura "vencimento" com "data de pagamento" na transação financeira).
4. Se a parcela tem `bank_account_id`: soma o valor no saldo da conta e cria o statement (com rollback do saldo se o statement falhar, igual ao endpoint anterior).
5. Recalcula `service_orders.payment_status` olhando **todas** as parcelas daquela OS (`paid`/`partial`/`pending`).

Importante: este endpoint **não gera/atualiza comissão**. Comissão só é (re)gerada dentro de `process-payment.post`.

## 4. Comissão de funcionário — gerada como efeito colateral do pagamento

`server/utils/service-order-commissions.ts`, função `generateServiceOrderCommissions`, chamada só por `process-payment.post.ts` (não é chamada pelo endpoint de pagar parcela isolada, nem alterada pelo cancelamento de pagamento).

Comportamento, a cada chamada:
1. **Apaga todas** as comissões (`employee_financial_records` com `record_type='commission'`) já existentes para aquela OS — junto com a `financial_transactions` e os `bank_account_statements` ligados a elas (linhas 89-111). **Isso roda mesmo que a comissão antiga já estivesse `paid`**, e o saldo da conta bancária que recebeu o pagamento daquela comissão **não é revertido** aqui (diferente do `payment.delete.ts`, que reverte saldo corretamente — ver Gap 3 abaixo).
2. Se a OS não tem `responsible_employees` ou não tem `items`, zera `commission_amount` e retorna com warning — não lança erro.
3. Para cada funcionário responsável com `has_commission=true`:
   - Filtra os itens elegíveis pelas `commission_categories` do funcionário (se vazio, todos os itens contam).
   - `commission_type==='percentage'`: rateia desconto e impostos proporcionalmente entre os itens elegíveis; se `commission_base==='profit'`, subtrai custo do item e impostos da base antes de aplicar o percentual.
   - Qualquer outro `commission_type`: comissão = valor fixo (`commission_amount` do funcionário), sem proporção a itens.
   - Comissão <= 0 é descartada (não cria registro).
4. Cria um `employee_financial_records` por funcionário elegível, `status='pending'`, com snapshot do tipo/percentual/base e do item (`item_name`, `item_amount`, `item_cost`) — esse snapshot existe porque a config do funcionário pode mudar depois.
5. Atualiza `service_orders.commission_amount` com a soma.

**A geração de comissão não depende de `payment_status`** — roda igual para pagamento à vista, parcelado totalmente pago, ou com só a 1ª parcela paga (`partial`).

Comissão é paga **separadamente** da OS, em `OSCommissionsCard.vue` → `POST /api/financial/pay-commissions-bulk` (módulo financeiro, fora de `service-orders/*`). Isso debita da "conta bancária ativa da organização" (texto do próprio modal de confirmação) — não necessariamente a mesma conta usada para receber o pagamento da OS.

## 5. Cancelar pagamento — `payment.delete.ts`

Chamado pelo botão "Cancelar pagamento" no header do detalhe (`canCancelPayment`: `payment_status` em `paid`/`partial` e OS não cancelada). `DELETE /api/service-orders/:id/payment`:

1. Para cada comissão (`employee_financial_records` `record_type='commission'`) da OS: apaga os `bank_account_statements` ligados (revertendo `current_balance` para o `previous_balance` salvo no statement) e a `financial_transactions`, depois apaga a comissão.
2. Mesma coisa para cada `service_order_installments`.
3. Mesma coisa para qualquer `financial_transactions` ligada direto à OS (caminho à vista).
4. Reseta a OS: `payment_status='pending'`, `payment_method=null`, `is_installment=false`, `installment_count=0`, `commission_amount=0`, `terminal_fee_amount=0`.
5. Retorna contagem do que foi apagado + `warnings`.

Este é o único dos quatro endpoints que reverte saldo corretamente em todos os casos (porque lê o `previous_balance` gravado no statement, em vez de recalcular).

## 6. Modelo de dados

| Tabela | Migration | Papel |
|---|---|---|
| `service_orders` | `20240101000018` | `payment_status` (`pending`/`paid`/`partial`), `payment_method`, `is_installment`, `installment_count`, `commission_amount`, `terminal_fee_amount` |
| `service_order_installments` | `20240101000019`, colunas extra em `20240101000053` | `installment_number`, `installment_amount` (+ alias `amount`, sincronizado por trigger), `due_date`, `payment_date`, `status` (`pending`/`paid`/`overdue`), `bank_account_id`, `payment_terminal_id`, `financial_transaction_id` |
| `financial_transactions` | `20240101000021`, colunas extra em `20240101000053` | `type`/`status`/`category`, `is_installment`+`installment_count`+`current_installment`+`parent_transaction_id` (agrupamento), `service_order_id`, `payment_method`, `payment_terminal_id` |
| `bank_account_statements` | `20240101000022`, colunas extra em `20240101000053` | Extrato imutável: `previous_balance`/`new_balance` (+ alias `balance_after`, sincronizado por trigger) |
| `bank_accounts` | `20240101000005` | `current_balance`, `preferred_payment_method` |
| `employee_financial_records` | — | Usada para comissão (`record_type='commission'`) — tabela do módulo financeiro, reaproveitada aqui |

A migration `20240101000053_add_payment_compatibility_fields.sql` existe porque o app passou a usar nomes diferentes dos originais (`amount` vs `installment_amount`, `balance_after` vs `new_balance`) — mantém os dois nomes sincronizados via trigger de banco em vez de padronizar em um só.

## 7. Máquina de estados

**`service_orders.status`** (não é sobre pagamento, mas é o portão de entrada): `estimate → open → in_progress → waiting_for_part ⇄ in_progress → completed → delivered`, com `cancelled` possível a qualquer momento. Pagamento só é permitido em `completed`.

**`service_orders.payment_status`**: `pending → paid` (à vista ou parcelas todas pagas) ou `pending → partial → paid` (parcelas pagas uma a uma). Volta para `pending` só via cancelamento total (`DELETE /payment`). É recalculado em três lugares diferentes com a mesma lógica reescrita três vezes: `process-payment.post.ts:239-245`, `pay.post.ts:138-144`, e implicitamente zerado em `payment.delete.ts:118`.

**`service_order_installments.status`**: `pending → paid`. O terceiro valor possível no schema, `overdue`, **nunca é escrito por nenhum endpoint** — ver Gap 1.

**`employee_financial_records.status`** (comissão): `pending → paid` (ou a string `'pago'` — ver Gap 4), via `/api/financial/pay-commissions-bulk`. Não tem cancelamento individual de comissão; só é apagada por completo se a OS regenerar (`process-payment.post`) ou cancelar pagamento (`payment.delete.ts`).

## 8. Pontos de atenção (verificados no código, sem correção aplicada)

1. **`overdue` nunca é persistido.** O schema (`service_order_installments.status`, migration 19 linha 47) e o frontend (`OSInstallmentsCard.vue:18,24`) sabem sobre `overdue`, mas nenhum endpoint jamais grava esse valor — uma parcela vencida continua `pending` para sempre na tela da OS. Curiosamente, o relatório de inadimplência (`server/api/reports/debtors.get.ts:129-138`) **recalcula isso por conta própria** comparando `due_date` com a data de hoje, só que como cálculo efêmero do relatório — nunca grava de volta na parcela. Resultado: o badge "Atrasado" do card de parcelas (na OS) na prática nunca aparece, mesmo quando a mesma parcela já conta como atrasada no relatório de inadimplência.

2. **Taxa de maquininha nunca é calculada.** `terminal_fee_amount` existe no schema (`service_orders`, comentado como "Card machine / POS terminal fee"), é resetado para `0` no cancelamento (`payment.delete.ts:123`) e preservado no update genérico (`index.post.ts:135`) — mas em nenhum lugar do `process-payment.post.ts` ele é calculado ou debitado, mesmo quando `payment_terminal_id` é informado. A maquininha é só um metadado guardado, sem efeito financeiro.

3. **`generateServiceOrderCommissions` apaga comissões já pagas sem reverter saldo.** Em `service-order-commissions.ts:89-111`, toda chamada apaga as comissões existentes da OS (transação + statement) antes de recriar — incluindo as que já estavam `status='paid'`. Diferente de `payment.delete.ts`, que lê o `previous_balance` do statement antes de apagar e reverte o saldo, aqui o saldo da conta que recebeu aquele pagamento de comissão **não é tocado**. Na prática isso só importa se `process-payment` for chamado de novo para a mesma OS depois de uma comissão já ter sido paga (a UI normal não oferece esse caminho hoje, porque o botão "Receber" desaparece assim que `payment_status` deixa de ser `pending` — mas o backend não impede a chamada).

4. **Sem trava de duplo envio enquanto `payment_status` não é `paid`.** `process-payment.post.ts` só bloqueia (`409`) se a OS já está `paid`. Uma OS `pending` (nunca pagou) ou `partial` (só a 1ª parcela paga) pode receber `process-payment` de novo — criando uma segunda leva de transações/parcelas/comissões. O frontend não tem proteção de duplo-clique nem desabilita o botão entre o clique e o fechamento do modal além do `isSaving` local (que não impede uma segunda chamada vinda de outra aba/sessão).

5. **Soma das parcelas só é validada no frontend.** `installmentsMatch` (`PaymentModal.vue:83,271-273`) impede enviar parcelas cuja soma não bate com `total_amount` — mas é só uma checagem de UI. O `process-payment.post.ts` aceita qualquer array de `installments` sem comparar a soma com `order.total_amount`.

6. **`status` de comissão tem dois valores para "pago".** `OSCommissionsCard.vue:27-30` trata `'paid'` e `'pago'` como equivalentes (`isPending` exclui ambos), sinal de que o endpoint `/api/financial/pay-commissions-bulk` (fora do escopo desta investigação, é do módulo financeiro) usa uma string diferente da que `generateServiceOrderCommissions` grava (`'pending'`).

7. **Lista de OS já traz `payment_status` e progresso de parcelas** (`index.get.ts:156-158,178`, consumido por `OrderCard.vue`), mas o filtro da listagem (`service-orders.vue`, `ServiceOrdersFilters`) só filtra por `status` da OS — não existe filtro por `payment_status` na tela de listagem (diferente do relatório de inadimplência, que tem filtro de status de pagamento próprio).

8. **Cada um dos três endpoints de pagamento reimplementa** "criar transação → atualizar saldo → criar statement → tratar erro com rollback manual" do zero, com pequenas diferenças (ex.: `pay.post.ts` sobrescreve `due_date` da transação com a data de pagamento; `process-payment.post.ts` não). Não há uma função compartilhada tipo `applyIncomeToBankAccount(...)`.
