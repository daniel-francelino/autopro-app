# Histórico detalhado da OS (timeline de eventos)

Data: 2026-11-13. Autor: software-architect. Status: **proposta, nada aprovado**. Só documentação: nenhum código, teste, schema ou migração foi alterado.

Legenda: **[V]** verificado no código/docs (caminho citado); **[H]** hipótese ou proposta, não verificada; **[D]** decisão pendente do dono do produto.

Documentos relacionados (não duplicados aqui): `docs/audit/audit-log-plan.md` (auditoria técnica), `docs/service-orders/payment-flow-current.md`, `docs/engineering/pending-bulk-payment-rollback.md`, `docs/product/comissoes-priorizacao.md`, `docs/security/access-control-route-map.md`.

---

## 1. Resumo e recomendação

**Criar uma estrutura nova, append-only, voltada ao cliente (`service_order_events`), gravada por código explícito nos handlers, e NÃO estender `audit_logs`.** A auditoria atual é técnica, por requisição, só do owner da plataforma, com retenção de 6 meses e gravação assíncrona que aceita perda. Nada disso serve a um histórico que o cliente lê e que deve durar tanto quanto a OS. Em contrapartida, reaproveitar dela o `request_id` (correlação), o padrão append-only por trigger e o diff `de/para` já calculado (`diffSnapshots`).

**Requisito adicional (2026-11-13):** o histórico cobre tudo que afeta a OS, **inclusive ações feitas em outras telas** (Financeiro, Relatório de comissões, pagamento em lote), e cada evento registra a **origem (tela)** da ação, separada do ator e exibida ao cliente (seções 5.1, 5.2 e 8).

O histórico é **registro, nunca fonte de verdade financeira**: nenhum saldo, total ou status é lido dele.

---

## 2. Contexto e evidências

### 2.1 Como a auditoria atual funciona [V]

| Aspecto | Fato | Evidência |
|---|---|---|
| Tabela | `audit_logs`, uma linha por requisição `/api/**`, particionada por mês | `supabase/migrations/20240101000097_create_audit_logs.sql` |
| Campos | request_id, organization_id, actor (id, e-mail, role, tipo), action, resource_type/id, método/rota, status, outcome, query/request/response body (jsonb, truncáveis), `changes` (jsonb), IP, user agent, plataforma | idem |
| Quem grava | plugin Nitro automático (camada 1) + `recordAudit(event, {before, after, extra})` nos handlers (camada 2), que só anexa `changes` à mesma linha da requisição | `server/utils/audit/record.ts`, `context.ts` |
| Gravação | fila em memória (flush 2 s/50 linhas) ou `waitUntil`; 1 retry; falha só vira `console.error`; **nunca propaga** | `server/utils/audit/queue.ts` |
| Imutabilidade | trigger bloqueia UPDATE/DELETE; RLS sem policy; só service role | migration 97 |
| Retenção | **6 meses** por DROP de partição | `audit_logs_maintain`, migration 97; `docs/audit/audit-log-plan.md` |
| Acesso | **somente owner da plataforma** (`requireOwner`), tela `/admin/audit`, período máx. 31 dias | `server/api/admin/audit-logs/index.get.ts` |
| Ação da OS | `POST /api/service-orders` vira `service_order.create` ou `service_order.update` (um handler para criar, editar e **avançar status**) | `server/utils/audit/config.ts`, `server/api/service-orders/index.post.ts` |
| Tenant | `organization_id` gravado, mas a tabela é lida só pelo owner (todas as orgs) | idem |

Já existe um "histórico" na tela da OS, mas é frágil [V]: `server/api/service-orders/[id].get.ts` lê as últimas 50 linhas de `audit_logs` (180 dias, `resource_type='service_order'`) e devolve `editLogs`; o tipo existe em `app/types/service-orders.ts:197`, mas **nenhum `.vue` consome `editLogs`** (grep em `app/`). A tabela `service_order_edit_logs` (migration 36) nunca foi gravada. Efeito colateral a corrigir: esse GET expõe a usuários da org o campo `changes`, que é diff bruto de colunas.

### 2.2 Auditoria técnica x histórico ao cliente

| Critério | Auditoria técnica (`audit_logs`) | Histórico da OS |
|---|---|---|
| Público | owner/dev/suporte | usuário da oficina (e talvez cliente final, ver D1) |
| Granularidade | requisição HTTP | fato de negócio ("Parcela 2 recebida") |
| Linguagem | colunas, ids, JSON | pt-BR legível, nomes em vez de ids |
| Completude exigida | amostral aceitável (perda tolerada) | alta (evento financeiro perdido é reclamação) |
| Retenção | 6 meses | vida da OS |
| Conteúdo sensível | bodies, IP, UA, e-mail | só o que o cliente pode ver |
| Falha inclui | sim (denied/error) | só sucesso |

Estender `audit_logs` exigiria: tirar o limite de 6 meses (a partição mensal e o `audit_logs_maintain` assumem isso), abrir leitura a não-owners numa tabela com bodies e IPs, e transformar linha por requisição em vários eventos por requisição (a PK e o `request_id` 1:1 não comportam). Conflito direto; rejeitado.

### 2.3 Mapa de pontos de mudança da OS e do fluxo financeiro [V]

Todos em `server/api/**` usando service role, sem transação de banco (ver 4.1). Permissão atual entre parênteses.

**OS (`server/api/service-orders/`)**
| Handler | Efeito | Permissão |
|---|---|---|
| `index.post.ts` | criar OS (insert), editar campos/itens/responsáveis/status (update), cria compromisso (`appointments`) opcional; recalcula snapshot de comissão dos itens | `orders.create` ou `orders.update` |
| `[id]/cancel.post.ts` | status `cancelled`; apaga extratos, lançamentos, comissões (delete físico) | `orders.cancel` |
| `[id].delete.ts` | soft delete da OS + remoção de extratos, comissões, parcelas, lançamentos | `orders.delete` |
| `[id]/process-payment.post.ts` | gera plano de pagamento (parcelas), pode marcar `commission_release_mode='full'`, reconcilia sinal, chama liberação de comissão | `orders.pay` |
| `[id]/down-payment.post.ts` | sinal (parcela `down_payment` + lançamento) | `orders.pay` |
| `[id]/receive-extra-payment.post.ts` | recebimento extra | `orders.pay` |
| `[id]/installments/[installmentId]/pay.post.ts` | paga parcela (lançamento, saldo, extrato), recalcula `payment_status`, libera comissão | `orders.pay` |
| `[id]/installments/[installmentId].patch.ts` | edita parcela pendente | `orders.update` |
| `[id]/installments/[installmentId].delete.ts` | remove parcela (soft, com motivo) e estorna recebimento/comissão | `financial.delete` |
| `[id]/payment.delete.ts` | remove pagamento da OS (apaga extratos, comissões, parcelas; soft delete lançamentos) | `orders.cancel` |
| `[id]/financial-transactions/[transactionId].delete.ts` | desfaz um recebimento específico (`reverseServiceOrderReceipt`) | `orders.cancel` |
| `[id]/generate-commissions.post.ts` | regeneração manual de comissões (`releaseServiceOrderCommissions`) | `orders.update` |

