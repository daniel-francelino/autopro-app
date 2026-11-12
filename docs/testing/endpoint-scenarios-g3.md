# Cenários de teste por endpoint, lote G3

Domínios: taxes (4 handlers), settings (5). Total: **9 handlers**.
Escopo: apenas desenho. Nenhum teste foi implementado, escrito ou executado. Nenhum código de produção foi alterado.
**Revisão obrigatória por `test-reviewer` antes da implementação.**

## Notas gerais

- As colunas "teste dedicado" em `docs/testing/domains/{taxes,settings}.md` podem estar desatualizadas, e a suíte não foi executada. O status vem de busca textual em `tests/` (grep).
- Já provado em `tests/fast/access/guard-matrix.test.ts` (referenciado, não duplicado): 401 sem sessão e rotas admin só para owner. Nenhuma linha repete "sem sessão".
- Helpers: `tests/support/handler-harness.ts`, `fake-supabase.ts`, `factories.ts`. Guard de referência: `server/utils/require-org-permission.ts`. Padrão: `tests/fast/service-orders/money-flows.test.ts`.
- Camada padrão `fast`. `db` só para RLS, constraint, transação. Sem E2E.
- Evidência existente: só `tests/e2e/service-orders/commission-preview.e2e.ts:132` usa `POST /api/taxes` como fixture (não verifica o handler). Catracas estáticas (`write-routes-without-permission.json`, `admin-client-without-org.json`) só listam as rotas. Status **gap** em todas as linhas.
- Taxes: GET/POST/PUT/DELETE usam só `requireAuthUser` + `resolveOrganizationId`, sem `requireOrgPermission`. As 3 escritas estão no baseline KF-09. Chave de permissão não existe: ver G3-OQ-01 (`<perm>`).
- Settings: handlers são **por usuário** (`user_id` da sessão), sem organização (KF-22, legítimo por desenho). Isolamento aqui é entre **usuários**, não entre orgs. Se settings exigem permissão por papel é questão aberta (G3-OQ-10); as 3 escritas constam no baseline KF-09. `device.post` **não persiste nada**, só devolve o corpo (verificado no código).
- Legenda: owner, admin, emp-sem (funcionário sem a permissão), emp-com. Tenant: duas orgs (A logada, B dona do registro) com `createFakeSupabase`.

---

## 1. taxes (4 handlers: 0 covered, 4 gap)

Fonte: `server/api/taxes/`. POST exige `name`, `type`, `rate` (rejeita só ausente/null/falsy em name e type; `rate=0` é aceito). `rate` não tem validação de tipo nem faixa. PUT atualiza só campos enviados (`!== undefined`) e não valida valor. DELETE é soft (`deleted_at`, `deleted_by`), sem `recordAudit`. PUT/DELETE fazem pré-checagem por `id`+`organization_id`+`deleted_at is null`, mas o update em si filtra só por `id`.

