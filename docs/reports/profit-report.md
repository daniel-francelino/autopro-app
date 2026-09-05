# Relatório de lucro — como funciona hoje e por que não entrega uma visão real do negócio

> **Atualização — implementado**: a proposta da seção 5 (múltiplos modos/abas) foi implementada. O relatório não usa mais `server/api/reports/costs-profit.get.ts` (branch `includeProfitReport`, removido) — agora são dois endpoints dedicados, um por modo: `server/api/reports/profit-cash-flow.get.ts` e `profit-by-order.get.ts`, com a lógica de cálculo compartilhada em `server/utils/profit-report-helpers.ts`. As seções 1-4 abaixo descrevem o comportamento **anterior** (mantidas como registro histórico do problema); a seção 5 descreve o que foi de fato construído.
>
> **Atualização — aba "Resultado do Período" removida**: essa terceira aba (P&L de competência completo) chegou a ser implementada mas nunca foi habilitada na UI, porque tinha uma lacuna real não resolvida (custo de comissão incorrida-mas-não-paga não entrava na conta — ver histórico abaixo). Decisão do time: não vale a pena manter/terminar essa aba agora. O endpoint (`profit-period-result.get.ts`) e as funções de cálculo (`calculateAccrualPeriodData`/`buildAccrualEvolutionData`) foram removidos. A seção 5 abaixo foi deixada como registro histórico de como ela funcionava, mas o código não existe mais.

Este documento cobre exclusivamente o **relatório de lucro** (aba "Lucro" em Relatórios, `app/pages/app/reports/profit.vue`). Todo o comportamento descrito abaixo foi confirmado lendo o código, não é suposição.

## 1. Onde vive (histórico — ver seção 5 para o estado atual)

| Arquivo | Papel |
|---|---|
| `server/api/reports/costs-profit.get.ts` | Endpoint antigo (branch `includeProfitReport`, **removido** — seção 5). Calculava receita/custo/lucro e montava `responseData.profitReport` |
| `server/utils/report-helpers.ts` | Normalização de status, cálculo de período anterior, variação percentual — ainda usado pelo relatório de custos e pelos 3 novos endpoints |
| `app/pages/app/reports/profit.vue` | Página — monta os query params e consome `data.profitReport` |
| `app/components/reports/profit/ProfitFilters.vue` | UI do filtro (período, "Status do pagamento", comparação) |

## 2. Fórmula atual

`calculatePeriodData()` (`costs-profit.get.ts:14-30`) calcula, para o período selecionado:

- **Receita** = soma de `total_amount` de toda `service_orders` cujo `entry_date` cai no período **e** cujo `status` seja `completed`, `invoiced` ou `delivered` (`costs-profit.get.ts:17-18`).
- **Custo** = soma de `amount` de toda `financial_transactions` do tipo `expense`, cujo `due_date` cai no período e cujo `status` normalizado não seja `cancelled` (`costs-profit.get.ts:20-24`).
- **Lucro** = Receita − Custo. **Margem** = Lucro / Receita.

Isso já é repetido para o período anterior (se comparação estiver ativa) para calcular variação percentual (`getPreviousRangeByMode`, `calculateVariation`).

### 2.1 Orçamento (`status = 'estimate'`) já é excluído — não é um bug

A checagem de status da OS é uma **allowlist explícita** (`completed`/`invoiced`/`delivered`) — qualquer outro valor, incluindo `estimate` (orçamento ainda não confirmado), `open`, `in_progress`, `waiting_for_part` e `cancelled`, já fica de fora da receita automaticamente. Confirmado no schema (`supabase/migrations/20240101000018_create_service_orders.sql:61-63`) que `'estimate'` é o status default de uma OS nova. Isso vale tanto para o resumo (`costs-profit.get.ts:141`) quanto para `topProfitableOrders`/`evolutionData`, que derivam do mesmo conjunto já filtrado.

### 2.2 `topProfitableOrders` usa uma base de custo **diferente** do lucro geral

