# Proposta: redesenho do pagamento de OS para cenários de ERP

Este documento é a continuação de [payment-flow-current.md](payment-flow-current.md) (o "como é hoje"). Aqui é o "como deveria ser" e, a partir da seção 5, o **plano de implementação** — com as decisões de negócio já tomadas, duas recomendações técnicas onde foi pedido apoio, o impacto detalhado em comissões e relatórios, e os passos concretos por fase.

## 1. Cenários que o fluxo precisa cobrir

Organizei por prioridade. "Core" é o que motivou esta análise (entrada + parcelado, múltiplos pagamentos, diferentes tipos). "Importante" é o que normalmente aparece junto na prática de uma oficina. "Futuro" é real no setor, mas é escopo grande o suficiente pra tratar depois.

### Core

| # | Cenário | Hoje funciona? |
|---|---|---|
| C1 | **Entrada + restante parcelado** — ex.: R$300 de entrada agora, R$700 em 4x | ⚠️ Meio-funciona por acidente: a 1ª parcela nasce `paid`, mas o valor dela é `total ÷ N`, não um valor de entrada livre |
| C2 | **Múltiplos meios de pagamento na mesma cobrança** — entrada em Pix, parcelas no boleto; ou parte no cartão + parte em dinheiro | ❌ O formulário manda **uma** `paymentMethod`/`bankAccountId` pra todas as linhas (`PaymentModal.vue:278-292`), mesmo o backend aceitando método/conta por parcela |
| C3 | **Pagamento avulso, fora de um plano fixo** | ❌ Não existe. Só dá pra (a) registrar o plano inteiro de uma vez, ou (b) liquidar uma parcela **inteira** já existente |
| C4 | **Quitação parcial de uma parcela específica** | ❌ `pay.post.ts` só aceita `payment_date`, sempre liquida o valor cheio |

### Importante

| # | Cenário | Hoje funciona? |
|---|---|---|
| I1 | **Receber sinal antes da OS estar `completed`** | ❌ Bloqueado: `process-payment.post.ts:169` |
| I2 | **Atraso de parcela com juros/multa** | ❌ `overdue` nunca é gravado; não existe campo de juros/multa |
| I3 | **Renegociação** — juntar parcelas vencidas, mudar datas/valores ainda não pagos | ❌ Não existe edição de parcela depois de criada |
| I4 | **Corrigir um lançamento errado sem cancelar tudo** | ❌ Único "desfazer" hoje é `DELETE /payment`, cancela tudo |
| I5 | **Idempotência / evitar lançamento duplicado** | ❌ já mapeado no AS-IS (gap 4) |
| I6 | **Taxa de maquininha efetivamente calculada** | ❌ já mapeado no AS-IS (gap 2) |

### Futuro (fora do escopo desta rodada)

| # | Cenário |
|---|---|
| F1 | Múltiplos pagadores — ex.: seguradora paga o conserto, cliente paga a franquia |
| F2 | Cobrança via gateway (Pix dinâmico, link de pagamento) |

> Busquei no código por "entrada/sinal/convênio/seguradora/juros/multa/renegociação" antes de escrever isso — nenhum desses conceitos existe hoje em nenhuma tabela ou tela. É greenfield.

## 2. Por que o modelo atual não aguenta isso (causa raiz)

O modelo atual conflita três conceitos que precisam ser independentes:

1. **O plano** (quanto se espera receber, quando, em quantas partes).
2. **O recebimento** (um evento real de dinheiro entrando).
3. **O status** (decorre de comparar 1 e 2).

`process-payment.post.ts` faz os três de uma vez, na mesma chamada. Outro sintoma: cada parcela só guarda **uma** `financial_transaction_id` (1:1, migration 19). A tabela `financial_transactions` **já tem** uma coluna `service_order_installment_id` (migration 21, linha 41) pronta pra apontar várias transações pra uma parcela — só que **nenhum código grava essa coluna hoje**. É a peça que falta pra C4 e C3.

## 3. Modelo proposto

### 3.1 Separar Plano × Recebimento × Status

**Plano** (`service_order_installments`) ganha `kind: 'down_payment' | 'installment' | 'extra'` e passa a guardar o **valor esperado**, não necessariamente o pago. `status` deixa de ser setado direto — passa a ser **derivado e cacheado** (ver seção 6.2 sobre por que "cacheado" e não só calculado on-the-fly): `pending`/`partial`/`paid`/`overdue`, recalculado pela função central sempre que algo muda.

**Recebimento** (`financial_transactions`) passa a apontar pra "a" parcela que está liquidando via `service_order_installment_id` (coluna já existente, ociosa) em vez da parcela apontar pra "a" transação. Isso permite N recebimentos numa parcela (C4) e um recebimento sem parcela nenhuma associada (C3).

**Status da OS** (`payment_status`) passa a ser **uma função só**, chamada pelos três fluxos, substituindo a lógica reescrita 3 vezes hoje (`process-payment.post.ts:239-245`, `pay.post.ts:138-144`, `payment.delete.ts:115-126`).

### 3.2 Como isso resolve cada cenário

