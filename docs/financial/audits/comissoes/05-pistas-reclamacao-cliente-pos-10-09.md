# Comissões: pistas da reclamação do cliente depois de 10/09

Data da análise: 2026-11-13 · Base: produção, somente leitura, recorte de 11/09 a 13/11/2026.
Origem: seção 9.9 do [consolidado](auditoria-comissoes-consolidada.md). Este documento aprofunda os pontos que parecem ligados ao que o cliente reclama.

> **Revisão (2026-11-13, validação independente):** a primeira versão deste documento concluía que "a comissão não nasce e o cliente cria na mão". A validação contra o código e o banco mostrou que essa leitura estava errada em dois pontos centrais:
> 1. O campo `previous_amount` do log de recálculo **é a soma dos registros que existiam** para o funcionário na OS (`server/utils/service-order-commissions.ts:512` e `:571`), não um valor teórico. Logo, as comissões do Moacir **já existiam** (pendentes) quando o cliente recalculou; o recálculo só apagou e recriou o registro (`:525-532`), por isso o `created_at` é de 11/11.
> 2. As comissões do Anderson nas OS5209 e OS5235 **foram pagas em 06/11, apagadas depois e pagas de novo em 12/11**, com débito bancário nas duas vezes. É pagamento em duplicidade, não comissão faltando.
>
> As seções abaixo já trazem a leitura corrigida.

**Status das afirmações:** "Fatos" vêm do banco e do código. "Hipóteses" não foram comprovadas. Não há trilha das exclusões: `service_order_edit_logs` está vazio no período, as comissões são apagadas fisicamente, e `audit_logs` (que existe desde 09/11 12:46 UTC) só registrou 35 escritas, todas de `/api/users/*`. Ou seja, o log de auditoria não está capturando escritas de OS e de comissão em produção.

Privacidade: funcionários citados pelo primeiro nome, como o cliente escreve nos motivos. Sem IDs completos nem dados de clientes.

---

## 1. Resumo da pista

O cliente reclama de **comissão que não aparece no relatório** ("não está constando no relatório de comissão para o Moacir/Anderson", "as comissões estão com divergência"). Os dados mostram dois problemas diferentes por trás dessa queixa:

| Caso | O que de fato aconteceu | Efeito |
|---|---|---|
| **Moacir** (OS5043, OS5209, OS5235) | O registro pendente **existia**. O cliente não o via no relatório e recalculou, o que apagou e recriou o mesmo valor. | Nenhum dinheiro a mais; o problema é de **visibilidade** no relatório. |
| **Anderson** (OS5209, OS5235) | O registro **pago em 06/11** foi apagado fisicamente entre 06/11 e 11/11. O recálculo de 11/11 criou um novo registro, pago em 12/11. | **Pagamento em duplicidade de R$ 1.640,85**, com débito bancário. |

Quantificação:

| Forma | Registros | Valor |
|---|---|---|
| Recálculo que só recriou pendente já existente (Moacir, 11/11) | 3 | R$ 1.921,05 |
| Recálculo que recriou comissão já paga e apagada (Anderson, 11/11), depois paga de novo | 2 | R$ 1.640,85 |
| Regeração ao apagar parcela pendente e relançar como paga (OS5225, 06/11) | 2 | R$ 143,42 |

Contexto: todas essas OS estão em modo de liberação `full` (a comissão é liberada sem depender do recebimento). O modo `full` está no consolidado, seção 9.9, ponto 1.

---

## 2. Moacir: comissão existente que o cliente não via

### Fatos

| OS | Entrada da OS | `previous_amount` no recálculo | Novo valor | Situação hoje |
|---|---|---|---|---|
| OS5043 | 07/10 | R$ 485,40 (11/11 17:45) | R$ 485,40 | pendente |
| OS5209 | 30/10 | R$ 1.138,00 (11/11 20:55) e R$ 1.138,00 (21:21) | R$ 1.138,00 | pendente |
| OS5235 | 30/10 | R$ 297,65 (11/11 21:13) | R$ 297,65 | pendente |

- `previous_amount` igual ao novo valor significa que já havia um registro pendente com esse valor. O recálculo manual apaga as pendentes do funcionário e insere uma nova (`service-order-commissions.ts:525-532`), o que explica o `created_at` de 11/11.
- Na OS5209, o recálculo das 20:55 **gravou** um registro, e o das 21:21 o substituiu. A hipótese anterior de que o primeiro recálculo "não gravou nada" está descartada.
- Não há despesa órfã do Moacir nessas OS, então nenhum registro dele foi pago e apagado.

### Por que o cliente não via (hipóteses, a reproduzir)

