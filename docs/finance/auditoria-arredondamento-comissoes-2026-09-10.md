# Auditoria: arredondamento de centavos no cálculo de comissões

> Documento só de análise — nenhuma mudança de código ou banco foi feita a partir daqui. Motivação: pedido explícito para investigar se o cálculo de comissão pode acumular erro de centavos ao longo do mês. A investigação encontrou o padrão de arredondamento esperado (baixo risco, mas real), **e também** uma causa muito maior de divergência de valores que não é arredondamento — registrada aqui para não ficar confundida com o problema de centavos.

## Resumo executivo

| Achado | Severidade | Tipo |
|---|---|---|
| 1. Arredondamento por item, não por total | Baixa — drift limitado, não cresce sem limite | Arredondamento (o que foi pedido) |
| 2. Quatro cópias independentes da mesma função de arredondamento | Baixa/manutenção | Risco de divergência futura |
| 3. Somas de relatório sem `roundMoney` final | Muito baixa | Ruído de ponto flutuante |
| 4. Recálculo manual apaga comissões pendentes de funcionário sem regra válida | **Alta — já causou R$ 7.130,99 em zeragem real hoje** | Bug de lógica, não de arredondamento |

O achado 4 não é sobre centavos — é sobre reais. Está incluído porque apareceu na mesma auditoria e no mesmo dia (ver `docs/finance/comissoes-anderson-santos-2-recalculadas-2026-09-10.md`), e é, na prática, mais urgente que o problema de arredondamento que motivou o pedido.

## 1. Arredondamento por item, não por total (o que foi pedido)

O motor de cálculo (`lib/utils/employee-commission-engine.ts`) computa a comissão de cada item elegível separadamente e arredonda a cada soma:

```ts
// lib/utils/employee-commission-engine.ts:75-77
function roundMoney(value: number): number {
  return Number.parseFloat(Number(value || 0).toFixed(2))
}

// lib/utils/employee-commission-engine.ts:154-163
export function computeCommissionAmount(rule, amounts): number {
  if (rule.commission_type === 'fixed_amount') {
    return roundMoney(rule.commission_amount * (amounts.quantity ?? 1))
  }
  const base = rule.commission_base === 'profit' ? amounts.profit : amounts.revenue
  return roundMoney((base * rule.commission_amount) / 100)   // arredonda AQUI, por item
}

// lib/utils/employee-commission-engine.ts:276-292
for (const index of eligibleIndexes) {
  ...
  const amount = computeCommissionAmount(rule, { revenue, profit, quantity })  // já arredondado
  if (amount > 0) {
    perItem[index] = { amount, rule }
    total = roundMoney(total + amount)   // arredonda de novo, a cada item somado
  }
}
```

**O que isso realmente causa:** como cada `amount` já é um valor de centavos "fechado" antes de entrar na soma, o segundo `roundMoney` no acumulador não introduz erro adicional — ele só limpa ruído de representação binária de ponto flutuante (o clássico `0.1 + 0.2 !== 0.3`). O ponto real de discordância é outro: **arredondar o percentual item a item, em vez de aplicar o percentual uma vez sobre o total do pedido, é uma escolha de modelo, não um bug** — mas ela produz um total ligeiramente diferente do que se obteria "calculando por fora" (ex.: pegar o lucro total da categoria Motor de um período e aplicar 20% de uma vez). Essa diferença:

- é limitada por item: no pior caso, até ~R$ 0,005 de viés por item comissionado (metade de um centavo, para mais ou para menos, dependendo do resultado do `toFixed`);
- **não cresce indefinidamente** — não é "acúmulo" no sentido de um erro sistemático que soma sempre na mesma direção; a direção do arredondamento depende do valor de cada item, então tende a se cancelar parcialmente ao longo de muitos itens/pedidos;
- mas também não é zero, e some com o volume de itens: um mês com centenas de itens comissionados pode facilmente acumular alguns reais de diferença entre "soma dos valores já lançados no sistema" e "o que daria para recalcular por fora a partir dos totais agregados".

**Evidência real, já observada em produção** (`docs/finance/comissoes-anderson-santos-2-recalculadas-2026-09-10.md`, seção "Comissão de Motor do ANDERSON DOS SANTOS em agosto"): comparando o valor esperado (R$ 4.109,25) com a soma ao vivo de um subconjunto de 11 OS (R$ 4.109,78), a diferença ficou em **R$ 0,53** — o próprio autor do levantamento atribui isso a "provável arredondamento acumulado item a item". Isso confirma, com dado real, exatamente o mecanismo acima: pequeno, real, mas não a causa principal de divergências grandes (ver achado 4).

**Isso é um bug?** Não no sentido de "está calculado errado" — arredondar no momento em que cada comissão é reconhecida (por item) é uma prática contábil defensável, inclusive mais correta do ponto de vista de auditoria por item do que "arredondar só no total". O ponto a registrar é que **qualquer conferência feita "por fora"** (somando valores esperados a partir de totais agregados, como o levantamento do Anderson Santos fez) **nunca vai bater exatamente**, por poucos centavos, e isso é esperado — não é sinal de erro no sistema.

## 2. Quatro cópias independentes da mesma função de arredondamento

A mesma lógica (`Number(value.toFixed(2))`) está reimplementada, sem compartilhar símbolo, em pelo menos 5 lugares:

| Arquivo | Nome local | Uso |
|---|---|---|
| `lib/utils/employee-commission-engine.ts:75-77` | `roundMoney` (não exportado) | motor novo, por item e por total |
| `server/utils/service-order-commissions.ts:83-85` | `roundCurrency` | liberação/claw-back de comissão |
| `server/utils/service-order-item-commissions.ts:22-24` | `roundCurrency` | snapshot de comissão por item da OS |
| `app/utils/service-orders.ts:122-124` | `roundCurrency` | preview no frontend, antes de salvar |
| `server/utils/report-helpers.ts:67-69` | `roundMoney` (exportado) | relatórios/agregações |

