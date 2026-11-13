# Auditoria de Comissões — 04. Cálculo Financeiro com Dados de Produção

- **Data:** 2026-11-13. Snapshot exportado pela sessão principal em 2026-11-13.
- **Origem:** findings FC-01 a FC-14 de `02-calculo-financeiro.md`.
- **Acesso aos dados:** somente leitura e offline. Os JSONs foram exportados pela sessão principal; a leitura em produção foi autorizada pelo usuário, conforme repassado pelo coordenador. Este agente não acessou rede nem banco: o acesso direto via helper foi negado pelo sistema de permissões e não foi contornado.
- **Privacidade:** o relatório traz apenas agregados, números de OS e IDs truncados em 8 caracteres. Não há nomes, e-mails ou IDs completos.
- **Scripts:** ficam no scratchpad da sessão, não no repositório (`pf2.mjs`, `pf3.mjs`, `pf4.mjs`). Cada um reimplementa o motor (`lib/utils/employee-commission-engine.ts`) e a lógica de liberação (`server/utils/service-order-commissions.ts`).

## Base analisada

| Item | Valor |
|---|---|
| OS | 1.348 (69 excluídas) |
| `employee_financial_records` | 2.327, sendo 2.323 `commission` e 4 bônus |
| Comissões com `deleted_at` | 0. As comissões nunca são soft-deleted; a exclusão é física. |
| Total de comissões vivas | R$ 248.734,01: pagas R$ 206.057,62; pendentes R$ 42.676,39 |
| Registros com regra ou plano rastreável | 420 com `commission_rule_id`; 458 com `commission_plan_id` |
| Atribuições de plano | 31, todas criadas entre 2026-08 e 2026-09 (cutover do modelo novo). OS anteriores foram calculadas pelo modelo legado. |

## Método

1. **Recálculo independente pelas regras atuais** (`pf2.mjs`). Para cada par OS × funcionário em OS vivas (2.580 pares), o script:
   - resolve as regras atuais pela data de entrada da OS (plano ativo → versão vigente → regras por `sort_order`);
   - aplica o override do log, quando houver;
   - roda o motor (rateio de desconto e impostos, base receita/lucro, `round2` por item);
   - multiplica pelo `receivedRatio` do código (parcelas `paid` ÷ `total_amount`, ou 1 no modo `full`);
   - compara o resultado com a soma gravada no razão.
2. **Snapshot gravado × razão** (`pf3.mjs`, `pf4.mjs`). Usa `items[].commissions[]`, a fotografia que o próprio sistema gravou, × o `receivedRatio`, e compara com a soma gravada. Isso isola defeitos de liberação e edição da deriva de regras ao longo do tempo.
3. **Conferências pontuais:**
   - comissões pagas × `financial_transactions` (despesa vinculada por `employee_financial_record_id`);
   - reprodução do relatório `/api/reports/commissions` sem filtros;
   - consistência entre o saldo das contas e o extrato.

## Findings de produção

### PF-01 — Pagamento duplicado de comissão: 14 registros com 2 despesas ativas (origem FC-07) — **CONFIRMADO, ALTA**

- 14 registros `commission` pagos têm **duas** `financial_transactions` de despesa ativas, com o mesmo valor. Todos são de 2026-02, e as duas despesas foram criadas com 6 a 132 segundos de diferença. Exemplos: OS4060, OS4007, OS4009, OS4092, OS4105, OS4050.
- **Despesa duplicada:** R$ 2.555,29.
- Nenhuma dessas 28 transações tem extrato bancário ativo. Por isso o impacto no saldo bancário é **inconclusivo**: o saldo pode não ter sido debitado duas vezes, mas o caixa e o DRE contam a despesa em dobro.
- **Padrão:** duplo clique ou requisições concorrentes. Os endpoints checam `status === 'paid'` antes (`pay.post.ts:48`, `pay-commissions-bulk.post.ts:103`), mas o update não tem `.eq('status','pending')` (`pay.post.ts:143-155`, `pay-commissions-bulk.post.ts:178-183`). Duas requisições simultâneas passam pela checagem.
- **Ressalva:** em 02/2026 nenhum pagamento de comissão gerava extrato (PD-06), e todas as despesas de comissão de 02/2026, inclusive as 28 duplicadas, têm descrição "Comissão (à vista) <funcionário> OS #…", diferente da gerada hoje por `pay.post.ts` ("Comissão - #OS…"). Vieram de um caminho de pagamento anterior, que não foi identificado. A correção atual de concorrência continua necessária, mas este caso histórico não prova que o endpoint atual duplica.
- **Ação:** estornar as 14 despesas excedentes (decisão humana) e corrigir a guarda de concorrência.

