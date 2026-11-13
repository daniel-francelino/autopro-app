# Auditoria completa do fluxo de comissões — relatório consolidado

Data: 2026-11-13 · Motivação: o cliente reclama que as comissões "não estão dando certo".

> **Atualização (fase 2, dados de produção):** os achados abaixo foram verificados contra um snapshot somente leitura de produção (2026-11-13). **A seção 9 traz o que foi confirmado, o que não ocorre hoje e as prioridades revisadas; ela prevalece sobre a ordem de severidade das seções 2 e 3, que são baseadas só em código.** Em especial, a causa "pagamento parcial" (T1) não ocorre hoje, porque não existe parcela parcial.
>
> **Validação independente (2026-11-13, código + banco de produção, somente leitura):** a seção 9.10 lista o que foi confirmado e o que foi corrigido nesta revisão. Correção principal: o pagamento em duplicidade por comissão paga apagada (PD-01) **continua acontecendo em novembro** (R$ 1.640,85 ao Anderson, com débito bancário). A leitura anterior de que "a comissão não nasce" estava errada.

## 1. Escopo e método

Quatro análises independentes, todas **estáticas** (leitura de código). Nenhum código foi alterado, nenhum teste foi executado e nenhum dado real foi acessado.

| Frente | Agente | Achados | Relatório detalhado |
|---|---|---|---|
| Regras de negócio | business-analyst | BR-01..BR-17 | [01-regras-de-negocio.md](01-regras-de-negocio.md) |
| Cálculo financeiro | financial-auditor | FC-01..FC-14 | [02-calculo-financeiro.md](02-calculo-financeiro.md) |
| Integridade de dados | data-integrity-auditor | DI-01..DI-15 (+3 hipóteses) | [../../../data-integrity/audits/comissoes-integridade.md](../../../data-integrity/audits/comissoes-integridade.md) |
| Bugs no código | code-reviewer | CR-01..CR-17 | [../../../reviews/code/comissoes-bugs.md](../../../reviews/code/comissoes-bugs.md) |

Este documento agrupa os achados por **tema**, porque vários agentes encontraram o mesmo defeito por ângulos diferentes. Evidência (arquivo:linha) e exemplos numéricos estão nos relatórios detalhados. Parte das linhas citadas lá é aproximada. Várias falhas já constam em `docs/testing/known-failures.md` (KF-24 a KF-44).

## 2. Resumo executivo

A reclamação do cliente tem causas concretas e confirmadas por mais de uma frente. As principais:

1. **Comissão "faltando" em recebimento parcial.** A comissão só é gerada quando a parcela está `paid`; pagamento parcial libera zero (OS de 1000 com 600 recebidos libera 0 em vez de 60).
2. **Valores que mudam sozinhos.** O override manual substitui todas as regras no ajuste e depois, nos pagamentos seguintes, só as categorias do override. Exemplo: 75 vira 275.
3. **Comissão desatualizada após editar a OS.** Editar uma OS já liberada não reconcilia as comissões pendentes.
4. **Pagamento de comissão sem proteção.** Duplo clique pode debitar o banco duas vezes. A geração de comissão também não tem trava e pode duplicar.
5. **Comissão paga pode ser apagada** (excluir comissão, cancelar ou excluir OS), com regras contraditórias entre fluxos. Faltam estados de estorno e cancelamento.
6. **Relatório que não bate** com os totais (bônus misturados, soft-deletados, filtros e datas inconsistentes).

Severidade geral: **alta** em dinheiro e integridade, porque o pagamento de comissão movimenta saldo bancário.

## 3. Achados por tema (ordenados por impacto)

### T1 — Pagamento parcial não gera comissão · ALTA
Achados: BR-04, FC-01, DI-04, KF-24.
O cálculo só conta parcelas com status `paid`. É a causa mais provável da reclamação "comissão faltando".
**Decisão de negócio necessária:** a comissão deve ser proporcional ao valor recebido, inclusive em parcela parcial?

### T2 — Override manual instável · ALTA
Achados: FC-02, CR-04, FC-03.
Aplicar o override usa só as regras do plano escolhido; as liberações seguintes usam override mais regras padrão. O valor sobe sozinho. Além disso, a regra padrão do override não vence a regra específica do plano padrão, ao contrário do que diz o comentário no código.
**Decisão de produto (FC-03):** a regra padrão de um override deve vencer a regra específica do plano padrão?