`costs-profit.get.ts:239-244` monta o ranking das 10 OS mais lucrativas usando `total_cost_amount` **da própria OS** (custo de peças/produtos usados naquele serviço, calculado no frontend em `CreateModal.vue:479/975` e salvo por OS) — não a despesa financeira agregada usada no cálculo de lucro geral (`financial_transactions` tipo `expense`).

Ou seja, o card "Lucro" do topo do relatório e a tabela "OS mais lucrativas" respondem a **duas perguntas diferentes**:
- Lucro geral = receita de todas as OS − despesas gerais da empresa (aluguel, salário, etc.), sem nenhuma ligação direta OS-a-OS.
- Ranking por OS = receita daquela OS − custo de peças/produtos daquela OS especificamente, sem nenhuma despesa geral entrando na conta.

Não são a mesma unidade e não devem ser somadas/comparadas diretamente — hoje nada na UI avisa essa diferença.

## 3. O filtro "Status do pagamento" — mecânica exata

Na UI (`ProfitFilters.vue:22-25`), só existem duas opções visíveis: **Pago** e **Pendente**. O valor selecionado vira `statusFilters` (`profit.vue:64`, default `['paid']`) e é enviado como `query.status` para o backend, onde `normalizeStatusFilters()` (`report-helpers.ts:124-132`) o transforma num array (`['paid']`, `['pending']`, `['paid','pending']` ou `[]`).

Esse **mesmo array** é aplicado a **duas colunas de duas tabelas diferentes**, dentro de `calculatePeriodData`:

```ts
// costs-profit.get.ts:18 — filtra a OS (receita) pelo campo payment_status
matchesStatusFilters(o?.payment_status, statusFilters)

// costs-profit.get.ts:24 — filtra a despesa (custo) pelo campo status
matchesStatusFilters(t?.status, statusFilters)
```

`normalizeReportStatus()` (`report-helpers.ts:116-122`) colapsa `partial` e `overdue` dentro de `pending` — ou seja, "Pendente" no filtro também inclui pagamentos parciais e vencidos, tanto do lado da OS quanto do lado da despesa.

`matchesStatusFilters()` (`report-helpers.ts:134-138`) retorna `true` para **tudo**, sem restringir nada, quando o array de filtros está vazio (`filters.length === 0`).

### 3.1 Os três estados possíveis e o que cada um realmente calcula

| Seleção na UI | `statusFilters` enviado | OS que entram na receita | Despesas que entram no custo | O que essa métrica representa |
|---|---|---|---|---|
| **Pago** (default da página) | `['paid']` | Só OS com `payment_status = paid` | Só despesas com `status = paid` | Regime de **caixa**: dinheiro que já entrou menos dinheiro que já saiu |
| **Pendente** | `['pending']` | Só OS com `payment_status` em pending/partial/overdue | Só despesas em pending/partial/overdue | Receita a receber menos despesa a pagar — **não é fluxo de caixa nem é o resultado real do período**, é uma projeção do que ainda vai acontecer |
| **Todos** (limpar a seleção de tags) | nenhum (`query.status` não é enviado) | Toda OS concluída/faturada/entregue, **qualquer** `payment_status` | Toda despesa não cancelada, **qualquer** `status` | Regime de **competência**: receita reconhecida (serviço prestado) menos custo reconhecido (despesa com vencimento no período) — é o resultado operacional real do período, independente de quando o dinheiro efetivamente circula |

**Este último estado ("Todos") é o número que representa a visão real do negócio** — é o P&L de competência, o mais próximo de "quanto a empresa realmente lucrou operando naquele período". Hoje ele só é alcançado **esvaziando** o filtro de tags (o placeholder mostra "Todos" quando nenhuma tag está marcada), o que não é intuitivo: a maioria dos usuários lê "nenhuma tag marcada" como "nada selecionado ainda", não como "modo especial que soma tudo".

## 4. Por que isso gera a sensação de "não consigo ver a visão real do negócio"

Juntando os pontos acima:

