# Histórico detalhado da OS: cenários de teste (F0 e F1)

> Desenho de testes, sem código. Base: `docs/architecture/os-history-timeline.md` (seções 4 a 9, decisões D1 a D13). O desenho é hipótese até a implementação existir: nomes de módulos (`recordOsEvents`, `server/utils/os-history/*`) são os sugeridos no documento.
> Verificado no repositório: `tests/README.md` (convenções), `tests/support/*` (fake-supabase, handler-harness, factories, `adminDb`), `tests/db/*` (Postgres real na stack Docker), `tests/fast/access/guard-matrix.test.ts`, `tests/e2e/service-orders/*`.

## 1. Estratégia de camadas (mais barata que dá confiança)

| Camada | Onde / como | Usar para |
|---|---|---|
| UNIT | `tests/fast/os-history/` (funções puras, sem I/O) | resolução de origem, renderizador, filtro de visibilidade, chaves de idempotência, cursor |
| STATIC | `tests/static/` (lê código/migrations) | cobertura por handler, `defaultSource` declarado, catálogo/rótulos, "histórico não é fonte de cálculo" |
| HANDLER | `tests/fast/` com `callHandler` + fake-supabase | handlers reais: evento gravado/não gravado, origem, cascata, falha do helper |
| DB | `tests/db/` (Postgres real via `pnpm test:db` / `pnpm test:stack --only=db`) | trigger append-only, RLS, unique de idempotência, concorrência, ordem por `seq` |
| API | `tests/db/` com HTTP real contra o app na stack (ou handler sobre `adminDb`) | tenant e permissão ponta a ponta no endpoint de leitura, dois tenants reais |
| E2E | Playwright na stack (`pnpm test:stack --only=e2e`) | somente o fluxo crítico e o envio real do header |

Limite verificado (`tests/README.md`): o fake-supabase **não simula gatilho, RPC nem índice único**. Logo, idempotência, append-only e RLS só se provam na camada DB; HANDLER prova apenas "o helper foi chamado com a chave e o conteúdo certos".

Convenções a seguir: prefixo `[OSH-xxx]` no `describe`; cada teste cria os próprios dados; `vi.setSystemTime`; TZ `America/Sao_Paulo`; `fakeCpf()`; bug conhecido vira `it.fails` com `KF-nn`. Para HANDLER de falha do helper: o teste substitui `recordOsEvents`/o insert da tabela por erro, não o resto do fluxo.

Legenda de prioridade: P0 = bloqueia release (segurança, dinheiro, integridade); P1 = alto; P2 = médio.

## 2. Cenários F0 (base)

### 2.1 Origem (`x-origin`)

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-001 | F0 | UNIT | P0 | endpoint com `defaultSource=commission_report`, `allowedSources=[commission_report, bonus_page]` | resolver origem com header `bonus_page` | `source_code=bonus_page`, `source_trust=declared`, `source_declared=bonus_page` |
| OSH-002 | F0 | UNIT | P0 | idem OSH-001 | header `financial_bulk` (no catálogo, fora do conjunto do endpoint) | `source_code=commission_report` (inferido), `source_trust=mismatch`, `source_declared=financial_bulk` |
| OSH-003 | F0 | UNIT | P0 | idem | header com valor fora do catálogo (`foo`, vazio, 10 KB, `<script>`, `os_detail;DROP`) | valor descartado, origem inferida; nada além de valor do catálogo vira `source_code`/`source_label`; ver pergunta Q1 sobre o que `source_declared` guarda nesses casos |
| OSH-004 | F0 | UNIT | P1 | idem | sem header; endpoint de rota única; e endpoint compartilhado (`pay-commissions-bulk`) | rota única: `inferred` com `defaultSource`; compartilhado: rótulo genérico do fluxo, não uma tela adivinhada; sem nada resolvível: `unknown` |
| OSH-005 | F0 | UNIT | P1 | catálogo fechado da seção 5.1 | validar o catálogo | contém exatamente os 14 códigos; cada um com rótulo pt-BR não vazio; códigos únicos |
| OSH-006 | F0 | UNIT | P1 | mapa rota-da-página para `source_code` do plugin `api-client.client.ts` | resolver cada rota do app (ex.: `/app/financial`, `/app/reports/commissions`, `/app/financial/bonuses/:id`, detalhe da OS) | cada rota mapeia ao código da tabela 5.1; rota desconhecida não gera código fora do catálogo; override explícito (`withOrigin`) vence o mapa |
| OSH-007 | F0 | STATIC | P1 | endpoints instrumentados (lista da tabela 6, F1) | varrer fonte | todo endpoint instrumentado declara `defaultSource` e `allowedSources` contendo `defaultSource`; catraca `baselines` só encolhe |
| OSH-008 | F0 | STATIC | P2 | rótulos do catálogo | comparar com os nomes do menu do app | rótulos não divergem dos do menu (aprovação do texto em D12; ver Q2) |