### PF-02 — Comissão paga acima do valor atual da OS após edição sem reprocessamento (origem FC-05) — **CONFIRMADO, MÉDIA**

- Comparação snapshot × razão, depois de excluir os casos legados de PF-04:
  - 68 pares em OS editadas após a última liberação;
  - diferença líquida de **+R$ 451,96** (8 pares pós-cutover: +R$ 31,64);
  - **pago a maior** do que o valor atual: **R$ 1.272,54**.
- **Exemplos pós-cutover:**

  | OS | Snapshot atual | Pago |
  |---|---|---|
  | OS5242 | 96,36 | 97,71 |
  | OS5255 | 158,70 | 162,45 |
  | OS4947 (pendente) | 84,30 | 100,50 |

- **Padrão:** diferenças de R$ 1,35 a R$ 3,75 (múltiplos de 0,45/0,75), compatíveis com ajuste de desconto ou item depois da liberação.
- **Outros pares:** mais 10 pares "outros" somam R$ 333,41, sem causa identificada. A hipótese é que tenham sido editados no mesmo instante da liberação.
- **Ação:** reprocessar o razão ao editar OS liberada, ou bloquear a edição. A OS4947 (pendente) ainda pode ser corrigida sem estorno.

### PF-03 — "Recalcular" hoje mudaria comissões históricas em larga escala (deriva de regras; amplia FC-05 e o KF-36 do relatório de 2026-09) — **CONFIRMADO (risco latente), ALTA**

- Pelas regras **atuais**, 669 dos 2.580 pares divergem do razão: 538 com razão **acima** do recalculado (+R$ 65.277,39) e 131 **abaixo** (−R$ 25.493,97).
- **Causa dominante:** as regras e atribuições atuais (cutover em 2026-08) não são as mesmas que geraram as comissões anteriores. Há troca de planos entre funcionários; por exemplo, na OS4482 o valor está invertido entre os funcionários `87ed81ea` e `b7ee7bba` (−1.124,06 / +1.019,44).
- **Não é erro de cálculo do razão.** É o que o sistema faria se alguém rodasse "Recalcular" ou houvesse um novo evento de recebimento nessas OS:
  - liberação ou top-up de diferenças a favor de um funcionário;
  - para quem já recebeu, apenas *warnings* (pagos não são estornados).
- O motor usa as atribuições **atuais** do funcionário, sem histórico de vigência da atribuição. Apenas a versão da regra é resolvida pela data da OS.
- **Ação:** bloquear ou alertar no recálculo de OS anteriores ao cutover, ou versionar as atribuições por vigência.

### PF-04 — OS pagas no modelo legado sem parcelas: o `receivedRatio` dá 0 (origem FC-01/FC-06) — **CONFIRMADO (risco latente), MÉDIA**

- 255 pares (R$ 24.342,82, todos já pagos) estão em OS com `payment_status='paid'` mas **sem** `service_order_installments`. É o pagamento legado, anterior ao modelo de parcelas.
- Nessas OS o código calcula `receivedRatio = 0` (`service-order-commissions.ts:414-426`).
- Qualquer evento de liberação nelas ("Recalcular", recebimento extra, estorno) geraria:
  - para registros pendentes, claw-back indevido;
  - para registros pagos, *warning* de reconciliação.