**Fora da pasta da OS, mas afetam a OS**
- `server/api/financial/pay-commissions-bulk.post.ts`: paga comissão (lançamento, saldo, extrato, marca `employee_financial_records` pago). Chamado também pelo card de comissões da OS (`OSCommissionsCard.vue`). Rollback best-effort com `catch {}` vazio (ver `docs/engineering/pending-bulk-payment-rollback.md`).
- `server/api/financial/pay-entries-bulk.post.ts`: paga lançamentos em lote, incluindo os vinculados a comissão de OS.
- `server/api/financial/[id].delete.ts`: exclui lançamento; se for recebimento de OS usa `reverseServiceOrderReceipt` (`server/utils/service-order-receipt-reversal.ts`).
- `server/api/reports/commissions/[id]/pay.post.ts` e `[id].delete.ts`: pagar individualmente e **apagar fisicamente** comissão (o `docs/product/comissoes-priorizacao.md` P0-1 trata disso: a exclusão de comissão paga é origem de pagamento em dobro).
- Utilitários compartilhados que concentram a lógica (melhores pontos de instrumentação): `server/utils/service-order-commissions.ts` (`releaseServiceOrderCommissions`, que cria linhas `pending` com o delta e apaga pendentes), `service-order-receipt-reversal.ts`, `service-order-payment-status.ts` (`recalculateServiceOrderPaymentStatus`), `financial-transaction-deletion.ts`.
- NFS-e e ajustes manuais de comissão: `service_orders.commission_manual_adjustments_log` (jsonb, migration 93) e `service_order_nfse`; escopo de fatia posterior.

**Varredura adicional (2026-11-13) de outros caminhos que alteram OS, pagamentos, comissões e lançamentos vinculados** [V: grep de `service_order_id`, `employee_financial_record_id` e `.insert/.update/.delete` em `server/api` e `server/utils`, com leitura dos trechos citados]:

| Caminho | Afeta a OS? | Evidência | Origem esperada | Novo? |
|---|---|---|---|---|
| `financial/[id]/pay.post.ts` (pagar lançamento avulso) | Sim, se o lançamento for de OS ou de comissão. **[H]** o handler não referencia `employee_financial_record_id` nem `service_order_*` (grep vazio), então pagar por aqui um lançamento de comissão pode deixar o registro da comissão `pending`. Tema de integridade, não de histórico (D13) | `server/api/financial/[id]/pay.post.ts`; contraste com `pay-entries-bulk.post.ts:131-141`, que sincroniza | `financial_entries` | **Sim** |
| `financial/[id].put.ts` (editar lançamento: `amount`, `due_date`, `status`, `bank_account_id`) | Sim, para lançamento de recebimento da OS ou de comissão: altera valor/status sem passar pela OS | `server/api/financial/[id].put.ts:42` (campos permitidos) | `financial_entries` | **Sim** |
| `financial/update-recurring.post.ts`, `financial/[id]/extend-recurrence.post.ts`, `financial/index.post.ts` | Não verificado vínculo com OS; recorrentes/manuais normalmente não têm `service_order_id` | só nomes e tabelas tocadas | `financial_entries` | Checar; provável fora de escopo |
| `financial/pay-entries-bulk.post.ts` | Sim: atualiza `employee_financial_records` quando há `employee_financial_record_id` | `pay-entries-bulk.post.ts:131-141` | `financial_bulk` | já listado |
| `financial/pay-commissions-bulk.post.ts` | Sim | já listado | `os_detail` ou `commission_report` (só o header distingue) | já listado |
| `reports/commissions/[id]/pay.post.ts` e `[id].delete.ts` | Sim | já listado | `commission_report`; `bonus_page` para o pay chamado da tela de bônus (route-map V16) | já listado |
| `financial/[id].delete.ts` | Sim (reversão de recebimento da OS) | já listado | `financial_entries` | já listado |
| `bonuses/[id]/generate.post.ts`, `bonuses/[id]/financial-records/[recordId].delete.ts` | **Não afetam a OS**: registros com `service_order_id: null` (`generate.post.ts:143`) | verificado | n/a | Excluído |
| `appointments/index.post.ts`, `[id].put.ts`, `[id].delete.ts` | Sim, quando `service_order_id` informado/alterado | `appointments/index.post.ts:36`, `[id].put.ts:34` | `appointments` | **Sim** (F3) |
| `fiscal/nfse/index.post.ts` (+ `server/utils/nfse-sync.ts`, `DELETE fiscal/nfse/:id`, `hook`, `email`) | Sim: emite/cancela NFS-e vinculada à OS e grava `service_order_nfse` | `fiscal/nfse/index.post.ts:57-61`, `nfse-sync.ts` | `fiscal`; ou `os_detail` quando emitida do modal da OS (`NfseIssueModal.vue`) | **Sim** (F3) |
| `clients/*`, `vehicles/*`, `clients/batch.post.ts` | Indireto: a OS referencia `client_id`/`vehicle_id`. **[H]** alterar/excluir cliente ou veículo não altera a OS; grep em `clients/[id].delete.ts` e `vehicles/[id].delete.ts` não achou referência a OS | grep | `clients`, `vehicles` | D11: recomendado NÃO entrar no histórico (o evento guarda nome em snapshot) |
| `employees/*`, `commissions/[id]/assignments`, `versions` (regras e atribuições) | Indireto: mudam o cálculo de **futuras** liberações/recálculos (`resolveCommissionPlanRules`). Para explicar ao cliente, `commission.released/recalculated` deve registrar no payload **qual regra/plano** foi usada (P0-6 de `docs/product/comissoes-priorizacao.md`) | `index.post.ts:156-193` | `settings` | Dado do payload, sem evento próprio |
| `bank-accounts/*`, `purchases/*`, `products/*` | Não afetam a OS diretamente | n/a | n/a | Excluído |
| `admin/**` (owner) | Possível ação do suporte em dados da OS: **não verificado** | n/a | `admin_support` | Verificar |
| Jobs/sistema | Nenhum job que altere OS encontrado (só `server/plugins/audit-log.ts`); `actor_type='system'` fica reservado | grep | `system` | n/a |

Conclusão: além dos handlers já listados, entram `financial/[id]/pay`, `financial/[id].put`, `appointments/*` (vinculados a OS) e as rotas de NFS-e. Cliente, veículo e funcionário ficam fora do histórico da OS (D11).

