# Histórico detalhado da OS: cenários de teste (F2 e F3)

> Desenho de testes, sem código. Complementa `docs/testing/os-history-scenarios.md` (F0 e F1, IDs OSH-0xx e OSH-1xx), que **não é repetido nem alterado**: onde um cenário F0/F1 já cobre o comportamento (ex.: OSH-003 header inválido, OSH-025 concorrência de chave, OSH-033 a 035 visibilidade, OSH-039 OS excluída => 404, OSH-171 editar cadastro fora da OS), este documento só referencia.
> Base: `docs/architecture/os-history-timeline.md` (seções 5, 6, 7, 9.1) e decisões aprovadas D11 e correlatas (resumo na seção 1). Faixas: **OSH-2xx = F2**, **OSH-3xx = F3**.
> Verificado no repositório: `server/utils/os-history/{record,render,access}.ts` existem (F0/F1); `server/api/service-orders/index.post.ts` (um handler cria, edita e avança status; usa `keepExisting` para campos ausentes; agendamento só no ramo de criação e falha vira `warnings`; lê `commission_manual_adjustments_log` existente na linha 175); convenções de `tests/README.md`. O desenho é hipótese até a implementação existir: nomes de módulos (ex.: `server/utils/os-history/diff.ts`) são sugestões do documento de arquitetura.
> Todos os testes rodam no Docker local (`pnpm test:db`, `pnpm test:stack`); nunca contra produção.

## 1. Premissas e decisões aprovadas que guiam o desenho

- D11: troca de cliente, veículo ou funcionário **só gera evento quando feita na OS**; editar o cadastro fora da OS não gera (OSH-171 já cobre; **OSH-170 e OSH-172 passam a ser F2** pela aprovação, ver 2.5, sem duplicar cenário aqui).
- NFS-e e agendamento geram evento (F3).
- OS excluída (soft delete): `GET history` responde **404**; eventos **permanecem na tabela**; `order.deleted` é gravado e preservado.
- Sem backfill. Texto pt-BR renderizado no servidor, "de → para" legível, sem ids crus.
- Itens ficam em jsonb com snapshot de comissão por item: o diff de itens **não pode vazar comissão** a quem não tem o gate de comissão.
- **Allowlist de campos**: campo fora da lista não vira evento e não aparece no payload.
- Origem por header validado contra catálogo fechado e `allowedSources` (F0).
- Falha ao gravar evento não derruba a operação (D3 recomendado; Q13 de F0/F1 segue valendo).

## 2. Estratégia de camadas

Mesma tabela de camadas de `os-history-scenarios.md` seção 1. Para F2/F3:

- **UNIT** (`tests/fast/os-history/`): diff, allowlist, formatação, chaves de idempotência, mapa de visibilidade. É onde mora a maior parte do risco de F2 e é a camada mais barata. Muitos cenários abaixo são **linhas de um único teste parametrizado** (tabela de casos), não arquivos separados.
- **HANDLER** (`callHandler` + fake-supabase): evento gravado/não gravado, origem, falha do helper, ordem dos passos. Lembrete: o fake **não simula** trigger, índice único, RPC nem RLS.
- **DB / API** (`tests/db/`, Postgres real): persistência após soft delete, append-only, concorrência, tenant com 2 organizações reais, paginação com volume.
- **STATIC**: cobertura por handler, allowlist cobrindo todas as colunas, catálogo x visibilidade x template.
- **E2E**: somente 2 fluxos críticos de F2; F3 não tem E2E (NFS-e depende de provedor externo e o restante é coberto por HANDLER/DB com custo bem menor).

Convenções: prefixo `[OSH-xxx]` no `describe`; cada teste cria os próprios dados; `vi.setSystemTime`; TZ `America/Sao_Paulo`; `fakeCpf()`; bug conhecido vira `it.fails` com `KF-nn`.

Prioridade: P0 = bloqueia release (segurança, dinheiro, integridade, vazamento); P1 = alto; P2 = médio.

---

## 3. Cenários F2 (edição e status)