### T3 — Edição da OS não reconcilia comissões · ALTA
Achados: BR-06, FC-05, DI-05, KF-38.
A edição recalcula `commission_amount` da OS, mas não os registros de comissão pendentes. Se forem pagos antes do próximo recebimento, sai pagamento a maior. Não há bloqueio para OS paga, e `status` e `total_amount` vêm do cliente.

### T4 — Concorrência e atomicidade no pagamento e na geração · CRÍTICA/ALTA
Achados: DI-01, DI-03, FC-07, CR-01, CR-02, CR-15.
- Pagar comissão (individual e em lote) verifica o status antes (`pay.post.ts:48`, `pay-commissions-bulk.post.ts:103`), mas o update não é condicional nem atômico (check-then-act). Duas requisições simultâneas passam pela checagem, criam duas despesas e debitam o banco duas vezes.
- O pagamento em lote não checa erro nos inserts de transação e extrato nem no update do saldo. Pode ficar "paga" sem lançamento, ou com saldo debitado sem lançamento.
- `releaseServiceOrderCommissions` não tem transação, lock nem UNIQUE: dois pagamentos simultâneos geram comissão em dobro. O recálculo tem a mesma corrida.

### T5 — Exclusão, cancelamento e estorno de comissão paga · ALTA
Achados: BR-01, BR-02, BR-03, FC-08, FC-09, CR-03, DI-02, DI-08, DI-09.
- Só existem os estados `pending` e `paid`. "Cancelar" e "estornar" significam apagar a linha, e não há fluxo de estorno de comissão paga.
- `DELETE /reports/commissions/:id` apaga comissão paga sem estornar despesa e banco, deixando registros órfãos. A pendente volta no próximo recebimento.
- Cancelar OS e excluir OS apagam comissão paga e devolvem o valor ao saldo, embora o dinheiro já tenha saído. `payment.delete.ts` bloqueia o mesmo caso com 409: as regras se contradizem.
- O estorno automático de comissão pendente apaga ou altera registros sem checar o status.

### T6 — Comissão pendente órfã e zero silencioso · ALTA/MÉDIA
Achados: BR-08, BR-09, FC-10, CR-05, DI-06, DI-07, KF-25/26.
- Quem sai da OS, ou perde o direito, fica com comissão pendente para sempre.
- Funcionário sem regra aplicável ou item sem categoria sem regra padrão recebe zero, sem aviso.
- A consulta dos registros existentes ignora `deleted_at`.

### T7 — Recálculo manual destrutivo · ALTA
Achados: BR-09, KF-36.
O recálculo manual apaga pendentes sem confirmação. O relatório de regras cita um incidente de 10/09/2026 de R$ 7.130,99.

### T8 — Regras mutáveis afetam OS antigas · MÉDIA
Achados: BR-05, BR-07, BR-10, BR-11, BR-12, CR-16.
- A atribuição de plano não tem vigência. Cada liberação recalcula com a regra atual, então excluir ou inativar o plano muda OS antigas.
- O modo de liberação `full` é irreversível, libera 100% sem recebimento e fica gravado mesmo após falha ou cancelamento do pagamento (DI-10).
- Conflito entre planos só é validado na atribuição, não ao publicar versão. `effectiveFrom` não é validado no servidor.
- O valor fixo mudou para "por unidade vendida". Rateio de desconto e imposto é por funcionário. Não há regra encontrada para devolução.

### T9 — Relatório de comissões inconsistente · MÉDIA
Achados: FC-11, CR-06, CR-07, CR-08, CR-13, CR-14, BR-17.
- Inclui bônus e registros soft-deletados (falta `deleted_at`), agrupa por nome e não arredonda: gráfico e count divergem do KPI.
- Filtro e ordenação usam a data de entrada da OS, mas a coluna exibida é `reference_date`.
- O filtro "Sem pagamento" nunca casa (`no_payment_method` contra `no_payment`).
- O detalhe mostra o cálculo só do primeiro item. A documentação está desatualizada.