**"Regeneração de pagamentos"**: não existe rota com esse nome [V]. O que existe é (a) `process-payment` gerando plano, (b) `payment.delete` removendo o pagamento (permitindo gerar de novo) e (c) `generate-commissions` (regeneração de **comissões**, "sem uso no frontend" segundo `docs/service-orders/payment-flow-redesign.md:202`, mas o front de `OSResponsiblesCard.vue` a chama segundo o route-map). **[D2]** confirmar com o dono o que "regeneração de pagamentos" significa: provavelmente remover pagamento + gerar plano novo, o que no histórico é uma correlação de eventos, não um evento novo.

### 2.4 Fatos de negócio que impactam o histórico [V]
- Comissão paga pode ser apagada fisicamente em vários fluxos (`payment.delete`, `cancel`, `[id].delete`, `reports/commissions/[id].delete`, `releaseServiceOrderCommissions` para pendentes). Depois disso **não sobra rastro** na linha da comissão. O histórico precisa gravar o fato antes/junto com o apagamento.
- Não há transação de banco nos handlers (três usos de `.rpc`, todos para numeração: `next_service_order_number`). Rollbacks são manuais e best-effort.
- Itens da OS vivem em `service_orders.items` (jsonb) e não em tabela própria [V, `index.post.ts:192`]; o diff de itens precisa ser feito por chave de item.

---

## 3. Decisão: novo event log x estender auditoria

| Opção | Prós | Contras | Veredito |
|---|---|---|---|
| A. Estender `audit_logs` (campos novos + texto legível) | Zero tabela nova; infra pronta | Retenção 6 meses; owner-only; 1 linha/requisição; gravação que pode perder; dados sensíveis (bodies/IP) na mesma tabela; texto de cliente acoplado a um log técnico | Rejeitada |
| B. Derivar a timeline em leitura a partir de `audit_logs` | Sem nova gravação | Mesmos limites de retenção e perda; precisa interpretar diffs brutos; comissões apagadas fisicamente só aparecem se o log existir | Rejeitada (serve só como fonte de backfill parcial) |
| **C. Tabela nova `service_order_events`, gravada explicitamente, append-only** | Retenção própria; permissão própria; um evento = um fato; payload estruturado; correlável com a auditoria por `request_id` | Instrumentar cada handler; risco de esquecer um ponto; duas trilhas a manter | **Recomendada** |
| D. Triggers de banco (CDC) | Não esquece ponto de escrita | Sem contexto de ator/motivo; linguagem de negócio impossível; o plano de auditoria já descartou a camada 3 | Rejeitada |

Mitigação do risco da C (esquecer pontos): concentrar a gravação em **funções de domínio** (`recordOsEvent`) chamadas pelos utilitários compartilhados (seção 6) e cobrir com um teste que lista os handlers de escrita da OS e exige ao menos um evento por caminho de sucesso.

---

## 4. Gravação: atomicidade, idempotência, ordem

### 4.1 Atomicidade [V + H]
- [V] Não há transação nos fluxos: cada passo é uma chamada supabase-js independente. Atomicidade real "mesma transação" **não é obtível sem reescrever os fluxos como funções SQL (RPC)**, fora do escopo e de alto risco financeiro.
- [H] Alternativa pragmática recomendada: **gravar o evento de forma síncrona (`await`), logo após o passo de negócio que o originou ter dado certo, dentro da mesma requisição**, sem fila em memória nem `waitUntil` (diferente de `audit_logs`). Consequências aceitas e explícitas:
  - Falha do negócio => nenhum evento (correto).
  - Negócio ok + falha do insert do evento => evento perdido. Mitigação: 1 retry, log de erro com `request_id`, e a resposta **não falha** (não se desfaz dinheiro por falta de histórico). **[D3]** confirmar que perder um evento é preferível a falhar a operação.
  - Evento gravado e negócio falhando depois (rollback manual): gravar o evento **depois** do último passo irreversível; para fluxos com rollback (pay-commissions-bulk), gravar só após o item ser confirmado como `paid`.
- [H] Evolução futura: quando um fluxo financeiro migrar para RPC SQL, o insert do evento entra na mesma função/transação. O modelo de dados proposto já é compatível (insert simples).

### 4.2 Idempotência
- Coluna `idempotency_key` (única por organização) composta por `(tipo de evento, entidade, id do efeito)`, ex.: `installment_paid:<installment_id>:<financial_transaction_id>`. Reenvio/retry de requisição não duplica; `INSERT ... ON CONFLICT DO NOTHING`.
- Duplo clique em pagar hoje pode pagar duas vezes (P0-2 de `docs/product/comissoes-priorizacao.md`); o histórico **não resolve** isso, mas deve refletir fielmente o que ocorreu (dois lançamentos = dois eventos, chaves distintas por `financial_transaction_id`).

### 4.3 Ordem temporal
- `occurred_at timestamptz default now()` gravado no servidor + `seq bigint identity` global para desempate. Ordenar por `(occurred_at, seq)`. Num fluxo multi-passos, a ordem de gravação reflete a ordem de execução; eventos de uma ação têm o mesmo `correlation_id` e `step` (inteiro) para ordenação interna.

### 4.4 Correlação
- `correlation_id` = `request_id` da requisição (já existe em `event.context.audit.requestId`) [V]. Agrupa: "Pagamento removido" + "Parcelas removidas" + "Comissão estornada" de uma mesma ação, e liga ao `audit_logs` para o suporte. Opcional `parent_event_id` para "causado por".
- Comissão paga em lote que atinge várias OS: um evento por OS, mesmo `correlation_id`.

---

## 5. Modelo de dados proposto [H]

```
service_order_events (append-only; sem UPDATE/DELETE por trigger, como audit_logs)
  id                uuid pk
  seq               bigint generated always as identity
  organization_id   uuid not null            -- tenant
  service_order_id  uuid not null
  occurred_at       timestamptz not null default now()
  event_type        varchar(60) not null     -- catálogo da seção 6, ex.: 'installment.paid'
  schema_version    smallint not null default 1
  category          varchar(20) not null     -- 'order' | 'items' | 'status' | 'payment' | 'commission' | 'fiscal'
  visibility        varchar(20) not null     -- 'general' | 'financial' | 'commission' (controla quem lê, seção 7)
  actor_type        varchar(20) not null     -- 'user' | 'system' | 'job' | 'owner'
  actor_user_id     uuid null
  actor_name        varchar(200) null        -- snapshot do nome (não só o e-mail)
  entity_type       varchar(40) null         -- 'installment' | 'commission_record' | 'financial_transaction' | 'item' ...
  entity_id         uuid null
  payload           jsonb not null           -- estruturado: { changes:[{field,label,from,to}], amounts:..., refs:... } já com valores legíveis resolvidos
  correlation_id    uuid not null            -- request_id
  source_code       varchar(40) not null     -- catálogo fechado (5.1), ex.: 'commission_report'
  source_label      varchar(120) not null    -- snapshot legível em pt-BR, ex.: 'Relatórios > Comissões'
  source_declared   varchar(40) null         -- o que o front declarou (rastro de divergência)
  source_trust      varchar(10) not null     -- 'inferred' | 'declared' | 'mismatch' (5.2)
  idempotency_key   varchar(200) null
  origin            varchar(20) not null default 'live'  -- 'live' | 'backfill'
  unique (organization_id, idempotency_key)
  index (organization_id, service_order_id, occurred_at desc, seq desc)
  index (organization_id, event_type, occurred_at desc)
```

