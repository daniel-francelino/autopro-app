# Auditoria de Integridade — Comissões: Confirmação com Dados de Produção (Fase 2)

- Data: 2026-11-13. Snapshot de produção exportado pela sessão principal (read-only) em 2026-11-13. O usuário autorizou a leitura, segundo o coordenador.
- Método: scripts Node locais (scratchpad, fora do repo) sobre os JSONs exportados. Nenhum acesso a rede ou Supabase, nenhuma escrita em dados.
- Privacidade: somente agregados, números de OS e IDs truncados (8 caracteres). Nenhum nome ou e-mail.
- Base: 2 organizações; 2.327 `employee_financial_records`, dos quais 2.323 comissões vivas (R$ 248.734,01: 1.987 pagas = R$ 206.057,62 e 336 pendentes = R$ 42.676,39); 1.348 OS (7 canceladas, 69 excluídas); 1.687 parcelas; 6.467 transações; 3.949 extratos; 7 contas.
- Relatório de origem (Fase 1): `docs/data-integrity/audits/comissoes-integridade.md`.

## Resumo por finding da Fase 1

| DI | Veredito | Evidência em produção |
|---|---|---|
| DI-01 duplicidade/race | CONFIRMADO (baixo volume) | PD-03: 1 caso inequívoco (R$ 81,22) e 1 suspeito (R$ 76,65) |
| DI-02/DI-08 delete físico de comissão paga | CONFIRMADO (impacto relevante) | PD-01: 16 pagamentos órfãos (R$ 4.301,11); 14 regerados e pagos de novo (~R$ 3.337,74) |
| DI-03 pagamento duplicado | CONFIRMADO (lançamentos) | PD-02: 14 registros com 2 despesas ativas (+R$ 2.555,29), sem extrato bancário |
| DI-04 recebimento parcial | NÃO OCORRE no snapshot | 0 parcelas `partial` |
| DI-05 OS editada × ledger | CONFIRMADO (baixo valor) | PD-04: 22 OS acima (R$ 242,98), 6 abaixo (R$ 161,01) |
| DI-06 pendentes órfãs | NÃO OCORRE | 0 pendentes de funcionário fora da OS ou sem pagamento; 1 pendente sem OS (R$ 35,00) |
| DI-07 soft delete ignorado | NÃO SE APLICA | 0 comissões soft-deleted; todas as remoções são físicas (PD-05) |
| DI-09 cancelamento apaga paga | NÃO OCORRE | 0 comissões (vivas) em OS cancelada ou excluída. Apagadas não são observáveis |
| DI-10 modo `full` | INCONCLUSIVO | 458 OS em `full`; 16 com pagamento pendente; 1 sem parcelas |
| DI-12 log manual | INCONCLUSIVO | 29 OS com log (83 entradas); perda por concorrência não é detectável |
| DI-14 isolamento por organização | NÃO OCORRE | 0 divergências entre o `organization_id` do registro e o da OS, do funcionário ou da transação |
| DI-15 bulk com qualquer tipo | NÃO OCORRE no snapshot | só há 3 registros `salary`, e não foi detectado pagamento indevido |

---

## Findings de produção

### PD-01 — Comissões pagas apagadas fisicamente e pagas de novo (origem DI-08 / DI-02) — Crítica

- **Método:** procurei despesas ativas com `notes` iniciando por "Pagamento de comissão" (padrão gerado por `pay.post.ts` / `pay-commissions-bulk.post.ts`) e com `employee_financial_record_id IS NULL`. Esse campo nulo é sinal do FK `ON DELETE SET NULL` após um delete físico. Em seguida cruzei o nº da OS (descrição) e o funcionário (sufixo de `notes`) com as comissões vivas.
- **Resultado:**
  - 16 despesas órfãs, somando R$ 4.301,11; 14 delas têm extrato bancário, ou seja, o dinheiro saiu.
  - Em 14 dos 16 casos, a mesma OS e o mesmo funcionário têm hoje um novo registro de comissão também **pago**. A sobreposição (pagamento em duplicidade provável) é de **R$ 3.337,74**. Em 11 casos o valor é idêntico.
  - Concentração temporal: 2026-08-06/07 (OS4739, OS4757, OS4795, OS4819, OS4838; R$ 1.696,89 de sobreposição) e 2026-11-06 (OS5209, OS5235; R$ 1.640,85). Os 2 casos sem sobreposição são de 2026-02-23 (R$ 805,20, sem extrato).