### 2.2 Helper `recordOsEvents`

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-010 | F0 | HANDLER | P0 | evento de teste com contexto de auditoria (`requestId`, usuário, org) | chamar helper com `organization_id` e `actor` diferentes dentro do item de evento | linha inserida usa org, ator e `correlation_id=requestId` **do contexto do servidor**; campos equivalentes enviados no item são ignorados |
| OSH-011 | F0 | HANDLER | P0 | insert do evento falha sempre | chamar helper | não lança; tenta 1 retry (2 chamadas de insert); loga erro com `request_id`; retorna sem propagar |
| OSH-012 | F0 | HANDLER | P1 | insert falha na 1a e ok na 2a | chamar helper | 1 retry; 1 evento efetivamente gravado; sem log de erro final |
| OSH-013 | F0 | HANDLER | P1 | lista vazia | chamar helper | nenhuma chamada ao banco; sem erro |
| OSH-014 | F0 | HANDLER | P2 | 3 eventos na mesma ação | chamar helper | 1 insert em lote (não 3); ordem de gravação preservada (não há coluna `step`); mesmo `correlation_id` |
| OSH-015 | F0 | UNIT | P0 | helper de chave | gerar chave para `installment_paid` com 2 `financial_transaction_id` distintos da mesma parcela e para o mesmo id repetido | ids distintos geram chaves distintas; mesmo id gera chave idêntica (determinística); chave inclui tipo + entidade + id do efeito |

### 2.3 Banco (tabela `service_order_events`)

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-020 | F0 | DB | P1 | migration aplicada na stack | inspecionar catálogo | colunas/NOT NULL do modelo (seção 5), índices `(org, os, occurred_at desc, seq desc)` e `(org, event_type, occurred_at desc)`, unique `(org, idempotency_key)` |
| OSH-021 | F0 | DB | P0 | linha existente | `UPDATE` como postgres, `service_role` e `authenticated` | todos falham pelo trigger (não por falta de privilégio, como em `audit-logs.sql.test.ts`: conceder GRANT ALL antes) |
| OSH-022 | F0 | DB | P0 | linha existente | `DELETE` e `TRUNCATE` pelos mesmos papéis | falham; linha intacta. Ver Q3 sobre exclusão em cascata de organização/OS |
| OSH-023 | F0 | DB | P0 | RLS ligado sem policy | `SELECT`/`INSERT` como `anon` e `authenticated` via PostgREST | negado/0 linhas; só `service_role` escreve e lê |
| OSH-024 | F0 | DB | P0 | 1 evento com `idempotency_key=K` na org A | inserir de novo com `ON CONFLICT DO NOTHING` (mesma chave, mesma org); depois mesma chave na org B; depois 2 linhas com chave `NULL` | mesma org: continua 1 linha, sem erro; org B: aceita (unicidade por org); `NULL` repetido: aceito |
| OSH-025 | F0 | DB | P0 | nenhuma | 10 inserts concorrentes (`Promise.all`) com a mesma chave | exatamente 1 linha; nenhuma chamada com erro |
| OSH-026 | F0 | DB | P1 | 3 eventos com mesmo `occurred_at` | ler ordenando `(occurred_at, seq)` | ordem igual à de inserção; `seq` estritamente crescente, não reaproveitado após falha |
| OSH-027 | F0 | DB | P1 | nenhuma | inserir sem `source_code`/`source_trust`/`correlation_id`; com `visibility`/`source_trust` fora do conjunto | sem campo obrigatório: rejeita; valor fora do conjunto: depende de CHECK (Q4) |