| ID | Método e caminho | Pri | Camada | Pré-condições | Passos | Resultado esperado | Integridade de dados | Status | Evidência |
|---|---|---|---|---|---|---|---|---|---|
| TAX-04 | GET /api/taxes | P1 | fast | Org A com 3 impostos (1 soft-deleted), B com 1 | GET; `search` (nome e tipo); `sort_by=rate&sort_order=desc`; `sort_by=invalid`; `page_size=500`; `page=0` | 200; exclui deletados e de B; busca filtra; sort inválido cai em `name`; `page_size` limitado a 100; `page` mínimo 1; `total` correto | Nenhuma escrita | gap | - |
| TAX-03a | GET /api/taxes | P0 | fast | Idem, B com imposto | GET logado A, com `organization_id`=B na query | Só itens de A, query ignorada | - | gap | - |
| TAX-05 | GET /api/taxes | P2 | fast | `search` com `,` `)` `%` | GET `search=a,b)` | Correto: não quebra o filtro `.or()` nem amplia o resultado (G3-SD-03). Hipótese | - | gap | - |
| TAX-06 | GET /api/taxes | P2 | fast | Papéis | GET como emp-sem | Hoje 200 (só login). Comportamento correto depende de G3-OQ-01 | - | gap | - |
| TAX-07 | POST /api/taxes | P1 | fast | Org A | POST `{name:'ISS', type:'municipal', rate:5}` | 200 `{item}`; `organization_id`=A; `created_by`/`updated_by`=email | `rate` persistido igual ao enviado (sem arredondamento) | gap | - |
| TAX-08 | POST /api/taxes | P1 | fast | - | Sem `name`; sem `type`; sem `rate`; `rate:null`; corpo vazio | 400 `name, type e rate são obrigatórios` | Nada inserido | gap | - |
| TAX-09 | POST /api/taxes | P1 | fast | - | `rate:0` | 200 (zero é válido; só undefined/null rejeitados). Regra de alíquota zero: G3-OQ-02 | Item com `rate`=0 | gap | - |
| TAX-01a | POST /api/taxes | P1 | fast | - | `rate`: -5, 100.01, 1000, 'abc', NaN, '5' | Correto: 400 para negativa, >100, não numérica (G3-SD-01). Candidato it.fails. `'5'` conforme G3-OQ-02 | Nenhuma alíquota inválida persistida (afeta `total_taxes_amount` da OS e a base de comissão) | gap | - |
| TAX-01b | POST /api/taxes | P2 | fast | - | `name`/`type` não string (número, objeto, array); `type` fora do conjunto | Correto: 400 (G3-SD-01); conjunto válido de `type`: G3-OQ-03. Candidato it.fails | Nada inserido | gap | - |
| TAX-10 | POST /api/taxes | P2 | fast | Imposto existente com mesmo `name`+`type` na org | POST duplicado | Regra de duplicidade em G3-OQ-04; registrar comportamento atual. Unicidade no banco: `db` | - | gap | - |
| TAX-03b | POST /api/taxes | P0 | fast | Org A logada | POST com `organization_id`=B no corpo | Criado com org A (corpo ignorado) | Nenhuma linha em B | gap | - |
| TAX-11 | POST /api/taxes | P1 | fast | Perfis owner/admin/emp-sem/emp-com | POST por perfil | owner/admin/emp-com 200; emp-sem 403. KF-09 (it.fails para emp-sem) | - | gap | `tests/static/baselines/write-routes-without-permission.json` (só estático) |
| TAX-12 | PUT /api/taxes/:id | P1 | fast | Imposto de A | PUT `{name}` só; PUT `{rate:7.5}`; PUT `{}` | 200; só campos enviados mudam; `updated_by` preenchido; `{}` só atualiza `updated_by` | `rate` persistido exato; demais campos intactos | gap | - |
| TAX-13 | PUT /api/taxes/:id | P1 | fast | - | id inexistente; id soft-deleted | 404 `Registro não encontrado` | Nada alterado | gap | - |
| TAX-01c | PUT /api/taxes/:id | P1 | fast | Imposto de A com `rate`=5 | PUT `rate`: -1, 150, 'abc', null, '' | Correto: 400 e `rate` continua 5 (G3-SD-01). Candidato it.fails | Alíquota original preservada | gap | - |
| TAX-01d | PUT /api/taxes/:id | P1 | fast | - | PUT `{name:''}` ou `{name:null}`; `{type:''}` | Correto: 400 (POST exige não vazio; PUT não). Candidato it.fails (G3-SD-02) | Nome/tipo continuam preenchidos | gap | - |
| TAX-02a | PUT /api/taxes/:id | P0 | fast | OS antiga com `total_taxes_amount` gravado e imposto `rate`=5 | PUT `rate:10`; recalcular comissão/relatório da OS antiga | `total_taxes_amount` e comissão da OS antiga inalterados (valor é snapshot na OS). Só novas OS usam 10 | Base de comissão histórica não muda | gap | - |
| TAX-02b | PUT /api/taxes/:id | P1 | fast | Imposto `rate`=10 e OS com `apply_taxes` | Calcular comissão sobre lucro com imposto (reusar `service-order-commissions` com `total_taxes_amount`) | Base de lucro = receita - custos - `total_taxes_amount`; comissão reduz proporcionalmente (C20). Como o imposto vira `total_taxes_amount`: G3-OQ-05 | Soma coerente com `reports/commissions` | gap | `tests/fast/commissions/*` usam `total_taxes_amount` (confirmar por grep, não é o handler) |
| TAX-03c | PUT /api/taxes/:id | P0 | fast | Imposto de B | PUT logado A | 404; B intacto (`rate`, `name`) | Intacto | gap | - |
| TAX-03d | PUT /api/taxes/:id | P1 | fast | Corpo com `organization_id`=B, `deleted_at`, `created_by` | PUT | Campos fora da lista (`name`,`type`,`rate`) ignorados; org e `deleted_at` não mudam | Sem mass assignment | gap | - |
| TAX-14 | PUT /api/taxes/:id | P1 | fast | Perfis | PUT por perfil | emp-sem 403 (KF-09, it.fails); emp-com 200 | - | gap | - |
| TAX-15 | DELETE /api/taxes/:id | P1 | fast | Imposto de A | DELETE | 200 `{success:true}`; `deleted_at`+`deleted_by` preenchidos; some do GET; linha continua no banco (soft) | - | gap | - |
| TAX-16 | DELETE /api/taxes/:id | P1 | fast | Já deletado / inexistente | DELETE duas vezes | 404 na segunda e no inexistente; `deleted_at` original mantido | Idempotência: nada reescrito | gap | - |
| TAX-02c | DELETE /api/taxes/:id | P0 | fast | OS antiga com imposto aplicado | DELETE do imposto | OS e comissões antigas inalteradas (`total_taxes_amount` snapshot). Bloquear ou não excluir imposto em uso: G3-OQ-06 | Histórico financeiro intacto | gap | - |
| TAX-03e | DELETE /api/taxes/:id | P0 | fast | Imposto de B | DELETE logado A | 404; B sem `deleted_at` | Intacto | gap | - |
| TAX-17 | DELETE /api/taxes/:id | P1 | fast | Perfis | DELETE por perfil | emp-sem 403 (KF-09, it.fails); emp-com 200 | - | gap | - |
| TAX-18 | DELETE /api/taxes/:id | P2 | fast | - | DELETE com update que retorna erro (fake com falha) | 500 com mensagem; nada marcado | - | gap | - |