- **C1**: criar o plano aceita entrada livre (`kind='down_payment'`) + N parcelas pro restante.
- **C2**: cada linha do plano e cada recebimento real tem sua própria forma/conta/maquininha.
- **C3**: novo endpoint de "recebimento avulso" cria a transação e, automaticamente, uma linha `extra` no mesmo valor (decisão tomada, ver seção 5.3).
- **C4**: endpoint de pagar parcela aceita `amount` parcial; `status` recalcula pra `partial` se sobrar saldo.

## 4. Reuso de dados existentes

| Mudança | Tabela | Observação |
|---|---|---|
| Adicionar `kind` | `service_order_installments` | Default `'installment'` nas linhas já existentes |
| Passar a popular | `financial_transactions.service_order_installment_id` | Coluna já existe desde a migration 21, nunca usada — confirmei via grep em `server/` |
| Nenhuma tabela nova | — | O ganho vem de usar o que já existe, não de criar schema novo |

## 5. Decisões de negócio

### 5.1 Sinal antes de `completed` (I1) — recomendação

Você travou em `completed` justamente porque o total da OS pode mudar de escopo, e isso quebraria o cálculo de pagamento. Essa preocupação é correta — a solução padrão de mercado pra esse problema (usada em ERPs com adiantamento de cliente, ex.: SAP Business One, QuickBooks, e em qualquer sistema com nota fiscal de adiantamento) é **não comparar o sinal contra o total enquanto o total não está fechado**. Na prática, pra este app:

1. **O dinheiro do sinal entra no caixa imediatamente** (cria `financial_transactions`/`bank_account_statements`/atualiza saldo — isso não muda, é dinheiro real entrando).
2. **Mas o `payment_status` da OS continua não-aplicável enquanto a OS não chega em `completed`.** Antes disso, a tela mostra só "Adiantamento recebido: R$ X" (soma dos recebimentos `kind='down_payment'`), sem tentar dizer se está "parcial" ou "pago" de um total que ainda pode mudar.
3. **No momento em que a OS muda para `completed`** (total final travado — já é a regra hoje, escopo não muda mais depois disso), o sistema faz uma **reconciliação automática**: `saldo_devedor = total_amount_final − soma(recebimentos de down_payment)`. O modal de pagamento que você já tem passa a abrir mostrando esse saldo (não o total cheio), e o cliente parcela/paga o que falta a partir daí — sem mudar a UX que você já validou pra essa parte.
4. **Dois casos de borda que essa reconciliação precisa decidir explicitamente** (não dá pra ignorar):
   - **Saldo negativo** (escopo encolheu, sinal já cobre mais que o total final): gera um fluxo de **reembolso** explícito — uma transação de saída revertendo a diferença do saldo bancário, com confirmação do usuário (nunca silencioso).
   - **OS cancelada com sinal recebido**: hoje o cancelamento (`cancel.post.ts`) e o `DELETE /payment` não pensam em "tem dinheiro de cliente parado aqui". Recomendo bloquear o cancelamento até o usuário decidir devolver o sinal (gera a transação de reembolso) — nunca apagar o registro sem reverter o saldo, é o mesmo princípio do gap 3 do AS-IS.

Isso resolve sua preocupação original (escopo mudando) sem abrir mão de receber sinal antes do fim do serviço: o "perigo" do total mudar só importa no momento em que ele realmente é comparado contra o que foi recebido, e isso passa a acontecer **uma vez, no fechamento**, não a cada sinal recebido no meio do caminho.

### 5.2 Comissão proporcional ao valor recebido — decisão confirmada

> Resposta: o funcionário só recebe sobre o valor recebido. Ex.: OS de R$1000, comissão de R$200, recebido R$500 → liberado R$100.

Decisão tomada. Ver seção 6 (impacto detalhado) — é a mudança com mais superfície de código tocada nesta proposta, porque entra na tabela `employee_financial_records`, que é compartilhada com outras coisas do módulo financeiro (ex.: `record_type='adiantamento'` de funcionário, que não tem nada a ver com isso).

### 5.3 Pagamento avulso sempre cria linha extra — decisão confirmada

> Resposta: criar a linha extra.

Decisão tomada, já refletida na seção 3.2 (C3). Mantém plano e realizado sempre conciliáveis pra relatório.

### 5.4 Onde configurar juros/multa (I2) — recomendação

Recomendo **nível de organização**, como configuração financeira padrão da oficina — é o padrão de mercado pra isso (boleto, ERPs de cobrança): juros e multa não costumam variar por OS, variam por política comercial da empresa. Concretamente:

- **Onde**: este app já tem `app/pages/app/settings/company.vue` ("Dados da empresa"), construída em vários `UPageCard` dentro da mesma página (confirmei lendo o arquivo). Encaixa adicionar um novo card "Cobrança e atraso" nessa página, em vez de criar uma tela nova — é o padrão de configuração organizacional que já existe (mesmo espírito do `bank_accounts.preferred_payment_method`, que é um default por entidade).
- **O quê**: três campos novos em `organizations` —
  - `late_fee_percentage` (multa fixa sobre o valor da parcela em atraso — no Brasil, pra relação de consumo, a multa moratória é limitada a 2% pelo CDC; vale validar com o financeiro/jurídico de vocês antes de travar isso no produto, não estou afirmando isso como regra do sistema, só como ponto de atenção).
  - `daily_interest_percentage` (juros de mora por dia de atraso — ou `monthly_interest_percentage`, se preferirem configurar ao mês e o sistema dividir por 30).
  - `interest_grace_period_days` (carência: quantos dias após o vencimento antes de começar a contar atraso/juros).
