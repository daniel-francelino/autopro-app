# Núcleo financeiro: análise de risco e cenários de teste

> Escopo: **ordem de serviço → pagamentos → comissões → relatórios**.
> Motivação: clientes relatam que *os relatórios não batem* e que *falta valor de comissão*.
> Criado em 2026-11-09. Os cenários marcados ✅ já existem como teste automatizado; os marcados 🐞 são **bugs reais encontrados** por esses testes (registrados em [known-failures.md](known-failures.md), KF-24 a KF-42; KF-43 é caracterização); os marcados ⏳ dependem de Postgres real (projeto `api`).

## 1. Como o dinheiro anda (mapa)

```text
OS (service_orders)                       total_amount, items[], discount, responsible_employees[]
 ├─ sinal  .................. POST down-payment            → installment(kind=down_payment) + financial_transaction(income) + extrato + saldo
 ├─ plano  .................. POST process-payment         → installments[] (+ transação/extrato/saldo só das linhas "pagas")
 ├─ parcela ................. POST installments/:id/pay    → transação(income) + extrato + saldo (inteira ou em partes)
 ├─ avulso .................. POST receive-extra-payment   → installment(kind=extra, paga) + transação + extrato + saldo
 ├─ desfazer ................ DELETE payment | cancel | installments/:id | financial-transactions/:id
 ├─ editar .................. POST service-orders (orderId)  ← grava total/itens/status; NÃO passa pelo fluxo de pagamento
 └─ comissões manuais ....... POST service-orders/:id/generate-commissions  (recalcula/gera registros sem passar por pagamento)

Fora da OS (também mexem em saldo/extrato e em relatórios):
 ├─ despesa/receita avulsa .. POST financial/:id/pay · POST financial/pay-entries-bulk   → transação + extrato + saldo
 ├─ compra .................. POST purchases/:id/pay                                    → só payment_status='paid' (NÃO cria lançamento, extrato nem mexe no saldo — KF-43)
 └─ pagar comissão .......... POST reports/commissions/:id/pay · POST financial/pay-commissions-bulk
                              → registro vira 'paid' + despesa "Salários" + extrato + saldo   ← entra no overview, NÃO no profit-by-order
                                (saldo = saldo − valor, sem arredondar: KF-41)

payment_status (OS)  = recalculateServiceOrderPaymentStatus  ← deriva só das LINHAS de parcela (não dos valores)
comissão (employee_financial_records, record_type=commission)
   direito total  = engine(regras do plano × itens, desconto rateado)
   liberado       = direito × (soma das parcelas status='paid' ÷ total_amount)   ← releaseServiceOrderCommissions
   só é recalculado quando entra/sai dinheiro (pay, process-payment, extra, estorno)
relatórios        = leituras independentes (cada uma refaz sua conta a partir das tabelas)
```

### Duas verdades que precisam bater
1. **Caixa**: `financial_transactions` (income pagas) = `bank_account_statements` = variação de `bank_accounts.current_balance`.
2. **Competência**: `service_orders.total_amount` (OS concluídas por `entry_date`) = soma das parcelas do plano + sinal + avulsos (quando quitada).

Cada relatório usa **uma** dessas verdades. A reclamação "não bate" quase sempre é: (a) comparar um relatório de caixa com um de competência, ou (b) uma das duas verdades ficou inconsistente por um dos bugs abaixo.

## 2. Hipóteses de causa para as reclamações (ordenadas por probabilidade)