---

## 2. settings (5 handlers: 0 covered, 5 gap)

Fonte: `server/api/settings/`. Tabelas `user_preferences` e `notification_preferences`, chave `user_id` da sessão, upsert `onConflict: user_id`. Nenhuma checagem de organização ou papel. PUT de preferências usa `||` (string vazia vira default); PUT de notificações usa `??` (false é mantido). `habit_reminders` é aceito e devolvido pelo PUT de notificações mas **não é persistido**, e o GET devolve sempre o default `true` (verificado no código, G3-SD-01).

| ID | Método e caminho | Pri | Camada | Pré-condições | Passos | Resultado esperado | Integridade de dados | Status | Evidência |
|---|---|---|---|---|---|---|---|---|---|
| SET-03 | GET /api/settings/preferences | P1 | fast | Usuário sem linha; usuário com linha parcial | GET | Sem linha: defaults (`purple`,`slate`,`light`,`UTC`); com linha: valores salvos mesclados aos defaults | Nenhuma escrita (GET não cria linha) | gap | - |
| SET-04 | GET /api/settings/preferences | P0 | fast | Usuários U1 e U2 com preferências diferentes | GET logado U1, com `user_id`=U2 na query | Só dados de U1 (filtra `user_id` da sessão) | Sem vazamento entre usuários | gap | - |
| SET-05 | GET /api/settings/preferences | P2 | fast | Fake com erro | GET | 500 `Failed to fetch user preferences`, sem detalhe interno | - | gap | - |
| SET-06 | PUT /api/settings/preferences | P1 | fast | Usuário sem linha | PUT `{primary_color:'blue', color_mode:'dark'}` | 200 devolve payload; upsert 1 linha; campos omitidos recebem default | 1 linha por `user_id` | gap | - |
| SET-07 | PUT /api/settings/preferences | P1 | fast | Linha existente | PUT de novo com outro valor | Atualiza a mesma linha (idempotente), sem duplicar | Contagem de linhas por usuário = 1 | gap | - |
| SET-02a | PUT /api/settings/preferences | P1 | fast | - | `color_mode:'neon'`; `timezone:'Not/AZone'`; `primary_color` não string (número, objeto) | it.fails só para tipo: `primary_color` não string (número, objeto) deve dar 400 (G3-SD-02). it.todo (G3-OQ-07): `color_mode:'neon'` e `timezone:'Not/AZone'`, pois o conjunto válido não está definido | Nada inválido persistido | gap | - |
| SET-02b | PUT /api/settings/preferences | P2 | fast | Linha com `dark` | PUT `{}` e PUT `{color_mode:''}` | Hoje: volta ao default (omitido reseta tudo, não é merge). Confirmar a intenção (G3-OQ-08). Registrar comportamento | Valores salvos são sobrescritos pelos defaults | gap | - |
| SET-08 | PUT /api/settings/preferences | P0 | fast | U1 e U2 com linhas | PUT logado U1 com `user_id`=U2 e `organization_id`=B no corpo | Grava só a linha de U1; U2 intacto | Linha de U2 inalterada | gap | - |
| SET-09 | PUT /api/settings/preferences | P2 | fast | Perfis | PUT como owner/admin/emp-sem | it.todo (G3-OQ-10): resultado correto por perfil depende da decisão se settings exigem permissão. Hoje 200 para todos; a rota está no baseline KF-09, que a classifica como defeito | - | gap | `write-routes-without-permission.json` (estático) |
| SET-10 | GET /api/settings/notifications | P1 | fast | Sem linha; com linha | GET | Defaults mesclados; `subscriptions: []`; `habit_reminders` sempre `true` | Nenhuma escrita | gap | - |
| SET-11 | GET /api/settings/notifications | P0 | fast | U1 e U2 | GET logado U1 com `user_id`=U2 na query | Só dados de U1 | Sem vazamento | gap | - |
| SET-12 | GET /api/settings/notifications | P2 | fast | Fake com erro | GET | 500 `Failed to fetch notification preferences` | - | gap | - |
| SET-13 | PUT /api/settings/notifications | P1 | fast | Usuário sem linha | PUT `{channel_email:false, weekly_digest:true}` | 200; `false` é mantido (`??`); omitidos recebem default; upsert 1 linha | 1 linha por `user_id` | gap | - |
| SET-14 | PUT /api/settings/notifications | P1 | fast | Linha com `channel_email:false` | PUT `{}` | Hoje reseta tudo ao default (não é merge). Confirmar intenção (G3-OQ-08, G3-SD-07) | Valores anteriores sobrescritos | gap | - |
| SET-02c | PUT /api/settings/notifications | P1 | fast | - | `channel_email:'yes'`, `1`, `null`; `web_push_permission:'xyz'` | it.fails só para tipo: `channel_email` não booleano (`'yes'`, `1`, `null`) deve dar 400 (G3-SD-02); hoje `'yes'` vai ao banco. it.todo (G3-OQ-07): `web_push_permission:'xyz'`, conjunto válido indefinido | Nada inválido persistido | gap | - |
| SET-15 | PUT /api/settings/notifications | P1 | fast | - | PUT `{habit_reminders:false}` e GET depois | Correto: valor persiste (GET devolve `false`). Hoje o PUT devolve `false` mas o GET devolve `true` (G3-SD-05, Verificado). Candidato it.fails | Resposta do PUT == leitura seguinte | gap | - |
| SET-16 | PUT /api/settings/notifications | P0 | fast | U1 e U2 | PUT logado U1 com `user_id`=U2 no corpo | Grava só U1 (`user_id` da sessão sobrescreve) | U2 intacto | gap | - |
| SET-17 | PUT /api/settings/notifications | P2 | fast | Perfis | PUT por perfil | it.todo (G3-OQ-10): permissão por perfil indefinida. Hoje 200 para todos; a rota está no baseline KF-09 | - | gap | `write-routes-without-permission.json` (estático) |
| SET-18 | PUT /api/settings/notifications | P2 | fast | Fake com erro no upsert | PUT | 500 `Failed to save notification preferences` | - | gap | - |
| SET-01a | POST /api/settings/notifications/device | P1 | fast | Usuário logado | POST `{token:'t1', platform:'web'}` | Hoje 200 `{ok, receivedAt, device}` espelhando o corpo, **sem persistir** (Verificado). Registrar comportamento atual | Nenhuma linha criada | gap | - |
| SET-01b | POST /api/settings/notifications/device | P2 | fast | Tabela de dispositivos (se existir) | POST duas vezes o mesmo token; mesmo token por U2 | it.todo, adiado (funcionalidade futura, G3-OQ-09): registro idempotente e token vinculado a um usuário (SET-01 do domínio). Hoje não há persistência (G3-SD-06). Reavaliar prioridade quando a feature existir | 1 linha por (usuário, token) | gap | - |
| SET-01c | POST /api/settings/notifications/device | P1 | fast | - | Sem corpo; corpo não objeto; token vazio; payload grande/HTML | Correto: 400 para sem token. Hoje 200 e ecoa qualquer corpo, inclusive `null` (G3-SD-06). Candidato it.fails | Nada ecoado ou persistido sem validação | gap | - |
| SET-01d | POST /api/settings/notifications/device | P0 | fast | U1 e U2 | POST logado U1 com `user_id`=U2 | Correto: dispositivo associado a U1 só; nunca a U2. Hoje nada é gravado | Sem associação cruzada | gap | - |
| SET-01e | POST /api/settings/notifications/device | P2 | fast | Perfis | POST por perfil | it.todo (G3-OQ-10): permissão por perfil indefinida. Hoje 200 para todos; a rota está no baseline KF-09 | - | gap | `write-routes-without-permission.json` (estático) |