### 3.1 Criação e diff de campos

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-200 | F2 | HANDLER | P0 | usuário com `orders.create`; header `x-origin=os_form` | `POST service-orders` sem id (criação) | 1 evento `order.created`, `visibility=general`, `source=os_form/declared`; payload com nº da OS e nome do ator (snapshot); `organization_id`/ator/`correlation_id` do servidor; chave de idempotência determinística pelo id da OS |
| OSH-201 | F2 | UNIT | P0 | OS com campos dentro e fora da allowlist (ex.: `updated_at`, colunas internas, `commission_*`, `commission_manual_adjustments_log`, `appointment_id`, ids) | diff `existing` x `saved` mudando só campos fora da lista | zero eventos; nenhuma chave fora da allowlist aparece em `payload` nem em `details` (varredura recursiva do JSON gerado) |
| OSH-202 | F2 | UNIT | P0 | pares "antes/depois" equivalentes | diff com: `null` x `undefined` x ausente; `""` x `null`; `"85000"` x `85000`; `85000.0` x `85000`; datas `2026-11-13` x `2026-11-13T00:00:00Z`; espaços nas bordas; ordem de chaves diferente | zero eventos em todos os casos (mudança sem efeito é ignorada); contraste: `85000` x `85320` gera 1 mudança |
| OSH-203 | F2 | UNIT | P1 | 3 campos da allowlist alterados | diff | 1 evento `order.fields_changed` com `changes[]` de 3 entradas `{label pt-BR, from, to}`; rótulos do mapa da allowlist (ex.: "Defeito relatado", "Km"); ordem das entradas determinística |
| OSH-204 | F2 | UNIT | P1 | campos de tipos diferentes | renderizar `changes` de moeda, km, data, data-hora, booleano, vazio, enum | moeda `R$ 1.234,50`; km `85.320`; data `dd/MM/yyyy`; data-hora em `America/Sao_Paulo` (23:30 local não vira dia seguinte por UTC); booleano "Sim"/"Não"; vazio "(vazio)"; enum com rótulo do app, nunca o código cru |
| OSH-205 | F2 | UNIT | P1 | texto livre com HTML, aspas, quebra de linha e emoji | renderizar de/para | devolvido como dado literal (escape é do front); sem lançar; quebra de linha preservada ou normalizada de forma definida (Q30) |
| OSH-206 | F2 | UNIT | P0 | lista de campos sensíveis da allowlist, se houver (ex.: observações internas, custo, margem; Q17) | alterar cada um | conforme Q17: ou fora da allowlist (zero evento) ou com `visibility` restrita; nunca `general` por omissão. Cenário falha se campo novo sensível aparecer sem classificação |
| OSH-207 | F2 | HANDLER | P0 | OS existente | `POST service-orders` reenviando o corpo idêntico ao estado salvo | 200 com o mesmo corpo de hoje; zero eventos |
| OSH-208 | F2 | HANDLER | P0 | OS existente; `orders.update` | `POST` mudando `reported_defect` e `odometer` | 1 `order.fields_changed` com 2 mudanças, origem do header, ator em snapshot; gravado **depois** do update da OS ter dado certo |
| OSH-209 | F2 | HANDLER | P1 | OS com vários campos preenchidos | `POST` parcial (campos ausentes no corpo; `keepExisting`) | campo ausente não vira mudança "para vazio"; só campos realmente enviados e diferentes geram diff |
| OSH-210 | F2 | HANDLER | P0 | edição que altera campos, itens e cliente | inspecionar a linha inserida (não a resposta) | payload gravado sem ids crus, e-mail, IP, `commission*`, chaves fora da allowlist; ids só em `entity_id`/`refs` |

### 3.2 Itens (jsonb com snapshot de comissão)

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-215 | F2 | UNIT | P0 | itens antes e depois | adicionar peça "Filtro de óleo", 2 x R$ 35,00 | 1 `order.item_added` com nome, tipo (peça/serviço), qtd e preço unitário formatados; sem campos de comissão |
| OSH-216 | F2 | UNIT | P0 | idem | remover um item | 1 `order.item_removed` com nome, qtd e preço do item no momento da remoção (snapshot, único rastro) |
| OSH-217 | F2 | UNIT | P0 | idem | alterar quantidade de 1 para 3 | 1 `order.item_changed`, de/para `1 → 3`, nome do item; demais itens inalterados não aparecem |
| OSH-218 | F2 | UNIT | P0 | idem | alterar preço de R$ 300,00 para R$ 350,00 | 1 `order.item_changed`, `R$ 300,00 → R$ 350,00`; texto não confunde preço unitário com total da linha |
| OSH-219 | F2 | UNIT | P1 | modelo de item com desconto, se existir (Q19) | alterar desconto do item | conforme Q19; se o item não tem desconto próprio, cenário é descartado |
| OSH-220 | F2 | UNIT | P0 | item com `commissions[]` e `commission_total` | (a) mudar só o snapshot de comissão; (b) mudar preço e comissão juntos; (c) adicionar/remover item com comissão | (a) zero eventos; (b) evento só com o preço; (c) evento sem comissão; em todos, varredura do JSON gerado não contém `commission` (chave ou valor derivado) |
| OSH-221 | F2 | UNIT | P1 | itens com e sem id estável; itens repetidos (mesmo nome) | reordenar a lista; trocar posições; dois itens iguais com qtd diferente | reordenar: zero eventos; itens iguais são distinguidos pela chave definida (Q18), sem emparelhar o item errado |
| OSH-222 | F2 | HANDLER | P1 | edição que muda 3 itens | `POST` | eventos de item compartilham `correlation_id` com `step` crescente; no máximo 1 insert em lote por requisição; quantidade por evento/agrupamento conforme Q18 |
| OSH-223 | F2 | HANDLER | P0 | usuário A edita itens com comissão; usuário B só com `orders.read` | A edita; B abre `GET history` | linha **gravada** sem comissão (inspeção do insert); resposta de B sem comissão em `title`, `description`, `details`; evento de item visível a B (visibility `general`) |
| OSH-224 | F2 | HANDLER | P1 | edição que muda plano/regra de comissão e dispara recálculo do snapshot (`index.post.ts`) | `POST` sem mudar item visível | zero eventos de item; nenhum evento `commission.*` criado por este caminho (F1 cobre liberação) |
| OSH-225 | F2 | HANDLER | P1 | `items` ausente, `null`, `{}`, string JSON, item sem nome, qtd negativa/zero/texto | `POST` / diff | operação conclui com o mesmo status de hoje; diff não lança; no máximo log de erro com `request_id`; sem evento corrompido |
| OSH-226 | F2 | UNIT | P2 | preços como `0.1+0.2` x `0.3`, strings com vírgula | diff | sem evento falso por ponto flutuante; comparação por valor monetário normalizado a 2 casas |