| # | Sintoma do cliente | Causa encontrada | Evidência |
|---|---|---|---|
| H1 | "Comissão não apareceu / está menor" depois de receber **parte** de uma parcela | `releaseServiceOrderCommissions` soma só parcelas `paid`; o valor já recebido numa parcela `partial` não conta | 🐞 KF-24 (`commissions-release`, `service-order-payments`) |
| H2 | "Comissão ficou errada depois que editei a OS" | Editar a OS recalcula só o *snapshot* (`commission_amount` e itens); os registros de comissão já liberados não são reconciliados até o próximo pagamento | 🐞 KF-38 (`service-order-edit`) |
| H3 | "Comissão continua para quem saiu da OS" | Quem deixou de ser responsável (ou ficou sem regra) mantém o pendente antigo no fluxo automático | 🐞 KF-25, KF-26 |
| H4 | "Zerou a comissão de várias OS" (incidente real de 10/09/2026, R$ 7.130,99) | Recálculo manual de quem não tem mais regra aplicável apaga os pendentes sem confirmação | 🐞 KF-36 + `docs/finance/auditoria-arredondamento-comissoes-2026-09-10.md` |
| H5 | "A OS está paga mas faltou receber" / "sumiu dos devedores" | `payment_status` é derivado das *linhas*, não dos *valores*: avulso menor que o total deixa a OS `paid`; aumentar o total de OS quitada mantém `paid`; `payment_status` do corpo é aceito na edição | 🐞 KF-31, KF-39, KF-37 |
| H6 | "Relatório de comissões não bate com o do funcionário / com o financeiro" | Comissão de OS excluída some do relatório mas continua no cadastro; gráfico por funcionário conta *cancelada* como pendente | 🐞 KF-32, KF-33 |
| H7 | "Devedores mostra mais do que o cliente deve" | OS ainda sem plano com sinal pago aparece pelo total, sem descontar o sinal | 🐞 KF-34 |
| H8 | "Saldo da conta diferente do extrato" | Estorno regravava `previous_balance` (corrigido) e saldo somado em ponto flutuante sem arredondar | ✅ KF-02/19 corrigidos · 🐞 KF-30 |
| H9 | "Lucro pelas OS ≠ visão geral" | Sem filtro de status, "Lucro pelas OS" soma orçamento, cancelada e em andamento; a visão geral só conta concluídas | ✅ caracterizado (`reports-consistency` R3 × KF-35) |
| H10 | "Pagamento duplicado / valor a mais" | Avulso sem limite de saldo; plano aceita linha negativa; recebimento avulso antes do plano bloqueia o plano | 🐞 KF-27, KF-28, KF-29 |
| H11 | Centavos de diferença na comissão | Arredondamento por item (≤ 1 centavo por item) — baixo risco, caracterizado | ✅ C35 |
| H12 | "Alguém mexeu no dinheiro e não sei quem" / valores alterados por usuário sem papel financeiro | Rotas de escrita sem `requireOrgPermission` (123 → 109) e handlers com service role que não filtram `organization_id` | 🐞 KF-09, KF-22 · ✅ S2 prova que as 10 rotas de dinheiro respondem 200 sem permissão |
| H13 | "O lucro do mês não fecha com o relatório por OS" | Comissão paga vira despesa "Salários" (entra no `overview`/`costs-profit`) e também é descontada como `commission_amount` no `profit-by-order`; somar os dois conta a comissão duas vezes | ✅ C41: cada relatório conta a comissão uma vez (sem dupla contagem hoje) |
| H14 | "Lucro da OS está errado" mesmo com receita certa | Custo (`total_cost_amount`: peças/estoque/compras) alimenta lucro e comissão por lucro (C20); nenhum cenário confere a origem desse custo | ✅ R34 |
| H15 | "Saldo da conta não bate" em contas com compras/despesas | Pagamento de compra **não move saldo** (KF-43); excluir lançamento pago não devolve saldo (KF-42); lote soma em ponto flutuante (KF-41); cancelar OS apaga comissão paga (KF-40) | 🐞 KF-40 a KF-42 · ✅ P45–P48 |

## 3. Regimes dos relatórios (o que cada um deve somar)

