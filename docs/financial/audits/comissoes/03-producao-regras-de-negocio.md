# Auditoria de Comissões — 03 Confirmação em dados de produção (regras de negócio)

Fonte: snapshot JSON local de 2026-11-13 (somente leitura, exportado pela sessão principal com autorização do usuário). Nenhuma consulta de rede feita por este agente.
Privacidade: sem nomes, e-mails ou IDs completos. Funcionários aparecem com 8 caracteres do ID; OS pelo número. Duas organizações no snapshot: `fda7436b` (2.313 de 2.327 registros) e `386614c4` (14); a análise cobre ambas, dominada pela primeira.
Método: scripts Node em scratchpad (não no repo) sobre `employee_financial_records` (EFR), `service_orders`, `service_order_installments`, `financial_transactions`, `employees` e as tabelas de plano. Reconstruí o direito de comissão com a regra do motor (`lib/utils/employee-commission-engine.ts:116-163,249-296`), mês de `entry_date`, versão vigente e atribuição atual. Classificação: CONFIRMADO / NÃO OCORRE / INCONCLUSIVO.

## Base

- 2.323 comissões, todas vivas (nenhuma com `deleted_at`): 1.987 `paid` = R$ 206.057,62; 336 `pending` = R$ 42.676,39.
- 1.348 OS: 887 `proportional`, 461 `full` (34%).
- Planos: 22 (10 vivos, 12 excluídos, todos criados em 19/08/2026, data da migração); 26 versões; 33 regras; 31 atribuições.

## Findings

### PB-01 — Incidente de 10/09/2026 reconstruído (origem BR-08) — REINTERPRETADO

> **Revisão:** a análise do log por usuário (consolidado, seção 9.8) mostrou que as 21 zeragens de 10/09 foram uma limpeza feita por um usuário interno (motivo "Migração do sistema") sobre o cadastro duplicado "Anderson 2". Em 20 dos 21 casos o valor continua em outro registro da mesma OS; só R$ 23,40 (OS4985) ficaram sem destino. **Não é perda de R$ 7.130,99 do cliente.** A severidade "Crítica" não se sustenta; a causa de fundo é o cadastro duplicado. O texto abaixo é mantido como registro da reconstrução original.

- Método: `commission_recalculation_log` e `commission_manual_adjustments_log` de `service_orders` (23 e 29 OS com entradas, 111 entradas).
- Resultado: 21 entradas com `new_amount=0` e `previous_amount>0`, somando exatamente **R$ 7.130,99**. Bate com o incidente (KF-36). Todas em 10/09 e com o mesmo motivo-padrão de conferência.
- Em 10/09 houve 67 recálculos manuais em 25 OS (3 funcionários): soma anterior R$ 17.670,33, soma nova R$ 11.392,72 (queda líquida de R$ 6.277,61). Motivos: "migração do sistema" (30), "comissão não confere com os valores internos da OS" (21), "para virar somente uma comissão" (7), "não estava batendo com a planilha" (9).
- Impacto: R$ 7.130,99 zerados e R$ 6.277,61 líquidos a menos. Se algum já era `paid`, o recálculo teria sido bloqueado (`service-order-commissions.ts:503-509`); portanto os valores zerados eram pendentes.
- Por que foi possível reconstruir: só pelo log JSON da OS. Os registros em EFR foram apagados fisicamente (nenhum `deleted_at`, nenhum `deletion_reason`), confirmando BR-01 (sem estado cancelada/estornada nem trilha própria).

### PB-02 — Os usuários recalculam manualmente em massa para "conferir" (origem BR-04, BR-06, BR-12) — CONFIRMADO, Alta
- 111 recálculos manuais no total. Motivos dominantes: "não confere com o relatório/planilha/valores internos da OS". Indica divergência entre os motores (OS x relatório de itens x relatório de comissões) percebida pelo cliente. Sem overrides manuais (0 entradas com `override_action`): a feature de override não foi usada.
- Picos: 25/08 (22), 10/09 (67), 11/11 (6). O último é recente: o problema continua.

### PB-03 — Responsáveis sem plano vivo (zero silencioso) (origem BR-08) — CONFIRMADO, Alta
- 2 funcionários desligados em 17/04/2026 (`fad537d7`, `767cb6ac`) só têm atribuição a plano **excluído**. Eles figuram em 194 pares OS x funcionário; 133 com recebimento > 0; 93 têm comissão registrada (legado) e **40 não têm nenhuma**, com R$ 36.232 recebidos nessas OS. Entradas entre 08/01 e 13/04/2026, antes da data de desligamento.
- Hipótese [H]: os 40 sem registro podem ser legítimos (comissão nunca configurada à época). Não comprovado. Relevante porque qualquer recálculo agora geraria zero, pois não há regra vigente.
- 15 das 28 atribuições ativas apontam para plano excluído (12 planos excluídos em 19/08). Sem efeito no cálculo, mas é lixo de configuração (BR-10).
- Pendentes de funcionários desligados/excluídos: 1 registro, R$ 35 (funcionário excluído).