- **Como usa**: no momento de calcular o saldo de uma parcela `overdue` (status que passa a ser sempre coerente a partir da Fase 0/6, ver seção 7), soma `expected_amount + multa + juros_por_dias_de_atraso` como "valor a cobrar hoje" — sem alterar o `expected_amount` original (preserva o valor combinado na OS pra auditoria).
- **Pendente de decisão de vocês**: se juros/multa cobrados geram comissão pro funcionário responsável ou não — recomendo que não (é penalidade financeira, não venda), mas é decisão de política comercial, não técnica.

## 6. Impacto detalhado nas comissões

### 6.1 Por que não basta editar o valor de uma linha existente

Os dois endpoints que pagam comissão hoje pagam **sempre o valor cheio da linha**:
- `server/api/financial/pay-commissions-bulk.post.ts:124` — `valor = normalizeNumber(registro?.amount)`, paga o `amount` inteiro, cria transação + extrato + atualiza saldo bancário.
- `server/api/reports/commissions/[id]/pay.post.ts` — marca `status='paid'`, mas **não cria transação nem toca no saldo bancário**. Essa é uma divergência que já existe hoje, independente desta proposta — uma comissão paga por esse segundo caminho nunca aparece no extrato da conta.

Se eu mantivesse **uma linha só** por (OS, funcionário) e fosse aumentando o `amount` dela conforme mais dinheiro entra, qualquer pagamento parcial via esses endpoints fecharia a linha (`status='paid'`) achando que pagou tudo — e não teria como "reabrir" pra liberar mais depois sem reescrever os dois endpoints de pagamento.

### 6.2 Modelo proposto: liberação incremental e aditiva

1. **Total da comissão** (`commission_total_amount`, por OS × funcionário): continua calculado como hoje (`generateServiceOrderCommissions`, baseado em itens/categorias/% do funcionário), na prática a partir do momento em que a OS chega em `completed` (depois disso os itens não mudam mais).
2. A cada recebimento confirmado **ou revertido** (sinal, parcela, avulso), recalcula `valor_recebido_total_da_os` e, por funcionário: `valor_liberado = round(commission_total_amount × valor_recebido_total_da_os / total_amount)`.
3. Compara `valor_liberado` com a soma do que já existe em `employee_financial_records` (`status` `pending`+`paid`, `record_type='commission'`) pra aquele par (OS, funcionário).
   - Se `valor_liberado` > soma existente → **cria uma linha nova**, `pending`, só com a diferença (delta). Nunca edita uma linha já criada.
   - Se `valor_liberado` < soma existente (recebimento foi revertido) → reduz/apaga a linha `pending` mais recente até a soma bater. Se a diferença já estava em uma linha `paid` (funcionário já recebeu), **não reverte automaticamente** — gera um aviso pra reconciliação manual (mesma postura do gap 3 do AS-IS, onde já existe esse mesmo tipo de risco).
4. Com isso, **nenhum dos dois endpoints de pagamento de comissão precisa mudar a lógica central** — cada linha já nasce do tamanho exato que pode ser pago de uma vez. Só preciso decidir se unifico os dois nessa rodada (ver 6.3).

### 6.3 Endpoints e telas afetados

| Onde | Hoje | Impacto |
|---|---|---|
| `server/utils/service-order-commissions.ts` | Apaga e recria todas as comissões da OS a cada chamada (gap 3 do AS-IS: não reverte saldo de comissão já paga) | Passa a ter duas funções: cálculo do total (quase igual ao de hoje) + liberação incremental (nova) — a liberação nunca apaga linha `paid` |
| `server/api/financial/pay-commissions-bulk.post.ts` | Paga o `amount` cheio da linha, move saldo bancário | Sem mudança de lógica — continua funcionando porque cada linha agora já nasce do tamanho liberado |
| `server/api/reports/commissions/[id]/pay.post.ts` | Só marca `status='paid'`, não move saldo | Recomendo unificar com o endpoint acima nesta rodada — caso contrário parte das comissões pagas nunca aparece no extrato bancário, e isso fica mais visível com mais linhas pequenas circulando |
| `app/components/service-orders/detail/OSCommissionsCard.vue` | Lista 1 linha por comissão | Continua funcionando sem mudança — só vai mostrar mais linhas pequenas por OS/funcionário ao longo do tempo (pode valer agrupar visualmente por funcionário, é UX, não bloqueador) |

### 6.4 Sistema paralelo de comissão descoberto (atenção, não é desta proposta)

Existe um **segundo cálculo de comissão**, item a item, gravado direto em `order.items[].commission_total`/`commissions[]` (`server/utils/service-order-item-commissions.ts`), populado quando a OS é salva (`server/api/service-orders/index.post.ts`) e por um endpoint avulso de backfill (`server/api/service-orders/seed-commissions.post.ts`). Esse valor é "o calculado", igual em espírito ao que `generateServiceOrderCommissions` recalcula — mas só o segundo é o que de fato entra no financeiro (`employee_financial_records`).