Decisões do modelo:
- **Sem `message` pronto como fonte única.** Gravar `event_type` + `payload` estruturado e **renderizar pt-BR na leitura** por templates versionados (`schema_version`). Motivos: rótulos e redação podem melhorar sem reescrever histórico; i18n futura; correção de erro de redação retroativa. Custo: renderizador deve tolerar versões antigas.
- **Mas o payload guarda valores já legíveis** (nome do funcionário, nome do cliente, "Em andamento -> Concluída", `R$ 150,00`) como snapshot no momento do fato, pois ids viram nomes diferentes depois (renomeação, exclusão lógica). Ids ficam em `entity_id`/`refs` só para o suporte, e a API de cliente não os devolve.
- Valores monetários gravados como número (centavos ou decimal) no payload; formatação na leitura. Nunca ler o histórico para calcular saldo, comissão ou lucro.
- Particionamento: **não no início**. Volume esperado baixo (dezenas de eventos por OS; ver 9.3). Reavaliar por `organization_id`/ano se passar de dezenas de milhões de linhas.
- RLS ligado sem policy, leitura só via API (mesmo padrão de `audit_logs`) [V padrão, H aplicação].
- Tabela morta `service_order_edit_logs` (migration 36): substituir por esta; remoção da antiga é decisão separada (o plano de auditoria já previa removê-la).


### 5.1 Origem (tela) do evento, separada do ator [H]

O **ator** responde "quem" (usuário, sistema, owner); a **origem** responde "de onde" (qual tela/fluxo). São colunas distintas (`actor_*` x `source_*`): a mesma pessoa paga comissão pela OS ou pelo Relatório, e o cliente precisa ver a diferença. Mensagem: "Comissão paga por Maria, pela tela Relatórios > Comissões."

Catálogo **fechado** de origens (`source_code` e rótulo pt-BR). Os rótulos devem espelhar os nomes do menu do app (aprovar a redação, D12):

| `source_code` | Rótulo exibido | Telas/fluxos |
|---|---|---|
| `os_detail` | Ordem de serviço (detalhe) | `service-orders/detail/*` (pagamento, parcelas, comissões, responsáveis, cabeçalho) |
| `os_form` | Ordem de serviço (cadastro/edição) | `CreateModal.vue`, edição e avanço de status em `service-orders.vue` |
| `os_list` | Ordem de serviço (lista) | cancelar/excluir/duplicar pela lista (`service-orders.vue`, `OrderCard.vue`) |
| `financial_entries` | Financeiro > Lançamentos | `app/pages/app/financial/index.vue` (pagar, editar, excluir lançamento) |
| `financial_bulk` | Financeiro > Pagamento em lote | `pay-entries-bulk` (chamado em `financial/index.vue:523`) |
| `commission_report` | Relatórios > Comissões | `reports/commissions.vue` (pagar, excluir, lote) |
| `commission_bulk` | Pagamento de comissões em lote | `pay-commissions-bulk` a partir do relatório |
| `bonus_page` | Financeiro > Bônus | `financial/bonuses/[id].vue` chamando `reports/commissions/:id/pay` |
| `appointments` | Agenda | `appointments/*` |
| `fiscal` | Fiscal > NFS-e | `fiscal/nfse/**` |
| `system` | Sistema | processamento interno sem tela (reconciliação/recálculo disparado por outra ação) |
| `admin_support` | Suporte AutoPro | ação do owner pela área `/admin` |
| `api` | Integração/API | chamada sem identificação de tela |
| `unknown` | Origem não identificada | fallback final |

Nota: `pay-commissions-bulk` é chamado de duas telas (`OSCommissionsCard.vue:49` e `reports/commissions.vue:271`, route-map V1); só o header distingue `os_detail` de `commission_report`. Inferir só pela rota é insuficiente para esse e outros endpoints compartilhados. Eventos em cascata herdam a origem da requisição que os causou (comissão removida por `payment.delete` tem origem `os_detail`); reconciliação interna automática usa `system` com `parent_event_id` apontando para o evento causador.

### 5.2 Como capturar a origem: header x inferência x combinação [V fatos, H avaliação]

Fatos [V]: o servidor não sabe qual tela chamou. Existe um ponto central no front, `app/plugins/api-client.client.ts`, que envolve `$fetch` e já injeta `x-client-platform` em toda chamada `/api/`; o servidor já lê esse header (`server/plugins/audit-log.ts:86`, `server/utils/analytics/record.ts:81`). O mecanismo de header central tem precedente no projeto.

| Opção | Confiabilidade | Cobertura | Esforço | Problemas |
|---|---|---|---|---|
| A. Só inferir pela rota | Alta (vem do servidor) | Parcial: ambígua em endpoints compartilhados (`pay-commissions-bulk`, `reports/commissions/:id/pay`, `POST service-orders` usado para criar/editar/avançar status/NFS-e) | Baixo | Não distingue a tela |
| B. Só header do front (`x-origin`) | Declarativa: o cliente pode errar ou mentir | Total se todas as telas enviarem | Médio | Telas esquecem de enviar; valor não confiável |
| **C. Combinação (recomendada)** | Rota dá o valor-base; header refina | Total | Médio | Exige regras de validação |