1. **O default da página é `['paid']`** (`profit.vue:64`) — ou seja, todo mundo abre o relatório já em regime de caixa, sem escolher isso ativamente.
2. **Não existe uma terceira opção visível** "Ver tudo / competência" — ela existe tecnicamente (limpar o filtro), mas está escondida atrás de um comportamento de "campo vazio", não de uma opção com nome e explicação.
3. **O rótulo "Status do pagamento"** não deixa claro que o mesmo filtro atinge receita (OS) e custo (despesa) ao mesmo tempo, nem que os dois conjuntos de dados normalizam `partial`/`overdue` da mesma forma "silenciosa" dentro de `pending`.
4. **O card de topo e o ranking de OS mais lucrativas** (seção 2.2) usam bases de custo diferentes sem aviso — outra fonte de números que parecem não bater entre si.

O efeito prático: ao alternar entre "Pago" e "Pendente" tentando entender o negócio, nenhum dos dois números é o P&L de competência que normalmente se espera de um "relatório de lucro" — e a opção que seria esse P&L (limpar a seleção) não é descoberta com facilidade.

## 5. Três abas, um modo cada (implementado)

O problema de raiz da seção 4 é ter **um único filtro tentando responder mais de uma pergunta ao mesmo tempo**. A correção proposta não é ajustar o filtro — é parar de usar um filtro para isso e virar **três abas**, cada uma respondendo uma pergunta de negócio específica, com sua própria fonte de receita/custo:

### Aba "Fluxo de Caixa"
- Filtro **Pago/Pendente** (`ProfitFilters.vue:22-25`), aplicado ao `status` de cada `financial_transactions`.
- Pergunta que responde: **"Tenho dinheiro no caixa?"** — quanto dinheiro entrou e saiu de fato (ou está prestes a entrar/sair). Controle de curto prazo, não diz se o negócio é lucrativo — só se há dinheiro circulando.

**Correção feita após a primeira implementação (bug real, reportado pelo usuário)**: a primeira versão calculava a receita deste modo a partir de `service_orders.total_amount`/`payment_status` (copiado do endpoint antigo) — mas isso está **errado**. O `payment_status` da OS não é a mesma coisa que "existe uma transação de receita registrada e com o status certo" no financeiro; os dois podem divergir bastante (parcela paga adiantada, estorno, ajuste manual, etc.). Prova concreta encontrada em produção: para julho/2026 com filtro "Pendente", o endpoint respondia receita = R$ 39.868 (soma de OS com `payment_status` pendente/parcial), enquanto a tela de Financeiro — que é a fonte real de verdade do fluxo de caixa — mostrava apenas R$ 0,01 de receita pendente no mesmo período.

A correção: receita do Fluxo de Caixa agora vem de `financial_transactions` tipo `income` (criadas em `server/utils/financial-income.ts` a cada pagamento recebido de uma OS — sinal, parcela, quitação), a **mesma fonte e a mesma lógica** que já alimenta os cards "Receitas"/"Despesas" da tela de Financeiro (`server/api/financial/summary.get.ts`). Receita e custo agora vêm da mesma tabela, filtrados pelo mesmo `status`, exatamente simétricos — nenhum dos dois lados usa mais `service_orders`. Implementado em `calculateCashFlowFromTransactions` (`server/utils/profit-report-helpers.ts`).

### Aba "Pelas OS" (nova — margem por serviço, no nível da OS)
- **Custo = `total_cost_amount` (peças/produtos) + `commission_amount` (comissão) de cada OS** — **não** as despesas gerais da empresa (`financial_transactions`).
- Pergunta que responde: **"O preço que cobro por serviço cobre o custo da peça e a comissão?"** — Receita = soma de `total_amount` das OS do período; Custo = soma de `total_cost_amount` + `commission_amount` das mesmas OS; Lucro = a diferença. É a margem direta do serviço prestado, útil para precificação — **não inclui aluguel, conta de luz** nem nenhuma despesa geral fixa. Uma oficina pode ter margem ótima aqui e ainda fechar o mês no vermelho, porque essa métrica não desconta a estrutura fixa do negócio.
- Passa a ser **consistente com o ranking "OS mais lucrativas"** (seção 2.2), que agora usa essa mesma base (peças + comissão) — antes o ranking convivia com um card de lucro geral que usava uma fonte de custo diferente; com a aba nova, os dois números finalmente falam a mesma língua.