O relatório `server/api/reports/sales-items.get.ts` já cruza os dois (`commissionTotalsByOrderEmployee`, a partir de `employee_financial_records`, vs. o `commission_total` gravado no item) — ou seja, já existe uma noção parcial de "calculado vs. lançado" nesse relatório, parecida com o que estou propondo de "total vs. liberado". Recomendo, na implementação, confirmar com quem desenhou esse relatório se "lançado" deve passar a significar "liberado" (mais correto, mas pode parecer que ficou menor "errado" pra quem está acostumado com o número de hoje) — não tenho contexto da intenção original de manter os dois sistemas pra decidir isso sozinho.

## 7. Impacto nos relatórios

Levantei todo report que toca `payment_status`, `service_order_installments`, `employee_financial_records`/comissão, `is_installment` ou `commission_amount`:

| Relatório | O que usa hoje | Risco com o redesenho | O que fazer |
|---|---|---|---|
| `server/api/reports/debtors.get.ts` (Inadimplência) | `payment_status`, `service_order_installments.status/due_date/amount`; recalcula `overdue` por conta própria a partir de `due_date` | **Alto** — rotula parcela como "P{installment_number}" (não sabe de `kind`); trata `amount` da parcela como "ainda devido" por inteiro, sem suporte a quitação parcial | Rotular `down_payment` como "Entrada" e `extra` como "Avulso"; trocar "valor esperado" por "saldo restante" (esperado − recebido) por linha |
| `server/api/reports/commissions.get.ts`, `export-commissions.post.ts`, `server/utils/employee-commission-report.ts` | Somam `employee_financial_records.amount` agrupado por `status` | **Baixo** — soma continua correta com várias linhas pequenas em vez de uma grande | Nenhuma mudança estrutural; opcional: mostrar "comissão total da OS" ao lado do "liberado até agora" |
| `server/api/reports/commissions/[id].get.ts`, `[id].delete.ts`, `[id]/pay.post.ts` | CRUD de uma linha individual | **Médio** — `pay.post.ts` não move saldo bancário (ver 6.3) | Unificar com `pay-commissions-bulk.post.ts` nesta rodada |
| `server/api/reports/sales-items.get.ts`, `export-sales-items.post.ts` | Cruza `items[].commission_total` (calculado) com `employee_financial_records` (lançado) | **Médio** — "lançado" passa a ficar menor que hoje até liberar 100% (proposital, mais correto, mas é uma mudança visível) | Validar com o time se deve renomear "lançado" → "liberado" |
| `server/api/reports/costs-profit.get.ts` (Lucro) | `service_orders.total_amount` por OS `completed/invoiced/delivered`, filtrando por `payment_status`; despesas via `financial_transactions` | **Nenhum** — receita é por regime de competência (total da OS completa), não por valor recebido; `payment_status` continua com os mesmos três valores | Nenhuma mudança |
| `server/api/reports/dashboard-stats.get.ts` (Dashboard) | `service_orders.total_amount` filtrado por `status`, sem usar `payment_status` | **Nenhum** — confirmado, não toca em nenhum campo afetado | Nenhuma mudança |
| `server/api/reports/overview.get.ts` | Não usa nenhum campo de pagamento de OS (confirmei via grep) | **Nenhum** | Nenhuma mudança |
| `server/api/service-orders/index.get.ts` (listagem de OS) | `payment_status`, `is_installment`, `installments_progress` (linhas 156-158, 178) | **Baixo** — `installments_progress` (pago/total) ainda funciona, mas "total" passa a poder incluir `down_payment`/`extra` junto com `installment` | Revisar o rótulo na tela pra não confundir "parcelas financiadas" com "linhas do plano" |

**Não lidos linha a linha nesta rodada** (mencionados pra não esquecer, baixo risco aparente por serem CRUD simples ou specs já claras pelo nome): `server/api/reports/customers.get.ts`, `server/api/service-orders/commission-seed-status.get.ts`. Conferir rapidamente antes de fechar a Fase 3.

## 8. Plano de implementação

### Fase 0 — Fundamentos (pré-requisito de todo o resto)

> ✅ **Implementado nesta rodada.** `server/utils/service-order-payment-status.ts` (novo) + `process-payment.post.ts`, `pay.post.ts` e `payment.delete.ts` atualizados + migration `20240101000067_add_kind_to_service_order_installments.sql`. **Pendente**: aplicar a migration no banco — o projeto usa Supabase hospedado (sem `supabase/config.toml` de ambiente local), então preciso da sua confirmação antes de rodar algo contra ele. `kind` ainda não é aceito no contrato da API (isso é Fase 1); por enquanto toda parcela nova é criada como `'installment'`.