---

## 3. Defeitos suspeitos (SD) e perguntas de negócio (OQ)

Verificado = confirmado lendo o código; hipótese = precisa de teste ou decisão. Nenhum foi executado. Todos viram `it.fails` com KF novo (numeração a cargo do test-engineer), exceto os já cobertos por KF-09/KF-22.

### Defeitos suspeitos

| ID | Status | Descrição | Cenário |
|---|---|---|---|
| G3-SD-01 | Verificado (código) | `taxes` POST e PUT não validam `rate` (tipo, negativa, >100, NaN) nem tipo de `name`/`type`. Alíquota inválida entra no cálculo de `total_taxes_amount` e reduz/aumenta a base de comissão. Constraint de banco pode mitigar (confirmar em `db`). | TAX-01a/b/c |
| G3-SD-02 | Verificado (código) | `taxes` PUT aceita `name`/`type` vazio ou null (POST rejeita). Settings PUT não validam tipos nem conjunto de valores (`color_mode`, `timezone`, booleanos, `*_permission`). | TAX-01d, SET-02a, SET-02c |
| G3-SD-03 | Hipótese | `taxes` GET interpola `search` na string de `.or()` sem escapar vírgula e parênteses; pode alterar o filtro (PostgREST). | TAX-05 |
| G3-SD-04 | Verificado (código) | `taxes` PUT/DELETE fazem pré-checagem por org, mas o `update` final filtra só por `id` (janela de corrida). Risco baixo, teste via fake não prova; não vira cenário obrigatório. | - (sem cenário: fake não prova; TAX-03c/e não cobrem) |
| G3-SD-05 | Verificado (código) | `settings/notifications` `habit_reminders` não é persistido: PUT devolve o valor enviado, GET devolve sempre `true`, a coluna não está no `select` nem no upsert. Preferência perdida. | SET-15 |
| G3-SD-06 | Verificado (código) | `settings/notifications/device` é stub: não grava, não valida, ecoa o corpo (inclusive qualquer campo). Sem registro de dispositivo, push móvel/web não pode funcionar; riscos de eco de dado arbitrário. | SET-01a-e |
| G3-SD-07 | Verificado (código) | `settings` PUT sem merge: corpo parcial reseta os demais campos ao default (perda silenciosa de preferências). Pode ser intencional (G3-OQ-08). | SET-02b, SET-14 |

