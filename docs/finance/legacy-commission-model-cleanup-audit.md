# Auditoria: o que sobrou do modelo antigo de comissão

> Documento só de análise — nenhuma mudança de código ou banco foi feita a partir daqui. Objetivo: registrar com precisão (arquivo/linha) o que ainda resta do modelo legado de comissão (`employees.has_commission/commission_type/commission_amount/commission_base/commission_categories`), para servir de checklist quando a limpeza for retomada aos poucos — depois que os usuários tiverem testado o motor novo em produção por um tempo.

## 1. Contexto

`docs/finance/commissions-configuration-architecture.md` e `docs/finance/commissions-step8-engine-cutover.md` desenharam um plano de 10 steps para migrar do modelo legado (5 colunas soltas em `employees`) para o modelo novo (`employee_commission_plans` → `employee_commission_rule_versions` → `employee_commission_rules`). Esses dois documentos foram escritos numa fase intermediária do trabalho e **nunca foram atualizados** depois — então hoje eles descrevem um estado desatualizado: alguns steps que lá aparecem como "pendentes" já foram feitos por commits posteriores (`98e6b19`, `d778e94`, `ec4f9f6`), mas o Step 10 (remoção final das colunas do banco) genuinely nunca aconteceu, e a limpeza do código de cálculo legado ficou pela metade, criando uma inconsistência ativa hoje (seção 3).

A pergunta que motivou esta auditoria: **"um step que não passamos foi limpar o que tinha de antigo das comissões — pode quebrar algo que já existe hoje?"** As seções abaixo respondem as duas partes.

## 2. Estado real, por step do plano original

| Step (do doc de arquitetura) | O que era | Status real |
|---|---|---|
| 1-7 | Schema novo, CRUD, UI da tela de Comissões, motor novo (`employee-commission-plans.ts`), backfill dos funcionários existentes | ✅ Feito. O backfill (que teria a migration `20240101000091_backfill_legacy_employee_commissions.sql`) **não existe como migration no repositório** — foi feito manualmente pela UI, confirmado pelo usuário nesta mesma sessão de trabalho, não é um buraco a investigar. |
| 8 — cortar os 4 motores de cálculo legados para o motor novo | Preview (`app/utils/service-orders.ts`), snapshot por item (`server/utils/service-order-item-commissions.ts`), liberação (`server/utils/service-order-commissions.ts`), relatórios (`server/utils/sales-item-commissions.ts`) | ✅ Feito nos 3 primeiros (preview, snapshot por item, liberação) — os três têm comentário próprio confirmando que o fallback para `employees.*` foi removido. ⚠️ **Parcial no 4º** (relatórios) — ver seção 3, é exatamente aqui que sobrou código morto/quebrado. |
| 9 — remover a UI antiga do formulário de funcionário | Campos de comissão no cadastro de funcionário | ✅ Feito (commit `98e6b19`). O doc de arquitetura ainda descreve isso como pendente — está desatualizado, não o código. |
| 10 — migration final: dropar as 5 colunas de `employees`, decidir o destino de `has_commission`, remover código morto restante | | ❌ **Não feito.** As colunas continuam existindo em `employees` (criadas em `supabase/migrations/20240101000013_create_employees.sql:52,55,57,60,64`, com CHECK constraints e comentários nas linhas 110-139). Nenhuma migration em todo o histórico dá `DROP COLUMN` nelas — o único `DROP COLUMN` do repositório inteiro é em `products.code` (migration 59), sem relação. |

## 3. O que sobrou de fato: fallback legado de relatório, quebrado em 2 de 3 lugares

`server/utils/sales-item-commissions.ts` existe deliberadamente para uma coisa: reconstruir a comissão por item de **OS anteriores ao motor novo**, que nunca tiveram o snapshot `items[].commissions[]` persistido (só existe o total da OS em `employee_financial_records`). O próprio cabeçalho do arquivo (linhas 1-19) explica isso e diz que é intencional manter esse cálculo antigo — ele reflete fielmente o que rodou na época.