1. Criar função utilitária central de recálculo de `payment_status` da OS, substituindo a lógica hoje duplicada em `process-payment.post.ts:239-245`, `pay.post.ts:138-144` e `payment.delete.ts:115-126`.
2. Migration: adicionar `kind` em `service_order_installments` (`'down_payment' | 'installment' | 'extra'`), default `'installment'` nas linhas existentes.
3. **Parar de pré-criar `financial_transactions` "fantasma" para parcelas ainda não pagas.** Hoje `process-payment.post.ts:195-208` chama `createIncomeTransaction` pra **toda** parcela no momento em que o plano é criado, mesmo as que nascem `pending` — fica um registro com `status='pending'` esperando ser promovido depois por `pay.post.ts` (que edita essa mesma linha pra `status='paid'`, `pay.post.ts:58-73`). Isso só funciona porque hoje uma parcela só pode ser paga **uma vez, por inteiro**. Pra suportar C4 (pagar uma parcela em mais de uma vez) e C3 (recebimento sem parcela nenhuma), a transação financeira precisa parar de ser "o plano" e passar a representar só **dinheiro que de fato entrou**: criar uma transação somente no momento em que existe um recebimento real (na criação do plano, só pra entrada/parcela já paga ali mesmo; depois disso, uma transação nova por cada chamada de "pagar"/"pagar parcial"). Sem essa mudança, não tem onde encaixar um segundo pagamento parcial pra mesma parcela.
4. Passar a popular `financial_transactions.service_order_installment_id` (coluna já existente desde a migration 21, nunca usada) em paralelo ao atual `service_order_installments.financial_transaction_id` — com o passo 3, uma parcela passa a poder ter 0, 1 ou N transações linkadas por esse campo.
5. **Pronto quando**: os três endpoints de pagamento usam a mesma função de recálculo; uma parcela nova só gera transação quando algum valor é efetivamente recebido contra ela; e dá pra rastrear, pra cada parcela, todas as transações que já a abateram.

### Fase 1 — Entrada + parcelado, múltiplos meios de pagamento (C1, C2 — o pedido original)

> ✅ **Implementado nesta rodada.** `PaymentModal.vue` reescrito (entrada opcional + parcelamento do restante, forma de pagamento/conta/maquininha por linha). `process-payment.post.ts` agora valida `kind` por linha, valida a soma das linhas contra `total_amount`, e troca a trava de idempotência por "já existe parcela pra esta OS?" (mais robusta que checar só `payment_status`). **Mudança de escopo em relação ao texto original do item 4**: o branch separado de "pagamento à vista" (sem array de parcelas) foi removido do backend — como o modal novo sempre envia ao menos uma linha (mesmo pagamento único agora é "1 parcela"), manter os dois caminhos era duplicar a mesma lógica sem necessidade; só `PaymentModal.vue` chama esse endpoint, então não há contrato externo quebrado.

1. **(C1) `PaymentModal.vue` — entrada + parcelamento do restante**: trocar o campo único "número de parcelas" por dois blocos: **Entrada** (valor livre, opcional) + **Parcelamento do restante** (N parcelas sobre `total_amount − entrada`, reaproveitando a lógica de `distributeInstallments` de hoje, só que partindo do saldo em vez do total cheio).
2. **(C2) `PaymentModal.vue` — forma de pagamento/conta por linha**: cada linha (a entrada e cada parcela) ganha seus próprios campos de forma de pagamento, conta bancária e maquininha. Hoje só existe um conjunto desses campos pra todo o formulário, e ele é aplicado a **todas** as linhas na hora de montar o body (`PaymentModal.vue:278-292`: `payment_method: form.paymentMethod`, `bank_account_id: form.bankAccountId` repetidos pra cada item do array). Os campos do topo do formulário passam a ser só o **default sugerido** pra uma linha nova, não um valor fixo pra todas.
3. **(C2) Conferir que o backend já aceita isso**: `process-payment.post.ts` **já lê** `bank_account_id`/`payment_method`/`payment_terminal_id` por parcela, com fallback pro valor global só se a linha não informar o seu (linhas 190-191: `inst.bank_account_id || bankAccountId`, `inst.payment_terminal_id || paymentTerminalId`; linha 201: `inst.payment_method || paymentMethod`). **Não precisa mudar contrato de API nem schema pra isso** — o trabalho é só no frontend parar de sobrescrever esses campos com o valor global antes de montar o body.
4. **(C1+C2) `process-payment.post.ts`**: aceitar `kind` por linha (`down_payment` na entrada, `installment` nas demais); validar no backend que a soma de todas as linhas bate com `total_amount` (fecha gap 5 do AS-IS, hoje só validado no frontend em `PaymentModal.vue:271-273`); adicionar guarda de idempotência (fecha gap 4 do AS-IS).
5. **Pronto quando**: dá pra registrar, numa única tela, R$300 de entrada via Pix em uma conta, mais 4x R$175 via boleto em outra conta, na mesma OS — sem editar manualmente o body da requisição nem usar workaround nenhum.

### Fase 2 — Sinal antes de `completed` e reconciliação no fechamento (D1, I1)