### T10 — Qualidade de pagamento e interface · MÉDIA/BAIXA
Achados: CR-09, CR-10, CR-11, CR-12, BR-14, FC-04, FC-06, FC-12..14, DI-11..15, CR-17.
- Toast diz sucesso mesmo com falhas no lote; exclusão em lote não trata falha parcial.
- Data de pagamento em UTC: após 21h BRT vira o dia seguinte (hipótese, depende do fuso do servidor).
- O pagamento individual usa a primeira conta ativa, sem escolha. Não há checagem do estado da OS, nem fechamento ou aprovação.
- Arredondamento perde meio centavo (20,10 × 5% dá 1,00 em vez de 1,01).
- `total_amount` vem do navegador sem recálculo no servidor (parte do impacto é hipótese).
- A taxa do plano é `numeric(15,2)`. Algumas escritas não filtram `organization_id` (sem exploração direta hoje). O log de ajustes manuais perde entradas em concorrência.

## 4. Hipóteses a confirmar (não comprovadas)

- H-01: despesa de comissão excluída no Financeiro pode deixar a comissão "paga".
- H-02: o sinal não libera comissão até o process-payment.
- H-03: OS antigas podem ter ficado sem regra após o drop das colunas legadas.
- Fuso horário (CR-11) e impacto de `total_amount` do cliente (FC-06).

## 5. Decisões de negócio pendentes (bloqueiam a correção)

1. Pagamento parcial de parcela gera comissão proporcional? (T1)
2. Precedência entre regra padrão do override e regra específica do plano padrão. (T2)
3. Comissão paga pode ser estornada? Qual fluxo e quais estados (cancelada, estornada)? (T5)
4. A atribuição de plano passa a ter vigência, ou OS antigas devem ser congeladas? (T8)
5. Política para funcionário sem regra: bloquear, alertar ou regra padrão? (T6)

## 6. Plano de correção sugerido

**Fase 0 — mitigação imediata (baixo risco)**
- Exigir confirmação no recálculo manual e registrar o que será apagado (T7).
- Exigir `status='pending'` no pagamento, com update condicional ou transação (T4).
- Verificar erro nos inserts do pagamento em lote (CR-01).

**Fase 1 — corrigir o que o cliente sente**
- T1 (após decisão), T2, T3, T6.
- Consertar o relatório: filtro `deleted_at`, filtro de data, `no_payment`, totais (T9).

**Fase 2 — integridade estrutural**
- UNIQUE e transação na geração de comissão (DI-01); estados de estorno e cancelamento (T5); unificar a regra de exclusão e cancelamento entre fluxos.

**Fase 3 — robustez**
- Vigência de atribuição, validação de versões, T10.

**Diagnóstico com dados reais.** O relatório de integridade traz consultas somente leitura (duplicatas, órfãs, divergências, pagas sem transação). Rodá-las em ambiente autorizado mede o impacto real no cliente antes da correção.

## 7. Lacunas de teste

- Nenhuma rota `/api/commissions/*` tem teste dedicado.
- Faltam testes de filtros, ordenação e paginação do relatório.
- Faltam testes de falha de insert no pagamento em lote, concorrência, exclusão de comissão paga, override com categorias, fuso horário e detalhe com vários itens.
- Faltam testes de frontend (toasts, seleção).
- O relatório de cálculo traz uma tabela de testes de regressão por achado.

## 9. Fase 2 — verificação com dados de produção (snapshot 2026-11-13, somente leitura)

Base: 2.323 comissões, R$ 248.734,01 no total (R$ 206.057,62 pagas e R$ 42.676,39 pendentes), 1.348 OS. Relatórios: [03-producao-regras-de-negocio.md](03-producao-regras-de-negocio.md) (PB), [04-producao-calculo-financeiro.md](04-producao-calculo-financeiro.md) (PF), [comissoes-integridade-producao.md](../../../data-integrity/audits/comissoes-integridade-producao.md) (PD), [comissoes-bugs-producao.md](../../../reviews/code/comissoes-bugs-producao.md) (PC). Só agregados; nenhum dado pessoal nos relatórios.

### 9.1 Confirmado nos dados