#### Dois filtros independentes (adicionados a pedido do usuário, depois da primeira implementação)

A primeira versão desta aba não tinha nenhum filtro de status — usava sempre uma allowlist fixa (`completed`/`invoiced`/`delivered`) e ignorava completamente `payment_status`. Agora ela ganhou dois filtros de tags independentes, nenhum obrigatório:

- **Status da OS** (`orderStatusFilters` no frontend, `query.orderStatus` no endpoint) — o status do ciclo de vida da OS (`open`, `in_progress`, `waiting_for_part`, `completed`, `invoiced`, `delivered`, `estimate`, `cancelled`). Default: `['completed', 'invoiced', 'delivered']` — preserva o comportamento original (só serviço efetivamente prestado). Limpar o filtro ("Todos") passa a incluir até orçamento e cancelada, se o usuário explicitamente escolher isso — deixa de ser uma allowlist fixa no código, vira uma escolha do usuário (mesmo padrão de `CommissionsFilters.vue`/`DebtorsFilters.vue`, que já filtram OS por status da mesma forma).
- **Status do pagamento** (`orderPaymentStatusFilters` no frontend, `query.orderPaymentStatus` no endpoint) — o `payment_status` da própria OS (Pago/Pendente, mesma normalização `partial`/`overdue` → `pending` já usada no resto do relatório). Default: **vazio** (Todos) — continua sendo, por padrão, independente de pagamento (é isso que faz este modo ser "regime de competência" por padrão); mas agora o usuário pode restringir, por exemplo, para ver a margem só das OS já pagas.

Implementado em `calculateByOrderPeriodData(orders, start, end, orderStatusFilters, paymentStatusFilters)` (`server/utils/profit-report-helpers.ts`) — os dois filtros são aplicados de forma independente (AND), sobre o mesmo conjunto de OS já restrito ao período por `entry_date`.

#### Correção: faltava o custo de comissão (reportado pelo usuário)

A primeira versão desta aba só descontava `total_cost_amount` (peças) — sem a comissão paga/devida aos funcionários responsáveis pela OS, que é um custo real do serviço tanto quanto a peça.

Investigando como a comissão é calculada e armazenada (`server/utils/service-order-commissions.ts`, `server/utils/service-order-item-commissions.ts`):
- `service_orders.commission_amount` é o **total já consolidado** da comissão entitulada a todos os funcionários responsáveis pela OS — calculado por item (percentual sobre receita, sobre lucro, ou valor fixo, conforme a regra de cada funcionário) e somado numa única coluna, mantida em sincronia sempre que a OS é criada/editada ou a comissão é liberada/paga.
- Confirmei que **é seguro somar `commission_amount` ao custo aqui, sem risco de contar a mesma coisa duas vezes**: este modo nunca lê `financial_transactions`, só campos da própria `service_orders`.
- **Atenção, achado colateral (não corrigido agora, registrado para não esquecer)**: o mesmo não vale para a aba **Resultado do Período** — lá, a parcela **já paga** de uma comissão gera uma linha em `financial_transactions` (`type='expense'`, categoria "Salários", ver `server/api/reports/commissions/[id]/pay.post.ts:78-98` e `server/api/financial/pay-commissions-bulk.post.ts:131-145`), que já entra na soma de "despesas gerais" daquele modo. Se um dia somarmos `commission_amount` também no Resultado do Período, a parcela paga da comissão seria contada duas vezes — por isso o Resultado do Período **não** foi alterado para incluir comissão nesta correção. Ele também tem uma lacuna oposta, ainda não resolvida: a parcela **pendente** de uma comissão (ainda não paga) não gera linha em `financial_transactions`, então hoje o Resultado do Período só reconhece o custo de comissão quando ela é efetivamente paga, não quando é incorrida (o que, a rigor, contradiz o regime de competência que esse modo deveria seguir) — fica como um gap conhecido, fora do escopo deste ajuste.