> ✅ **Implementado nesta rodada.** Endpoint novo `down-payment.post.ts` (recebe o sinal, sem tocar `payment_status`). `process-payment.post.ts` reconcilia: busca `down_payment`s existentes, calcula `balanceDue = total_amount − soma(down_payment)`, e só então valida/processa o restante. `server/utils/financial-income.ts` (novo) extrai "criar transação de entrada + atualizar saldo + extrato com rollback" — já era duplicado em 2 lugares (`process-payment` e `pay.post.ts`), e o endpoint de sinal é o 3º consumidor. `PaymentModal.vue` busca o detalhe da OS ao abrir pra saber quanto já foi recebido como sinal, mostra "Adiantamento já recebido"/"Saldo a receber", e trata os dois casos de borda (saldo já coberto → confirma sem cobrar nada; saldo negativo → bloqueia e orienta cancelar o pagamento). Botão "Receber sinal" adicionado em `OrderCard.vue` e `OSHeader.vue` (detalhe), com novo `DownPaymentModal.vue`. `OSInstallmentsCard.vue` agora rotula cada linha (Entrada/Parcela N/Avulso) e mostra o total de adiantamento.
>
> **Itens 4 e 5 não precisaram de código novo, só verificação**: (4) em vez de um endpoint de reembolso parcial novo, o saldo negativo orienta o usuário a usar o `DELETE /payment` que já existe — ele já reverte o saldo bancário corretamente (lê o `previous_balance` do extrato), então cancelar e relançar o valor certo resolve sem inventar uma 3ª forma de mover dinheiro. (5) o bloqueio de cancelamento **já existia**: `cancel.post.ts:58-70` já rejeita cancelar uma OS com qualquer `service_order_installments` registrada — e um sinal é exatamente isso, então o bloqueio passou a valer automaticamente assim que o endpoint de sinal começou a criar essas linhas.
>
> **Pendente**: migration da Fase 0 (`kind`) ainda não foi aplicada no banco — sem ela, o endpoint de sinal e o `process-payment` (que agora também grava `kind`) não funcionam contra o Supabase hospedado.

1. Liberar criação de recebimento `kind='down_payment'` para OS em `open`/`in_progress`/`waiting_for_part` (não `estimate`, não `cancelled`).
2. Tela da OS (antes de `completed`) passa a mostrar "Adiantamento recebido: R$ X" — sem tentar classificar como parcial/pago de um total que ainda pode mudar.
3. Reconciliação automática no momento em que a OS muda pra `completed`: calcular `saldo_devedor = total_amount_final − soma(down_payment)`; o modal de pagamento abre mostrando esse saldo, não o total cheio.
4. Fluxo de reembolso explícito para saldo negativo (escopo encolheu) — transação de saída + confirmação do usuário, nunca automático/silencioso.
5. Bloquear cancelamento de OS com sinal recebido até decidir o reembolso (afeta `cancel.post.ts`).
6. **Pronto quando**: um sinal recebido em "Em andamento" é corretamente abatido do valor a pagar quando a OS completa, incluindo o caso em que o valor final ficou menor que o sinal.

### Fase 3 — Comissão proporcional ao recebido (D2)

> ✅ **Implementado nesta rodada.** `service-order-commissions.ts` foi reescrito: `generateServiceOrderCommissions` (apagava e recriava tudo) virou `releaseServiceOrderCommissions` (nunca edita/apaga linha existente — só soma `service_order_installments` pagas, calcula o valor liberado por funcionário, e cria uma linha nova `pending` só com a diferença). Chamada agora em dois pontos: `process-payment.post.ts` (já chamava) e `pay.post.ts` (novo — pagar uma parcela aumenta o recebido, então também libera comissão). `down-payment.post.ts` continua sem chamar, de propósito — antes de `completed` não existe direito à comissão ainda, só depois. `generate-commissions.post.ts` (endpoint de regeneração manual, sem uso no frontend hoje) atualizado pro nome novo.
>
> **Bug pré-existente encontrado e corrigido durante a unificação (item 2)**: `pay-commissions-bulk.post.ts` gravava `status: 'pago'` ao marcar uma comissão como paga — mas a constraint do banco (`employee_financial_records_status_check`, migration 20) só permite `'paid'`/`'pending'`. Esse `update` falhava silenciosamente (o código não checava o erro), então a comissão continuava `pending` no banco mesmo depois de mover o dinheiro e reportar sucesso — abrindo risco de pagar a mesma comissão duas vezes. Corrigido pra `'paid'` e adicionei checagem de erro nessa chamada específica. `commissions/[id]/pay.post.ts` (usado pela tela de relatório de comissões) foi reescrito pra criar a mesma transação/extrato/saldo que o endpoint em lote já faz — antes só marcava `status='paid'` sem mexer no banco.
>
> **Item 3 não decidido** (como já estava marcado no plano) — fica como pergunta aberta pro time, não decidi sozinho se `sales-items.get.ts` deve passar a tratar "lançado" como "liberado".
>
> **Item 4 verificado**: `commission-seed-status.get.ts` é sobre o outro sistema de comissão (item-level, gravado em `order.items[]`), não toca `employee_financial_records` — confirmado sem impacto.
>
> **Adicionado depois, a partir de uma pergunta sobre a relação comissão↔pagamento**: (1) `releaseServiceOrderCommissions` agora grava `service_order_installment_id` (coluna que já existia, nunca usada) na linha de comissão criada, quando dá pra saber exatamente qual parcela/sinal disparou aquela liberação — sempre em `pay.post.ts`; em `process-payment.post.ts` só quando exatamente uma linha do lote nasceu paga, senão fica `null` (ambíguo). (2) Achei e corrigi um bug real em `payment.delete.ts`: ele revertia o saldo bancário e apagava o registro de **qualquer** comissão da OS ao cancelar o pagamento, inclusive as já pagas ao funcionário — como se o dinheiro nunca tivesse saído da conta, mesmo o funcionário já tendo recebido de verdade. Agora bloqueia o cancelamento (409) se existir comissão `status='paid'` na OS, até alguém resolver manualmente — mesmo espírito do bloqueio que já existia pra sinal recebido. Confirmei que o mesmo padrão em `cancel.post.ts` é código morto inofensivo (os guards anteriores daquele endpoint já garantem que nunca há comissão paga nesse ponto).