### 3.3 Desconto

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-230 | F2 | UNIT | P0 | desconto R$ 0,00 | alterar para R$ 50,00 | 1 `order.discount_changed`, `R$ 0,00 → R$ 50,00`; tipo (valor x percentual) explícito se existir (Q19) |
| OSH-231 | F2 | UNIT | P1 | desconto R$ 50,00 | reenviar R$ 50,00; `50`; `"50.00"`; `null` x `0` | zero eventos nos três primeiros; `null` x `0` tratado como sem efeito |
| OSH-232 | F2 | UNIT | P1 | mapa de visibilidade | consultar `order.discount_changed` | visibilidade definida e coerente com Q19 (general x financial); teste de tabela única junto de OSH-272; usuário sem o gate não recebe o evento e o evento não é mascarado |

### 3.4 Responsáveis

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-235 | F2 | HANDLER | P0 | OS sem responsável | adicionar "Carlos" em `responsible_employees` | 1 `order.responsibles_changed`, "Responsável 'Carlos' adicionado", nome em snapshot, sem id |
| OSH-236 | F2 | HANDLER | P1 | OS com 2 responsáveis | remover 1; trocar 1 por outro | remoção e troca explícitas (de/para por nome); demais inalterados ficam de fora |
| OSH-237 | F2 | UNIT | P1 | lista com mesmos funcionários em outra ordem | diff | zero eventos |
| OSH-238 | F2 | UNIT | P1 | evento antigo "Carlos adicionado"; funcionário renomeado/excluído depois | renderizar | nome da época (snapshot), nunca o atual |
| OSH-239 | F2 | HANDLER | P0 | responsável com percentual/valor de comissão no payload de entrada | trocar responsável | evento não cita percentual, valor nem regra de comissão; visibilidade conforme Q22 (general só se não houver dado de comissão) |

### 3.5 Troca de cliente e veículo na OS (D11)

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-240 | F2 | HANDLER | P0 | OS com cliente X | editar a OS trocando para cliente Y (**absorve OSH-170**) | `order.fields_changed` com "Cliente: X → Y" em **nomes** (snapshot), sem `client_id`, sem telefone/CPF; origem `os_form` |
| OSH-241 | F2 | HANDLER | P1 | OS com veículo V1 | trocar para V2 | "Veículo: <modelo/placa V1> → <modelo/placa V2>" legível, sem id; placa é dado do veículo e aparece só como rótulo definido (Q29) |
| OSH-242 | F2 | HANDLER | P1 | OS com cliente e veículo | remover o veículo (`null`); remover cliente se permitido | "Veículo: <anterior> → (vazio)"; sem erro |
| OSH-243 | F2 | UNIT | P1 | cliente sem nome / nome só espaços / excluído logicamente / veículo sem placa | renderizar a troca (**complementa OSH-172**) | fallback textual definido (ex.: "(sem nome)"), nunca o uuid; sem lançar |
| OSH-244 | F2 | HANDLER | P1 | nenhum | trocar cliente e veículo na mesma edição | comportamento determinístico (um evento com 2 mudanças ou dois eventos, conforme Q29), mesma `correlation_id` |

### 3.6 Status e transições

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-245 | F2 | HANDLER | P0 | OS `open` | `POST` com `status=completed`, header `os_form` | 1 `order.status_changed` (`general`), "Em andamento → Concluída" com rótulos do app, ator em snapshot; não duplica em `fields_changed` (status não aparece como campo) |
| OSH-246 | F2 | UNIT | P1 | conjunto de status válidos (Q21; hoje só `open`, `completed`, `cancelled` verificados) | tabela com todos os pares (origem, destino) | cada par distinto gera 1 evento com rótulos corretos; par igual gera zero; nenhum código cru no texto |
| OSH-247 | F2 | HANDLER | P0 | OS `open` | `cancel.post` (F1) e também `POST` com `status=cancelled` (se o handler aceitar; Q21) | `cancel.post`: exatamente 1 `order.cancelled` (OSH-140) e **nenhum** `status_changed` duplicado; `POST` com cancelled: comportamento definido e sem evento duplicado, ou `it.fails` com `KF` se hoje permitir cancelar sem limpar pagamentos |
| OSH-248 | F2 | HANDLER | P1 | OS `completed` | reabrir (`completed → open`); `cancelled → open` (Q21) | se permitido: `status_changed` com de/para; se bloqueado pelo negócio: erro de negócio e zero eventos |
| OSH-249 | F2 | HANDLER | P1 | OS `open` | mesma requisição altera status + campos + item + desconto | eventos distintos, mesmo `correlation_id`, `step` em ordem fixa e documentada, 1 insert em lote |
| OSH-250 | F2 | UNIT | P1 | evento com status fora do mapa de rótulos (legado/futuro) | renderizar | não lança; fallback sem expor código técnico (alinha com OSH-041, Q7) |
| OSH-251 | F2 | API | P1 | OS na stack Docker, 5 mudanças em requisições sequenciais | ler histórico | ordem decrescente por `(occurred_at, seq)`; cada mudança um evento; sem depender do relógio do cliente |