- **Ação:** fazer o fallback para as receitas pagas da OS, ou bloquear o recálculo em OS legadas.

### PF-05 — Relatório: o gráfico por funcionário inclui bônus excluído e o total tem ruído de ponto flutuante (origem FC-11) — **CONFIRMADO, BAIXA**

- Reproduzindo o relatório sem filtros:
  - resumo "Total de comissões": R$ 248.699,01;
  - soma do gráfico por funcionário: R$ 249.199,01.
- A diferença de **R$ 500,00** vem de 1 registro de bônus **com `deleted_at`**. O relatório não filtra `deleted_at` em `employee_financial_records` (`commissions.get.ts:69-73`) e o gráfico mistura tipos (`:171-181`).
- **Ruído de ponto flutuante:** o total bruto é `248699.01000000088`; a soma não é arredondada.
- Homônimos: 0. Registros de funcionários excluídos: 0. Os riscos de agrupamento por nome não se materializaram.
- 1 comissão viva fica fora do relatório porque a OS está ausente ou excluída. Esse registro está fora da contagem de PF-07.
- **Competência:**
  - 1.140 comissões pagas (R$ 121.221,25) foram pagas em mês diferente do mês de entrada da OS;
  - o relatório filtra por `entry_date`, então não concilia com o caixa do mês;
  - isso é uma escolha de modelo e precisa ser explicada ao cliente.

### PF-06 — Arredondamento de meio centavo para baixo (origem FC-04) — **CONFIRMADO, INFORMATIVA**

- No recálculo, 50 cálculos por item caem no caso em que `toFixed` difere do half-up. Impacto total: **R$ 0,50** a menos.
- Divergências de centavos entre snapshot e razão: 13 pares, R$ 0,06.
- **Conclusão:** arredondamento **não** é causa relevante da reclamação.

### PF-07 — Comissão em OS excluída (origem FC-08) — **NÃO OCORRE**

- Nenhuma comissão está vinculada a OS excluída (0 registros).
- Nenhuma despesa de comissão foi soft-deleted com origem de exclusão de OS.
- O risco do código continua existindo, mas não se materializou.

### PF-08 — Despesas órfãs de comissão excluída (origem FC-09) — **OCORRE (corrigido na validação de 2026-11-13)**

- **Correção:** a checagem abaixo não detecta o caso, porque o delete físico zera `employee_financial_record_id` (FK `ON DELETE SET NULL`). Procurando despesas ativas de "Pagamento de comissão" com vínculo nulo, há **16 órfãs (R$ 4.301,11)**, 14 com extrato. Em 14 delas a comissão foi recriada e paga de novo (R$ 3.337,74), inclusive em novembro/2026. Ver PD-01 em `comissoes-integridade-producao.md`.
- 0 transações ativas apontam para registro inexistente.
- 0 comissões pagas estão sem transação.
- 0 têm valor diferente da transação vinculada.

### PF-09 — Pendências de funcionário removido da OS (origem FC-10) — **NÃO OCORRE**

- 0 pares em que o razão existe e o funcionário não está entre os responsáveis atuais.

### PF-10 — Recebimento parcial não libera comissão (origem FC-01) — **NÃO OCORRE (ainda)**

- 0 parcelas com status `partial` no snapshot. O defeito é real no código, mas o fluxo de pagamento parcial ainda não foi usado.

### PF-11 — Override de comissão manual (origens FC-02 e FC-03) — **NÃO OCORRE**

- 0 OS com `override_action` no log. As 83 entradas de log são recálculos simples.
- 0 funcionários com regras sobrepostas hoje, o que é coerente com a guarda em `employee-commission-plans.ts:478`.

### PF-12 — `total_amount` ≠ Σitens − desconto (+ impostos) (origem FC-06) — **INCONCLUSIVO / BAIXA**

- Sem impostos: 0 divergências em 1.276 OS.
- Considerando `apply_taxes`: 5 divergências (OS2, OS3, OS4, OS23, OS51; de −R$ 49,40 a −R$ 317,20). São OS antigas; a hipótese é que os impostos não entram no total. Não afetam comissão atual.