Regras da combinação (C):
1. **Header `x-origin`** enviado de forma central. Para nenhuma tela precisar lembrar, o plugin `api-client.client.ts` acrescenta `x-origin` derivado da **rota atual do Vue Router** (mapa fixo rota-da-página para `source_code`). Um composable (ex.: `withOrigin('financial_bulk', fn)`) sobrescreve em ações específicas. Telas novas ganham origem por padrão; a exceção é explícita.
2. **Validação no servidor**: o valor deve estar no catálogo fechado (allowlist em módulo como `server/utils/os-history/sources.ts`, nome sugerido). Ausente ou fora do catálogo: descartado.
3. **Coerência com a rota**: cada endpoint declara `defaultSource` e `allowedSources`. Ex.: `reports/commissions/[id]/pay` aceita `commission_report` e `bonus_page`; `financial/[id].delete` aceita `financial_entries`. Header fora do conjunto aceito: usa a origem inferida, marca `source_trust='mismatch'` e guarda o valor em `source_declared`.
4. **Fallback**: header ausente usa a origem inferida (`defaultSource`). Endpoint compartilhado sem header usa rótulo genérico do fluxo (ex.: "Pagamento de comissão") em vez de adivinhar a tela. Sem nada: `unknown`.
5. `source_trust`: `declared` (header válido e coerente), `inferred` (só rota), `mismatch`.
6. **A origem é informação de exibição e suporte, nunca de segurança.** Autorização segue por `requireOrgPermission`; `x-origin` não concede nem retira acesso. Quem forja só escolhe outra origem dentro do conjunto aceito pela rota; ator e `correlation_id` continuam definidos pelo servidor. Não usar `Referer` como fonte primária (instável no app Capacitor).
7. `x-client-platform` (web/ios/android) pode ser gravado como dado de suporte, não exibido ao cliente.

Teste de cobertura: todo endpoint instrumentado deve declarar `defaultSource`; a tabela 6 serve de lista esperada.

---

## 6. Catálogo de eventos proposto e instrumentação [H]

Fatia indicada: F1 = pagamentos/comissões, F2 = status/campos/itens, F3 = ciclo de vida e demais. Exemplos de mensagem para o cliente.

| Evento (`event_type`) | Gatilho (arquivo / função) | Mensagem de exemplo (pt-BR) | Origem esperada | Fatia |
|---|---|---|---|---|
| `order.created` | `service-orders/index.post.ts`, ramo insert | "OS nº 4012 criada por Maria." | `os_form` | F2 |
| `order.fields_changed` | `index.post.ts`, ramo update; diff `existingOrder` x `savedOrder` | "Maria alterou: Defeito relatado de 'barulho no motor' para 'barulho e perda de potência'; Km de 85.000 para 85.320." | `os_form` | F2 |
| `order.status_changed` | `index.post.ts` (campo `status`); `cancel.post.ts` | "Status alterado de 'Em andamento' para 'Concluída' por João." | `os_form`, `os_list` (cancelar) | F2 |
| `order.item_added` / `item_changed` / `item_removed` | `index.post.ts`, diff do jsonb `items` por chave de item (peça ou serviço) | "Peça 'Filtro de óleo' adicionada (2 x R$ 35,00)." / "Serviço 'Troca de correia': valor de R$ 300,00 para R$ 350,00." | `os_form` | F2 |
| `order.responsibles_changed` | `index.post.ts` (`responsible_employees`) | "Responsável 'Carlos' adicionado." | `os_form` | F2 |
| `order.discount_changed` | `index.post.ts` | "Desconto alterado de R$ 0,00 para R$ 50,00." | `os_form` | F2 |
| `order.cancelled` | `cancel.post.ts` | "OS cancelada por João. Pagamentos e comissões vinculados foram removidos." (referencia as correlações) | `os_detail`, `os_list` | F1 |
| `order.deleted` | `[id].delete.ts` | "OS excluída por João." | `os_detail`, `os_list` | F3 |
| `payment.plan_created` | `process-payment.post.ts` | "Plano de pagamento criado: 3 parcelas, total R$ 900,00." | `os_detail` | F1 |
| `payment.down_payment_received` | `down-payment.post.ts` | "Sinal de R$ 200,00 recebido via PIX em 12/11." | `os_detail` | F1 |
| `payment.extra_received` | `receive-extra-payment.post.ts` | "Recebimento adicional de R$ 100,00 registrado." | `os_detail` | F1 |
| `installment.paid` | `installments/[installmentId]/pay.post.ts` | "Parcela 2 de 3 recebida: R$ 300,00 em dinheiro." | `os_detail` | F1 |
| `installment.edited` | `installments/[installmentId].patch.ts` | "Parcela 3: vencimento alterado de 10/12 para 15/12." | `os_detail` | F1 |
| `installment.removed` | `installments/[installmentId].delete.ts` | "Parcela 2 removida por Maria. Motivo: lançamento em duplicidade." (usa `deletion_reason`) | `os_detail` | F1 |
| `receipt.reversed` | `financial-transactions/[transactionId].delete.ts`, `financial/[id].delete.ts` via `reverseServiceOrderReceipt` | "Recebimento de R$ 300,00 desfeito por Maria." | `os_detail`, `financial_entries` | F1 |
| `payment.deleted` | `payment.delete.ts` | "Pagamento da OS removido por João: recebimentos desfeitos e plano de pagamento apagado." | `os_detail` | F1 |
| `payment.plan_regenerated` | **não é rota própria**: derivado quando `process-payment` ocorre numa OS que já teve `payment.deleted` (correlação, **[D2]**) | "Plano de pagamento gerado novamente: 2 parcelas, total R$ 900,00." | `os_detail` | F1 |
| `payment.status_changed` | `recalculateServiceOrderPaymentStatus` (`service-order-payment-status.ts`), só quando muda | "Situação do pagamento alterada de 'Pendente' para 'Parcialmente pago'." | herda da ação causadora | F1 |
| `commission.released` | `releaseServiceOrderCommissions` (`service-order-commissions.ts`), ao criar a linha `pending` | "Comissão de R$ 45,00 liberada para Carlos (proporcional ao recebido)." | herda da ação causadora (`os_detail` ou `system`) | F1 |
| `commission.release_mode_changed` | `process-payment.post.ts` (`commission_release_mode='full'`) | "Comissões da OS passaram a ser liberadas integralmente, sem esperar o recebimento." | `os_detail` | F1 (regra sensível, ver D5) |
| `commission.recalculated` / `commission.removed_pending` | `releaseServiceOrderCommissions` (apaga pendentes), `generate-commissions.post.ts` | "Comissão pendente de Carlos recalculada: de R$ 45,00 para R$ 52,00." | `os_detail` | F1 |
| `commission.paid` | `financial/pay-commissions-bulk.post.ts`; `reports/commissions/[id]/pay.post.ts`; `pay-entries-bulk` (quando o lançamento é de comissão) | "Comissão de R$ 45,00 paga a Carlos em 13/11 (conta Caixa)." | `os_detail`, `commission_report`, `commission_bulk`, `financial_bulk`, `bonus_page` | F1 |
| `commission.payment_reversed` / `commission.deleted` | `reports/commissions/[id].delete.ts`; `payment.delete.ts`; `cancel.post.ts`; `[id].delete.ts`; `installments/.../delete` | "Comissão de R$ 45,00 de Carlos removida por Maria." Quando era comissão paga: texto reforçado "(já estava paga)" | `commission_report`, `os_detail`, `os_list` | F1 |
| `commission.manual_adjusted` | `generate-commissions`/`index.post.ts` (`commission_manual_adjustments_log`) | "Comissão de Carlos ajustada manualmente para R$ 60,00." | `os_form`, `os_detail` | F3 |
| `appointment.created` | `index.post.ts` (agendamento junto da OS) | "Agendamento criado para 20/11 às 08:00." | `os_form`, `appointments` | F3 |
| `entry.edited` | **novo**: `financial/[id].put.ts` quando o lançamento tem `service_order_id` ou `employee_financial_record_id` (valor, vencimento, status, conta) | "Maria alterou o recebimento vinculado à OS: valor de R$ 300,00 para R$ 250,00, pela tela Financeiro > Lançamentos." | `financial_entries` | F1 |
| `entry.paid_outside_os` | **novo**: `financial/[id]/pay.post.ts` e `pay-entries-bulk.post.ts` para lançamento de OS ou de comissão | "Lançamento da comissão de Carlos marcado como pago por Maria, pela tela Financeiro > Pagamento em lote." | `financial_entries`, `financial_bulk` | F1 |
| `entry.deleted` | **novo**: `financial/[id].delete.ts` para lançamento de OS ou comissão (`reversed_service_order_receipt`) | "Maria excluiu o lançamento de R$ 300,00 pela tela Financeiro > Lançamentos. Motivo: duplicidade." (vira `receipt.reversed` quando reverte recebimento da OS) | `financial_entries` | F1 |
| `appointment.linked` / `appointment.changed` / `appointment.removed` | **novo**: `appointments/[id].put.ts`, `[id].delete.ts`, `index.post.ts` com `service_order_id` | "Agendamento da OS alterado para 22/11 às 09:00, pela tela Agenda." | `appointments` | F3 |
| `nfse.issued` / `nfse.cancelled` | rotas fiscais (`server/api/fiscal/nfse/**`, vínculo a verificar) | "NFS-e nº 123 emitida." | `os_detail`, `fiscal` | F3 |