### 3.7 Origem por tela (OS form x lista x detalhe)

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-252 | F2 | HANDLER | P0 | `POST service-orders`, `allowedSources` do endpoint (Q23) | criar/editar com `x-origin=os_form` | todos os eventos da requisição com `source_code=os_form`, `declared`, rótulo do catálogo |
| OSH-253 | F2 | HANDLER | P0 | idem | avançar status e duplicar OS pela lista (`x-origin=os_list`); editar pelo detalhe (`os_detail`) | se `os_list`/`os_detail` estão em `allowedSources`: `declared` com o código enviado; se não, `mismatch` com origem inferida (resultado definido por Q23, teste fixa a decisão) |
| OSH-254 | F2 | HANDLER | P0 | idem | `x-origin=financial_bulk`, `commission_report`, `<script>` | `mismatch` ou descartado; origem inferida; `source_declared` conforme Q1; ator/org/`correlation_id` inalterados; autorização inalterada (mesmo 403 sem permissão, OSH-161) |
| OSH-255 | F2 | HANDLER | P1 | idem | sem header | rótulo genérico do fluxo ou `os_form` inferido, conforme Q23; nunca "tela adivinhada" fora do conjunto aceito |
| OSH-256 | F2 | HANDLER | P1 | criação por duplicação de OS pela lista | `POST` sem id com `os_list` | `order.created` com origem `os_list`; a OS duplicada não herda eventos da original |

### 3.8 Idempotência, duplo clique e falha de gravação

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-258 | F2 | HANDLER | P0 | OS existente | mesma edição enviada duas vezes em sequência (duplo clique) | 1ª: 1 evento; 2ª: estado já igual, zero eventos (diff contra o estado salvo); resposta 200 nas duas |
| OSH-259 | F2 | DB | P1 | OS na stack; 2 edições **concorrentes** com campos diferentes | `Promise.all` de 2 `POST` | as duas mudanças registradas (nenhuma perdida), `seq` crescente, sem erro 500; se ambas leem o mesmo estado e mudam o mesmo campo, o resultado segue a regra de Q16 (teste fixa a decisão) |
| OSH-260 | F2 | UNIT | P0 | helper de chave | gerar chave de `order.created`, `fields_changed`, `status_changed`, itens | determinística; reenvio da **mesma** requisição (retry) gera a mesma chave (1 linha com `ON CONFLICT`); duas edições distintas geram chaves distintas (Q16) |
| OSH-261 | F2 | HANDLER | P0 | insert de eventos sempre com erro | criar, editar campos, editar itens, trocar status (parametrizado) | resposta idêntica à do caso sem falha (status e corpo); OS persistida; log com `request_id`; sem rollback causado pela falha do histórico |
| OSH-262 | F2 | HANDLER | P0 | update da OS falha (erro do supabase) | `POST` | erro do negócio inalterado; **zero** eventos |
| OSH-263 | F2 | HANDLER | P0 | função de diff força exceção (payload inesperado) | `POST` | OS salva e resposta 200; exceção contida; log; sem evento parcial |

### 3.9 Tenant, permissão e volume

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-267 | F2 | HANDLER | P0 | corpo/query com `organization_id` de outra org | criar e editar OS | eventos usam a org da sessão; valor do corpo ignorado |
| OSH-268 | F2 | API | P0 | 2 organizações reais, OS e eventos F2 em ambas | cada usuário lê o histórico da própria OS e tenta a da outra | cada um vê só a própria org; a outra devolve 404 sem pista de existência (reforça OSH-163 para F2) |
| OSH-269 | F2 | HANDLER | P0 | usuário da org A, OS da org B | `POST` editando o id da OS de B | 404/negado como hoje; **zero** eventos em B e em A |
| OSH-270 | F2 | HANDLER | P0 | usuário sem `orders.update`/`orders.create` | `POST` | 403 antes de qualquer escrita; zero eventos; header de origem não altera o resultado |
| OSH-271 | F2 | HANDLER | P1 | usuário com `orders.read` apenas | `GET history` após edições F2 | vê eventos `general` de F2 (criação, campos, status, itens sem comissão); não vê os de visibilidade restrita (Q19, Q22) |
| OSH-272 | F2 | UNIT | P0 | catálogo F2 | tabela única `event_type` → `visibility` | todo evento F2 tem visibilidade explícita; `order.*` e `item_*` conforme Q19/Q22; teste falha se novo tipo entrar sem classificação |
| OSH-275 | F2 | API | P1 | OS com 300 eventos F2 (inserção direta via `adminDb`) | paginar com `limit=30` até o fim | sem repetição nem salto; ordem estável; `hasMore` correto; nenhuma página com itens de outra OS ou org |
| OSH-276 | F2 | UNIT | P1 | edição com 300 itens alterados | diff | saída determinística; quantidade de eventos/agrupamento limitada conforme Q18; sem erro e sem estourar o tamanho de payload |
| OSH-278 | F2 | UNIT | P1 | `reported_defect` de 10 KB | diff | payload gravado respeita o limite de Q30 (truncamento marcado ou recusa); nenhum erro de insert por tamanho |

