# OS recalculadas hoje (10/09/2026) envolvendo ANDERSON DOS SANTOS 2

> Levantamento gerado em 10/09/2026, consultando `service_orders` (organização `fda7436b-a384-5fd6-9f98-74b1547d0e61`) diretamente via API do Supabase. Escopo: **toda OS, de qualquer mês, com uma entrada em `commission_manual_adjustments_log` para o funcionário `b7ee7bba-37bb-5b05-a8f5-7a1b89ff68ca` (ANDERSON DOS SANTOS 2) datada de hoje (10/09/2026)** — sem filtrar por `entry_date` da OS.
>
> Esta é a lista completa: 25 OS no total, das quais 21 tiveram uma zeragem real (comissão saindo de um valor positivo para R$ 0,00) e 4 já estavam em R$ 0,00 antes do recálculo de hoje (não houve mudança).

## Resumo

- **25 OS recalculadas hoje** envolvendo este funcionário
- **21 com zeragem real** — R$ 7.130,99 no total, saindo de um valor positivo para R$ 0,00
- **4 sem mudança** — já estavam em R$ 0,00 antes de hoje (OS5042, OS5043, OS5052, OS5000)
- Reconciliado com o razão financeiro real (`employee_financial_records`): as OS com `entry_date` em agosto têm **zero** registros de comissão (pendente ou pago) para este funcionário hoje — a zeragem foi efetiva de fato, não só no log de auditoria

## 21 OS com zeragem real

O plano de comissão do ANDERSON DOS SANTOS 2 só cobre a categoria **Motor** — todas as 21 OS abaixo têm pelo menos um item dessa categoria. A divisão em responsável/não-responsável bate exatamente com a categoria da OS, sem exceção: nas 9 OS "só Motor" ele continua responsável (só a comissão zerou); nas 12 OS "Motor + Cabeçote" ele foi removido dos responsáveis também.

### Ainda responsável hoje (9 OS — todas só categoria Motor)

| OS | Data de entrada | Categorias da OS | Valor anterior | Novo valor | Se fosse ANDERSON DOS SANTOS (20% s/ lucro Motor) |
|---|---|---|---:|---:|---:|
| #OS4886 | 03/08 | Motor | R$ 43,00 | R$ 0,00 | R$ 43,00 |
| #OS4928 | 04/08 | Motor | R$ 50,00 | R$ 0,00 | R$ 50,00 |
| #OS4884 | 11/08 | Motor | R$ 534,60 | R$ 0,00 | R$ 534,60 |
| #OS4961 | 13/08 | Motor | R$ 173,00 | R$ 0,00 | R$ 173,00 |
| #OS4944 | 17/08 | Motor | R$ 50,00 | R$ 0,00 | R$ 50,00 |
| #OS4985 | 18/08 | Motor | R$ 23,40 | R$ 0,00 | R$ 23,40 |
| #OS4995 | 20/08 | Motor | R$ 85,00 | R$ 0,00 | R$ 85,00 |
| #OS5006 | 24/08 | Motor | R$ 48,00 | R$ 0,00 | R$ 48,00 |
| #OS4977 | 24/08 | Motor | R$ 927,30 | R$ 0,00 | R$ 927,30 |
| **Total** | | | **R$ 1.934,30** | **R$ 0,00** | **R$ 1.934,30** |

> ANDERSON DOS SANTOS (87ed81ea) não está listado como responsável em nenhuma dessas 9 OS hoje — a coluna acima é o que o sistema calcularia (20% sobre o lucro dos itens de Motor, a mesma regra que ele já usa em outras OS onde é responsável) se ele fosse adicionado. O valor bate exatamente com o que o Anderson 2 tinha antes de zerar, porque os dois têm a mesma taxa (20%) para Motor.

#### Combinação mais próxima de R$ 401,90

Testadas as 512 combinações possíveis dessas 9 OS (valor anterior, valor bruto dos itens de Motor, e lucro de Motor) — nenhuma soma exatamente R$ 401,90. A mais próxima:

| OS | Valor anterior |
|---|---:|
| #OS4886 | R$ 43,00 |
| #OS4928 | R$ 50,00 |
| #OS4961 | R$ 173,00 |
| #OS4944 | R$ 50,00 |
| #OS4995 | R$ 85,00 |
| **Total** | **R$ 401,00** |

Diferença de R$ 0,90 para R$ 401,90 — não é exato. Ainda não identificado de onde vem o valor exato de R$ 401,90.

### Não é mais responsável (12 OS — todas Motor + Cabeçote)