| Relatório | Regime | Receita | Custos | Observação |
|---|---|---|---|---|
| `overview` | Competência | OS concluídas/faturadas/entregues por `entry_date` | despesas **pagas** por `due_date` | despesas já incluem a comissão paga (categoria Salários) |
| `dashboard-stats` | Competência | idem, mês corrente | — | deve coincidir com `overview` no mesmo mês (✅ R2) |
| `profit-by-order` | Competência | `total_amount` por `entry_date` (todos os status se não filtrar) | `total_cost_amount` + `commission_amount` (direito total) | **não** soma a comissão paga do financeiro |
| `profit-cash-flow` | Caixa | income por `due_date` (filtro pago/pendente) | expense por `due_date` | inclui sinal de OS ainda aberta |
| `costs-profit` | Misto | OS por `entry_date` + despesas por `due_date` | despesas | cuidado ao somar com comissão |
| `debtors` | Posição em aberto | parcelas `pending/partial/overdue` − recebido; OS sem plano pelo total | — | ver KF-34 |
| `commissions` | Por data da OS | registros `commission` (+ bônus por `reference_date`) | — | soma por status; bônus fora do total |

Invariantes que **nunca** podem quebrar (todas cobertas em teste):
- I1 `Σ extrato == Δ saldo == Σ transações income pagas` (✅ `expectMoneyConsistent`).
- I2 Comissão liberada ≤ direito da OS (✅ C4/C15) e nunca negativa (✅ C21).
- I3 Comissão **paga** nunca é apagada (✅ C15/C16/C28).
- I4 OS excluída/cancelada/orçamento nunca entra em faturamento nem devedores (✅ R1/R5/R14).
- I5 Nada de outra organização entra em relatório (✅ R20, C18).
- I6 Total do gráfico diário = total do período (✅ R11).
- I7 Visão por OS e visão por cliente dos devedores somam o mesmo (✅ R17).
- I8 Toda escrita financeira exige login, papel com permissão e `organization_id` da sessão (nunca do corpo) (✅ S1–S4, S6; violada por KF-09: ver S2).
- I9 Comissão paga entra **uma vez** no resultado: ou como despesa "Salários" (regime de caixa), ou como `commission_amount` (regime de competência), nunca nos dois somados (✅ C41).
- I10 I1 vale também para despesas e compras: `Σ extrato == Δ saldo == Σ transações (income − expense) pagas` (✅ P46–P48; KF-41/KF-42 abertos).

## 4. Catálogo de cenários

Legenda: ✅ implementado · 🐞 falha conhecida (`it.fails`) · ⏳ precisa de banco real · ➕ a criar

### 4.1 Ordem de serviço (`service-order-edit.test.ts`)
| ID | Cenário | Status |
|---|---|---|
| E1 | edição parcial mantém campos não enviados | ✅ |
| E2 | número duplicado sugere o próximo (RPC) | ⏳ |
| E3 | OS de outra organização → 404 | ✅ |
| E4 | sem `orderData` → 400 | ✅ |
| E5/E6 | snapshot de comissão com/sem responsáveis | ✅ |
| E7 | `organization_id` do corpo ignorado | ✅ |
| E8 | criar OS | ✅ |
| E10 | desconto recalcula snapshot mantendo override | ✅ |
| E13/E14 | excluir parcela paga estorna saldo/status/comissão; outra org → 404 | ✅ |
| KF-37 | `payment_status` do corpo é ignorado | 🐞 |
| KF-38 | editar valor depois de receber reconcilia comissão | 🐞 |
| KF-39 | aumentar total de OS quitada volta para parcial | 🐞 |
| E15 | transição de status inválida (ex.: `cancelled` → `completed` sem estorno) | ➕ |
| E16 | `PATCH installments/:id`: só parcela pendente; parcial/paga travada (409); valor inválido (400); outra org (404); não mexe em saldo | ✅ |
| E17 | concorrência: duas edições simultâneas (último vence?) | ⏳ |
| E18 | cancelar OS: sem pagamento recolhe comissões pendentes e zera o snapshot; com pagamento/parcela/recebimento → 409 (é preciso desfazer o pagamento antes); idempotente; outra org → 404 | ✅ |
| KF-40 | cancelar OS não apaga nem estorna comissão já paga | 🐞 |
| E19 | `generate-commissions` manual não duplica registros | ✅ |
| E20 | editar OS sem permissão de OS → 403 (ver bloco S) | ➕ (`service-orders/index.post.ts` está no baseline do KF-09) |
| E21 | editar itens/custo da OS recalcula `total_cost_amount` e o lucro do relatório | ➕ (liga com R34) |