Total: 7 itens (6 verificados no código, 1 hipótese).

### Perguntas em aberto

Regras fiscais e de produto: nada foi inventado. Para o `product-owner` (PO) e o `financial-auditor` (FA).

| ID | Dono | Pergunta |
|---|---|---|
| G3-OQ-01 | PO | Qual chave de permissão protege criar, editar e excluir impostos (KF-09)? Quem pode ler (GET hoje só exige login)? |
| G3-OQ-02 | PO + FA | Faixa válida de `rate` (0 a 100? casas decimais máximas)? Alíquota 0 é permitida? Aceitar string numérica (`'5'`)? Soma de impostos aplicados em uma OS pode passar de 100%? |
| G3-OQ-03 | PO + FA | Quais valores de `type` são válidos (ex.: `municipal`)? É livre ou lista fixa? |
| G3-OQ-04 | PO | Nome/tipo de imposto duplicado na mesma org é permitido? |
| G3-OQ-05 | FA | Como o imposto vira `total_taxes_amount` na OS (percentual sobre quê: bruto, serviços, líquido)? Arredondamento? E quais impostos se aplicam por item? |
| G3-OQ-06 | PO | Excluir imposto usado em OS: bloquear, ou manter só o histórico? |
| G3-OQ-07 | PO | Conjuntos válidos de `primary_color`, `neutral_color`, `color_mode` e `timezone` (IANA)? |
| G3-OQ-08 | PO | PUT de preferências deve ser merge parcial ou substituição total (hoje reseta omitidos)? |
| G3-OQ-09 | PO | Registro de dispositivo push: é funcionalidade futura (stub intencional) ou deve persistir? Chave de unicidade (usuário+token)? Quantos dispositivos por usuário? |