1. `server/utils/service-order-commissions.ts`: separar cálculo do total (quase igual ao de hoje) de uma nova função de liberação incremental (ver seção 6.2) — chamada a cada recebimento confirmado ou revertido.
2. Unificar `server/api/reports/commissions/[id]/pay.post.ts` com a lógica de `server/api/financial/pay-commissions-bulk.post.ts` (criar transação + extrato + mover saldo bancário) — hoje só o segundo faz isso.
3. Validar com o time o tratamento de `sales-items.get.ts` (seção 6.4 e 7) — decidir se "lançado" passa a significar "liberado".
4. Checar rapidamente `commission-seed-status.get.ts` antes de fechar a fase (não lido nesta rodada).
5. **Pronto quando**: OS de R$1000 com comissão de R$200, recebendo R$500, libera exatamente R$100 — e nenhum dos dois endpoints de pagamento de comissão deixa pagar mais que isso.

### Fase 4 — Pagamento avulso e quitação parcial de parcela (C3, C4)

> ✅ **Implementado nesta rodada.** Migration nova (`20240101000068`) adiciona `'partial'` aos status válidos de `service_order_installments` (só tinha `pending`/`paid`/`overdue`). `recalculateServiceOrderPaymentStatus` corrigido pra contar parcela `partial` como contribuindo pro `payment_status='partial'` da OS — antes só olhava `status==='paid'`, então uma OS com uma única parcela parcialmente paga ficaria incorretamente como `pending`. `pay.post.ts` aceita `amount` opcional: se for novo-estilo (sem transação legada) soma o que já foi recebido daquela parcela via `financial_transactions.service_order_installment_id`, valida contra o saldo restante, e cria uma transação nova só com o valor informado — nunca edita uma anterior. Parcela legada (já tem transação pendente pré-criada antes da Fase 0) continua só-liquidação-total, por simplicidade. Novo endpoint `receive-extra-payment.post.ts` (C3) cria linha `kind='extra'` já paga.
>
> **Desvio do texto original do item 5 (C3)**: mantive a trava em `status='completed'` em vez de relaxar pra `open`/`in_progress`/`waiting_for_part` como sinal. Motivo descoberto ao implementar: a reconciliação da Fase 2 em `process-payment.post.ts` bloqueia ("já existe plano") se encontrar qualquer parcela que não seja `kind='down_payment'` antes da OS completar — se `extra` pudesse nascer pré-completion, ela seria lida como "plano já existe" e travaria a reconciliação por engano. Pré-completion já tem o sinal pra "receber algo sem plano definido"; avulso é especificamente o equivalente pós-completion.
>
> **Achados extras durante a implementação, não estavam explícitos no plano**: (1) `[id].get.ts` agora calcula e expõe `received_amount`/`remaining_amount` por parcela (soma de `financial_transactions` pagas linkadas) — necessário pra UI pré-preencher o valor certo ao receber o restante de uma parcela parcial, em vez de sugerir o valor original cheio. (2) `debtors.get.ts` tinha uma extração frágil de número da OS via `string.split(' P')` — quebraria pra parcelas `kind='down_payment'`/`extra` que agora rotulo como "Entrada"/"Avulso" em vez de "P{n}". Troquei por um campo `orderNumber` explícito carregado direto do pedido, sem parsing de string.
>
> **UI**: botão "Receber avulso" só no header do detalhe (`OSHeader.vue`), não duplicado na lista (`OrderCard.vue`) como fiz com "Receber sinal" na Fase 2 — é uma ação mais ocasional/deliberada, e o card da lista já está denso; ficou só onde já existem outras ações menos frequentes (cancelar pagamento, etc.).

**Pré-requisito**: Fase 0 passo 3 (parar de pré-criar transação `pending`) — sem isso não tem onde encaixar um segundo recebimento pra mesma parcela, nem um recebimento sem parcela nenhuma.

**C3 — Pagamento avulso**
1. UI: novo botão "Receber valor avulso" na tela de detalhe da OS, fora do modal de plano de pagamento — pede valor, data, forma de pagamento, conta e maquininha (opcional).
2. Novo endpoint (ex.: `POST /api/service-orders/:id/receive-extra-payment`): cria a transação de entrada. Vale extrair a lógica de "criar transação + atualizar saldo da conta + criar extrato com rollback em caso de erro" pra um utilitário compartilhado — hoje ela é uma função interna (`createIncomeTransaction`) só de dentro de `process-payment.post.ts`, e a partir desta fase pelo menos três endpoints (registrar pagamento, pagar parcela, receber avulso) precisam dela.
3. Cria automaticamente uma linha em `service_order_installments` com `kind='extra'`, `status='paid'`, `amount` = valor recebido, `due_date`/`payment_date` = data informada — decisão já tomada na seção 5.3, nunca fica "solto" sem linha de plano.
4. Chama a função central de recálculo de `payment_status` (Fase 0) e a de liberação de comissão (Fase 3) — um avulso libera comissão proporcional igual a qualquer outro recebimento.
5. Decidir a trava de status: se a Fase 2 (sinal antes de `completed`) ainda não estiver pronta, manter exigindo `status='completed'` pra usar este endpoint também; depois da Fase 2, relaxar pra incluir `open`/`in_progress`/`waiting_for_part`, do mesmo jeito que o sinal.