| Tema | Evidência real | Impacto | Origem |
|---|---|---|---|
| **Recálculo manual / limpeza de 10/09** (T7) | **Corrigido após análise detalhada (ver 9.8).** As 21 entradas zeradas (R$ 7.130,99) foram feitas por um usuário interno (suporte da migração) com o motivo "Migração do sistema", e não por recálculo do cliente. Em 20 dos 21 casos (R$ 7.107,59) o mesmo valor reaparece em outro registro da mesma OS; só a OS4985 (R$ 23,40) ficou sem comissão. O que o cliente fez foram 12 recálculos em 09/09 e 10/09 no cadastro duplicado "Anderson 2" e 18 em 25/08 a 02/09, quase todos com o motivo "não confere com o relatório". | Alta. A causa de fundo é o cadastro duplicado de funcionário, não perda de dinheiro. | PB-01 (reinterpretado), PB-02, PD-05 |
| **Pagamento de comissão apagado e pago de novo** (T4/T5) | 16 registros pagos apagados fisicamente (R$ 4.301,11), 14 deles com saída de dinheiro. Em 14 casos a comissão foi gerada e paga de novo: duplicidade de R$ 3.337,74. Agosto/2026: R$ 1.696,89 (OS4739, OS4757, OS4795, OS4819, OS4838). **Novembro/2026: R$ 1.640,85** (Anderson, OS5209 e OS5235, pagos em 06/11 e de novo em 12/11, com extrato nas duas vezes; validado em 9.10). Os 2 restantes (R$ 805,20, fevereiro) não têm extrato. | Crítica. Sem trilha de quem apagou: `audit_logs` não registra essas escritas. | PD-01, 9.10 |
| **Despesa em dobro** (T4) | 14 comissões têm 2 despesas ativas cada, criadas com segundos a poucos minutos de diferença, todas de 23/02/2026. São R$ 2.555,29 a mais em despesa, que inflam relatórios e DRE. Nenhuma das 28 despesas tem extrato, então não dá para afirmar se o saldo foi debitado duas vezes. | Alta | PF-01, PD-02, PC-01 |
| **Edição da OS depois da liberação** (T3) | 68 pares OS × funcionário foram editados depois da liberação. Foram pagos R$ 1.272,54 acima do valor atual. A OS4947 ainda está pendente e pode ser corrigida sem estorno. | Média | PF-02, PD-04 |
| **Modo `full` em uso** (T8) | 458 OS (34%). Em 17 OS sem nenhum recebimento já há R$ 5.953,30 de comissão, dos quais R$ 4.247,35 pagos. Contando OS em `full` ainda não quitadas (inclui as com recebimento parcial), são 19 OS e R$ 4.900,35 pagos. | Alta | PB-07 |
| **Comissões legadas e sem rastreio** (T8) | 82% das comissões (R$ 202.342,28) não têm regra nem snapshot. Depois de 19/08 ainda foram criados 135 registros (R$ 10.864,10) sem plano. | Média | PB-10 |
| **Mudança de regras em 08/2026 divergindo do histórico** (T8) | Pelas regras atuais, 669 de 2.580 pares divergem do que foi gravado (+R$ 65.277,39 / −R$ 25.493,97). A causa é a troca de modelo e de atribuições, não erro de conta. Um "Recalcular" ou novo recebimento nessas OS geraria novas diferenças. | Alta (risco latente) | PF-03 |
| **Falta de regra padrão** (T6) | 19 de 26 versões de plano não têm regra default. Há 80 de 697 pares OS × funcionário pós-migração com itens sem regra (R$ 177.330 em itens sem comissão). Pode ser intencional e precisa de confirmação do cliente. | Média/Alta | PB-05 |
| **Relatório inconsistente** (T9) | O gráfico por funcionário soma R$ 500 a mais que o resumo (bônus excluído sem filtro). O total sai com ruído de ponto flutuante. 1.140 comissões pagas (R$ 121.221,25) foram pagas em mês diferente da entrada da OS. O filtro "Sem pagamento" nunca acha as 203 OS sem forma de pagamento, e boleto (48) e cheque (64) não têm opção no filtro. 11 registros (R$ 1.480,97) têm `reference_date` em outro mês. | Média | PF-05, PC-04, PC-05, PC-06 |
| **Detalhe da comissão mostra o item errado** (T9) | 82,6% das comissões (R$ 230.351,53) estão em OS com vários itens e nenhum `item_name` casa com um item. | Média | PC-03 |
| **Data de pagamento deslocada** (T10) | 186 pagamentos às 21h BRT têm `payment_date` no dia seguinte (R$ 17.225,33). | Média | PC-02 |
| **Duplicata pontual** (T4) | OS29: comissão paga e pendente de R$ 81,22 criadas com 1 segundo de diferença. | Média | PD-03 |
| **Comissão pendente em estoque** | 336 pendentes somando R$ 42.676,39, a maioria em OS já quitadas. | Informativo | PB |

### 9.2 Não ocorre hoje (ou impacto desprezível)