### PF-13 — `commission_amount` da OS inconsistente (origem FC-12) — **CONFIRMADO, BAIXA**

- 24 OS têm `commission_amount` ≠ soma dos itens.
- 326 OS têm `commission_amount` ≠ recálculo pelas regras atuais (efeito da deriva de PF-03).
- Afeta a exibição, não o razão.

### PF-14 — Centavos residuais e valores não positivos (origens FC-13 e FC-14) — **CONFIRMADO, INFORMATIVA**

- 1 registro de comissão abaixo de R$ 0,02.
- 2 registros com valor ≤ 0.

### PF-15 — Saldo bancário × extrato — **INCONCLUSIVO (encaminhar ao data-integrity-auditor)**

- Em todas as 7 contas, `current_balance` é igual ao `balance_after` do último extrato.
- Porém, em 5 contas, saldo inicial + Σ movimentos ≠ saldo atual. Na conta `674c064d` a diferença é de R$ 436 mil, e há 342 quebras de encadeamento `previous_balance` × saldo anterior, contando todas as contas.
- **Hipóteses:**
  - extratos excluídos fisicamente (`revertStatementOnAccount` + delete);
  - ordenação por `created_at`;
  - edição do saldo inicial.
- Fora do foco de cálculo de comissões.

## Matriz FC → produção

| FC | Status | Ocorrências | R$ |
|---|---|---|---|
| FC-01 | NÃO OCORRE (ainda) / risco legado em PF-04 | 0 parciais; 255 pares legados | 0 / 24.342,82 (exposição) |
| FC-02 | NÃO OCORRE | 0 | 0 |
| FC-03 | NÃO OCORRE | 0 | 0 |
| FC-04 | CONFIRMADO (irrelevante) | 50 itens | 0,50 |
| FC-05 | CONFIRMADO | 68 pares (+10 sem causa) | 1.272,54 pago a maior; deriva latente +65.277,39 / −25.493,97 |
| FC-06 | INCONCLUSIVO | 5 OS antigas | n/a |
| FC-07 | CONFIRMADO | 14 registros | 2.555,29 em despesa duplicada |
| FC-08 | NÃO OCORRE | 0 | 0 |
| FC-09 | OCORRE (ver PF-08 corrigido) | 16 despesas órfãs | 4.301,11 (3.337,74 repagos) |
| FC-10 | NÃO OCORRE | 0 | 0 |
| FC-11 | CONFIRMADO | 1 bônus excluído no gráfico; competência ≠ caixa em 1.140 pagamentos | 500,00; 121.221,25 deslocados |
| FC-12 | CONFIRMADO | 24 / 326 OS | exibição |
| FC-13/14 | CONFIRMADO (informativo) | 1 / 2 | ~0 |

## Leitura para o cliente

A queixa de que "as comissões não estão dando certo" é explicada principalmente por:

1. **Ordem de grandeza maior:** o valor que o sistema mostraria ou recalcularia hoje difere do que foi pago em ~26% dos pares OS × funcionário (PF-03, PF-13). A causa é a mudança de modelo e de atribuições em 2026-08, não o arredondamento.
2. **Pagamentos duplicados** de 14 comissões em 2026-02 (PF-01).
3. **OS editadas depois de pagas**, com diferenças pequenas (PF-02).
4. **Relatório por data de entrada da OS**, que não bate com o pagamento do mês (PF-05).

Arredondamento (R$ 0,50) e overrides não são causas relevantes.

## Limitações

- O recálculo pelas regras atuais não reconstitui as regras legadas (campos `employees.commission_*` anteriores ao cutover). Para OS anteriores a 2026-08, a comparação válida é a de snapshot × razão.
- Não verifiquei se as 14 despesas duplicadas de PF-01 movimentaram o saldo: não há extrato ativo para elas.
- O snapshot é de um único instante (2026-11-13).