O card "Custos" no resumo (`ProfitSummary.vue`) agora mostra "peças: R$X · comissão: R$Y" quando está no modo Pelas OS (a mesma lógica de breakdown já usada para "peças · despesas" no Resultado do Período, só que com a combinação certa de campos para cada modo).

### Aba "Resultado do Período" (nova — P&L completo, regime de competência)

Esta é a aba que falta para o cliente realmente saber **"o negócio deu lucro de verdade este mês, incluindo todos os custos, independente de já ter recebido ou pago?"** — nem Fluxo de Caixa (ignora o que ainda não foi pago/recebido) nem Pelas OS (ignora despesa geral) respondem essa pergunta sozinhas.

#### O que entra na conta

- **Sem filtro de status de pagamento**, em nenhum dos lados — nem `payment_status` da OS, nem `status` da despesa entram no critério. O endpoint (`server/api/reports/profit-period-result.get.ts`) nem sequer lê `query.status` — não existe esse parâmetro aqui, ao contrário do modo Fluxo de Caixa.
- **Receita** = soma de `total_amount` de toda `service_orders` cujo `status` seja `completed`, `invoiced` ou `delivered` e cujo `entry_date` caia no período — reconhecida pela data em que o serviço foi lançado, **independente de já ter sido paga**.
- **Custo** = **duas fontes somadas**, não uma só (correção feita depois da primeira versão — ver "Correção" abaixo):
  - **Custo de peças** = soma de `total_cost_amount` das mesmas OS que compõem a receita (o CMV/COGS do serviço prestado).
  - **Despesas gerais** = soma de `amount` de toda `financial_transactions` do tipo `expense`, não cancelada, cujo `due_date` caia no período (aluguel, salário, conta de luz, etc.).
  - Custo total = custo de peças + despesas gerais.
- **Lucro** = Receita − Custo total. **Margem** = Lucro / Receita × 100.

É o número mais próximo de um **DRE/P&L de competência** completo: o resultado contábil real do período, o que um contador chamaria de "lucro líquido" daquele mês — a métrica que efetivamente diz se o negócio é lucrativo, distinta de caixa (quando o dinheiro se move) e de margem por serviço (se o preço cobre só a peça, sem contar a estrutura fixa).

#### Correção: faltava o custo de peças (CMV/COGS) — este modo superestimava o lucro

A primeira versão desta aba somava só as despesas gerais como custo, do mesmo jeito que o endpoint antigo fazia. Investigando a fundo (a pedido do usuário, revisando este modo para melhorá-lo), confirmei uma lacuna real no sistema: **comprar ou repor peças/produtos nunca gera uma linha em `financial_transactions`** — busquei em todo `server/api/purchase-requests/**`, `server/api/products/**` e no fluxo real de `app/pages/app/products/purchases.vue`, e nenhum deles grava na tabela financeira (existe uma coluna `purchases.financial_transaction_id`, mas é um vínculo manual opcional que a UI atual nunca preenche). Ou seja: o custo da peça só existe em um lugar — `service_orders.total_cost_amount` — e um "Resultado do Período" que soma só despesas gerais **nunca desconta o custo do material usado no serviço**, superestimando o lucro real sempre que houver custo de peça relevante.

A correção soma as duas fontes (custo de peças da própria OS + despesas gerais), confirmando antes que elas nunca se sobrepõem (nenhuma delas registra a mesma coisa duas vezes) — sem isso, dois modos ("Pelas OS" e "Resultado do Período") continuariam contando a mesma pergunta de formas incompletas, cada um faltando uma metade do custo real do negócio.

O card "Custos" no resumo agora mostra o detalhamento ("peças: R$X · despesas: R$Y") quando essa quebra está disponível — implementado em `ProfitSummary.vue` (`costsDescription`), lendo os campos novos `partsCost`/`generalExpenses` que `toPublicPeriodData` (`server/utils/profit-report-helpers.ts`) inclui na resposta.