- **Validação (2026-11-13, consulta direta):** números reproduzidos. Novembro confirmado: o Anderson recebeu R$ 1.234,30 na OS5209 em 06/11 e de novo em 12/11, e R$ 559,50 + R$ 406,55 na OS5235. As quatro despesas têm extrato na mesma conta. O log de recálculo de 11/11 mostra `previous_amount = 0`, ou seja, o registro pago já tinha sido apagado, e não por recálculo (que bloqueia funcionário com comissão paga). Detalhes no doc 05 de comissões.
- **Leitura:** a sequência compatível é: comissão paga → excluída por `DELETE /api/reports/commissions/:id` (delete físico, sem estorno) → recálculo ou novo release regera → paga de novo. Não há trilha no banco, porque o delete é físico. O `audit_logs` não ajuda: existe desde 09/11, mas não registra escritas de comissão (só 35 escritas, todas de `/api/users/*`).
- **Impacto:** cerca de R$ 3.337,74 pagos em duplicidade a funcionários, mais R$ 963,37 de despesas órfãs sem registro correspondente.
- **Correção proposta (texto, NÃO executada):**
  - Para cada par (despesa órfã, novo registro pago), o financeiro decide entre desconto na próxima folha ou estorno.
  - SQL de diagnóstico (proposta): `SELECT ft.id, ft.amount, ft.description, ft.notes FROM financial_transactions ft WHERE ft.deleted_at IS NULL AND ft.type='expense' AND ft.employee_financial_record_id IS NULL AND ft.notes ILIKE 'Pagamento de comissão%';`
  - Bloquear a exclusão de comissão paga (Fase 1, DI-08).

### PD-02 — Duas despesas ativas para o mesmo registro de comissão (origem DI-03) — Alta

- **Método:** agrupei `financial_transactions` ativas por `employee_financial_record_id` e listei os grupos com mais de uma transação.
- **Resultado:**
  - 14 registros (OS4007, OS4009, OS4050, OS4060, OS4062, OS4069, OS4070, OS4082, OS4088, OS4092, OS4098, OS4105, OS4112, entre outras) têm 2 despesas ativas cada. O excedente é de **R$ 2.555,29**.
  - Todos são de 2026-02-23, com intervalo de 6 a 132 segundos entre as duas.
  - O registro aponta para a segunda despesa. **Nenhuma das duas tem extrato bancário**, então o sistema não debitou o saldo duas vezes (em 02/2026 nenhum pagamento de comissão gerava extrato, ver PD-06). Mas DRE, relatórios de despesa e "Salários" estão inflados em R$ 2.555,29. Se houve pagamento real em dobro ao funcionário, só o financeiro pode confirmar.
- **Leitura:** o padrão é de reprocessamento (pagamento repetido) sem guarda de status, compatível com DI-03. A ausência de extrato sugere um caminho diferente de `pay.post.ts`: possivelmente `pay-entries-bulk.post.ts`, um import ou uma versão antiga. Isso não foi verificado.
- **Correção proposta (NÃO executada):** soft-delete da despesa não referenciada por `employee_financial_records.financial_transaction_id`, com `deletion_source='data_fix.duplicate_commission_payment'` e motivo. Antes, validar com o financeiro.

### PD-03 — Comissões duplicadas no mesmo segundo (origem DI-01) — Média

- **Método:** agrupei por (OS, funcionário, valor, minuto de `created_at`) e, separadamente, por (OS, funcionário, parcela).
- **Resultado:**
  - 0 grupos por (OS, funcionário, parcela).
  - **OS29:** 1 registro pago e 1 pendente de R$ 81,22, mesmo funcionário, criados com 1 segundo de diferença. É duplicata típica de race (DI-01). Há risco de o pendente ser pago: **R$ 81,22**.
  - **OS4343:** 6 registros pagos de R$ 15,33 no mesmo segundo, cada um com parcela distinta. É provavelmente legítimo (várias parcelas liberadas de uma vez), mas o agrupamento por minuto contou 5 como excedentes (R$ 76,65). INCONCLUSIVO; conferir o direito total da OS.
- **Correção proposta:** excluir (soft) o pendente duplicado da OS29 após conferência manual.

### PD-04 — Divergência entre `service_orders.commission_amount` e o ledger (origem DI-05) — Média

- **Método:** para OS não canceladas e não excluídas, calculei o esperado como `commission_amount × razão recebida`. A razão é 1 em `full`; caso contrário, é a soma das parcelas `paid` dividida por `total_amount`, como no código. Comparei com a soma das comissões vivas.
- **Resultado:**
  - 22 OS com comissão registrada **acima** do `commission_amount` atual, excedente de **R$ 242,98** (ex.: OS4435 84,00 × 78,00; OS4839 174,60 × 159,60, em modo `full`).
  - 6 OS pagas **abaixo** do esperado, gap de **R$ 161,01**.
  - 1 OS paga com `commission_amount` > 0 e nenhum registro de comissão (R$ 65,88, entrada em 2026-02).
- **Leitura:** o padrão é compatível com OS editadas após a liberação, sem reconciliação. O valor total é baixo, mas explica divergências visíveis entre a tela da OS e o relatório.
- **Correção proposta:** rodar "Recalcular" por OS, apenas onde não há comissão paga; no excedente pago, decisão manual.