1. **Filtro de período do relatório.** O relatório filtra comissões pela **data de entrada da OS** (`server/api/reports/commissions.get.ts:102-105`), e o período padrão é o **mês corrente** (`app/composables/useReportDateRange.ts:8-17`). Em 11/11, a visão padrão (novembro) exclui a OS5043 (entrada 07/10) e as OS5209/OS5235 (entrada 30/10), embora as comissões tenham sido geradas e pagas em novembro. É a explicação mais simples e combina com "não está constando no relatório".
2. **Filtros persistidos.** Os filtros ficam na URL e no `localStorage`. Um filtro de situação ("pago"), de status de pagamento da OS (as OS5209/OS5235 estão com pagamento pendente) ou de forma de pagamento esconde as pendentes.
3. Os dois outros responsáveis dessas OS aparecem como pagos porque foram pagos no lote de 06/11; o Moacir ficou pendente. Se o cliente conferiu pelo lote de pagamento (só pendentes do filtro atual), o Moacir pode não ter aparecido pelo mesmo motivo do item 1.

### O que verificar

- Com o cliente: qual tela e quais filtros ele usa para conferir (período, situação, status da OS).
- Reproduzir em homologação: OS com entrada em outubro, comissão gerada em novembro, relatório no período padrão de novembro.

---

## 3. Anderson: comissão paga, apagada e paga de novo

### Fatos

| OS | 1º pagamento (com extrato) | Registro original | Recálculo (`previous_amount`) | 2º pagamento (com extrato) | Excesso |
|---|---|---|---|---|---|
| OS5209 | 06/11 17:22, R$ 1.234,30 | apagado fisicamente | 0 → R$ 1.234,30 (11/11 21:20) | 12/11 20:42, R$ 1.234,30 | **R$ 1.234,30** |
| OS5235 | 06/11 17:25, R$ 559,50 | apagado fisicamente | 0 → R$ 406,55 (11/11 21:12) | 12/11 20:42, R$ 406,55 | **R$ 406,55** (o 1º pagamento já cobria o direito atual) |

- As quatro despesas são da mesma conta (`d87834c0`) e têm extrato ativo, ou seja, o saldo foi debitado duas vezes.
- As despesas de 06/11 continuam ativas e ficaram com `employee_financial_record_id = NULL`. É o efeito do `ON DELETE SET NULL` da FK (`supabase/migrations/20240101000021_create_financial_transactions.sql:71-74`) quando o registro de comissão é apagado.
- Nenhuma entrada de recálculo apagou esses registros (o recálculo bloqueia funcionário com comissão paga, `service-order-commissions.ts:503-509`). O caminho compatível é `DELETE /api/reports/commissions/:id` (`server/api/reports/commissions/[id].delete.ts`), que apaga comissão **paga** sem estornar despesa nem saldo.
- Na OS5235, o valor de 06/11 (R$ 559,50) é maior que o direito atual (R$ 406,55). Sugere que a OS foi alterada entre 30/10 e 11/11, sem trilha para confirmar.

### Hipótese

O cliente (ou alguém da oficina) apagou no relatório as comissões pagas do Anderson, talvez tentando corrigir a "divergência", e depois as recriou pelo recálculo. Sem log de auditoria das escritas, não dá para saber quem apagou nem quando.

### O que fazer

- **Financeiro:** decidir com o cliente como recuperar R$ 1.640,85 pagos a mais ao Anderson (desconto ou estorno). Não executado.
- **Código (Fase 0):** bloquear exclusão de comissão paga e passar a usar soft delete. Esse é o mesmo padrão do PD-01 (agosto/2026) e continua acontecendo.
- **Auditoria:** investigar por que `audit_logs` não registra as escritas de OS e de comissão em produção.

---

## 4. O cliente apaga parcelas para forçar a comissão

### Fatos

| OS | Data | Parcela apagada | Status da parcela apagada | Motivo escrito | O que aconteceu em seguida |
|---|---|---|---|---|---|
| OS5225 | 06/11 14:35 | R$ 710,00 | **pendente** (não recebida) | "Vou ter que lançar novamente o pagamento devido a não constar no relatório de comissão" | Nova parcela de R$ 710 criada **já paga** (data de pagamento 21/10). Em 14:36 nasceram as comissões de Mateus (R$ 89,64) e Anderson (R$ 53,78), pagas no mesmo dia. |
| OS5235 | 11/11 21:08 | R$ 6.000,00 | **pendente** (não recebida) | "As comissões estão com divergência" | Nenhuma parcela nova. A OS ficou **sem parcela ativa**. |

