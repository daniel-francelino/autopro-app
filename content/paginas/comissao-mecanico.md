---
title: Como calcular comissão de mecânico
description: 'Entenda como calcular a comissão de mecânico (percentual sobre faturamento ou lucro, ou valor fixo por unidade) e como o AutoPro automatiza regras por categoria, bônus por meta e pagamento em lote.'
answer: 'A comissão de mecânico costuma ser um percentual sobre o valor faturado ou sobre o lucro do serviço, ou um valor fixo por unidade. No AutoPro você cadastra as regras uma vez, atribui aos funcionários e o sistema calcula a comissão de cada item da ordem de serviço.'
updatedAt: '2026-11-08'
related:
  - ordem-de-servico-oficina
  - controle-financeiro-oficina
  - sistema-para-oficina-mecanica
faq:
  - label: 'Como calcular a comissão de um mecânico?'
    content: 'Defina a regra (percentual ou valor fixo) e a base de cálculo. Em percentual sobre faturamento, multiplique o valor do item pelo percentual. Em percentual sobre lucro, use o valor do item menos o custo. Em valor fixo, multiplique o valor pela quantidade de unidades. O AutoPro faz esse cálculo por item da OS.'
  - label: 'O AutoPro permite comissões diferentes por categoria?'
    content: 'Sim. Cada plano de comissão pode ter uma regra para cada categoria de produto ou serviço, além de uma regra padrão para o que não tiver regra específica.'
  - label: 'Se eu mudar uma regra, as comissões antigas mudam?'
    content: 'Não. As regras têm versões com data de início. Comissões já geradas guardam um registro de como foram calculadas e não são alteradas quando a regra muda.'
  - label: 'Dá para pagar várias comissões de uma vez?'
    content: 'Sim. O AutoPro permite pagar comissões em lote pelo Financeiro.'
  - label: 'O AutoPro calcula bônus por meta?'
    content: 'Sim. Em Financeiro > Bônus você define a base de cálculo, a meta a bater e o valor do bônus, atribui aos funcionários e gera os registros dos que atingiram a meta.'
---

## Os três jeitos mais comuns de calcular comissão

A comissão de um mecânico normalmente segue uma destas formas:

| Tipo | Como calcula | Exemplo |
|---|---|---|
| Percentual sobre o **faturamento** | Valor do item × percentual | Serviço de R$ 400 com comissão de 10% → R$ 40 |
| Percentual sobre o **lucro** | (Valor do item − custo) × percentual | Peça vendida a R$ 300 com custo de R$ 200 e comissão de 20% sobre o lucro → R$ 20 |
| **Valor fixo** por unidade | Valor fixo × quantidade | R$ 15 por troca de óleo, 4 trocas → R$ 60 |

Os números acima são exemplos de cálculo, não valores recomendados. Percentuais e bases variam de oficina para oficina e devem respeitar o combinado com cada funcionário e a orientação do seu contador.

## Como o AutoPro calcula

No AutoPro as comissões ficam em **Financeiro > Comissões**:

1. **Crie um plano de comissão** com um nome e uma ou mais regras.
2. **Defina as regras:** tipo (percentual ou valor fixo), taxa ou valor e, no percentual, a base (faturamento ou lucro). Você pode criar uma regra por categoria e uma **regra padrão** para as demais.
3. **Atribua o plano** a um ou mais funcionários.
4. **Trabalhe normalmente:** a cada item da ordem de serviço, o sistema mostra a comissão de cada responsável. Quando o pagamento da OS é registrado, as comissões são liberadas.

### Regras que mudam ao longo do tempo

Cada plano guarda **versões** com data de início. Quando você altera uma taxa, a nova versão vale a partir da data escolhida e as comissões já geradas continuam explicáveis pela regra que as originou.

### Ajuste manual com registro

Quando é preciso corrigir uma comissão específica, o ajuste manual é feito com registro do que foi alterado.

### Pagamento em lote

As comissões liberadas podem ser pagas em lote pelo Financeiro, e há um relatório de comissões para conferência.

## Bônus por meta

Além da comissão, o AutoPro tem **bônus por meta** em Financeiro > Bônus. Você escolhe a base de cálculo (faturamento bruto, faturamento menos peças, lucro ou lucro líquido do funcionário), a meta a bater, o valor do bônus e a data a partir da qual ele vale, e atribui aos funcionários. Os registros dos que bateram a meta são gerados e aparecem junto das comissões nos relatórios.

## Limites a conhecer

- A comissão depende das regras cadastradas; o sistema não sugere percentuais.
- Os relatórios avançados fazem parte dos planos Pro e Fiscal. Veja os [planos](/pricing).
- Cálculos trabalhistas e tributários sobre comissão (reflexos, encargos) não são feitos pelo AutoPro; consulte seu contador.