O problema: esse arquivo depende de `employee.has_commission`/`commission_type`/`commission_amount`/`commission_base`/`commission_categories` (interface `CommissionEmployeeRecord`, linhas 23-31) para funcionar — e **três lugares diferentes** chamam esse fallback, mas só **um** ainda busca esses campos do funcionário:

| Tela/endpoint | Como busca funcionários | Fallback legado funciona? |
|---|---|---|
| Relatório "Itens Vendidos" (tela) — `server/api/reports/sales-items.get.ts:268` | `columns: 'id, name'` | ❌ Não — sempre retorna comissão R$0 pra OS antigas sem snapshot |
| Exportação (CSV/PDF) do "Itens Vendidos" — `server/api/reports/export-sales-items.post.ts:230-234` | sem restrição de `columns` → `select('*')` (default de `fetchAllOrganizationRows`, `server/utils/supabase-pagination.ts:49`) | ✅ Sim — ainda recalcula um valor real, porque tem uma cópia própria (não importada) da mesma lógica, linhas 50-59 e 110-147 |
| Relatório "Funcionários" (tela) — via `server/utils/employee-report.ts:169-174`, usado por `server/api/reports/employees.get.ts` e `server/api/reports/export-employees.post.ts` (tela E export) | `columns: 'id, name'` | ❌ Não — mesma causa, sempre R$0 |

**Consequência prática, hoje**: para uma OS antiga o suficiente (criada antes do motor novo, sem breakdown por item persistido), a tela "Itens Vendidos" mostra R$0 de comissão, mas o CSV/PDF exportado da mesma tela mostra um valor calculado de verdade — **os dois podem divergir para o mesmo dado**. O relatório "Funcionários" (tela e export) está consistente entre si, mas sempre em R$0 pra esses casos.

Isso não foi causado por nenhuma mudança desta sessão (bônus, override de comissão) — é resíduo do corte do Step 8 já feito antes, que trocou a busca de funcionários pra só `id, name` nos relatórios (otimização razoável para o caminho novo, que não precisa mais desses campos), sem perceber que o fallback legado dentro do mesmo arquivo ainda dependia deles.

## 4. Resposta direta: "pode quebrar algo que já existe hoje?"

Depende de qual ação for tomada, quando a limpeza for retomada:

- **Remover as 5 colunas de `employees` sem tocar em mais nada**: quebraria o único caminho que ainda funciona (a exportação do "Itens Vendidos", tabela acima) — ele passaria a se comportar como os outros dois (R$0 pra OS antigas), silenciosamente, sem erro. Não quebraria nada além disso, porque nenhum outro código lê essas colunas (confirmado por busca exaustiva, seção 6).
- **Remover só o código morto** (o fallback dos 3 lugares da seção 3), sem tocar nas colunas do banco: seguro, não muda comportamento visível — os dois lugares que já mostram R$0 continuam mostrando R$0 (só que agora por um código mais simples, sem o fallback morto), e a exportação passaria a mostrar R$0 também (alinhando com os outros dois) em vez do valor recalculado atual. Essa é a única mudança de comportamento visível dessa opção, e é uma decisão de produto, não um bug a corrigir tecnicamente.
- **Não mexer em nada agora** (opção escolhida): zero risco, mas a inconsistência tela-vs-export da seção 3 continua existindo para quem consultar OS antigas.

Não há nenhum caminho, no código atual, em que remover as colunas quebre a tela "Itens Vendidos", o relatório "Funcionários", a liberação de comissão, o preview de OS, ou o motor de override manual (`docs/finance/commissions-manual-override.md`) — todos esses já foram migrados e não tocam nas colunas antigas (seção 6 tem a lista completa, arquivo por arquivo).

## 5. Quando a limpeza for retomada — checklist sugerido (nenhum passo feito ainda)

Ordem sugerida, cada item independente e testável isoladamente:

1. **Decidir o que fazer com a divergência da seção 3** — escolher entre (a) remover o fallback legado dos 3 lugares (`sales-item-commissions.ts`, o uso dele em `employee-report.ts`, e a cópia embutida em `export-sales-items.post.ts`), aceitando R$0 consistente em todo lugar para OS antigas sem snapshot; ou (b) restaurar a busca completa de funcionário (`select('*')` ou incluir os 5 campos explicitamente) nos dois relatórios que hoje quebraram, para voltar a reconstruir o valor histórico corretamente em todo lugar, igual à exportação já faz.
2. **Remover a interface `CommissionEmployeeRecord` e as funções `getEmployeeCommissionConfig`/`computeEmployeeItemCommissions`** de `server/utils/sales-item-commissions.ts` (e a cópia em `export-sales-items.post.ts`) — só depois da decisão do item 1, e só se a decisão foi "remover o fallback".
3. **Migration para dropar as colunas** `has_commission`, `commission_type`, `commission_amount`, `commission_base`, `commission_categories` de `employees` — só depois dos itens 1-2 (pra não quebrar a exportação, seção 4). Ação destrutiva sobre dados de produção; fazer com backup do banco antes, e só quando tiver confiança de que não vai precisar consultar essa configuração antiga de novo (os dados históricos de comissão já pagos ficam preservados em `employee_financial_records`, que tem suas próprias colunas de snapshot — não dependem de `employees` continuar com esses campos).
4. **Atualizar os dois documentos desatualizados** (`commissions-configuration-architecture.md` e `commissions-step8-engine-cutover.md`) pra refletir que os Steps 9 e (parte do) 8 já foram feitos, e apontar pra este documento para o estado real do Step 10.
5. Rodar `select * from employees where has_commission = true` (ou equivalente) antes do passo 3, só pra ter um snapshot manual de quais funcionários tinham o quê configurado no modelo antigo, caso alguém precise consultar depois de as colunas já não existirem mais.

## 6. Referência completa — tudo que foi verificado e está OK (não precisa de limpeza)

Confirmado, arquivo por arquivo, que os seguintes **não** são o modelo legado (mesmo usando nomes de campo parecidos como `commission_type`/`commission_base`/`commission_amount`) — pertencem ao modelo novo ou a outras tabelas:

- `lib/utils/employee-commission-engine.ts` — `ResolvedCommissionRule` (motor novo).
- `server/utils/service-order-item-commissions.ts` e `server/utils/service-order-commissions.ts` — leem de `rulesByEmployeeId` (motor novo); comentários próprios confirmam remoção do fallback legado.
- `app/utils/service-orders.ts` — mesma coisa, lado cliente.
- `app/utils/commission-rule-draft.ts`, `VersionModal.vue`, `CommissionRulesPopover.vue`, `app/pages/app/financial/commissions/[id].vue` — operam em `employee_commission_rules` (tela de Comissões).
- `app/types/service-orders.ts` — `commission_type`/`commission_base` pertencem ao snapshot novo em `ServiceOrderItem.commissions[]`; `commission_amount` (linha 148) é a coluna própria `service_orders.commission_amount`, não ligada a `employees`.
- `server/utils/employee-commission-report.ts` e `server/api/reports/commissions/[id].get.ts` — os campos vêm de `employee_financial_records` (snapshot por registro, migration `20240101000054`), tabela separada e ainda ativa.
- `server/utils/bonuses.ts` — `commission_base` aqui é o enum do módulo de Bônus (`revenue`/`profit`/`revenue_minus_parts`/`employee_net_profit`), tabela própria, sem relação com o motor de comissão (ver `docs/finance/bonuses-feature-design.md`).
- Telas de funcionário (`app/pages/app/settings/employees/[id].vue` e `index.vue`) e todos os endpoints de CRUD de funcionário — sem nenhum campo legado, já totalmente migrados.
- Nenhuma interface TypeScript em `app/types/` declara os 5 campos legados; o único resquício é `CommissionEmployeeRecord` em `sales-item-commissions.ts` (seção 3).

`server/api/employees/index.get.ts:21` e `server/api/employees/commission-seed-status.get.ts:79` usam `select('*')` e por isso **hoje** trazem as 5 colunas mortas pro cliente (nenhuma tela usa esse dado) — inofensivo, mas vai precisar de atenção (ou simplesmente vai parar de acontecer sozinho) quando as colunas forem dropadas no passo 3 da seção 5.