### 4.2 Pagamentos (`service-order-payments.test.ts`, `money-flows.test.ts`, `flows/undo-payment.test.ts`)
| ID | Cenário | Status |
|---|---|---|
| P1–P8 | sinal: saldo/extrato, status intocado, validações, org, numeração, reconciliação na conclusão | ✅ |
| P9–P16 | plano: à vista, parcelado, tudo pendente, comissão integral, tolerância de 1 centavo, centavos, kind inválido, OS cancelada | ✅ |
| P17–P21 | pagar parcela inteira/todas/já paga/outra OS/outra org | ✅ |
| P22–P25 | recebimento parcial em 3 partes, acima do saldo, inválidos, totalmente recebida | ✅ |
| P26 | recebimento parcial gera comissão proporcional | 🐞 KF-24 |
| P27/P28 | parcela com lançamento prévio: parcial recusado / integral movimenta saldo | ✅ |
| P29–P31 | avulso: cria `extra`, validações, outra org | ✅ |
| KF-27 | avulso acima do saldo é recusado | 🐞 |
| KF-28 | avulso antes do plano não bloqueia o plano | 🐞 |
| KF-29 | linha negativa/zero no plano é recusada | 🐞 |
| KF-30 | 10 × R$ 0,10 = R$ 1,00 no saldo | 🐞 |
| KF-31 | avulso < total deixa OS parcial | 🐞 |
| P35–P40 | desfazer: saldo/parcelas/comissão/status; comissão paga bloqueia; parciais; outra org; ciclo pagar-desfazer-pagar | ✅ |
| F19 | 3 parcelas na mesma conta, desfazer devolve o saldo | ✅ (KF-19 corrigido) |
| P41 | `commission_release_mode='full'` permanece após desfazer o pagamento | ✅ caracterizado (o código chama de "one-way switch"; decisão de produto) |
| P42 | pagar com maquininha: taxa (`terminal_fee_amount`) afeta saldo/relatório | ➕ |
| P43 | duas requisições idênticas simultâneas (duplo clique) criam 2 recebimentos | ⏳ (precisa de chave de idempotência) |
| P44 | estorno de recebimento com movimento posterior na conta | ✅ (KF-02 corrigido) |
| P45 | `purchases/:id/pay`: só muda o status; pagar duas vezes → 400; outra org → 404 | ✅ caracterizado — KF-43 (**decisão de produto**: a compra paga deveria mover saldo?) |
| P46 | `financial/:id/pay` (regressão KF-18): movimenta saldo/extrato; já pago → 400; outra org → 404; sem conta; extrato prévio não duplica | ✅ |
| P47 | `financial/pay-entries-bulk`: lote misto fecha I10; item pago/inexistente/de outra org não derruba o lote (resultado por item, **não** é atômico); ids repetidos; limite de 200 | ✅ |
| KF-41 | 10 × R$ 0,10 em lote somam R$ 1,00 no saldo | 🐞 |
| P48 | excluir despesa paga devolve saldo e extrato (I10) | 🐞 KF-42 (excluir pendente e exigir motivo: ✅) |
| P49 | transferência entre contas / conciliação bancária mantém a soma dos saldos | ➕ (verificar se o recurso existe antes de escrever) |