| OS | Data de entrada | Categorias da OS | Valor anterior | Novo valor |
|---|---|---|---:|---:|
| #OS4816 | 06/08 | Motor, Cabeçote | R$ 632,62 | R$ 0,00 |
| #OS4727 | 10/08 | Motor, Cabeçote | R$ 690,82 | R$ 0,00 |
| #OS4918 | 10/08 | Motor, Cabeçote | R$ 400,14 | R$ 0,00 |
| #OS4916 | 11/08 | Motor, Cabeçote | R$ 201,30 | R$ 0,00 |
| #OS4899 | 14/08 | Motor, Cabeçote | R$ 571,90 | R$ 0,00 |
| #OS4939 | 18/08 | Motor, Cabeçote | R$ 443,14 | R$ 0,00 |
| #OS4982 | 20/08 | Motor, Cabeçote | R$ 95,40 | R$ 0,00 |
| #OS4994 | 26/08 | Motor, Cabeçote | R$ 263,76 | R$ 0,00 |
| #OS4981 | 27/08 | Motor, Cabeçote | R$ 452,74 | R$ 0,00 |
| #OS5001 | 28/08 | Motor, Cabeçote | R$ 559,17 | R$ 0,00 |
| #OS5018 | 01/09 | Motor, Cabeçote | R$ 401,78 | R$ 0,00 |
| #OS4973 | 01/09 | Motor, Cabeçote | R$ 483,92 | R$ 0,00 |
| **Total** | | | **R$ 5.196,69** | **R$ 0,00** |

### Combinado

| Grupo | OS | Valor zerado |
|---|---:|---:|
| Ainda responsável (só Motor) | 9 | R$ 1.934,30 |
| Não é mais responsável (Motor + Cabeçote) | 12 | R$ 5.196,69 |
| **Total geral** | **21** | **R$ 7.130,99** |

## Comissão de Motor do ANDERSON DOS SANTOS (87ed81ea) em agosto

Valor esperado: **R$ 4.109,25**. Valor ao vivo no sistema hoje, somando as 14 OS de agosto onde ele tem comissão de Motor: **R$ 5.115,75** — diferença de R$ 1.006,50.

| OS | Data de entrada | Comissão de Motor (ao vivo) |
|---|---|---:|
| #OS4816 | 06/08 | R$ 557,20 |
| #OS4727 | 10/08 | R$ 609,55 |
| #OS4918 | 10/08 | R$ 400,14 |
| #OS4916 | 11/08 | R$ 177,00 |
| #OS4971 | 14/08 | R$ 409,20 |
| #OS4899 | 14/08 | R$ 465,09 |
| #OS4939 | 18/08 | R$ 425,55 |
| #OS4982 | 20/08 | R$ 43,00 |
| #OS5011 | 25/08 | R$ 339,60 |
| #OS4994 | 26/08 | R$ 173,00 |
| #OS4981 | 27/08 | R$ 403,42 |
| #OS5023 | 27/08 | R$ 246,00 |
| #OS5001 | 28/08 | R$ 453,40 |
| #OS5027 | 28/08 | R$ 413,60 |
| **Total** | | **R$ 5.115,75** |

Testadas as 16.384 combinações possíveis dessas 14 OS: nenhuma soma exatamente R$ 4.109,25. A mais próxima — **excluindo #OS4916, #OS4939 e #OS4981** — soma **R$ 4.109,78**, uma diferença de apenas R$ 0,53 (provável arredondamento acumulado item a item):

| OS | Comissão de Motor |
|---|---:|
| #OS4816 | R$ 557,20 |
| #OS4727 | R$ 609,55 |
| #OS4918 | R$ 400,14 |
| #OS4971 | R$ 409,20 |
| #OS4899 | R$ 465,09 |
| #OS4982 | R$ 43,00 |
| #OS5011 | R$ 339,60 |
| #OS4994 | R$ 173,00 |
| #OS5023 | R$ 246,00 |
| #OS5001 | R$ 453,40 |
| #OS5027 | R$ 413,60 |
| **Total** | **R$ 4.109,78** |

As 3 OS excluídas (#OS4916, #OS4939, #OS4981) somam R$ 1.005,97 — coincidem com 3 das 12 OS da tabela "Não é mais responsável" acima (onde o Anderson 2 tinha Motor + Cabeçote e foi removido). Ainda não confirmado se essa exclusão é o motivo real da diferença ou coincidência de valores.

## 4 OS recalculadas hoje sem mudança (já estavam em R$ 0,00)

| OS | Data de entrada |
|---|---|
| #OS5042 | 02/09 |
| #OS5043 | 02/09 |
| #OS5052 | 03/09 |
| #OS5000 | 09/09 |

Essas 4 não entram no total de R$ 7.130,99 — o recálculo de hoje só confirmou que ele já não tinha comissão nelas, não houve dinheiro removido.

## Metodologia e ressalvas

- "Categorias da OS" lista **todas** as categorias de itens presentes na ordem de serviço, não só a parte que gerava comissão para este funcionário.
- Quando uma OS teve mais de uma entrada de recálculo hoje, foi usada a última que representa uma zeragem real (`previous_amount > 0` e `new_amount = 0`); nas 4 sem mudança, foi usada a última entrada de hoje mesmo assim.
- Filtro usado: `commission_manual_adjustments_log[].recalculated_at` começando com `2026-09-10` e `employee_id = b7ee7bba-...`, **sem** filtrar por `entry_date` da OS.
- Este documento é um retrato pontual (10/09/2026) — não se atualiza sozinho.