Pontos de instrumentação preferidos:
1. **Funções de domínio compartilhadas** primeiro: `releaseServiceOrderCommissions`, `reverseServiceOrderReceipt`, `recalculateServiceOrderPaymentStatus`, `softDeleteFinancialTransaction`. Cobrem vários handlers de uma vez e reduzem esquecimento.
2. Depois os handlers (`pay`, `process-payment`, `payment.delete`, `cancel`, `pay-commissions-bulk`...), via helper único `recordOsEvents(event, supabase, events[])` que injeta organização, ator, `correlation_id` e `occurred_at`, e faz `ON CONFLICT DO NOTHING`.
3. Diff de campos e itens num módulo puro (`server/utils/os-history/diff.ts`, [H] nome sugerido), reaproveitando `diffSnapshots` de `server/utils/audit/record.ts`, com **allowlist de campos** mapeada para rótulos pt-BR. Campo fora da allowlist (colunas internas, snapshots de comissão dos itens) não vira evento de cliente.
4. Cuidado com o diff de `items`: o jsonb carrega `commissions[]`/`commission_total` por item (snapshot de comissão). Remover esses campos do diff de itens para não vazar comissão no evento visível a quem não pode ver comissão.

Casos especiais verificados [V] que o catálogo cobre: comissão apagada fisicamente (evento é o único rastro); lote (`pay-commissions-bulk`) com falha parcial e rollback best-effort (gravar só o que confirmou `paid`; a falha de rollback segue como pendência de integridade, não de histórico).

---

## 7. Permissões, tenant e dados sensíveis

- **Tenant [V padrão]**: toda leitura filtra por `organization_id` resolvido do usuário (padrão de `service-orders/[id].get.ts`, que usa `resolveOrganizationId` e `.eq('organization_id', ...)`); a OS é validada na org antes de listar eventos (404 se não for da org). Nunca aceitar `organization_id` do cliente.
- **Quem lê [H]**: endpoint exige `orders.read` e filtra eventos por `visibility`:
  - `general`: qualquer um com `orders.read`;
  - `financial` (valores recebidos, parcelas, plano): exige permissão financeira da OS. Hoje o gate de pagamento é `orders.update` no front e `orders.pay` no plano (route-map V5): **usar o mesmo critério que for decidido no rollout** (`docs/engineering/access-control-rollout-plan.md`), sem criar regra paralela;
  - `commission` (valor e pagamento de comissão por funcionário): exigir a permissão que governa ver comissão (ex.: `reports.commissions` / `employees.read`, ver route-map V4). Verificar com o rollout qual é o equivalente "ver comissão de OS" antes de implementar. **[D4]**
  - Evento sem permissão: omitido da lista (não mascarado), para não vazar nem a existência.
- Possível ação nova `orders.history` não é recomendada de início: o catálogo de ações exige migração de seed (`supabase/migrations/..._seed_*_actions.sql`) e concessão a perfis; usar o que existe.
- **Não expor**: ids crus, e-mails de outros usuários (mostrar nome), IP, user agent, bodies, `correlation_id` (útil ao suporte: devolver só para owner/admin, ou omitir da API de cliente). O `request_id` serve ao dev para abrir `audit_logs` correspondente.
- **Owner/suporte**: acesso total pela tela `/admin` (nova aba ou link a partir da auditoria), seguindo `requireOwner`. Não misturar com a rota de cliente.
- **Dado pessoal**: o payload não guarda CPF/telefone; guarda nomes (cliente, funcionário). Definir retenção (D6).

---

## 8. API de leitura e UI (direção) [H]

API (nova, na pasta da OS):
- `GET /api/service-orders/:id/history` com `orders.read`.
- Parâmetros: `source` (código de origem), `cursor` (por `(occurred_at, seq)`, paginação por keyset, melhor que offset em tabela append-only), `limit` (padrão 30, máx. 100), `category`, `type`, `from`, `to`, `actor` (id do usuário). Ordem decrescente.
- Resposta: itens já **renderizados**: `{ id, occurredAt, category, title, description, details:[{label, from, to}], actorName, source:{code,label}, groupId }`. `groupId` = `correlation_id` opaco, para agrupar visualmente uma ação (ex.: remoção de pagamento com 4 efeitos).
- O renderizador de texto roda no servidor (um único lugar, testável, aplica a filtragem por permissão). Alternativa de renderizar no front só se houver exigência de i18n no cliente (**[D7]**).
- Remover `editLogs` bruto de `[id].get.ts` quando a timeline estiver no ar (hoje vaza `changes` brutos e ninguém consome).
- Para o suporte: `GET /api/admin/service-orders/:id/events` (owner) devolve payload cru + `correlation_id` + link para `audit_logs` por `request_id`.