### 3.10 E2E crítico de F2

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-280 | F2 | E2E | P0 | stack com OS aberta (`order-fixtures`) | editar defeito e km pelo formulário, adicionar item, avançar status pela lista; abrir o histórico | itens "de → para" legíveis em pt-BR, origens distintas (formulário x lista), ordem correta, sem ids |
| OSH-281 | F2 | E2E | P0 | OS com item que tem comissão; perfil com `orders.read` apenas | editar item (preço) com perfil completo; abrir histórico com o perfil restrito (estende OSH-191) | perfil restrito vê a mudança de preço e **nenhum valor de comissão** no HTML nem na resposta da API |

### 3.11 STATIC de F2

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-285 | F2 | STATIC | P1 | handlers de F2 (`service-orders/index.post.ts`) | varrer fonte | chama `recordOsEvents`, declara `defaultSource` e `allowedSources`; estende OSH-007/154 |
| OSH-286 | F2 | STATIC | P1 | colunas de `service_orders` nas migrations | comparar com a allowlist | toda coluna está classificada "na allowlist" ou "excluída" de forma explícita; coluna nova sem classificação falha o teste (impede vazamento silencioso) |
| OSH-287 | F2 | STATIC | P1 | catálogo F2 x mapa de visibilidade x templates do renderizador | cruzar | todo `event_type` F2 tem visibilidade e template pt-BR; nenhum template referencia campo fora da allowlist |

---

## 4. Cenários F3 (restante)

### 4.1 Exclusão da OS (soft delete) e evento preservado

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-300 | F3 | HANDLER | P0 | OS ativa com nº 4012; `orders.delete`; header `os_list` | `DELETE service-orders/:id` | 1 `order.deleted` com nº da OS, nome do ator e origem em snapshot (não depende de reler a OS depois); `visibility=general`; gravado após o soft delete ter dado certo |
| OSH-301 | F3 | HANDLER | P0 | OS com plano, recebimentos e comissões (1 paga) | `DELETE` | eventos dos efeitos (`receipt.reversed`, `installment.removed`, `commission.deleted` com "já estava paga") **e** `order.deleted` com o mesmo `correlation_id` e `step` crescente; o caminho `[id].delete` não estava na lista de OSH-125/154 |
| OSH-302 | F3 | API | P0 | stack; OS com 5 eventos | `DELETE`; depois `GET history` pelo usuário | `GET` = 404; consulta direta via `adminDb` mostra os 5 eventos anteriores **mais** `order.deleted`, intactos (não apagados nem alterados). Não repete OSH-039 (só 404) |
| OSH-303 | F3 | DB | P0 | eventos da OS; OS marcada `deleted_at` | `UPDATE`/`DELETE` em eventos por qualquer papel; excluir fisicamente a OS (se existir fluxo) | trigger bloqueia; evento preservado; FK/`ON DELETE` conforme Q3/Q24 (sem cascata que apague eventos) |
| OSH-304 | F3 | HANDLER | P0 | id inexistente; OS já excluída; OS de outra org | `DELETE` | 404 como hoje; zero eventos; nada em outra org |
| OSH-305 | F3 | HANDLER | P0 | insert de eventos sempre com erro | `DELETE` | exclusão conclui com 200; log com `request_id`. Risco registrado: `order.deleted` é rastro único, perda é silenciosa (sugerir contador/métrica; ver seção 7) |
| OSH-306 | F3 | HANDLER | P1 | OS já excluída pela 1ª chamada | 2ª chamada idêntica (duplo clique) | 404 ou resposta idempotente; total de `order.deleted` = 1 (chave `order_deleted:<os_id>`) |
| OSH-307 | F3 | HANDLER | P1 | idem OSH-300 | `x-origin` = `os_list`, `os_detail`, `financial_bulk` | `os_list`/`os_detail` `declared`; `financial_bulk` `mismatch`; autorização inalterada |
| OSH-308 | F3 | UNIT | P1 | evento `order.deleted` | renderizar e classificar | "OS excluída por João." pt-BR; visibilidade explícita; quem o enxerga é Q24 (a UI do cliente nunca o lista se `GET` é 404; leitura só pelo suporte) |

### 4.2 Ajuste manual de comissão (visibilidade `commission`)

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-310 | F3 | HANDLER | P0 | OS com comissão calculada de R$ 45,00 para Carlos | salvar ajuste manual para R$ 60,00 (`commission_manual_adjustments_log` ganha entrada) | 1 `commission.manual_adjusted`, `visibility=commission`, funcionário em snapshot, `R$ 45,00 → R$ 60,00`; só **entradas novas** do log geram evento |
| OSH-311 | F3 | HANDLER | P0 | usuário A (com gate de comissão) ajusta; usuário B sem o gate | A ajusta junto com outra edição (campo e item); B lê `GET history` | B não recebe o evento (omitido, não mascarado); eventos irmãos da mesma requisição (`fields_changed`, itens) **sem** vestígio do ajuste, do log ou do valor; paginação não revela omitidos (como OSH-035) |
| OSH-312 | F3 | HANDLER | P0 | OS com log de ajustes existente | reenviar a OS sem novo ajuste (ex.: editar só o defeito) | zero `commission.manual_adjusted`; o log antigo não é "reemitido" |
| OSH-313 | F3 | HANDLER | P1 | 2 funcionários ajustados na mesma edição | salvar | 1 evento por funcionário, mesmo `correlation_id`, valores corretos |
| OSH-314 | F3 | HANDLER | P1 | ajuste existente | reverter ao cálculo automático / ajustar para o mesmo valor (Q25) | conforme Q25: evento de reversão ou zero evento; nunca evento "de X para X" |
| OSH-315 | F3 | HANDLER | P1 | ajuste feito pelo formulário e pelo card de responsáveis | `x-origin=os_form` e `os_detail` (caminho de `generate-commissions`) | origem `declared` por tela; `mismatch` com valor fora do conjunto aceito |
| OSH-316 | F3 | UNIT | P1 | ajuste com valores de 3 casas e justificativa livre, se existir (Q25) | renderizar | BRL 2 casas com regra de arredondamento definida; justificativa escapada e exibida só se Q25 permitir; não cita lucro nem margem |
| OSH-317 | F3 | HANDLER | P0 | insert de eventos com erro | salvar ajuste | OS e log de ajuste persistem; resposta 200; log do erro |