### 4.3 Comissões (`commissions-release.test.ts`, `employee-commission-engine.test.ts`, `bonuses.test.ts`)
| ID | Cenário | Status |
|---|---|---|
| C1–C6 | liberação proporcional, 0/50/100/>100%, modo integral, total 0 | ✅ |
| C7–C12 | complemento, idempotência, 3 parcelas fecham o total, centavos, vários responsáveis, sem regra/excluído | ✅ |
| C13–C18 | estorno remove pendente, parcial, pago intocado, outra org | ✅ |
| C19–C26 | desconto, base lucro, custo>venda, sem itens, categoria, valor fixo, snapshot, data de referência | ✅ |
| C27–C34 | recálculo manual: motivo, pago bloqueia, consolida, isolamento, override (válido/inválido/persistente/remover) | ✅ |
| C35 | arredondamento por item ≤ 1 centavo/item | ✅ |
| KF-24 | parcela parcial libera comissão proporcional | 🐞 |
| KF-25 | quem saiu da lista de responsáveis perde o pendente | 🐞 |
| KF-26 | regra que passou a render 0 recolhe o pendente | 🐞 |
| KF-36 | recálculo manual sem regra não apaga em silêncio | 🐞 |
| C37 | `pay-commissions-bulk` / `reports/commissions/:id/pay` movimentam saldo e geram despesa "Salários" | ✅ |
| C38 | pagar comissão duas vezes (duplo clique): 400 e saldo cai uma vez (sequencial; concorrência real continua ⏳) | ✅ |
| C39 | versão de regra vigente na data de entrada da OS (virada de mês) | ➕ (engine já tem unitário; falta ponta a ponta) |
| C40 | bônus × comissão no mesmo funcionário/mês não se misturam em totais | ✅ parcial (`bonuses.test.ts`) · ➕ ponta a ponta |
| C41 | comissão paga: `overview` (despesa "Salários") e `profit-by-order` (`commission_amount`) não somam a mesma comissão duas vezes (I9); `costs-profit` também não | ✅ (em `reports-consistency`) |
| C42 | `pay-commissions-bulk`: lote com registro de outra org / pago / adiantamento / inexistente; idempotência; conta alheia; rollback quando o registro some no meio | ✅ (por registro, não atômico no lote) |
| C43 | `generate-commissions` em OS com recebimento parcial gera o mesmo resultado que o fluxo automático (liberado × direito) | ✅ |

### 4.4 Relatórios (`reports-consistency.test.ts`, `reports.test.ts`)
| ID | Cenário | Status |
|---|---|---|
| R1–R6 | competência: overview, dashboard, lucro pelas OS, ticket médio, OS excluída, limites do período | ✅ |
| R7–R12 | caixa: entradas, despesas, mês seguinte, overview×caixa, gráfico diário, comparação com período vazio | ✅ |
| R13–R20 | devedores: soma, excluídas, parcial, vencido+a vencer, visões, vencimento, plano, isolamento | ✅ |
| R21–R28 | comissões: totais, funcionário, status, paginação | ✅ |
| KF-32 | comissão de OS excluída não some em silêncio | 🐞 |
| KF-33 | gráfico por funcionário não trata cancelada como pendente | 🐞 |
| KF-34 | devedores desconta o sinal | 🐞 |
| KF-35 | "Lucro pelas OS" sem filtro soma cancelada/orçamento | ✅ caracterizado — **decisão de produto** |
| R29 | exportações (`export-*`) batem com a tela (mesmos filtros → mesmos totais) | ➕ |
| R30 | `sales-items`/`customers`/`suppliers`/`purchases`: mesmos invariantes I4–I6 | ➕ |
| R31 | fuso horário: OS às 23h do dia 31 não vaza para o mês seguinte | não se aplica hoje: `entry_date` e `due_date` são `date` (sem hora); R6 já cobre os limites do mês. Reabrir se algum relatório passar a filtrar por `created_at` |
| R32 | volume: > 1000 linhas (paginação interna `fetchAllOrganizationRows`) soma igual | ⏳ (fake não pagina) |
| R33 | golden dataset: março/2026 com totais conferidos à mão (visão geral, lucro, caixa, devedores, comissões) | ✅ |
| R34 | lucro por OS = total − custo − comissão e a soma das OS fecha com o período; custo > venda dá lucro negativo | ✅ (falta: custo vindo de peças/estoque, ver E21) |
| R35 | `purchases` (relatório) × despesas: compra paga **não** aparece em custos/caixa | ✅ caracterizado — KF-43 |