### PB-04 — OS com recebimento, funcionário com plano e sem registro (origem BR-04) — CONFIRMADO, Média
- 21 pares OS x funcionário (21 OS) com recebimento e sem registro, funcionários `5c7741e6` e `87ed81ea` (o primeiro com plano de taxa 0,01%/0,05%/0,09% sobre faturamento). Em 16 pares o direito calculado é > 0, mas soma só **R$ 264,03**. Os demais (5) dão 0 por lucro zero ou taxa irrelevante. Ordem de grandeza pequena.
- Parcelas `partial`: **0** em produção (todas as 1.687 parcelas são `paid`/outros). **KF-24 NÃO OCORRE nos dados atuais**: nenhuma parcela parcial ignorada. Risco continua latente.

### PB-05 — Itens sem regra aplicável por falta de default (origem BR-09) — CONFIRMADO, Média/Alta
- 19 de 26 versões de plano **não têm regra default**; 0 versões com 2 defaults.
- Em OS posteriores à migração (≥ 19/08/2026), 80 de 697 pares OS x funcionário (11%) têm itens sem regra aplicável: **R$ 177.330,02 em itens sem comissão**. Todos os itens têm categoria (0 sem categoria), então o caso é "categoria fora do plano".
- [H] Pode ser intencional (comissão só sobre certas categorias), o que o cliente deve confirmar. Se não for, é a fonte de "comissão menor que o esperado".

### PB-06 — Duas taxas diferentes por funcionário na mesma OS e valores trocados (origem BR-07, BR-12) — INCONCLUSIVO, Alta se confirmado
- Reconstrução com as regras atuais x registros existentes: dos 2.386 pares com plano, 545 divergem em ≥ R$ 0,02 (131 a menos, R$ -25.493,94; 414 a mais, R$ +54.584,79). Boa parte decorre de regra legado x plano (não comparável) e de erros de reconstrução minhas; **não use como valor oficial**.
- Sinal forte que merece apuração [H]: em OS multi-responsável (ex.: OS4547, OS4128, OS4624) o valor registrado de um funcionário é exatamente o valor que o motor atual calcularia para o outro, indicando troca de regras entre funcionários ou da atribuição. Exemplo OS4547: funcionário A registrado R$ 82,35 (esperado R$ 709,15); funcionário B registrado R$ 626,80 (esperado R$ 82,35).
- Consequência para BR-07: um recálculo hoje alteraria esses valores. Verificar com o cliente se os planos atuais representam o acordo real.

### PB-07 — Modo `full` amplamente usado e paga comissão antes de receber (origem BR-05) — CONFIRMADO, Alta
- 458 OS vivas em `full` (34%; 98 só em outubro). Dessas, 17 OS têm **zero recebido** e já possuem comissão: R$ 5.953,30, dos quais **R$ 4.247,35 já pagos** ao funcionário (16 OS com `payment_status=pending`). Validado em 2026-11-13. Pelo critério "OS ainda não quitada" (usado na seção 9.9 do consolidado), são 19 OS com R$ 4.900,35 pagos.
- 2 OS `full` com recebimento parcial: comissão R$ 1.154,75 liberada integralmente.
- Impacto: dinheiro pago a funcionário sem entrada de caixa correspondente; combinado com KF-40 (cancelar apaga paga) é risco real.

### PB-08 — Comissões de OS canceladas/excluídas (origem BR-03, BR-16) — NÃO OCORRE
- 0 comissões vivas em OS cancelada ou excluída; 0 comissões órfãs (sem OS); 1 comissão sem `service_order_id` (a de funcionário excluído, R$ 35).
- OS excluídas: 69 (4 canceladas, resto rascunhos/em andamento/concluídas). KF-32 e KF-40 não se manifestaram. **Sem trilha** de comissões apagadas, mas nada sobra no ledger.

### PB-09 — Comissões de quem saiu da OS (origem KF-25) — NÃO OCORRE
- 0 registros de funcionário que não consta em `responsible_employees` da OS.

### PB-10 — Registros legados sem `commission_rule_id`/snapshot (origem BR-07, BR-17) — CONFIRMADO, Média
- 1.903 de 2.323 comissões (82%, R$ 202.342,28) sem `commission_rule_id` e sem snapshot; 1.865 sem `commission_plan_id`. Aparecem em todos os meses de 2025-09 a 2026-09: são do modelo antigo (anterior a 19/08/2026).
- **Após 19/08/2026**: 593 registros, 420 com rule_id, 38 só com plan_id (regra agregada), 135 (R$ 10.864,10) **sem plano**, de 6 funcionários, criados depois da migração. [H] Origem: top-ups em OS antigas ou fallback legado. Explicável por BR-07, mas deveria ser zero se o legado foi removido.
- Impacto: 82% do histórico não consegue explicar a regra que gerou o valor; não dá para reproduzir/auditar.