### 4.3 NFS-e (emissão, cancelamento, falha, sync)

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-320 | F3 | HANDLER | P0 | OS vinculada; provedor fake retorna sucesso | `POST fiscal/nfse` (modal da OS, `os_detail`) | 1 `nfse.issued` com nº da NFS-e e valor em snapshot, origem `os_detail`/`declared`; chave por id da NFS-e; gravado após a linha de `service_order_nfse` persistir |
| OSH-321 | F3 | HANDLER | P0 | provedor fake retorna erro (rejeição e timeout) | `POST fiscal/nfse` | conforme Q26: com evento de falha, mensagem pt-BR legível e curta, sem stack nem corpo do provedor; sem evento de falha, zero eventos e erro de negócio inalterado. Nunca `nfse.issued` |
| OSH-322 | F3 | HANDLER | P0 | resposta do provedor com token, certificado, credenciais, XML completo | emitir/cancelar/sincronizar | linha gravada **não contém** segredos, XML nem corpo bruto; motivo do provedor sanitizado e truncado |
| OSH-323 | F3 | HANDLER | P0 | NFS-e emitida | `DELETE fiscal/nfse/:id` com motivo | `nfse.cancelled` com nº e motivo; cancelamento recusado pelo provedor: sem `nfse.cancelled`, e falha conforme Q26 |
| OSH-324 | F3 | HANDLER | P1 | NFS-e `processing` | `nfse-sync` encontra status `authorized` (e outro caso `rejected`) | 1 evento por mudança de status; ator `system`, rótulo "Sistema", sem usuário; origem conforme Q26 |
| OSH-325 | F3 | HANDLER | P1 | NFS-e já `authorized` | `nfse-sync` roda 100 vezes sem mudança | zero eventos novos (sem inflar a timeline) |
| OSH-326 | F3 | HANDLER | P0 | webhook (`hook`) sem sessão | (a) payload válido; (b) `service_order_id`/org no corpo divergentes do registro; (c) assinatura/segredo inválido; (d) mesmo webhook repetido 3 vezes | (a) evento na OS e org do **registro** da NFS-e; (b) corpo ignorado; (c) rejeitado, zero evento; (d) 1 evento (chave por NFS-e + status); resposta de sucesso ao provedor mesmo se o evento falhar (evita reentrega) |
| OSH-327 | F3 | UNIT | P0 | helper de chave | gerar chaves de emissão, cancelamento e mudança de status | `nfse_issued:<id>`, `nfse_cancelled:<id>`, `nfse_status:<id>:<status>` (formato sugerido): determinísticas; ids distintos geram chaves distintas |
| OSH-328 | F3 | HANDLER | P1 | NFS-e sem vínculo com OS | emitir/cancelar | zero eventos; sem erro por `service_order_id` nulo (como OSH-128) |
| OSH-329 | F3 | HANDLER | P0 | usuário da org A, OS da org B | emitir NFS-e com `service_order_id` de B | recusado; zero eventos em B e em A; nenhuma linha `service_order_nfse` cruzada |
| OSH-330 | F3 | UNIT | P1 | eventos de NFS-e | renderizar | pt-BR; "NFS-e nº 123 emitida"; valor BRL; data em `America/Sao_Paulo`; chave de acesso/URL só se Q26 permitir |
| OSH-331 | F3 | HANDLER | P1 | modal da OS e tela Fiscal | `x-origin=os_detail` e `fiscal`; valor fora do conjunto | `declared` nos dois primeiros; `mismatch` no terceiro |
| OSH-332 | F3 | HANDLER | P0 | insert de eventos com erro | emitir, cancelar, webhook, sync (parametrizado) | NFS-e emitida/cancelada/atualizada normalmente; resposta igual à do caso sem falha; webhook devolve sucesso ao provedor |