### 2.4 Endpoint de leitura `GET /api/service-orders/:id/history`

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-030 | F0 | API | P0 | orgs A e B reais, OS e eventos em A, usuário de B | GET do id da OS de A | 404 (não 403), corpo sem nenhum dado de A; idem para id inexistente (mesma resposta) |
| OSH-031 | F0 | HANDLER | P0 | usuário de A | GET com `organization_id`/`org` na query e header forjado para a org B | param ignorado; resultado só da org resolvida do usuário |
| OSH-032 | F0 | HANDLER | P0 | OS em A com eventos | sem sessão; com sessão sem `orders.read` | 401; 403. Entra também na matriz `guard-matrix.test.ts` |
| OSH-033 | F0 | HANDLER | P0 | OS com 1 evento `general`, 1 `financial`, 1 `commission` | usuário com `orders.read` apenas | só o `general`; os outros **omitidos**, não mascarados |
| OSH-034 | F0 | HANDLER | P0 | idem | usuário com permissão financeira sem a de comissão; depois com ambas | 1) general+financial; 2) os três. (Permissões exatas: Q5) |
| OSH-035 | F0 | HANDLER | P0 | 40 eventos, 30 deles `commission`; usuário sem permissão de comissão, `limit=10` | paginar até o fim | páginas cheias de eventos visíveis (filtro aplicado antes do limite); cursor/`hasMore` não revelam eventos omitidos; nenhuma página vazia seguida de mais |
| OSH-036 | F0 | UNIT | P0 | evento com payload contendo `entity_id`, `actor_user_id`, e-mail, `correlation_id`, IP | renderizar para cliente | resposta só tem `{id, occurredAt, category, title, description, details, actorName, source:{code,label}, groupId}`; sem ids crus, e-mail, IP, user agent. `groupId` é opaco (Q6: pode ser o `correlation_id`?) |
| OSH-037 | F0 | UNIT | P1 | eventos com mesmo `occurred_at` e outros de datas diferentes | paginar com cursor `(occurred_at, seq)`, inserindo evento novo entre páginas | sem repetição nem salto; ordem decrescente; cursor adulterado/malformado: 400 |
| OSH-038 | F0 | HANDLER | P2 | nenhuma | `limit` ausente, 0, 101, texto; `source`, `category`, `from>to` inválidos | padrão 30; clamp a 100 ou 400 (definir); filtros inválidos: 400 sem 500 |
| OSH-039 | F0 | HANDLER | P1 | OS excluída logicamente / inexistente | GET | 404 consistente |
| OSH-040 | F0 | UNIT | P1 | evento `installment.paid` v1 | renderizar | pt-BR, BRL (`R$ 300,00`), data `dd/MM/yyyy HH:mm` em `America/Sao_Paulo`; valor vem do payload, sem consulta ao banco |
| OSH-041 | F0 | UNIT | P1 | evento com `event_type` desconhecido ou `schema_version` futura | renderizar | não lança; item genérico seguro ou omitido (Q7); demais itens da página seguem |
| OSH-042 | F0 | UNIT | P0 | `source_declared='<img onerror>'` ou rótulo malicioso gravado | renderizar | `source.label` vem sempre do catálogo, nunca de `source_declared`; texto do payload é devolvido como dado (escape fica no front) |
| OSH-043 | F0 | E2E | P1 | dev server na stack | abrir página do Financeiro e do Relatório de comissões, interceptar chamadas a `/api/` | toda chamada leva `x-origin` coerente com a rota; ação com `withOrigin` leva o override. Único teste que prova o plugin real |
| OSH-044 | F0 | STATIC | P1 | código do repositório | varrer consumidores | nenhum cálculo de saldo/comissão/lucro lê `service_order_events` (contrato "histórico não é fonte de verdade") |