#### Como o código calcula isso, exatamente

Este modo usa `calculateAccrualPeriodData(orders, transactions, start, end)` (`server/utils/profit-report-helpers.ts`) — **sem parâmetro de status**, porque este modo nunca filtra por pagamento:

```ts
// server/api/reports/profit-period-result.get.ts
const currentData = calculateAccrualPeriodData(orders, transactions, dateFrom, dateTo)
```

1. Busca `service_orders` e `financial_transactions` da organização (`fetchAllOrganizationRows`).
2. `calculateAccrualPeriodData` filtra OS por `entry_date` no período + `status` em completed/invoiced/delivered, e despesas por `due_date` no período + `type='expense'` + não cancelada — nenhum dos dois lados olha status de pagamento. Soma `total_amount` (receita) e `total_cost_amount` (custo de peças) das mesmas OS, mais `amount` das despesas gerais (custo geral) — `costs = partsCost + generalExpenses`.
3. Se a comparação com período anterior estiver ativa, `resolveComparison()` recalcula o período anterior com a mesma função.
4. `buildVariations()` calcula a variação percentual de receita/custo/lucro/margem entre os dois períodos.
5. `buildAccrualEvolutionData()` monta o gráfico diário: a receita **e o custo de peças** de cada dia vêm do `entry_date` das OS; o custo de despesa geral de cada dia vem do `due_date` da despesa — os dois lados do custo diário são somados na mesma barra/linha do gráfico, mas continuam vindo de fontes e datas independentes uma da outra.
6. **Não gera `topProfitableOrders`** — esse ranking (seção 2.2) usa só `total_cost_amount` por OS, sem as despesas gerais; misturar os dois números faria o ranking não bater com o card de lucro desta aba.

Query params aceitos por este endpoint: `dateFrom`, `dateTo`, `compareWithPreviousPeriod` (`'true'`/`'false'`), `compareMode` (`previous_period`/`same_period_last_year`/`previous_month`/`previous_quarter`). Não existe `status` — se alguém passar esse parâmetro na URL manualmente, ele é simplesmente ignorado.

#### Exemplo numérico

Um período com:
- 3 OS concluídas: R$ 1.000 (paga, custo de peça R$ 300), R$ 800 (pendente, custo de peça R$ 250), R$ 500 (parcial, custo de peça R$ 100) → receita = R$ 2.300; custo de peças = R$ 650.
- 2 despesas gerais no período: aluguel R$ 600 (já pago) e energia R$ 150 (ainda pendente) → despesas gerais = R$ 750.
- Custo total = R$ 650 + R$ 750 = R$ 1.400.
- Resultado do Período = R$ 2.300 − R$ 1.400 = **R$ 900**, margem ≈ 39% (bem diferente do R$ 1.550/67% que sairia ignorando o custo de peça — a diferença é exatamente o tamanho do erro que a versão anterior cometia).

Compare com o que as outras duas abas mostrariam para o mesmo período:
- **Fluxo de Caixa** (filtro Pago): receita = soma das transações `income` já pagas no período (**não** as OS), custo = R$ 600 (só o aluguel pago) → depende de quanto já foi efetivamente registrado como recebido/pago no financeiro, tipicamente um número diferente porque ignora o que ainda não circulou.
- **Pelas OS**: receita R$ 2.300 (ou menos, se o filtro de status da OS/pagamento estiver restringindo) menos R$ 650 de custo de peças e menos a comissão das mesmas OS = margem por serviço, sem nenhuma despesa geral fixa entrando na conta — não comparável com o Resultado do Período, que inclui peças + despesas gerais (mas não comissão, ver seção da correção de comissão acima).

Isso ilustra por que nenhuma das três abas deveria ser lida como "a resposta certa" isolada — cada uma responde uma pergunta diferente (tabela da seção seguinte).