- **Pagamento parcial (T1 / FC-01 / BR-04 / DI-04 / KF-24):** não existe nenhuma parcela `partial`. Só há R$ 264,03 de direito em 21 OS com recebimento e sem comissão. **Isso derruba a hipótese de causa principal da fase 1.**
- **Override manual (T2 / FC-02 / FC-03 / CR-04):** nunca foi usado.
- **Comissões em OS cancelada ou excluída, e pendentes de funcionário removido da OS (T5/T6):** nenhuma ocorrência relevante (só 1 pendente sem OS, de R$ 35).
- **Pagas sem transação, com transação apagada ou com valor divergente:** nenhuma.
- **Mistura entre organizações:** nenhuma.
- **Conflito de categoria entre planos e `effectiveFrom` irregular:** nenhum.
- **Arredondamento (FC-04):** confirmado, mas R$ 0,50 em 50 itens; irrelevante.

### 9.3 Inconclusivo, precisa de apuração (não afirmar como erro)

- **PB-03:** 2 funcionários desligados só têm atribuição a plano excluído, e 40 OS (R$ 36.232 recebidos) não têm comissão registrada. É hipótese que seja indevido.
- **PB-06:** em OS com mais de um responsável, o valor registrado de um funcionário é o que o motor atual calcularia para o outro. Sugere troca de regras e precisa de apuração.
- **PD-06 / PC-13 (números validados em 9.10):** 425 comissões pagas (R$ 47.207,79, pagas de set/2025 a mar/2026) têm despesa sem extrato bancário. Somando as 14 despesas duplicadas de fevereiro, são 439 despesas de comissão (R$ 49.763,08). O número anterior de PD-06 (441 / R$ 57.763,08) incluía 2 despesas de salário (R$ 8.000). O código do pagamento individual só passou a mover saldo depois disso (comentário em `pay.post.ts:29`). Confirmar com o financeiro se o saldo real reflete esses pagamentos.
- **PD-07 / PF:** em 5 de 7 contas o saldo inicial mais os movimentos não dá o saldo atual, com 342 quebras no encadeamento do extrato. Fora do escopo de comissões; encaminhar ao financeiro.
- **PF-04:** 255 pares (R$ 24.342,82, todos já pagos) estão em OS do modelo antigo, sem parcelas. Recalcular essas OS seria perigoso.
- **CR-12** (conta de origem do pagamento; 25 pagamentos, R$ 2.479,77, sem conta), **CR-15** (22 OS com R$ 242,98 acima do `commission_amount`) e **FC-06** (5 OS antigas com `total_amount` divergente).
- **PD-08 (confirmado em 9.10):** as 5 colunas legadas de comissão ainda existem em `employees` na produção. A migration `20240101000099_drop_legacy_employee_commission_columns.sql` não foi aplicada. O cabeçalho dela pede que só seja aplicada depois do deploy do código que deixou de ler essas colunas.

### 9.4 Divergências entre os relatórios

- A 14 comissões com despesa em dobro aparecem em PC-01, PF-01 e PD-02 como o mesmo caso. PD-02 afirma que o saldo não foi debitado duas vezes; PF-01 diz que não dá para saber, porque essas despesas não têm extrato. **Vale a leitura mais cautelosa: inconclusivo até o financeiro conferir.**
- PD-01 (16 pagamentos apagados e pagos de novo, R$ 3.337,74 de duplicidade provável) é um caso **diferente** do anterior: os registros foram apagados fisicamente e recriados.
- Os totais de PB-04, PB-05 e PB-06 são aproximados: a reconstrução usa o plano atual e não desconta taxa de maquininha.

### 9.5 Leitura para o cliente

A reclamação "as comissões não estão dando certo" é melhor explicada pelos dados por quatro causas, em ordem de peso:
1. **Falta de confiança nos valores, que leva a recálculos manuais** (111 recálculos). Parte vem do cadastro duplicado de funcionário (9.8). Outra parte vem do relatório, que filtra pela data de entrada da OS no mês corrente e por isso "esconde" comissões existentes (9.10). A zeragem de R$ 7.130,99 em 10/09 foi limpeza interna, não perda.
2. **Mudança de regras e de atribuições em 08/2026**, que fez 669 de 2.580 pares divergirem do que foi gravado.
3. **Pagamentos duplicados ou refeitos:** R$ 3.337,74 em comissão paga apagada e repaga (R$ 1.640,85 deles em novembro, ainda em curso) e R$ 2.555,29 em despesa lançada em dobro em fevereiro.
4. **OS editadas depois de pagas** (R$ 1.272,54 a mais) e **relatório que não bate** com o caixa e com o resumo.