## 3. Cenários F1 (pagamentos e comissões)

### 3.1 Parcela, pagamento da OS e estorno

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-100 | F1 | HANDLER | P0 | OS com parcela 2 de 3 de R$ 300,00 | `installments/:id/pay` com header `os_detail` | 1 evento `installment.paid`, `visibility=financial`, `source=os_detail/declared`, payload com valor, forma, nº da parcela, nomes; chave `installment_paid:<parcela>:<financial_transaction_id>` |
| OSH-101 | F1 | HANDLER | P0 | parcela já paga | pagar de novo (negócio recusa) | resposta de erro do negócio; **zero** eventos |
| OSH-102 | F1 | HANDLER | P0 | parcela paga duas vezes (duplo clique, P0-2 de `comissoes-priorizacao.md`) | duas chamadas com `financial_transaction_id` distintos | 2 eventos com chaves distintas (histórico reflete o que ocorreu); reenvio da mesma chamada com mesmo id: 1 evento |
| OSH-103 | F1 | HANDLER | P1 | parcela pendente | `PATCH installments/:id` valor/vencimento | `installment.edited` (financial/payment) com `changes` de/para reais, chave `installment_edited:<parcela>:<request_id>`, origem `os_detail`; sem mudança real, corpo vazio, parcela já recebida, outra org: sem evento. Teste: `f1-handlers-review-fixes.test.ts` |
| OSH-104 | F1 | HANDLER | P1 | parcela com comissão vinculada | `DELETE` com `deletion_reason` | `installment.removed` com motivo; efeitos em comissão como eventos do mesmo `correlation_id` (ver OSH-125) |
| OSH-105 | F1 | HANDLER | P1 | OS sem plano | `process-payment`, `down-payment`, `receive-extra-payment` | respectivamente `payment.plan_created`, `payment.down_payment_received`, `payment.extra_received`, `os_detail`, financial; valores corretos; reconciliação sem mudança (`reconciled_only`) não diz "pagou" |
| OSH-106 | F1 | HANDLER | P0 | OS com plano, 2 recebimentos, 2 comissões pendentes | `payment.delete` | (comportamento atual) `payment.deleted` (parcelas removidas confirmadas + total recebido do caixa) -> `commission.removed` (motivo `payment_deleted`, por comissão confirmada) -> `payment.status_changed` (só se mudou), nesta ordem, mesmo `correlation_id`, origem `os_detail`. Comissão já paga bloqueia a operação (409), sem evento. `receipt.reversed`/`installment.removed` por parcela NÃO são gerados aqui (só nas rotas de estorno/remoção de parcela). Teste: `f1-handlers-os.test.ts`, `f1-handlers-review-fixes.test.ts` |
| OSH-107 | F1 | HANDLER | P1 | OS que teve `payment.deleted` | `process-payment` novamente | `payment.plan_regenerated` correlacionado ao anterior. Regra pendente em D2 (Q8); sem a decisão, só `payment.plan_created` |
| OSH-108 | F1 | HANDLER | P0 | recebimento de OS | estornar por `financial-transactions/:id` (`os_detail`) e por `financial/:id` delete (`financial_entries`) | `receipt.reversed` nos dois, com a origem de cada caminho; o `financial/:id` **não** gera também `entry.deleted` duplicado (vira `receipt.reversed`, seção 6) |
| OSH-109 | F1 | HANDLER | P1 | situação de pagamento muda Pendente para Parcialmente pago; outro caso sem mudança | pagar parcela | `payment.status_changed` só quando muda, herda origem da ação |
| OSH-110 | F1 | HANDLER | P0 | OS de organização A | executar OSH-100 com sessão de A e `x-origin` valido | `organization_id` do evento = org da OS/usuário; nunca de header/corpo |