### 4.4 Agendamento vinculado à OS

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-340 | F3 | HANDLER | P0 | criação de OS com `appointmentData` (`os_form`) | `POST service-orders` | `order.created` e `appointment.created` (ou `linked`, Q27) com data e hora legíveis (`20/11 às 08:00`), mesmo `correlation_id`; evento de agendamento só depois do insert do agendamento ter dado certo |
| OSH-341 | F3 | HANDLER | P0 | criação do agendamento falha (hoje vira `warnings`) | `POST service-orders` | OS criada e `order.created` gravado; `warnings` preservado; **zero** `appointment.created` |
| OSH-342 | F3 | HANDLER | P0 | agendamento criado na Agenda com `service_order_id` | `POST appointments` (`appointments`) | evento na OS correta com origem `appointments`; sem `service_order_id`: zero eventos e sem erro |
| OSH-343 | F3 | HANDLER | P1 | agendamento vinculado | `PUT appointments/:id` mudando data e hora; depois reenviando igual | 1 `appointment.changed` com "dd/MM → dd/MM, HH:mm → HH:mm"; reenvio igual: zero eventos |
| OSH-344 | F3 | HANDLER | P1 | agendamento vinculado à OS A | `PUT` trocando para OS B; vinculando um agendamento solto | conforme Q27: evento em A (desvinculado) e em B (vinculado), cada um na própria OS e org; nunca só em uma delas sem regra |
| OSH-345 | F3 | HANDLER | P1 | agendamento vinculado e outro avulso | `DELETE appointments/:id` | vinculado: `appointment.removed`; avulso: zero eventos |
| OSH-346 | F3 | HANDLER | P0 | agendamento da org A com `service_order_id` da org B | `POST`/`PUT appointments` | recusado ou ignorado; zero eventos em B; se hoje o handler aceita o vínculo cruzado, registrar `it.fails` `KF-nn` e abrir defeito de tenant |
| OSH-347 | F3 | UNIT | P1 | evento de agendamento | renderizar | data `dd/MM/yyyy`, hora `HH:mm`, fuso `America/Sao_Paulo` (08:00 local não vira 11:00); sem id; sem dados pessoais do cliente |
| OSH-348 | F3 | HANDLER | P0 | insert de eventos com erro | criar/alterar/excluir agendamento vinculado | agendamento e OS persistem; resposta idêntica; log |
| OSH-349 | F3 | UNIT | P1 | edição da OS que altera `appointment_id` (fora da allowlist) | diff de campos | zero `order.fields_changed` por `appointment_id`; o fato fica só em `appointment.*` (sem duplicidade) |

### 4.5 Aba de suporte (`GET /api/admin/service-orders/:id/events`, owner)

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-355 | F3 | HANDLER | P0 | sem sessão; usuário comum; admin/gerente da org (não owner) | `GET` | 401; 403; 403. Entra na matriz `guard-matrix.test.ts` com `requireOwner` |
| OSH-356 | F3 | API | P0 | owner; OS ativa e OS **excluída** com eventos em 2 orgs | `GET` de cada | 200 com payload cru, `correlation_id`, `request_id`; inclui eventos da OS excluída (inclusive `order.deleted`); eventos da OS pedida só |
| OSH-357 | F3 | HANDLER | P1 | owner | `POST`/`PUT`/`PATCH`/`DELETE` na mesma rota | 405/404; tabela inalterada (somente leitura, append-only) |
| OSH-358 | F3 | HANDLER | P1 | OS com 150 eventos | `limit`, cursor, ordem | mesmas regras de paginação do `GET` de cliente (OSH-037/038); resultado estável |
| OSH-359 | F3 | HANDLER | P1 | id inexistente ou sem eventos | `GET` como owner | resposta definida por Q28 (404 x lista vazia), sem 500 |

### 4.6 STATIC de F3

| ID | Fatia | Camada | Prio | Pré-condições | Ação | Resultado esperado |
|---|---|---|---|---|---|---|
| OSH-365 | F3 | STATIC | P1 | `[id].delete`, `fiscal/nfse/**` (emissão, cancelamento, `hook`, `nfse-sync`), `appointments/*`, `generate-commissions` | varrer fonte | cada ponto de escrita chama `recordOsEvents` e declara `defaultSource`/`allowedSources`; ponta esquecida falha (estende OSH-154) |
| OSH-366 | F3 | STATIC | P1 | catálogo F3 | cruzar `event_type` x visibilidade x template | `order.deleted`, `commission.manual_adjusted` (=`commission`), `nfse.*`, `appointment.*` com visibilidade e template definidos |

---

## 5. Resumo por fatia, camada e prioridade

Contagem exata por script sobre as tabelas deste documento (cenários F2 e F3 apenas; F0/F1 não incluídos).

Total: **115** cenários (F2: 68; F3: 47).

| Camada | F2 | F3 | Total | | Prioridade | F2 | F3 | Total |
|---|---|---|---|---|---|---|---|---|
| HANDLER | 33 | 36 | 69 | | P0 | 34 | 25 | 59 |
| UNIT | 26 | 6 | 32 | | P1 | 33 | 22 | 55 |
| API | 3 | 2 | 5 | | P2 | 1 | 0 | 1 |
| STATIC | 3 | 2 | 5 | | | | | |
| DB | 1 | 1 | 2 | | | | | |
| E2E | 2 | 0 | 2 | | | | | |

Muitos cenários UNIT/HANDLER são linhas de um teste parametrizado, então o número de arquivos/`it` reais é menor que o de IDs.

Núcleo mínimo se for preciso cortar escopo: OSH-201, 202, 220, 223, 258, 261, 267 a 270 (F2); OSH-302, 303, 311, 322, 326, 346, 355 (F3).