### Por que abas separadas, e não um único filtro (histórico: chegou a ser três, hoje são duas — ver nota no topo do documento)

Cada aba responde exatamente uma pergunta de negócio, sem ambiguidade, e uma não substitui a outra:

| Aba | Pergunta que responde | Receita considerada | Custo considerado |
|---|---|---|---|
| Fluxo de Caixa | Tenho dinheiro no caixa? | `financial_transactions` tipo `income`, por `status` (filtro Pago/Pendente) | `financial_transactions` tipo `expense`, por `status` (filtro Pago/Pendente) |
| Pelas OS | O preço do serviço cobre o custo da peça e da comissão? | OS por status da OS (default: concluída/faturada/entregue) e status de pagamento (default: Todos) — ambos filtráveis | `total_cost_amount` + `commission_amount` da própria OS |
| ~~Resultado do Período~~ *(removida — ver nota no topo)* | O negócio deu lucro de verdade, incluindo tudo? | Toda OS concluída, qualquer status de pagamento | Custo de peças da OS (`total_cost_amount`) **+** despesa geral não cancelada (`financial_transactions`), qualquer status de pagamento |

A visão "Todos" ambígua descrita na seção 3.1 (que antes calculava exatamente o "Resultado do Período", só que sem nome nem explicação) não existe mais como comportamento implícito — hoje só há mesmo Fluxo de Caixa e Pelas OS, cada uma com filtros próprios e explícitos.

### 5.1 Implementação

- `server/utils/profit-report-helpers.ts` — lógica compartilhada:
  - `calculateCashFlowFromTransactions`/`buildCashFlowTransactionsEvolutionData` (Fluxo de Caixa) — receita e custo **ambos** de `financial_transactions` (`type='income'`/`type='expense'`), filtrados pelo mesmo `status`. Não usa `service_orders`.
  - `calculateByOrderPeriodData`/`buildByOrderEvolutionData`/`buildTopProfitableOrders` (Pelas OS) — receita e custo de `service_orders` (`total_amount`/`total_cost_amount`/`commission_amount`).
  - Helpers comuns de comparação de período (`resolveComparison`, `buildVariations`), reaproveitados pelos dois modos.
  - *(`calculateAccrualPeriodData`/`buildAccrualEvolutionData`, do modo Resultado do Período, foram removidos — ver nota no topo do documento.)*
- `server/api/reports/profit-cash-flow.get.ts`, `profit-by-order.get.ts` — um endpoint por modo, cada um só buscando as tabelas e aceitando os query params que fazem sentido para ele (`status` só existe em `profit-cash-flow`; `profit-by-order` nem busca `financial_transactions`).
- `server/api/reports/costs-profit.get.ts` — perdeu o branch `includeProfitReport`; continua servindo só o relatório de Custos (`costsReport`/`costsCategoryDetails`), sem nenhuma mudança de comportamento para essa página.

### 5.2 Bug corrigido: Fluxo de Caixa mostrava receita da OS, não das transações

Reportado pelo usuário logo após a primeira implementação: no modo Fluxo de Caixa, o "Faturamento" exibido não batia com a tela de Financeiro. Causa raiz e correção detalhadas na seção "Aba Fluxo de Caixa" acima — resumo: a primeira versão herdou a lógica do endpoint antigo (`costs-profit.get.ts`), que somava `service_orders.total_amount` filtrado por `payment_status`; a versão corrigida soma `financial_transactions` tipo `income` filtrado por `status`, a mesma fonte que a tela de Financeiro usa. A aba Pelas OS não foi afetada por esse bug (sempre usou `service_orders` corretamente, por design — competência não depende de status de pagamento).
- `app/components/reports/profit/ProfitFilters.vue` — ganhou um `UTabs` de modo no topo, com uma linha de explicação abaixo; o filtro "Status do pagamento" só aparece no modo Fluxo de Caixa.
- `app/pages/app/reports/profit.vue` — escolhe o endpoint pelo modo ativo; a tabela "Ordens mais lucrativas" só aparece no modo Pelas OS (é a única com essa base de custo).