UI (direção; sem implementação aqui):
- Nova aba/seção "Histórico" em `app/components/service-orders/detail/Modal.vue` (ou card como os `OS*Card.vue`), usando o componente Nuxt UI `UTimeline` (já usado em `app/components/financial/entries/DetailSlideover.vue`), `UBadge` por categoria, `USelectMenu`/`UInput` de período para filtros, `UButton` "Carregar mais" (cursor), `UAccordion` ou `details` para o de/para.
- **Origem na UI**: cada item mostra a origem em linguagem natural ("Comissão paga por Maria, pela tela Relatórios > Comissões") e um `UBadge` discreto com o rótulo da tela; filtro por origem (`USelectMenu`). Origem `unknown` ou só inferida sem tela aparece como "Origem não identificada", sem sugerir erro. Quando a ação ocorreu fora da OS (`source_code` diferente de `os_*`), destacar com ícone para o cliente notar que veio de outra tela. Agrupamento por dia e por `groupId`. Linguagem: valores monetários em BRL, datas `dd/MM/yyyy HH:mm`, status com rótulos já traduzidos do app.
- Recomenda-se `/design-plan` (ux-ui-designer) antes de implementar a UI, e `/design-review` depois.

---

## 9. Rollout, backfill, volume e retenção

### 9.1 Fatias entregáveis
1. **F0 - Base**: catálogo de origens + validação no servidor + `x-origin` central em `api-client.client.ts` (mapa rota-para-origem, `defaultSource`/`allowedSources` por endpoint); migration da tabela (com colunas de origem) + trigger append-only + RLS; helper `recordOsEvents`; renderizador com 2 eventos; endpoint de leitura com filtro de tenant e de permissão; testes de isolamento. Sem instrumentar nada além de 1 evento de prova.
2. **F1 - Pagamentos e comissões, inclusive ações feitas fora da OS (Financeiro, Relatório de comissões, lotes: `entry.*`, `commission.paid` por `commission_report`/`commission_bulk`/`financial_bulk`) (maior valor, ligado à reclamação em `docs/product/comissoes-priorizacao.md`)**: `installment.paid`, `payment.*`, `receipt.reversed`, `commission.*`, `order.cancelled`, instrumentando primeiro os utilitários compartilhados. UI mínima (lista simples).
3. **F2 - Edição e status**: `order.created`, `fields_changed`, `status_changed`, itens, responsáveis, desconto, com allowlist de campos e rótulos.
4. **F3 - Restante**: exclusão da OS, ajuste manual de comissão, NFS-e, agendamento; aba de suporte no `/admin`.
5. **F4 - Acabamento**: UI final conforme `/design-plan`, filtros, remoção de `editLogs` bruto, decisão sobre `service_order_edit_logs`.

Cada fatia é independente e reversível (só adiciona gravação; nenhuma mudança de comportamento de negócio).

### 9.2 Backfill
- **Não recomendado como parte do núcleo.** `audit_logs` guarda só 6 meses e o `changes` é diff bruto e parcial; reconstruir texto confiável e ordem é arriscado, e eventos antigos incompletos geram desconfiança ("o histórico está errado").
- **Opção barata [H]**: backfill *derivado do estado atual*, sem usar a auditoria, marcado `origin='backfill'`: `order.created` (de `created_at/created_by`), `installment.paid` (parcelas pagas, data de pagamento), `commission.paid` (`employee_financial_records` pagos). Só estado atual; não reconstitui remoções (que já foram apagadas). Mostrar na UI "histórico anterior a DD/MM/AAAA é resumido". **[D8]**
- Comissões já apagadas fisicamente (ex.: o caso das 14 repagas em `docs/product/comissoes-priorizacao.md`) não são recuperáveis pelo histórico; só por `audit_logs` dentro de 6 meses, tratar como análise forense separada.

### 9.3 Volume e performance [H, estimativa não medida]
- Ordem de grandeza: 15 a 40 eventos por OS; ~1.300 OS em produção no snapshot do doc de comissões (458 em modo full = 34%). Dezenas de milhares de linhas no total: trivial. Medir após F1.
- Leitura sempre por `(organization_id, service_order_id)` com índice; escrita é 1 insert em lote por requisição. Impacto na latência: um `await` extra por fluxo financeiro (poucos ms).
- Retenção: manter enquanto a OS existir (anos). **[D6]** definir se evento de OS excluída (soft delete) permanece e por quanto tempo; sugestão: manter, pois é o rastro da exclusão.

---

## 10. Riscos

| Risco | Tipo | Mitigação |
|---|---|---|
| Evento perdido (sem transação) | técnico [V: sem transação] | `await` síncrono, retry, log com `request_id`, métrica de falhas; evolução para RPC |
| Ponto de escrita esquecido | cobertura | instrumentar funções compartilhadas + teste de cobertura por handler |
| Histórico divergir do estado real e virar "fonte de verdade" | integridade | contrato explícito: somente leitura/registro; nenhum cálculo lê eventos; relatórios continuam em `service_order_installments`/`financial_transactions`/`employee_financial_records` |
| Vazamento de comissão/valores a perfil sem permissão | segurança | `visibility` + filtro no servidor + teste com perfis `orders.read` apenas; limpar `commissions[]` do diff de itens |
| Vazamento atual de `changes` bruto via `editLogs` | segurança [V] | remover/estreitar em F4 (ou antes, se o security-analyst priorizar) |
| Texto errado/enganoso ("pagou" quando só reconciliou) | clareza | eventos distintos para reconciliação (`reconciled_only` existe no `recordAudit` de `process-payment`), revisão de redação com o dono |
| Confundir receita, caixa recebido e lucro na mensagem | financeiro | mensagens separam "valor da OS", "recebido" e "comissão"; nunca mostrar lucro |
| Rollback best-effort em lote (`pending-bulk-payment-rollback.md`) gerar evento sem efeito | integridade | gravar evento após confirmação do último passo; não corrigir isso aqui |
| Origem declarada pelo front errada ou forjada | confiança | catálogo fechado, `allowedSources` por endpoint, `source_trust`/`source_declared`, uso só informativo (5.2) |
| Telas novas esquecerem de enviar origem | cobertura | wrapper central deriva da rota do Router; teste exige `defaultSource` por endpoint |
| Endpoint compartilhado ambíguo (`pay-commissions-bulk`) | clareza | header decide; sem ele, rótulo genérico |
| Latência/escopo crescente | custo | fatias pequenas; sem backfill pesado |

---

## 11. Decisões pendentes para o dono do produto