## 6. Perguntas de negócio e de desenho em aberto (sem decisão tomada)

Continuam a numeração de `os-history-scenarios.md` (Q1 a Q15). Nada abaixo foi assumido como regra.

| ID | Pergunta | Cenários afetados |
|---|---|---|
| Q16 | Qual a chave de idempotência dos eventos de edição (ex.: hash do diff + versão/`updated_at` da OS)? Duas edições concorrentes sobre o mesmo campo registram uma ou duas mudanças? | OSH-259, 260 |
| Q17 | Lista exata da allowlist e dos rótulos pt-BR. Há campos sensíveis (observações internas, custos, margem) e qual a visibilidade deles? | OSH-201, 206, 286 |
| Q18 | Itens: um evento por item ou agrupado? Qual a chave estável do item (id ou nome)? Há teto de eventos por edição? | OSH-221, 222, 276 |
| Q19 | O item tem desconto próprio? Desconto da OS é valor ou percentual? `discount_changed` é `general` ou `financial`? | OSH-219, 230, 232, 271 |
| Q20 | Mudança do total da OS (derivada de itens/desconto) entra no texto? Pode ser lida como "valor da OS" sem confundir com recebido? | OSH-218, 230 |
| Q21 | Quais status existem e quais transições são válidas (inclusive reabrir)? `POST` com `status=cancelled` é permitido sem passar por `cancel.post`? | OSH-246, 247, 248 |
| Q22 | Responsável na OS é visível a quem só tem `orders.read`? O texto pode citar percentual de comissão (não deve)? | OSH-239, 271 |
| Q23 | `allowedSources` e `defaultSource` de `POST service-orders` (criar, editar, avançar status, duplicar): inclui `os_form`, `os_list`, `os_detail`? Sem header: rótulo genérico ou `os_form`? | OSH-252 a 256 |
| Q24 | `order.deleted`: quem o lê (só suporte)? Existe restaurar OS excluída? Retenção (D6) e FK com `ON DELETE` (Q3) para eventos de OS excluída? | OSH-303, 308, 356 |
| Q25 | Ajuste manual de comissão: pode ser revertido? Existe justificativa e ela é exibida? Visibilidade `commission` confirmada para o evento e para o texto? | OSH-310, 314, 316 |
| Q26 | NFS-e: falha de emissão/cancelamento gera evento? Origem e ator do sync/webhook (`system` ou `fiscal`)? Visibilidade (`general` ou `financial`)? Chave de acesso/URL pode aparecer? Envio por e-mail gera evento? | OSH-321, 324, 330, 332 |
| Q27 | Agendamento: `appointment.created` x `appointment.linked`; troca de OS gera evento nas duas? Mudança de status do agendamento entra? Criar agendamento ao **editar** a OS (hoje só na criação) é esperado? Visibilidade? | OSH-340, 344 |
| Q28 | Aba de suporte: `GET` de OS inexistente é 404 ou lista vazia? Filtro por org é obrigatório? Payload cru pode conter dado pessoal (D6)? | OSH-356, 359 |
| Q29 | Troca simultânea de cliente e veículo: 1 ou 2 eventos? Veículo que não pertence ao cliente novo é regra existente? Placa aparece no texto? | OSH-241, 244 |
| Q30 | Limite de tamanho de texto livre no payload (defeito, observações): truncar, recusar ou gravar inteiro? | OSH-205, 278 |

## 7. Lacunas e riscos de cobertura

- **Perda silenciosa de `order.deleted`/`nfse.*`**: sem transação e com falha tolerada (D3), o único rastro da exclusão pode não existir. Os cenários provam só que a operação não cai; falta teste de alarme. Sugerir contador ou log estruturado verificável.
- **Fake-supabase não prova** unicidade, trigger, RLS, FK, concorrência real: cobertos só em OSH-259, 302, 303, 356 (stack Docker). Se a stack não subir, essas garantias ficam sem prova.
- **Vínculo cruzado de agendamento e NFS-e entre organizações** (OSH-329, 346): o código lido não mostra validação explícita de que `service_order_id` pertence à org; o cenário pode revelar defeito de tenant (`it.fails`). Hipótese, não verificada.
- **NFS-e**: sem E2E e dependente de provedor fake; comportamento real de webhook (reentrega, assinatura, formato) não verificado; `nfse-sync.ts` e a rota `hook` não foram lidos em detalhe.
- **Defeito latente do diff de itens**: se a implementação reutilizar `diffSnapshots` sem remover `commissions[]`/`commission_total`, OSH-220/223/281 falham; é o risco de segurança principal de F2.
- **Allowlist x coluna nova**: sem OSH-286 uma coluna adicionada a `service_orders` depois pode alimentar o histórico sem revisão.
- **Fora de escopo**: UI final (F4), remoção de `editLogs`, backfill (D8) e visão pública (D1) não têm cenários.
- **Matriz de status** (OSH-246) depende de Q21: só `open`, `completed` e `cancelled` estão confirmados no código.
- Dependem de decisão de F0/F1 ainda aberta: Q1 (`source_declared`), Q3 (FK/limpeza de testes `deleteOrgs` versus trigger append-only), Q5 (permissões exatas de leitura), Q7 (tipo desconhecido), Q13 (D3).