Hoje são idênticas, então não há divergência de resultado. O risco é de manutenção: nada impede que uma dessas cópias seja alterada (ex.: para lidar com um caso extremo) sem que as outras quatro acompanhem, criando uma divergência futura entre o preview do frontend, o snapshot por item e o valor efetivamente liberado — que hoje só coincidem porque as implementações são coincidentemente iguais.

**Sugestão** (não aplicada — fora do escopo desta auditoria): consolidar num único `roundMoney`/`roundCurrency` exportado de um módulo compartilhado (ex.: `lib/utils/money.ts`), e importar dos quatro lugares.

## 3. Somas de relatório sem arredondamento final

Em `server/api/reports/commissions.get.ts:165-171`, os totais do relatório de comissões são somados com `reduce` puro, sem passar por `roundMoney` no resultado final:

```ts
const totalCommissions = commissionOnlyRecords.reduce((sum, record) => sum + toNumber(record?.amount, 0), 0)
const paidCommissions = commissionOnlyRecords.filter(r => r.status === 'paid').reduce(...)
const pendingCommissions = commissionOnlyRecords.filter(r => r.status === 'pending').reduce(...)
```

e o mesmo em `byEmployeeMap` (linha 184-194), com `+=` direto. Cada `amount` somado já é um valor de centavos gravado no banco (`numeric(15,2)`), então o único risco aqui é ruído de ponto flutuante do JS ao somar muitos valores (ex.: exibir `R$ 1234.5600000000001` em vez de `R$ 1234.56`) — não afeta o valor guardado, só a exibição/exportação nesse endpoint específico. Outros relatórios (`server/utils/employee-commission-report.ts:308-311`, `server/utils/employee-report.ts:391-437`) já envolvem a soma em `roundMoney`.

**Sugestão**: envolver `totalCommissions`/`paidCommissions`/`pendingCommissions`/os totais de `byEmployeeMap` em `roundMoney` antes de devolver a resposta, por consistência com os outros relatórios — risco de exibição, não de valor gravado.

## 4. O achado mais importante: recálculo manual apaga comissões pendentes válidas (não é arredondamento)

Isso não é um problema de centavos, mas apareceu na mesma varredura e é, disparado, o de maior impacto financeiro observado hoje — por isso registrado aqui.

Em `server/utils/service-order-commissions.ts:377-403`, quando um recálculo manual é disparado para um `employeeId` específico e esse funcionário **não tem mais nenhuma regra de comissão que combine** com os itens da OS (ex.: plano/categoria reconfigurados), o código sintetiza um "entitlement zero" em vez de barrar a operação:

```ts
if (employeeId && targetEntitlements.length === 0) {
  targetEntitlements = [{ employeeId, totalAmount: 0, ... }]
}
```

Combinado com a lógica de recálculo manual introduzida logo depois (linhas 515-532): para recálculo manual (`employeeId` setado), **todos os registros `pending` desse funcionário nessa OS são apagados** e substituídos por um novo registro só se `released >= 0.01`. Como o entitlement é zero, `released` é zero, e nada é reinserido — o resultado prático é: **toda comissão pendente daquele funcionário naquela OS é apagada, sem distinção entre "esse funcionário legitimamente não tem mais direito a nada aqui" e "o recálculo rodou com regras erradas/desatualizadas carregadas".**

Isso é exatamente o mecanismo documentado, com dados reais, em `docs/finance/comissoes-anderson-santos-2-recalculadas-2026-09-10.md`: 21 OS zeradas hoje para o funcionário "ANDERSON DOS SANTOS 2", **R$ 7.130,99** no total, incluindo 12 OS onde ele tinha uma comissão real de Motor + Cabeçote e foi removido dos responsáveis pelas duas categorias de uma vez. O próprio documento nota que uma parte da diferença de R$ 1.006,50 encontrada para outro funcionário ("ANDERSON DOS SANTOS") nas comissões de Motor de agosto coincide com 3 dessas mesmas 12 OS — ou seja, os dois achados (o zeramento em massa e uma divergência de total) podem estar se sobrepondo no mesmo conjunto de dados, embora isso ainda não esteja confirmado no documento original.

**Por que isso é mais grave que o achado 1**: o achado 1 é limitado a centavos e não cresce sem limite; este achado apaga o valor **inteiro** de uma comissão pendente, de uma vez, por OS — e foi disparado 21 vezes no mesmo dia pelo mesmo fluxo (recálculo manual). Não é uma auditoria teórica: já aconteceu.

Este achado não foi corrigido aqui — está fora do escopo de "arredondamento" que motivou este documento, e já está registrado com mais detalhes de dados em `docs/finance/comissoes-anderson-santos-2-recalculadas-2026-09-10.md`. Fica sinalizado para decisão de prioridade.

## Conclusão

Respondendo diretamente à pergunta original — **"pode ter algum problema de centavos que acumula durante o mês e vira um problema maior?"**:

- Sim, existe um padrão real de arredondamento por item (achado 1) que gera pequenas diferenças (frações de centavo por item) entre o total lançado e qualquer recomputação "por fora" a partir de agregados — confirmado com um caso real de R$ 0,53 de diferença em 11 OS. Esse padrão **não cresce sem limite** e não é, por si só, capaz de explicar diferenças de centenas ou milhares de reais.
- A diferença grande observada em produção hoje (R$ 7.130,99 zerados, e R$ 1.006,50 de gap num único funcionário/mês) **não vem de arredondamento** — vem do bug de recálculo manual descrito no achado 4, que é uma prioridade maior do que qualquer ajuste fino de centavos.