| G3-OQ-10 | PO | Os endpoints de settings exigem permissão? Todas as três escritas de settings (preferences PUT, notifications PUT, notifications/device POST) estão no baseline KF-09, que hoje as classifica como defeito. Decidir se KF-09 se aplica a elas ou se são pessoais e isentas. |

Total: 10 perguntas.

---

## 4. Ordem de implementação para o test-engineer (uma PR por domínio)

Antes: `test-reviewer` revisa este documento. Rodar a suíte atual e confirmar o estado real das colunas "dedicado" em `docs/testing/domains/*.md`.

1. **taxes** (4 handlers). Prioridade: TAX-03a-e (isolamento), TAX-02a/c (histórico), TAX-01a/c (alíquota, `it.fails`, G3-SD-01), TAX-11/14/17 (KF-09, `it.fails`), depois CRUD P1 e P2. TAX-02b só depois de G3-OQ-05. Arquivo: `tests/fast/taxes/handlers.test.ts`.
2. **settings** (5 handlers). Prioridade: SET-04/08/11/16/01d (isolamento entre usuários), SET-15 (`it.fails`, G3-SD-05), SET-01a-c (documentar stub, G3-SD-06), SET-02a/c, depois defaults e erros. Linhas dependentes de G3-OQ-07/08/09/10 ficam `it.todo` (SET-09, SET-17, SET-01e, SET-01b e os conjuntos válidos de SET-02a/c). Arquivo: `tests/fast/settings/handlers.test.ts`.

Em ambas: não alterar código de produção; um `it.fails` por defeito suspeito com KF novo em `docs/testing/known-failures.md`; só atualizar colunas "dedicado" dos domínios depois de executar a suíte. OQ bloqueiam apenas as linhas que as citam.