### 3.2 Comissão

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-120 | F1 | HANDLER | P0 | OS em modo proporcional | pagar parcela libera comissão (`releaseServiceOrderCommissions`) | `commission.released`, `visibility=commission`, valor e funcionário em snapshot, origem herdada (`os_detail`); modo `full`: `commission.release_mode_changed` |
| OSH-121 | F1 | HANDLER | P1 | comissão pendente | `generate-commissions` / recálculo que apaga e recria pendentes | `commission.recalculated`/`removed_pending` com de/para; origem herdada |
| OSH-122 | F1 | HANDLER | P0 | 1 comissão pendente | `reports/commissions/:id/pay` com `x-origin=commission_report`; depois `bonus_page`; depois sem header; depois `financial_bulk` | `commission.paid` com origem: declared, declared, genérica "Pagamento de comissão" (inferred), inferida + `mismatch` |
| OSH-123 | F1 | HANDLER | P0 | 3 comissões de 3 OS diferentes | `pay-commissions-bulk` com `commission_report`; repetir com `os_detail` e sem header | 3 eventos, 1 por OS, mesmo `correlation_id`; origem por chamada conforme header; sem header: genérica |
| OSH-124 | F1 | HANDLER | P0 | lote com 3 itens, o 2o falha | `pay-commissions-bulk` | eventos só para os confirmados `paid`; nenhum para o item falho; falha de rollback best-effort não gera evento sem efeito (`pending-bulk-payment-rollback.md`) |
| OSH-125 | F1 | HANDLER | P0 | comissão paga e outra pendente | `reports/commissions/:id` delete; cancelar OS; `installments` delete | `commission.deleted`/`payment_reversed` com snapshot (funcionário, valor, "já estava paga"); como a linha é apagada fisicamente, o evento é o único rastro e tem dados suficientes sem consultar a linha |
| OSH-126 | F1 | HANDLER | P0 | lançamento financeiro de comissão e de OS | `pay-entries-bulk` com `financial_bulk` | comissão: `commission.paid`; lançamento de OS: `entry.paid_outside_os`; ambos `financial_bulk`, 1 evento por OS, mesmo `correlation_id`. Qual evento para lançamento de comissão: Q9 |
| OSH-127 | F1 | HANDLER | P1 | lançamento de OS | `financial/:id/pay` (`financial_entries`) | `entry.paid_outside_os`; para lançamento de comissão cuja linha de comissão **não** foi sincronizada (D13), não registrar `commission.paid` inexistente, só o que ocorreu |
| OSH-128 | F1 | HANDLER | P0 | lançamento ligado a `service_order_id`; outro ligado a `employee_financial_record_id`; outro avulso (despesa) | `financial/:id` PUT alterando valor | `entry.edited` com de/para nos 2 ligados; avulso: **zero** eventos, resposta 200 sem erro por `service_order_id` nulo |
| OSH-129 | F1 | HANDLER | P0 | lançamento de OS; avulso | `financial/:id` DELETE com motivo | OS: `receipt.reversed`/`entry.deleted` com motivo, origem `financial_entries`; avulso: nenhum evento |
| OSH-130 | F1 | HANDLER | P1 | dado de configuração D13 | pagar lançamento de comissão | texto não afirma "comissão paga" se a linha não mudou (separar "lançamento pago" de "comissão paga") |