### 9.6 Prioridades revisadas

1. **Conter o dano agora (Fase 0):** **bloquear exclusão de comissão paga** (`DELETE /api/reports/commissions/:id`), que segue gerando pagamento em duplicidade em novembro; trocar o delete físico de comissão por soft delete; exigir confirmação e registrar o que será apagado no recálculo manual; update condicional `status='pending'` e proteção contra duplo clique no pagamento; fazer `audit_logs` registrar as escritas de OS e de comissão.
2. **Apurar o passivo financeiro:** conferir com o financeiro as 14 despesas em dobro (R$ 2.555,29), os 16 pagamentos apagados e refeitos (R$ 4.301,11 / R$ 3.337,74, dos quais R$ 1.640,85 em novembro), as 17 OS em modo `full` sem recebimento (R$ 4.247,35 pagos), as 425 pagas sem extrato e o recebível de R$ 6.000 apagado na OS5235. As correções de dado são **propostas, nunca executadas** nesta auditoria.
3. **Decisões de negócio** (a lista da seção 5 muda): a de pagamento parcial deixa de ser urgente; passam a ser urgentes (a) o que fazer com OS antigas quando o plano muda (congelar versus recalcular), (b) política para itens sem regra padrão, (c) fim ou restrição do modo `full`.
4. **Corrigir o relatório:** filtro `deleted_at`/bônus, filtro "Sem pagamento", opções boleto e cheque, fuso horário do `payment_date`, detalhe por item, `reference_date`.
5. **Fase 2 e 3 do plano original** (UNIQUE e transação na geração, estados de estorno, vigência de atribuição).

### 9.7 Limitações da fase 2

- Snapshot de um instante; sem histórico de edições além do log de recálculo da OS. A tabela `audit_logs` existe desde 09/11/2026 12:46 UTC, mas até 13/11 só registrou 35 escritas, todas de `/api/users/*`. Escritas de OS, parcelas e comissões não aparecem nela.
- Remoções físicas não deixam rastro no banco; o incidente de 10/09 só foi reconstruído pelo log da OS.
- Reconstrução do direito usa o plano atual e não considera taxa de maquininha.
- Os JSONs exportados com dados pessoais estão no scratchpad da sessão e devem ser apagados ao final.

### 9.8 Correção: o que realmente aconteceu em 10/09 (análise do log de ajustes, últimos 3 meses)

Fonte: `commission_recalculation_log` (28 entradas, 24/08 a 02/09) e `commission_manual_adjustments_log` (83 entradas, 09/09 a 11/11) das OS, cruzados com os registros atuais. Isto **corrige** a leitura de PB-01 ("R$ 7.130,99 apagados"): as 21 zeragens foram uma limpeza feita por um usuário interno (suporte da migração, motivo "Migração do sistema"), no cadastro duplicado "Anderson 2".

- **Causa de fundo:** cadastro duplicado de funcionário vindo da migração. "Anderson 2" (criado em 15/12/2025) coexiste com o cadastro principal do Anderson, e "Lucas 2" (criado em 15/07/2026) não tem cadastro-base ativo. Os gêmeos têm atribuição de plano própria, então o motor calcula e grava a mesma comissão para os dois. O cliente reclama exatamente disso: "ordem com dois valores de comissão" e "não está constando no relatório para o Anderson".
- **O cliente recalculava o gêmeo e recebia o valor do outro.** Em 09/09 e 10/09 houve 10 recálculos em "Anderson 2" cujo novo valor é o do cadastro principal (ex.: OS4727 609,55 → 690,82). O próprio motor reproduz a duplicidade.
- **A limpeza de 10/09 retirou as duplicatas.** Em 8 OS conferidas, a soma dos registros vivos bate com o `commission_amount` da OS depois da zeragem. Valor residual sem destino: OS4985, R$ 23,40.
- **O cadastro duplicado ainda tem 162 comissões pagas (R$ 39.974,00, com pagamentos de 23/02 a 07/08/2026).** O pagamento do Anderson está dividido entre dois cadastros e o relatório por funcionário mostra duas pessoas. Em 94 OS os dois cadastros têm registro, sem nenhum par de mesmo valor; o excesso total de comissão sobre a OS é só R$ 242,98 em 22 OS, então não há pagamento em dobro sistemático.
- **Recálculos do cliente em 25/08 a 02/09:** 15 reduziram o valor do "Lucas 2" em 4% a 21% (ex.: 167,25 → 135,45), todos ainda pendentes. A redução uniforme sugere mudança da base de cálculo do motor novo (hipótese).

