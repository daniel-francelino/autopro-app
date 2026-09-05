# Step 8 — Migração: trocar os motores de cálculo (detalhamento)

> Detalha o Step 8 de `docs/finance/commissions-configuration-architecture.md`. Escrito depois de auditar os 4 motores legados linha a linha e de fechar o Step 6 (`server/utils/employee-commission-plans.ts`) e o Step 7 (backfill, `20240101000091_backfill_legacy_employee_commissions.sql`). Só análise e plano — nenhuma mudança de código feita por este documento.

## 1. Objetivo e escopo

Fazer os 4 pontos que hoje calculam comissão a partir dos 5 campos legados de `employees` (`has_commission`, `commission_type`, `commission_amount`, `commission_base`, `commission_categories`) passarem a calcular usando a estrutura nova (`employee_commission_plans` → `employee_commission_rule_versions` → `employee_commission_rules` → `employee_commission_rule_categories` → `employee_commission_plan_assignments`, resolvida por `server/utils/employee-commission-plans.ts`).

Fora do escopo deste step (ficam para Steps 9-10):
- Remover os campos antigos de `employees` ou a UI que ainda os exibe em modo leitura.
- Remover o código dos 4 motores legados — eles continuam existindo até o corte de cada um ser validado.

Este step **não deve alterar valores de comissões já geradas** (`employee_financial_records` existentes, `pending` ou `paid`). Ele só muda de onde vem a *configuração* usada para gerar as próximas.

## 2. Pré-requisitos

- Step 7 aplicado: todo funcionário com comissão legada tem uma configuração equivalente no módulo novo (`employee_commission_plans` + 1 versão + assignment). Sem isso, o corte de qualquer motor faria funcionários pararem de receber comissão.
- Consciência de que **nem todo funcionário necessariamente tem uma configuração nova válida no momento do corte** — o Step 7 lida com o legado no momento em que rodou, mas: funcionários criados depois, funcionários cuja configuração legada era inválida (pulados pelo backfill, ver diagnóstico no fim de `20240101000091`), ou uma configuração nova cuja versão vigente foi mal editada (ex: sem regra default e o item não bate em nenhuma categoria) podem ficar sem regra aplicável. A seção 6 define o comportamento de fallback para esses casos.

## 3. Estado atual dos 4 motores (auditoria)

| # | Arquivo | Quando roda | Isolado ou compartilhado |
|---|---|---|---|
| 1 | `app/utils/service-orders.ts` (`computeServiceOrderCommissionBreakdown` e derivadas) | Client-side, preview ao vivo enquanto o usuário monta/edita a OS (`CreateModal.vue`, `detail/Modal.vue`, `OSResponsiblesCard.vue`) | Roda no browser, sem chamada ao backend |
| 2 | `server/utils/sales-item-commissions.ts` (`computeEmployeeItemCommissions`, `computeOrderItemCommissionMap`) | Servidor, sob demanda, ao montar os relatórios de Itens Vendidos e de Funcionários (`server/api/reports/sales-items.get.ts`, `server/api/reports/employees.get.ts`) | Recalcula em cima do total já persistido por funcionário/OS (`commissionTotalsByOrderEmployee`), só para *distribuir* entre itens — não decide se há comissão, só como ela se reparte na exibição |
| 3 | `server/utils/service-order-item-commissions.ts` (`computeServiceOrderItemsWithCommissionSnapshots`) | Servidor, dentro de `POST /api/service-orders` — cobre tanto criar quanto editar uma OS (o endpoint decide por `orderId` presente no body) | Grava o snapshot em `service_orders.items[].commission_total` / `.commissions[]` — é o que a OS exibe depois de salva e o que os outros 3 motores usam como fonte quando disponível (`hasStoredCommissions` em `sales-item-commissions.ts` e `employee-commission-plans.ts`) |
| 4 | `server/utils/service-order-commissions.ts` (`releaseServiceOrderCommissions`) | Servidor, toda vez que um recebimento da OS é confirmado (parcela paga, pagamento avulso, geração do plano com `commission_release_mode='full'`) ou via `POST /api/service-orders/:id/generate-commissions` | **É o único que grava `employee_financial_records`** — os outros 3 são só cálculo/exibição. Este é o motor que efetivamente decide quanto cada funcionário recebe |