### 3.3 Cancelamento e cascata de origem

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-140 | F1 | HANDLER | P0 | OS com pagamentos e comissões | `cancel` com `os_list`, repetir com `os_detail` | 1 `order.cancelled` (`general`) + eventos dos efeitos (pagamentos/comissões removidos), todos com mesmo `correlation_id`; origem = a do header em todos |
| OSH-141 | F1 | HANDLER | P1 | OS já cancelada | `cancel` de novo | erro de negócio ou idempotente; sem evento duplicado |
| OSH-142 | F1 | HANDLER | P0 | `payment.delete` com header `os_detail` | inspecionar eventos de comissão removida | herdam `os_detail`, não `system` e não `unknown`; reconciliação interna automática posterior usa `system` com `parent_event_id` do evento causador |
| OSH-143 | F1 | HANDLER | P1 | ação com vários efeitos | ler a lista | efeitos com mesmo `groupId` (derivado do correlation, opaco); a ordem interna é a ordem causa->efeito de gravação do lote (não há coluna `step`); asserção de ordem sem `.sort()` em `f1-handlers-review-fixes.test.ts` |
| OSH-144 | F1 | UNIT | P0 | tabela de visibilidade por `event_type` do catálogo F1 | verificar mapa | `installment.*`/`payment.*`/`receipt.*`/`entry.*` = financial; `commission.*` = commission; `order.cancelled` = general. Mapa em teste de tabela única |
| OSH-145 | F1 | HANDLER | P0 | usuário sem permissão de comissão | GET de OS cancelada | `order.cancelled` visível sem citar valores de comissão; ver Q10 sobre a frase "comissões vinculadas foram removidas" |

### 3.4 Falha de gravação não derruba o fluxo

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-150 | F1 | HANDLER | P0 | insert de evento sempre com erro | executar, um por um: pagar parcela, pagar comissão, `pay-commissions-bulk`, `pay-entries-bulk`, `payment.delete`, `cancel`, `financial/:id` delete/pay/put | resposta de sucesso (mesmo status e corpo do caso sem falha); estado de negócio gravado (parcela paga, transação criada, comissão paga); log com `request_id`. Teste parametrizado por handler |
| OSH-151 | F1 | HANDLER | P0 | falha do evento no item 2 de um lote de 3 | `pay-commissions-bulk` | itens 1 a 3 continuam pagos; **nenhum rollback** disparado pela falha de histórico; eventos dos outros itens gravados |
| OSH-152 | F1 | HANDLER | P0 | negócio falha depois do ponto onde o evento seria gravado (ex.: passo posterior com rollback) | executar | evento gravado só após o último passo irreversível; em rollback, sem evento órfão |
| OSH-153 | F1 | HANDLER | P1 | handler instrumentado | contar chamadas | no máximo 1 insert de eventos por requisição (batch); nenhum `await` fora do caminho feliz que mude o status de erro |
| OSH-154 | F1 | STATIC | P1 | tabela 6, lista de handlers F1 | varrer | cada handler/função compartilhada da lista (`releaseServiceOrderCommissions`, `reverseServiceOrderReceipt`, `recalculateServiceOrderPaymentStatus`, `softDeleteFinancialTransaction`, `pay`, `process-payment`, `payment.delete`, `cancel`, `pay-commissions-bulk`, `pay-entries-bulk`, `financial/[id]` put/pay/delete, `reports/commissions/[id]` pay/delete) chama `recordOsEvents`; ponta esquecida falha o teste |

### 3.5 Origem forjada e tenant no uso

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-160 | F1 | HANDLER | P0 | cada endpoint compartilhado de F1 | enviar `x-origin` de outro endpoint | `mismatch`, origem inferida, `source_declared` guardado; ator, org, `correlation_id` inalterados |
| OSH-161 | F1 | HANDLER | P0 | usuário sem permissão de pagar | enviar `x-origin=commission_report` | autorização inalterada (mesmo 403 que sem o header); origem não concede acesso |
| OSH-162 | F1 | HANDLER | P0 | `pay-commissions-bulk` com ids de comissão da org B, usuário da org A | executar | negócio recusa/ignora; nenhum evento na OS de B nem de A com dados de B |
| OSH-163 | F1 | API | P0 | 2 orgs reais, eventos F1 em ambas | ler histórico de cada OS com usuários trocados | cada usuário vê só a própria org; contagem de eventos de A não aparece em B |
| OSH-164 | F1 | HANDLER | P1 | ator com nome atualizado/excluído depois | ler evento antigo | `actorName` é o snapshot da gravação; evento com `actor_type=system` mostra "Sistema" |
| OSH-165 | F1 | UNIT | P1 | evento com e-mail do ator no payload ou no ator | renderizar | só nome; sem e-mail |