**C4 — Quitação parcial de uma parcela específica**
1. `pay.post.ts`: aceitar `amount` opcional no body (hoje só aceita `payment_date`, sempre liquida o valor cheio). Se vier e for menor que o saldo restante da parcela (`expected_amount − soma já recebida nela`), cria uma transação **nova** só com esse valor — nunca edita uma transação anterior — linkada à parcela via `service_order_installment_id` (Fase 0).
2. `service_order_installments.status`, recalculado pela função central (Fase 0), passa a virar `partial` em vez de `paid` quando ainda sobra saldo — a parcela continua com o botão "Pagar" disponível pro restante.
3. `OSInstallmentsCard.vue`: o botão "Pagar" abre um campo de valor pré-preenchido com o saldo total da parcela, mas editável pra um valor menor.
4. Atualizar `debtors.get.ts` pra refletir saldo restante por linha (esperado − já recebido) em vez de tratar o valor da parcela como integralmente devido (seção 7).
5. **Pronto quando**: dá pra registrar um recebimento de R$150 sem ele bater com nenhuma parcela prevista (C3); e dá pra quitar R$80 de uma parcela de R$200 hoje e os R$120 restantes depois, em outra data, com outra forma de pagamento se for o caso (C4).

### Fase 5 — Renegociação e cancelamento de recebimento isolado (I3, I4)

> ✅ **Implementado nesta rodada.** Dois endpoints novos sob `installments/[installmentId]`: `.patch.ts` (edita `due_date`/`amount` — só se `status==='pending'`) e `.delete.ts` (remove a linha — mesmo guard). Novo endpoint `financial-transactions/[transactionId].delete.ts` reverte **um** recebimento específico (lê o `previous_balance` do extrato pra estornar o saldo certo), recalcula o status da parcela a partir do que sobrou ligado a ela (`paid`→`partial`→`pending`, dependendo de quanto ainda está vinculado via `service_order_installment_id`), recalcula `payment_status` da OS e roda `releaseServiceOrderCommissions` de novo (a liberação cai naturalmente; se já tinha sido pago ao funcionário mais do que o novo valor liberado justifica, vira aviso, não reversão automática — mesma política da Fase 3).
>
> **Decisão de escopo (não estava explícita no plano)**: "juntar parcelas" (do critério de pronto) precisa de duas operações, não uma — editar o valor de uma linha pra absorver a outra, e *remover* a linha que sobrou. O item 1 do plano só falava em editar; adicionei o endpoint de remoção (mesmo guard de `pending`) porque sem ele não tem como literalmente juntar duas linhas em uma.
>
> **Mesma política de bloqueio da Fase 3, replicada aqui**: cancelar um recebimento específico usa a mesma trava de `payment.delete.ts` — se existir qualquer comissão `status='paid'` nesta OS, bloqueia (409) em vez de arriscar reverter dinheiro que já saiu pra um funcionário. É uma checagem geral (existe alguma comissão paga na OS?), não uma simulação precisa de quanto *esse* recebimento específico contribuiu — mesmo nível de rigor que já existia.
>
> **`[id].get.ts`** passou a expor `receipts` por parcela (lista de recebimentos individuais, não só a soma) — necessário pra UI oferecer "desfazer" um recebimento específico em vez de só o agregado. **UI** (`OSInstallmentsCard.vue`): parcelas `pending` ganharam ícones de editar/remover; parcelas com recebimentos ganharam uma lista expansível com "desfazer" por linha. Por consistência, troquei o emit do componente de `paid` pra `changed` (cobre pagar/editar/remover/desfazer) e corrigi uma lacuna que encontrei nesse mesmo ponto: o card de parcelas nunca emitia `updated` pro componente pai recarregar a lista — todos os outros (pagamento, sinal, avulso, cancelamento) já faziam isso, só esse não.

### Fase 6 — Juros e multa configuráveis (D4, I2)

1. Migration: novas colunas em `organizations` (`late_fee_percentage`, `daily_interest_percentage` ou `monthly_interest_percentage`, `interest_grace_period_days`).
2. Novo card "Cobrança e atraso" em `app/pages/app/settings/company.vue`.
3. Aplicar no cálculo de "valor a cobrar hoje" de uma parcela `overdue` (sem alterar o `expected_amount` original).
4. Decidir com o time se isso gera comissão (recomendação: não, ver seção 5.4).
5. **Pronto quando**: uma parcela vencida mostra o valor atualizado com multa/juros conforme a configuração da organização, e o valor combinado original continua auditável.

### Depois desta rodada

Taxa de maquininha efetivamente calculada (gap 2 do AS-IS), múltiplos pagadores/convênio (F1), gateway de cobrança (F2) — dependem de decisões de produto que ainda não foram tomadas, ou são escopo independente o suficiente pra não travar as fases acima.