- **D1** Quem é o "cliente final"? A oficina (usuário do app) ou o dono do veículo (acesso por link/PDF)? Recomendação: F1 a F3 só para usuários da oficina com permissão; visão pública (se desejada) é um recorte posterior, com lista restrita de eventos e sem comissão.
- **D2** O que é "regeneração de pagamentos"? Não há rota com esse nome [V]. Confirmar se é "remover pagamento + gerar novo plano" (modelado por correlação) ou algo ainda não implementado.
- **D3** Em falha ao gravar o evento, a operação financeira deve concluir (recomendado) ou falhar?
- **D4** Quais permissões veem eventos financeiros e de comissão? Alinhar com o rollout de controle de acesso (route-map V1, V5, V6); sugestão: financeiro segue o gate de pagamento da OS; comissão segue o gate de visualização de comissão.
- **D5** Eventos de comissão sensíveis (modo `full`, comissão paga sem recebimento, exclusão de comissão paga) devem aparecer ao usuário comum ou só a perfis administrativos? Não inventei regra de negócio de comissão; só registro o que o código faz.
- **D6** Retenção e política para OS excluída e dado pessoal (nomes).
- **D7** Renderização no servidor (recomendado) ou no front (i18n)?
- **D8** Backfill: nenhum, derivado do estado atual (recomendado se desejado), ou a partir de `audit_logs` (não recomendado).
- **D9** Aprovar nova tabela e nova migração (próxima livre após `20240101000107`) e a remoção futura de `service_order_edit_logs`.
- **D10** Incluir NFS-e e agendamento no escopo (a varredura mostra que ambos afetam a OS; recomendado incluir em F3).
- **D11** Alterações em cliente, veículo e funcionário não entram no histórico da OS (recomendado; o evento guarda nome em snapshot). Confirmar.
- **D12** **Confiar ou validar a origem enviada pelo front?** Recomendado: usar só para exibição, validar contra catálogo fechado e contra `allowedSources` do endpoint, cair para a origem inferida pela rota quando divergir ou faltar, e guardar `source_declared`/`source_trust`. Alternativa rígida: só inferir pela rota (sem header), com rótulo genérico nos endpoints compartilhados. Aprovar também os **rótulos pt-BR das telas** (5.1).
- **D13** `financial/[id]/pay` parece não sincronizar o registro de comissão ([H]); encaminhar ao `data-integrity-auditor`. O histórico só registra o que ocorrer.

---

## 11.1 Respostas do responsável (2026-11-13)

Valem para F2 e F3. Perguntas Q16 a Q30 em `docs/testing/os-history-scenarios-f2-f3.md`.

| Pergunta | Decisão |
|---|---|
| D6 / OS excluída | O usuário não acessa mais o histórico (`GET history` responde 404). Os eventos permanecem na tabela para consulta direta no banco pelo desenvolvimento. |
| Q16 e Q17 (allowlist, campos sensíveis) | Todo campo alterado pode entrar no histórico. Mantém-se a regra técnica de nunca expor comissão a quem não tem o gate, ids crus ou dados de outro tenant (a visibilidade é decisão de segurança, não de produto). |
| Q18 a Q20 (itens, teto, desconto) | Delegado ao arquiteto/desenvolvedor: **um evento por requisição** de edição de itens (`order.items_changed`), com uma linha por item (adicionado, removido, alterado de → para em quantidade, preço e desconto), teto de 50 linhas por evento com resumo "e mais N itens"; desconto como campo com de → para, sem comissão. Reavaliar com uso real. |
| Q21 (status) | Todos os status e transições são registrados, sempre "status antigo → status novo". Sem regra de transição própria do histórico. |
| Q24 (evento de exclusão) | Só o desenvolvimento lê (direto no banco). Sem restauração pelo usuário. |
| Q25 (comissão manual) | Registrar reversão, justificativa e demais dados informados no ajuste (visibilidade `commission`). |
| Q26 (NFS-e) | Fora desta rodada: a parte fiscal será refeita depois. Em F3, NFS-e fica de fora e vira pendência. D10 continua valendo (NFS-e gera evento), mas a implementação espera o refazimento. |
| Q29 (cliente e veículo) | Troca de cliente ou veículo na OS gera evento; a placa aparece no texto. |

## 11.2 Mudança de desenho: painel lateral + permissão própria (2026-11-14)

Decisão do responsável. Substitui o que as seções anteriores dizem sobre onde o histórico aparece e quem o vê.

**Onde aparece:** painel lateral (sidebar) dentro do detalhe da OS (`ServiceOrdersDetailModal`), aberto ao lado do conteúdo, e não em tela separada nem como aba. Motivo: comparar o que o histórico diz com os dados atuais da OS (itens, parcelas, comissões) sem trocar de tela. Em telas estreitas vira `USlideover` por cima do detalhe.

**Quem vê: permissão dedicada `orders.history`** ("Ver histórico da OS").
- Motivo: um funcionário que faz algo errado não pode saber que a gestão consulta o histórico.
- Sem a permissão: o botão/painel **não é renderizado** (não fica desabilitado, não tem tooltip) e o endpoint `GET /api/service-orders/:id/history` responde **404** igual a uma rota inexistente (nunca 403, para não revelar que existe).
- `orders.read` deixa de bastar. Admin/dono continuam passando pelo bypass padrão de `requireOrgPermission`.
- Concessão inicial: **nenhum papel recebe** a permissão por migration (sem backfill). Dono/admin passam pelo bypass; a gestão concede o código ao papel que quiser. Concessão automática exporia o histórico justamente aos papéis que não deveriam saber dele.
- Os filtros internos por categoria **continuam**: `financial` exige `orders.pay` e `commission` exige `reports.commissions`. `orders.history` abre o histórico, mas não mostra valores de comissão a quem não pode ver comissão.
- Sigilo: nenhuma outra resposta da API para quem não tem a permissão pode indicar o histórico (ex.: o `editLogs` bruto do detalhe da OS sai, ver QLD-4). O catálogo de permissões só é visível para quem gerencia papéis.
- Gravação dos eventos não muda: continua para todas as ações de todos os usuários; só a leitura é restrita.

**Impacto:** novo código em `action-codes.ts` e no catálogo de actions (migration própria, sem alterar a 108), `access.ts` passa a exigir `orders.history` antes de calcular as visibilidades, `history.get.ts` responde 404 sem permissão, testes de acesso atualizados.

## 12. O que não foi verificado

- Conteúdo detalhado de `server/utils/service-order-commissions.ts`, `reports/commissions/[id]/pay.post.ts` e rotas fiscais além dos trechos citados; o catálogo é baseado nos pontos de escrita encontrados por grep de `.insert/.update/.delete`, não em leitura integral.
- Valores válidos de `service_orders.status` (confirmados apenas `open`, `completed`, `cancelled`).
- Quais perfis (mgr/emp) têm cada permissão (o route-map também marca como "não verificado").
- Volume real de produção; estimativas da seção 9.3 são hipóteses.
- O grafo (`graphify-out`) retornou pouco para esta consulta; a evidência veio de grep e leitura direcionada.