### PD-05 — Remoções físicas sem trilha: soft delete nunca usado para comissões (origem DI-07 / DI-08 / DI-09) — Média

- **Resultado:**
  - 0 comissões com `deleted_at`. Existe só 1 registro soft-deleted em toda a tabela, e é um bônus.
  - Todas as remoções de comissão (claw-back, recálculo, cancelamento, exclusão manual) são físicas, então não é possível medir volume, motivo ou padrão temporal de recálculos em massa no banco.
  - Transações de comissão soft-deleted: 11 (R$ 958,11), todas com `deletion_source='service_orders.payment_delete'`.
- **Recomendação:** trocar `delete()` por soft delete com `deletion_source` em todos os caminhos citados na Fase 1. A análise histórica fica dependente do audit log da aplicação.

### PD-06 — Despesas de comissão sem extrato bancário (achado novo; relação com DI-03 / DI-11) — Média, INCONCLUSIVO

- **Resultado (corrigido na validação de 2026-11-13):** a versão anterior contava 441 despesas / R$ 57.763,08, mas incluía 2 despesas de **salário** (R$ 8.000). Só de comissão: **439 despesas ativas (R$ 49.763,08)** sem `bank_account_statements`, correspondentes a **425 comissões pagas (R$ 47.207,79)** mais as 14 despesas duplicadas de PD-02. Por mês de pagamento: 2025-09 (2), 2025-10 (8), 2026-01 (45), 2026-02 (149), 2026-03 (221). Nenhuma depois de 2026-03.
- **Leitura:** essas despesas foram pagas sem mover o saldo bancário. A explicação mais provável está no próprio código: o comentário de `server/api/reports/commissions/[id]/pay.post.ts:29` registra que o endpoint antes "só virava o status" e não mexia no saldo. Alternativas menos prováveis: import, ou `bulk` com falha silenciosa no extrato (o erro não é checado em `pay-commissions-bulk.post.ts:161-175`). Os dados históricos não foram reconciliados.
- **Ação:** o financeiro deve confirmar se o saldo bancário real reflete esses pagamentos.

### PD-07 — Saldo bancário × extrato (contexto para DI-03) — INCONCLUSIVO

- **Resultado:**
  - Em 7 de 7 contas, `current_balance` coincide com o `balance_after` do último extrato.
  - Em 5 contas, `initial_balance + Σ extrato` diverge do saldo atual (de −R$ 436.264,81 a +R$ 19.652,89), com 4 a 193 quebras de encadeamento (`previous_balance` ≠ `balance_after` do extrato anterior).
- **Leitura:** as causas prováveis são extratos apagados fisicamente em estornos (`cancel.post.ts`, `payment.delete.ts`, reversão de recebimento), saldo regravado de forma absoluta (lost update, DI-03) ou edição do `initial_balance`. Não dá para isolar a parcela atribuível a comissões. Encaminhar ao `financial-auditor`.

### PD-08 — Drift de schema (achado novo) — Baixa, CONFIRMADO na validação de 2026-11-13 (as 5 colunas existem em produção)

- **Resultado:** o snapshot de `employees` ainda contém `has_commission`, `commission_type`, `commission_amount`, `commission_base` e `commission_categories`. `service_orders` contém `commission_recalculation_log`, preenchido em 23 OS.
- **Leitura:** a migration `20240101000099_drop_legacy_employee_commission_columns.sql` aparentemente não foi aplicada em produção, ou foi revertida. Não verifiquei o conteúdo dela.
- **Ação:** comparar `supabase_migrations.schema_migrations` de produção com o repositório.

## Hipóteses da Fase 1

- **H-01** (despesa de comissão excluída e registro ainda pago): NÃO OCORRE. 0 registros pagos apontam para transação inexistente ou excluída, e 0 registros pagos estão sem transação.
- **H-02** (sinal não libera comissão): NÃO OCORRE como problema. 0 OS pagas com sinal ficaram sem comissão. Só 1 OS paga não tem comissão (PD-04).
- **H-03** (OS antigas sem regra após o cutover): INCONCLUSIVO. Há apenas 1 OS paga sem nenhum registro (R$ 65,88, 2026-02); não há indício de gap sistêmico.

## Outras verificações

- 128 comissões **pagas** (R$ 10.692,76) pertencem a funcionários desligados ou excluídos. Isso é histórico legítimo. Há 0 pendentes nessa situação.
- 0 comissões pendentes em OS sem parcela paga ou parcial (modo `proportional`).

## Prioridade

1. PD-01 e PD-02: dinheiro e despesa em duplicidade, cerca de R$ 5,9 mil.
2. Bloquear a exclusão de comissão paga e adotar soft delete (DI-08, PD-05).
3. Reconciliar PD-03, PD-04 e PD-06 com o financeiro.
4. PD-07 e PD-08 com o `financial-auditor` e o time de infraestrutura.

Nenhuma correção foi executada. Todos os SQL acima são propostas.