### 9.9 Recorte: depois da limpeza de 10/09 (11/09 a 13/11/2026)

Fonte: snapshot de produção, somente leitura. Sem nomes; funcionários por iniciais. `service_order_edit_logs` está vazio nesse período, então edições de OS não puderam ser auditadas.

**Estável desde 10/09:** nenhuma atribuição ou plano foi alterado; 422 comissões novas (R$ 54.780,92) em 256 OS novas, sem nenhuma duplicata; as 349 comissões pagas (R$ 38.216,04) têm uma única despesa de mesmo valor; nenhuma despesa de comissão foi apagada; o cadastro "Anderson 2" não gerou mais registros; nas 159 OS quitadas todo responsável tem comissão. Os pagamentos duplicados de fevereiro (duas despesas para o mesmo registro) não se repetiram. **Correção (9.10):** o padrão de agosto (comissão paga apagada e paga de novo) **se repetiu em novembro**. Esta checagem não o detectou porque olhava só os registros vivos, e a despesa original fica órfã (`employee_financial_record_id = NULL`).

**Problemas do período:**
1. **Modo `full` paga comissão de OS não recebida.** 18 OS têm R$ 4.702,35 de comissão paga com a OS sem quitação (16 com R$ 0 recebido). 14 vieram em lote em 06/11. Maiores: OS5209 (R$ 11.500, recebido 0, R$ 1.394,80 pagos), OS5235 (R$ 6.000, R$ 588,05), OS5011 e OS5246. 154 das 256 OS novas (60%) entraram em modo `full`, que só é ativado por marcação no pagamento e não se desfaz.
2. **Recálculos de 11/11 (corrigido em 9.10).** Os 5 registros de 11/11 (R$ 3.561,90) **não** são comissões que deixaram de nascer. Moacir (OS5043 R$ 485,40, OS5209 R$ 1.138,00, OS5235 R$ 297,65): o registro pendente já existia (`previous_amount` igual ao novo valor), e o recálculo só o recriou. O cliente não o via no relatório, provavelmente pelo filtro de período por data de entrada da OS. Anderson (OS5209 R$ 1.234,30, OS5235 R$ 406,55): a comissão **tinha sido paga em 06/11**, foi apagada e foi paga de novo em 12/11, totalizando **R$ 1.640,85 em duplicidade**.
3. **O cliente apaga parcelas para forçar a comissão.** OS5225 (06/11, R$ 710: "vou ter que lançar novamente o pagamento devido a não constar no relatório de comissão") e OS5235 (11/11, R$ 6.000: "as comissões estão com divergência"). As duas parcelas apagadas estavam **pendentes**, então não houve entrada dupla no caixa. A OS5235 ficou **sem nenhuma parcela ativa** (o recebível sumiu), com R$ 588,05 de comissão paga, mais os R$ 559,50 pagos e apagados.
4. **Geração atrasada em OS quitadas no modo proporcional:** 4 de 7 OS tiveram a comissão criada de 2 a 7 dias depois do pagamento (OS5221, OS5201, OS5208, OS5170). Amostra pequena; pode ser data de pagamento lançada depois.
5. **Comissões do Anderson sem regra gravada (28, R$ 12.757,07):** não são legado. O Anderson tem **um** plano ativo ("Gerente"; o pessoal está excluído) com **duas regras** (20% e 9%), e o motor deixa a regra nula quando mais de uma regra contribui (service-order-commissions.ts, comentário em 143-147).
6. **Desvios pequenos:** 4 OS com comissão acima da OS (R$ 15,44, ex.: OS5255, OS5246, OS5242, OS5120); 28 registros sem regra gravada.

**Detalhamento dos pontos 2 a 6:** ver [05-pistas-reclamacao-cliente-pos-10-09.md](05-pistas-reclamacao-cliente-pos-10-09.md), com cronologia por OS, hipóteses, o que verificar e perguntas para o cliente.

**Colunas legadas:** confirmado em 9.10. As colunas existem em `employees` na produção (migration 099 não aplicada), mas o motor não as lê mais.