### 4.5 Permissão e isolamento nas escritas financeiras (novo — KF-09, KF-22, invariante I8)
| ID | Cenário | Status |
|---|---|---|
| S1 | sem login → 401 em todas as rotas de pagamento, estorno, sinal, avulso e pagamento de comissão | ✅ (também na matriz M1 de `guard-matrix`) |
| S2 | usuário sem papel financeiro → 403 (`down-payment`, `process-payment`, `installments/:id/pay`, `receive-extra-payment`, `payment.delete`, `cancel`, `pay-*-bulk`, `purchases/:id/pay`, `financial/:id/pay`) | 🐞 KF-09 — confirmado: as 10 rotas respondem 200 a um usuário sem nenhuma permissão |
| S3 | `organization_id` no corpo/query é ignorado (financial pay, avulso, comissões em lote) | ✅ |
| S4 | conta bancária de outra organização nunca é movimentada (7 rotas, incluindo lançamento apontando para conta alheia) | ✅ |
| S5 | funcionário só vê/paga as próprias comissões quando o papel não é financeiro | ➕ (definir a regra de negócio antes) |
| S6 | varredura estática das escritas que tocam dinheiro: resolvem a organização da sessão e não leem `organization_id` do cliente | ✅ · a parte "exige permissão" é o 🐞 KF-09 (foco financeiro) |

### 4.6 Prioridade dos cenários ➕ (ordem sugerida)
| Prioridade | Cenários | Por quê |
|---|---|---|
| **P0** ✅ feitos | S2, S4, C41, R33 | mexem em dinheiro sem dono ou explicam o "não bate" mais amplo; R33 vem antes de qualquer correção de relatório |
| **P1** ✅ feitos | P45–P48, C42, C37, C38, E18, E19, S1, S3, S6 | caminhos de saldo ainda sem rede de proteção; atomicidade e duplo clique |
| **P2** pendentes | E15, P42, C39, R29, R30, E20, E21, S5, P49 (feitos: E16, P41, C43, R34, R35; R31 não se aplica) | regras de negócio e bordas; várias dependem de decisão de produto |
| ⏳ | E2, E17, P43, R32 | precisam de Postgres real (projeto `api`) |

> **Numeração:** os números ausentes são intencionais. Os cenários que viraram falha conhecida usam o rótulo `KF-xx` no lugar do antigo número (E9/E11/E12 → KF-37/38/39; P32–P34 → KF-27/28/29; C36 → KF-36). Não renumerar para não quebrar referências nos testes.
>
> **Decisões em aberto** (sem dono até hoje): P41 (modo `full` permanece após desfazer?), KF-35 (filtro padrão do "Lucro pelas OS"), P42 (taxa de maquininha entra na receita ou em custo?). Cada uma precisa de uma resposta de produto antes de virar teste.

## 5. Como usar este documento
1. **Antes de mexer** em OS, pagamento, comissão ou relatório: rode `pnpm test` — a suíte inteira roda em ~90 s.
2. **Ao corrigir um 🐞**: o Vitest acusa *"unexpected pass"*; troque `it.fails` por `it`, marque ✅ aqui e em `known-failures.md`.
3. **Ao criar um relatório novo**: declare o regime (§3) e adicione-o ao `reports-consistency.test.ts` com as invariantes I4–I7.
4. **Ao tocar `releaseServiceOrderCommissions`**: o bloco C inteiro precisa continuar verde; é a rede de proteção do "comissão faltando".

## 6. Limites desta camada
- O banco é um **fake em memória**: sem RPC, sem joins, sem gatilhos, sem concorrência. Por isso E2, E17, P43 e R32 estão ⏳.
- As regras de comissão são **mockadas** (`employee-commission-plans`): a leitura real de planos/versões é coberta apenas pelo motor puro (`employee-commission-engine.test.ts`). Falta um teste `api` que semeie plano+versão+regra e confira o resultado fim a fim.
- **Permissão não é exercitada**: os testes atuais chamam os handlers com um contexto já autenticado, então KF-09 (rotas sem `requireOrgPermission`) e KF-22 não aparecem como falha. O bloco S (§4.5) precisa de um contexto sem papel/sem login ou da varredura estática S6.
- Gatilhos e a RPC de numeração de OS só são exercitados com Postgres real (⏳), assim como atomicidade de lotes (`pay-*-bulk`) sob erro no meio do caminho.
- O `typecheck`/`lint` do repositório estão vermelhos desde antes (KF-20); os testes novos não pioram isso.