- **OS5225:** às 14:33 o cliente recalculou o Mateus e o resultado foi 0 → 0. Sem recebimento, a comissão proporcional é zero, que é o comportamento correto do sistema. O cliente então apagou a parcela pendente e lançou o recebimento. Como a parcela apagada não estava paga, **não há entrada dupla no caixa**: só existe uma parcela paga de R$ 710. Falta confirmar com o cliente se esse valor foi de fato recebido (a data informada é 21/10).
- **OS5235:** o recebível de R$ 6.000 sumiu do sistema. A OS tem R$ 588,05 de comissão paga (Mateus R$ 181,50 e Anderson R$ 406,55) e mais o pagamento de R$ 559,50 da seção 3, sem nenhum recebimento.

### Por que isso importa além da comissão

- **Contas a receber ficam incorretas** (OS5235), e relatórios de recebimento, inadimplência e DRE deixam de bater.
- **A auditoria perde a trilha:** a exclusão fica só com o motivo livre digitado pelo usuário.
- É uma **contornada do sistema:** o cliente usa a exclusão de parcela como botão de "regerar comissão".

### O que verificar

- OS5235: se o cliente pretende relançar os R$ 6.000.
- OS5225: se os R$ 710 foram recebidos de fato em 21/10.
- Se há outros casos de parcelas apagadas com motivo ligado a comissão antes de 11/09.

---

## 5. Outros pontos menores

### 5.1 Geração atrasada no modo proporcional

Das 7 OS quitadas desde 11/09 no modo proporcional, 4 tiveram a comissão criada de 2 a 7 dias depois do último pagamento:

| OS | Último pagamento | Comissão criada | Atraso | Forma |
|---|---|---|---|---|
| OS5221 | 20/10 | 27/10 | 7,2 dias | pix |
| OS5201 | 14/10 | 21/10 | 7,0 dias | dinheiro |
| OS5208 | 30/10 | 04/11 | 5,0 dias | pix |
| OS5170 | 06/10 | 08/10 | 2,3 dias | pix |

Hipótese mais provável: a data de pagamento foi lançada retroativamente (como na OS5225, lançada em 06/11 com data de 21/10). Verificar o `created_at` da parcela paga contra o `payment_date`.

### 5.2 Comissão acima do valor da OS

| OS | Situação | Comissão da OS | Soma dos registros | Diferença |
|---|---|---|---|---|
| OS5255 | quitada | R$ 253,93 | R$ 259,92 | + R$ 5,99 |
| OS5246 | pendente | R$ 363,60 | R$ 367,20 | + R$ 3,60 |
| OS5242 | pendente | R$ 243,62 | R$ 247,22 | + R$ 3,60 |
| OS5120 | quitada | R$ 213,74 | R$ 215,99 | + R$ 2,25 |

Total R$ 15,44. Provável causa: OS editada depois da liberação sem reconciliar as comissões gravadas (FC-05).

### 5.3 Comissões do Anderson sem regra gravada

28 comissões criadas desde 11/09 (R$ 12.757,07), todas do Anderson, estão sem `commission_rule_id`. **Não é legado.** O Anderson tem **um único plano ativo**, "Gerente" (o plano pessoal está excluído), e esse plano tem **duas regras** por versão (20% e 9%). Quando itens da OS casam com regras diferentes, o motor deixa a rastreabilidade em branco (`server/utils/service-order-commissions.ts:143-147` e `:197`). O plano é preenchido quando todas as regras são do mesmo plano.

Ponto para decisão de produto: sem regra gravada, o registro não explica de onde veio o valor, o que dificulta a conferência que o cliente tenta fazer. Vale gravar o detalhamento por regra.

---

## 6. Perguntas para o cliente

1. Qual tela e quais filtros (período, situação, status da OS) são usados para conferir as comissões? Os valores que "não constam" aparecem ao trocar o período para o mês de entrada da OS?
2. Quem apagou as comissões pagas do Anderson nas OS5209 e OS5235 entre 06/11 e 11/11, e por quê?
3. Os R$ 710 da OS5225 foram recebidos em 21/10? A OS5235 vai ter os R$ 6.000 relançados?
4. O modo de liberação integral (`full`) é desejado para todas as OS ou foi marcado por hábito?

## 7. Sugestão de encaminhamento

- **financial-auditor / financeiro:** tratar os R$ 1.640,85 pagos em duplicidade ao Anderson em novembro, junto com o PD-01.
- **developer (Fase 0):** bloquear `DELETE` de comissão paga, soft delete com motivo, e checar por que `audit_logs` não registra escritas.
- **developer (relatório):** deixar claro na tela que o período filtra pela entrada da OS, ou oferecer filtro por data de geração ou pagamento; oferecer "regerar comissão" sem precisar apagar parcela.
- **business-analyst:** validar com o cliente as perguntas da seção 6.

Relação com outros achados: seção 9.9 do consolidado, PD-01 em `comissoes-integridade-producao.md` (mesmo padrão em agosto), CR-07 (filtro por data de entrada) e PB-07 (modo `full`).