### 9.10 Validação independente (2026-11-13)

Método: leitura do código e consultas somente leitura (apenas `select`) no banco de produção com a chave de serviço do `.env`. Nenhum dado foi alterado. Os totais da base batem exatamente com a fase 2 (2.323 comissões, R$ 248.734,01; R$ 206.057,62 pagas; R$ 42.676,39 pendentes).

**Confirmado sem ressalvas:** PD-01 (16 despesas órfãs, R$ 4.301,11; 14 com extrato; R$ 3.337,74 de sobreposição, recalculado OS a OS), PD-02/PF-01/PC-01 (14 registros com 2 despesas, R$ 2.555,29, todas de 23/02/2026, nenhuma com extrato), PB-07 (17 OS em `full` sem recebimento, R$ 4.247,35 pagos), cadastro duplicado "Anderson 2" (162 pagas, R$ 39.974,00), 28 comissões do Anderson sem regra (R$ 12.757,07), PD-08 (colunas legadas presentes), CR-03/DI-08 (o `DELETE` de comissão apaga registro pago sem estorno, `server/api/reports/commissions/[id].delete.ts`), CR-07 (o relatório filtra pela entrada da OS, com período padrão no mês corrente), CR-11 (`payment_date` padrão em UTC, `pay.post.ts:52`).

**Corrigido nesta revisão:**

| Afirmação anterior | Correção | Evidência |
|---|---|---|
| 9.9: "a alegação de PD-01 sobre novembro não foi reproduzida" | Reproduzida. Anderson recebeu R$ 1.234,30 duas vezes na OS5209 e R$ 559,50 + R$ 406,55 na OS5235 (06/11 e 12/11), com extrato nas quatro despesas (conta `d87834c0`). Excesso: R$ 1.640,85. | Despesas de 06/11 com `employee_financial_record_id = NULL` (FK `ON DELETE SET NULL`); log de recálculo de 11/11 com `previous_amount = 0` |
| Doc 05: "o valor anterior do log não é o valor do registro" e "a comissão do Moacir não nasceu" | `previous_amount` é a soma dos registros existentes (`service-order-commissions.ts:512,571`). O Moacir já tinha pendente com o mesmo valor; o recálculo só apaga e recria (`:525-532`). O problema é de **visibilidade no relatório**, não de geração. | Log de ajustes das OS5043, OS5209 e OS5235 |
| Doc 05: "conferir se a OS5225 tem entrada dupla no caixa" | As parcelas apagadas (OS5225 e OS5235) estavam **pendentes**. Não há entrada dupla. | `service_order_installments` com `status = pending` no momento da exclusão |
| Doc 05 / 9.9: "Anderson tem dois planos que somam" | Um plano ativo ("Gerente") com duas regras (20% e 9%). O plano pessoal está excluído. | Atribuições e regras de plano |
| PD-06: 441 despesas, R$ 57.763,08 sem extrato | Incluía 2 despesas de salário (R$ 8.000). Comissão: 425 pagas (R$ 47.207,79), ou 439 despesas (R$ 49.763,08) com as duplicadas. | Junção despesa → registro → `record_type` |
| T4: "pagamento não exige status pendente" | Exige, mas sem atomicidade (check-then-act). O risco de corrida continua. | `pay.post.ts:48,143-155`; `pay-commissions-bulk.post.ts:103,178` |
| 9.7: "sem log de auditoria" | `audit_logs` existe desde 09/11, mas não registra escritas de OS e de comissão (35 escritas, todas `/api/users/*`). É uma lacuna própria, a corrigir. | Contagem por rota em `audit_logs` |
| Números de modo `full` divergentes (17 OS / R$ 4.247,35 contra 18 OS / R$ 4.702,35) | Os dois estão certos, com definições diferentes: "recebido = 0" contra "OS não quitada". | Recalculado |

**Privacidade:** nomes completos de funcionários e do usuário interno foram trocados por primeiro nome ou papel neste documento.

## 10. Limites desta auditoria

Não cobertos ou cobertos só superficialmente: comissões de venda sem OS/PDV (`sales-item-commissions`), `employee-commission-report`, `preview.post`, `index.get`, páginas `financial/commissions`, prioridade entre regras de vários planos, preview no frontend, bônus, e dados reais/backfill do cliente. Permissões e isolamento por organização estão consistentes nas rotas lidas, sem bypass confirmado, mas não é uma auditoria de segurança.