### PB-11 — Conflitos de plano e atribuição sem vigência (origem BR-07, BR-10) — NÃO OCORRE (conflito), CONFIRMADO (sem vigência)
- 0 funcionários com conflito de categoria ou de default entre planos. 4 funcionários com 2-3 atribuições históricas foram resolvidos excluindo planos antigos.
- Atribuições não têm data de vigência (modelo): 31 atribuições criadas em só duas datas (19/08 e 10/09/2026). O mesmo dia 10/09 do incidente, o que sugere reconfiguração de planos durante os recálculos.
- Versões: 4 planos com 2 versões (`2026-08-01`); 1 com versão `2000-01-01`, valor-sentinela. Nenhuma versão fora do dia 1; nenhuma taxa > 100%.

### PB-12 — Pendentes envelhecidos e consistência de pagamentos (origem BR-14) — parcialmente OK
- 336 pendentes (R$ 42.676,39). 313 estão em OS `paid` + `full` (a pagar, esperado); 1 pendente de out/2025 e 1 de jan/2026 estão velhos. 155 criados em agosto e 128 em setembro.
- Integridade: 0 comissões `paid` sem lançamento financeiro, 0 lançamentos apagados, 0 divergências de valor; 0 lançamentos de despesa apontando para comissão inexistente.
- **Correção (validação de 2026-11-13):** a conclusão "KF-44 (apagar paga) não se manifestou" está errada. O delete físico zera o vínculo da despesa (`ON DELETE SET NULL`), então a checagem "despesa apontando para comissão inexistente" nunca acha esses casos. Há 16 despesas de comissão órfãs (R$ 4.301,11), com repagamento em agosto e em novembro/2026 (PD-01 em `comissoes-integridade-producao.md`).

### PB-13 — Planos com taxa simbólica (origem BR-11) — INCONCLUSIVO
- Dois funcionários (`5c7741e6`, `74740bb4`) têm taxa de 0,01% sobre faturamento (também no legado). [H] Padrão de "comissão praticamente zero" usado como workaround; confirmar com o cliente se é intencional.

## Resumo de severidade real

| ID | Origem | Resultado | Impacto R$ | Severidade |
|---|---|---|---|---|
| PB-01 | BR-08 | REINTERPRETADO (limpeza de cadastro duplicado) | R$ 23,40 sem destino | Baixa |
| PB-02 | BR-04/06/12 | CONFIRMADO | 111 recálculos | Alta |
| PB-03 | BR-08 | CONFIRMADO | 40 OS, R$ 36.232 recebidos sem comissão [H] | Alta |
| PB-04 | BR-04 | CONFIRMADO | 264,03 | Média |
| PB-05 | BR-09 | CONFIRMADO | 177.330,02 em itens sem regra [H] | Média/Alta |
| PB-06 | BR-07/12 | INCONCLUSIVO | até ~25-55 mil (não confiável) | Alta se confirmado |
| PB-07 | BR-05 | CONFIRMADO | 4.247,35 pagos sem recebimento; 5.953,30 liberados | Alta |
| PB-08/09 | BR-03/16, KF-25 | NÃO OCORRE | 0 | n/a |
| PB-10 | BR-07/17 | CONFIRMADO | 202.342,28 sem rastreio | Média |
| PB-11 | BR-10 | Conflito: NÃO OCORRE | 0 | Baixa |
| PB-12 | BR-14 | OK | 42.676,39 pendentes | Informativo |
| PB-13 | BR-11 | INCONCLUSIVO | n/d | Baixa |

## Respostas às hipóteses da fase 1

- BR-04 (parcela parcial): **não ocorre** hoje (0 parcelas parciais), risco latente.
- BR-06 (edição após recebimento): não verificável neste snapshot (sem histórico de edição). INCONCLUSIVO.
- BR-02/BR-03 (estorno e cancelamento de comissão paga): sem ocorrência registrada. NÃO OCORRE, mas a falta de trilha impede garantir.
- BR-05: confirmado, e mais grave que o previsto (34% das OS em `full`).
- BR-08/BR-09: confirmados, com incidente exato reconstruído.

## Recomendações de apuração (sem alterar nada ainda)
1. Validar com o cliente se os planos atuais representam o acordo real (PB-05, PB-06, PB-13), principalmente OS multi-responsável.
2. Decidir a política do modo `full` (PB-07), porque já pagou R$ 4,2 mil sem recebimento.
3. Tornar os recálculos que zeram pendentes reversíveis e auditáveis (PB-01); hoje os registros apagados só deixam rastro no log da OS.
4. Limpar atribuições a planos excluídos e documentar a política para funcionários desligados (PB-03).

## Limitações
Snapshot único; sem dados de ação do usuário nem de edições de OS. A reconstrução de direito (PB-04, PB-05, PB-06) aproxima o motor sem descontar taxas de maquininha e usa o plano atual, não o vigente à época do pagamento.