### 3.6 Mudança de cliente/veículo/funcionário (D11)

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-170 | F1* | HANDLER | P1 | OS com cliente X | editar a OS trocando para cliente Y (`POST service-orders`) | evento de campo com de/para em **nomes** (snapshot), `os_form`; idem veículo e responsável. (*Fatia em que entra: Q11, `order.fields_changed` está em F2 no documento) |
| OSH-171 | F1* | HANDLER | P0 | cliente X, veículo e funcionário ligados a OS | editar o cadastro (nome, telefone) de cliente/veículo/funcionário fora da OS | zero eventos em qualquer OS; resposta do cadastro inalterada |
| OSH-172 | F1* | UNIT | P1 | evento antigo "cliente: X para Y"; Y renomeado depois | renderizar | mostra o nome da época (snapshot), não o atual; mesmo com Y excluído logicamente |

### 3.7 Ordem temporal e renderização

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-180 | F1 | API | P1 | 2 ações em requisições diferentes, uma com 4 efeitos | ler história | ordem decrescente por `(occurred_at, seq)`; efeitos de uma ação contíguos; sem depender do relógio do cliente |
| OSH-181 | F1 | UNIT | P1 | 1 evento de cada tipo F1, valores com centavos | snapshot das mensagens pt-BR | texto claro; "valor da OS", "recebido" e "comissão" não se confundem; nenhuma menção a lucro; origem na frase ("... pela tela Relatórios > Comissões") |
| OSH-182 | F1 | UNIT | P2 | origem `unknown` ou só `inferred` sem tela | renderizar | "Origem não identificada" sem sugerir erro; ação fora da OS (`source` diferente de `os_*`) marcada |
| OSH-183 | F1 | UNIT | P2 | OS sem eventos | renderizar lista | lista vazia, sem erro (OS antiga sem backfill, D8) |

### 3.8 E2E (somente o crítico)

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-190 | F1 | E2E | P0 | stack com OS, plano e comissão (reaproveitar `order-fixtures`) | receber parcela na OS; pagar comissão pelo Relatório de comissões; abrir o histórico da OS | lista mostra, na ordem, "Parcela recebida" (OS) e "Comissão paga por <ator>, pela tela Relatórios > Comissões"; origem fora da OS destacada |
| OSH-191 | F1 | E2E | P0 | perfil com `orders.read` apenas e perfil da org B | abrir o histórico da mesma OS | `orders.read` apenas: sem eventos de valor e comissão; org B: 404/OS inacessível; sem vazamento no HTML nem na resposta da API. Estende `permissions-isolation.e2e.ts` |

## 4. Resumo por camada e prioridade

Total: 85 cenários (F0: 37; F1: 45; F1*: 3, condicionados a Q11).

| Camada | Qtd | | Prioridade | Qtd |
|---|---|---|---|---|
| HANDLER | 49 | | P0 | 47 |
| UNIT | 18 | | P1 | 33 |
| DB | 8 | | P2 | 5 |
| STATIC | 4 | | | |
| API | 3 | | | |
| E2E | 3 | | | |

Se for preciso cortar escopo, os P0 de DB (OSH-021 a 025), tenant/permissão (OSH-030 a 035, 163, 191) e falha de gravação (OSH-011, 150 a 152) são o núcleo mínimo.

## 5. Perguntas de negócio e de desenho em aberto (sem decisão tomada)