Todos os 4 leem os mesmos 5 campos de `employees` e a mesma regra de elegibilidade por categoria: `commission_categories` vazio → todos os itens elegíveis; não vazio → item elegível se `!item.category_id || commission_categories.includes(item.category_id)` (item sem categoria sempre é elegível, mesmo com allowlist configurada).

## 4. Divergência já existente entre os motores (achado da auditoria)

Isso **já é um bug em produção**, independente da migração — vale documentar porque o Step 8 é a oportunidade natural de resolvê-lo, e porque explica por que o motor novo redefiniu `fixed_amount` (`20240101000088`).

### 4.1 `fixed_amount` tem 3 interpretações diferentes convivendo hoje

| Motor | Interpretação de `commission_amount` (fixed_amount) |
|---|---|
| Preview frontend (#1) | `commission_amount` dividido pela **quantidade de itens elegíveis** (não pela quantidade vendida) — resto vai pro primeiro item |
| Relatórios (#2) | Mesma divisão por contagem de itens elegíveis |
| Snapshot por item (#3) | Mesma divisão por contagem de itens elegíveis — é o que fica gravado em `service_orders.items[].commission_total` e é o que os motores #1 e #2 preferem reusar quando já existe (`hasStoredCommissions`) |
| **Liberação real (#4)** | **`commission_amount` inteiro, uma única vez por OS**, sem dividir por item nem por quantidade — é literalmente `employeeCommissionAmount = commissionValue` |

Ou seja: para um funcionário com comissão fixa de R$50 numa OS com 2 itens elegíveis, a tela mostra R$25 + R$25 (motores #1-#3), mas o valor que **de fato vira `employee_financial_records`** é R$50 (motor #4). O usuário nunca vê essa divergência porque a tela não exibe o total liberado lado a lado com o snapshot por item.

O motor novo (Step 6) já decidiu a semântica correta pra frente: `fixed_amount` = valor fixo **por unidade vendida na categoria** (`commission_amount × quantidade`), documentado em `20240101000088` e implementado em `computeCommissionAmount()`. Isso não é igual a nenhuma das 3 interpretações legadas acima — é uma quarta, mais previsível. O corte do motor #4 (seção 8.4) é onde essa mudança de comportamento fica visível pela primeira vez, e por isso é o corte que precisa de mais cuidado/validação antes de ir pra produção.

### 4.2 `revenue` vs `profit` — consistente entre os 4, mas com regra própria

Todos os 4 seguem a mesma fórmula (isso está OK, só precisa ser replicado no novo motor pelo chamador, já que `computeCommissionAmount()` do Step 6 recebe `revenue`/`profit` prontos, não os calcula):

```
itemBase (revenue) = item.total − (desconto da OS, prorateado por participação do item no subtotal elegível)
itemBase (profit)  = itemBase(revenue) − item.cost − (impostos da OS, prorateados da mesma forma)
```

O rateio de desconto/imposto é sempre feito **sobre o subtotal dos itens elegíveis daquele funcionário especificamente** (`eligibleSale`), não sobre o subtotal da OS inteira. Isso tem uma consequência sutil: se dois funcionários têm categorias elegíveis diferentes na mesma OS, o mesmo item pode ter uma fração de desconto diferente dependendo de qual funcionário está sendo calculado — não é um bug isolado do Step 8, é assim que o legado sempre funcionou, mas é uma decisão de design que vale re-confirmar ao escrever o helper da seção 6 (replicar exatamente esse comportamento, ou simplificar para ratear sobre o subtotal da OS inteira, o que é mais simples de explicar e testar). Recomendo simplificar — ver seção 6.

## 5. O que o motor novo (Step 6) já cobre — e o que falta

`server/utils/employee-commission-plans.ts` já expõe, prontos para uso:

- `resolveEmployeeCommissionRules(supabase, organizationId, employeeId, referenceDate)` — todas as regras de todos os planos ativos atribuídos ao funcionário, já resolvidas pela versão vigente na data.
- `matchCommissionRule(rules, categoryId)` / `getApplicableCommissionRule(rules, categoryId)` — escolhe a regra aplicável (categoria específica → default → nenhuma).
- `computeCommissionAmount(rule, { revenue, profit, quantity })` — calcula o valor por percentual ou fixo.
- `buildCommissionSnapshot(rules, item)` — compõe os dois acima e devolve o formato pronto para as colunas novas de `employee_financial_records` (`commission_plan_id`, `commission_rule_id`, `commission_rule_version_id`, `commission_rule_name`, `commission_amount_snapshot`).
- `server/api/commissions/preview.post.ts` — endpoint isolado que já exercita esse pipeline fim a fim, sem tocar em OS real.

O que **não existe ainda** e precisa ser escrito como parte do Step 8 (não do Step 6, porque é específico de OS/item, não de funcionário):

- Um helper único que, dado um item de OS (preço, custo, quantidade) e a OS (desconto, impostos, subtotal), devolve `{ revenue, profit, quantity }` prontos para passar a `computeCommissionAmount()` — hoje essa conta está duplicada e ligeiramente diferente em cada um dos 4 arquivos (`getItemTotal`/`getItemCost`/proração de desconto e imposto). Sugestão de nome: `resolveOrderItemCommissionAmounts()`, em um novo arquivo compartilhado entre client e server (ex: `shared/utils/service-order-commission-amounts.ts`, já que o motor #1 roda no browser) ou em `app/utils/service-orders.ts` + reexport server-side, seguindo o padrão que já existe hoje de código de OS compartilhado entre as duas camadas.
- Uma função de resolução por **item de uma OS multi-responsável**, já que hoje cada motor itera `responsible_employees` e filtra itens elegíveis por funcionário — o motor novo resolve por funcionário isoladamente (`resolveEmployeeCommissionRules` é por `employeeId`), então o loop "para cada responsável, para cada item elegível" precisa continuar existindo no chamador; só a decisão de regra/valor é que migra para o motor novo.

## 6. Estratégia de fallback: modelo novo x legado, por funcionário

Nem todo funcionário terá uma configuração nova resolvível no momento de cada corte (ver seção 2). A regra recomendada para os 4 motores, nesta ordem:

1. Chamar `resolveEmployeeCommissionRules(supabase, organizationId, employeeId, referenceDate)`.
2. Para cada item elegível do funcionário, chamar `matchCommissionRule(rules, item.categoryId)`.
   - **Se encontrou regra** → usa o motor novo (`computeCommissionAmount`), fim.
   - **Se `rules` veio vazio** (funcionário sem nenhum plano ativo atribuído) → cai no legado: usa `employees.has_commission/commission_type/commission_amount/commission_base/commission_categories` exatamente como hoje.
   - **Se `rules` veio não-vazio mas nenhuma regra bateu no item** (tem plano, mas sem regra default e o item não está em nenhuma categoria coberta) → **não cai no legado** — respeita a decisão do usuário configurada no plano novo (item sem comissão). Cair no legado aqui esconderia um erro de configuração do usuário (esqueceu de marcar uma regra como default) atrás de um comportamento antigo que ele não pediu mais.
3. `referenceDate` deve ser a data de entrada da OS (`entry_date`), não a data de hoje — mesma lógica que já vale para o preview e os relatórios, que resolvem histórico por data do pedido, não por "agora".

Esse fallback precisa ser **o mesmo texto/lógica nos 4 motores** — se cada um decidir sozinho quando cair pro legado, a divergência da seção 4 volta a existir, agora entre "quem já migrou" e "quem não migrou". Sugestão: colocar essa decisão dentro do helper novo da seção 5 (`resolveOrderItemCommissionAmounts` já devolve, por item/funcionário, se usou modelo novo ou legado — isso também serve de log/telemetria pro modo sombra da seção 9).

## 7. Ordem de corte recomendada e detalhamento por motor

A ordem do documento principal já é a certa (do menor para o maior risco). Detalhando cada um:

### 7.1 Preview frontend — `app/utils/service-orders.ts`

- **Risco:** baixo. Não persiste nada, só exibe. Um valor errado aqui é cosmético e visível na hora — o próprio usuário percebe se o preview não bate com o que ele configurou em Financeiro > Comissões.
- **Complicador:** roda no browser, então precisa buscar as regras do funcionário via API (`GET /api/employees/:id/commission-plans`, já existe do Step 5, ou um endpoint novo dedicado a isso) em vez de ler `SupabaseClient` diretamente. Isso muda a função de síncrona para assíncrona — todo componente que chama `computeServiceOrderCommissionBreakdown` precisa lidar com o carregamento.
- **Sugestão:** buscar as regras uma vez por funcionário responsável (quando o responsável é atribuído à OS), cachear em memória no componente, e recalcular localmente (síncrono) a cada mudança de item/desconto — só o *carregamento das regras* é assíncrono, o cálculo em si continua local.

### 7.2 Relatórios — `server/utils/sales-item-commissions.ts`

- **Risco:** baixo-médio. Não gera dinheiro, mas é o que o usuário usa pra conferir comissão por item nos relatórios de Funcionários e Itens Vendidos — um valor errado aqui gera desconfiança mesmo sem impacto financeiro real.
- **Detalhe importante:** este motor já tem uma lógica de "usar valor persistido no item quando existir" (`hasStoredCommissions`) — ela deve continuar funcionando para OS antigas (persistidas antes do corte), e só usar o motor novo quando `hasPersistedCommissionRecords` mas os dados não vieram do formato antigo. Não precisa (nem deve) recalcular OS antigas com o motor novo — isso mudaria retroativamente números que o usuário já viu.

### 7.3 Snapshot por item — `server/utils/service-order-item-commissions.ts`

- **Risco:** médio. É o que fica gravado em `service_orders.items[].commission_total`/`.commissions[]` e alimenta os motores #1 e #2 depois (via `hasStoredCommissions`). Um erro aqui se propaga silenciosamente pros relatórios até alguém notar.
- Este é o primeiro motor onde a divergência do `fixed_amount` (seção 4.1) fica **gravada em disco**, não só calculada na hora — depois de cortado, uma OS nova com comissão fixa vai ter um `commission_total` por item calculado pela regra "por unidade", diferente de como toda OS anterior a esse corte foi calculada. Vale considerar guardar, junto com o snapshot, algum marcador de qual motor gerou aquele item (ex: reaproveitar `commission_plan_id`/`commission_rule_id` já nulo = veio do legado, preenchido = veio do novo) — os dois já existem como colunas em `employee_financial_records`, mas o snapshot por item vive dentro do JSON de `service_orders.items`, então precisa de um campo equivalente lá também (`commission_rule_id` dentro de cada objeto de `commissions[]`, por exemplo).

### 7.4 Liberação real — `server/utils/service-order-commissions.ts`

- **Risco:** alto. É o único motor que grava `employee_financial_records` — o que efetivamente vira valor a pagar pro funcionário. Um erro aqui é dinheiro errado saindo (ou deixando de sair) da empresa.
- Precisa ser o **último** a ser cortado, e o único que idealmente passa por um período de modo sombra (seção 9) antes de virar a fonte de verdade.
- Ponto de atenção específico deste motor: ele já tem uma lógica delicada de liberação proporcional ao recebido (`receivedRatio`) e de estorno (`delta <= -0.01` → remove de registros `pending`, nunca de `paid`). Essa lógica **não muda** — só a fonte do `entitlement.totalAmount`/`commissionType`/`commissionBase` por funcionário é que passa a vir do motor novo quando aplicável. Isso significa que `computeEmployeeEntitlements()` continua existindo estruturalmente, só troca o cálculo interno do valor por item pela chamada ao helper da seção 5/6.
- As 3 novas colunas de `employee_financial_records` (`commission_plan_id`, `commission_rule_version_id`, `commission_rule_id` — já existem desde a migration `20240101000085`) só devem ser preenchidas quando o motor novo foi de fato usado para aquele registro; ficam `NULL` para registros gerados pelo caminho legado (inclusive no fallback da seção 6).

## 8. Modo sombra antes do corte #4

Dado o risco do motor de liberação (#4), recomendo um passo intermediário não listado no plano original: antes de trocar `computeEmployeeEntitlements()` de fato, rodar os dois motores em paralelo por um tempo —

1. Calcular o valor pelo motor legado (como hoje) **e** pelo motor novo (via o helper da seção 5/6), para o mesmo funcionário/OS.
2. Persistir só o valor do motor legado (comportamento inalterado).
3. Logar (ou gravar numa tabela de auditoria temporária) os dois valores lado a lado quando divergirem além de uma tolerância (ex: R$0,01).
4. Rodar isso em produção por tempo suficiente pra cobrir os padrões de comissão realmente usados (percentual/faturamento, percentual/lucro, fixo — pelo menos um ciclo de pagamento completo).
5. Só depois de zerar (ou entender e aceitar) as divergências reais encontradas, trocar a fonte de verdade.

Isso é o equivalente ao "Uma comparação entre legado e novo motor retorna os mesmos valores para casos conhecidos" do critério de pronto do Step 7, mas aplicado contra dado real de produção em vez de só casos de teste manuais — pega divergências que a auditoria da seção 4 não previu.

## 9. OS já existentes / já pagas

O corte não deve recalcular nada retroativamente:

- `service_orders` já persistidas mantêm o `commission_total`/`commissions[]` que já têm — o motor #3 só roda de novo se a OS for editada (e nesse caso, ver seção 7.3 sobre marcar a origem do cálculo).
- `employee_financial_records` já gerados (pending ou paid) não são tocados — o motor #4 só decide a partir do próximo evento de recebimento daquela OS specific, e mesmo assim só cobre o **delta** não liberado ainda (a lógica de `delta`/`receivedRatio` já existente, seção 7.4).
- Recomendo **não** rodar `POST /:id/generate-commissions` em massa contra todas as OS existentes depois do corte — isso recalcularia entitlement de OS antigas com o motor novo, o que é exatamente o "mudar retroativamente" que o Step 5 do documento principal já disse que não deve acontecer.

## 10. Critério de pronto (detalhado)

Além dos 3 itens já listados no documento principal:

- [ ] Os 4 motores usam a mesma lógica de fallback (seção 6), não decisões independentes.
- [ ] Existe o helper compartilhado da seção 5 e ele é a única fonte de cálculo de `revenue`/`profit`/`quantity` por item — nenhum dos 4 motores recalcula isso por conta própria depois do corte.
- [ ] `service_orders.items[].commissions[]` grava algo que permite distinguir se aquele valor veio do motor novo ou do legado (seção 7.3).
- [ ] Modo sombra (seção 8) rodou em produção sem divergências inexplicadas antes do corte do motor #4.
- [ ] `POST /api/commissions/preview` (Step 6) e o preview real da OS (motor #1, já cortado) concordam para o mesmo funcionário/categoria/valor — é o teste de integração mais barato disponível, porque os dois já existem e usam o mesmo motor novo por baixo.
- [ ] Nenhuma OS ou `employee_financial_record` existente antes do corte teve seu valor alterado (comparação de snapshot antes/depois em amostra real).

## 11. Decisões que precisam confirmação antes de implementar

1. **`fixed_amount` no corte do motor #3/#4**: aceitar que o comportamento muda (de "dividido por contagem de itens" ou "flat por OS", dependendo do motor legado, para "por unidade vendida") a partir da data do corte, sem tentar unificar os 3 comportamentos legados entre si primeiro? (Recomendo sim — tentar fazer os 3 motores legados concordarem entre si antes seria trabalho jogado fora, já que todos os 3 vão ser substituídos.)
2. **Proração de desconto/imposto** (seção 4.2): manter o rateio "por participação nos itens elegíveis daquele funcionário" (replica o legado, mais fiel historicamente) ou simplificar para "por participação no subtotal da OS inteira" (mais simples de explicar/testar, mas muda levemente o valor quando há múltiplos funcionários com categorias diferentes na mesma OS)?
- "manter o rateio "por participação nos itens elegíveis daquele funcionário" (replica o legado, mais fiel historicamente)"
3. **Onde marcar a origem do cálculo no snapshot por item** (seção 7.3): reaproveitar um campo já existente ou adicionar um novo campo em `service_orders.items[].commissions[]`?
- Reaproveitar
4. **Janela do modo sombra** (seção 8): quanto tempo em produção antes de confiar no motor novo pro corte #4 — um ciclo de pagamento, dois, um número mínimo de OS observadas?
- Pode já liberar, porque ainda vou testar em DEv antes de ir para produão.

## 12. Plano de rollback

Como o corte de cada motor é independente (arquivo por arquivo, não uma flag global), o rollback também é por motor: reverter o commit/deploy daquele arquivo específico volta a ler os 5 campos legados de `employees`, que continuam intactos e não são tocados até o Step 10. Nenhum dos 4 cortes deste step depende de remover dado nenhum — é sempre seguro reverter até o Step 9 (remoção da UI legada) ser feito.