| ID | Pergunta | Cenários afetados |
|---|---|---|
| Q1 | O que `source_declared` guarda quando o valor está fora do catálogo: o texto bruto (truncado), um marcador (`invalid`) ou nada? Há limite de tamanho? | OSH-003, 042 |
| Q2 | Aprovar os rótulos pt-BR das telas (D12) e confirmar se devem coincidir com o menu (menu auto-ordena submenus; rótulos são texto, não ordem) | OSH-005, 008 |
| Q3 | Exclusão em cascata de organização/OS (inclusive a limpeza de testes `deleteOrgs`): a tabela terá FK com `ON DELETE`? O trigger append-only bloqueia a limpeza de dados de teste; D6 (retenção). Define como o teste DB cria e remove tenants | OSH-022, helpers |
| Q4 | `visibility`, `source_trust`, `category`, `actor_type` terão CHECK/enum no banco ou só validação na aplicação? | OSH-027 |
| Q5 | Permissões exatas de leitura: qual ação "financeira da OS" (`orders.update` no front, `orders.pay` no plano) e qual "ver comissão" (`reports.commissions`/`employees.read`)? Depende de D4 e do rollout de acesso | OSH-033, 034, 035, 191 |
| Q6 | `groupId` pode ser o `correlation_id` (opaco) ou precisa de id derivado? O documento também diz que `correlation_id` não vai ao cliente | OSH-036, 143 |
| Q7 | Evento com tipo/versão desconhecida: omitir ou mostrar texto genérico? | OSH-041 |
| Q8 | D2: "regeneração de pagamentos" é "remover + gerar novo plano"? Existe rota/fluxo próprio? | OSH-107 |
| Q9 | Lançamento de comissão pago em `pay-entries-bulk`: evento `commission.paid` (linha 263) ou `entry.paid_outside_os` (linha 268), ou ambos? Documento é ambíguo | OSH-126 |
| Q10 | `order.cancelled` é `general`, mas a frase cita comissões removidas: isso vaza a existência de comissão a quem não a vê? Ocultar a menção ou classificar parte como `commission` | OSH-145 |
| Q11 | D11 (troca de cliente/veículo/funcionário na OS) entra em F1 ou segue em F2 (`order.fields_changed`)? Os cenários OSH-170 a 172 ficam condicionados | OSH-170 a 172 |
| Q12 | Eventos sensíveis (modo `full`, comissão paga sem recebimento, exclusão de comissão paga) aparecem a usuário comum ou só administrativo (D5)? Afeta `visibility` do mapa de OSH-144 | OSH-120, 125, 144 |
| Q13 | Em falha de gravação, a regra é concluir a operação (D3 recomendado). Teste OSH-011/150 assume isso e falha se D3 for rejeitado | OSH-011, 150, 151 |
| Q14 | Qual é o "1 evento de prova" de F0 e o `source_code` dele? Sem isso F0 não tem evento para leitura de ponta a ponta antes de F1 | OSH-030 a 040 |
| Q15 | Existe limite/clamp definido para `limit` (clamp a 100 ou erro 400) e formato do cursor? | OSH-037, 038 |

## 6. Lacunas e riscos de cobertura

- Atomicidade real (evento na mesma transação) não é obtível sem RPC: não há cenário que a prove; só "negócio ok + evento perdido não derruba" (OSH-011, 150). Evento perdido é aceito, mas silencioso; sem métrica de falha não há teste de alarme. Sugerir contador/log verificável.
- fake-supabase não verifica unicidade, trigger, RLS nem joins: tudo isso cai nas camadas DB/API, que dependem da stack Docker e do `psql` do container (o teste de append-only existente usa container próprio `audit-pg`; reutilizar o padrão ou migrar para `adminDb`).
- Concorrência real do duplo clique em pagar (P0-2) não é resolvida pelo histórico; OSH-102 só garante o registro fiel.
- Backfill (D8), UI e aba `/admin` (`GET /api/admin/service-orders/:id/events`, owner) ficam fora de F0/F1 e sem cenários; se o endpoint de suporte entrar em F0/F1, acrescentar: owner 200 com payload cru, não owner 403.
- Rollback best-effort de lote (`pending-bulk-payment-rollback.md`) continua pendência de integridade; OSH-124 só cobre que o histórico não mente.
