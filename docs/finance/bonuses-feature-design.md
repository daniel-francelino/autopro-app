# Bonificação por meta — design de uma feature nova

> **Atualização**: a primeira versão deste documento modelava o bônus como uma configuração pendurada no cadastro do funcionário (uma "meta do mês" por funcionário). O usuário revisou a proposta para uma arquitetura mais limpa: o **Bônus é uma entidade própria**, cadastrada numa tela nova dentro do Financeiro, atribuível a um ou mais funcionários, com histórico de valores versionado — e deliberadamente **não** reaproveita o motor de cálculo de comissão legado (os 4 motores duplicados documentados em `docs/finance/commissions-configuration-architecture.md`). As seções 4 em diante foram reescritas para refletir essa decisão.

## 1. Pedido

O cliente quer configurar uma **bonificação** (bônus) — distinta da comissão, com base em meta de vendas. Requisitos, consolidando as duas rodadas de conversa:

1. Deve aparecer no relatório de comissões, filtrado especificamente pelo tipo "bônus" (não misturado com o número de comissão).
2. Existe uma **tela nova dentro do Financeiro** para configurar bônus — cria-se o bônus ali, e ele é **atribuído a um ou mais funcionários** (não é mais uma configuração dentro do cadastro do funcionário).
3. O valor do bônus pode **mudar ao longo do tempo** — precisa de **histórico de valores** (se alguém altera o valor, o valor anterior fica registrado).
4. O bônus é **baseado em meta**: uma base de cálculo (faturamento/lucro), uma meta de venda, e se a meta for batida, o(s) funcionário(s) atribuído(s) podem receber a bonificação.
5. Na tela de detalhes do Bônus:
   - histórico de alterações de valor;
   - quais funcionários estão atribuídos;
   - **X/X** por funcionário — quanto falta para a meta, se já bateu, ou se já ultrapassou;
   - botão para **gerar os registros do Bônus** (em lote, para os funcionários elegíveis).
6. Os registros gerados devem aparecer no **relatório de comissões** e no **Financeiro**.
7. Arquitetura pensada para não depender do motor de cálculo de comissão legado (que já é confuso/duplicado — ver o outro documento).

Como é uma feature nova, este documento propõe a arquitetura completa antes de qualquer código — nenhuma mudança foi feita ainda.

## 2. O que já existe no banco (achado importante)

`employee_financial_records.record_type` **já inclui `'bonus'` como valor válido desde a migration original** (`supabase/migrations/20240101000020_create_employee_financial_records.sql:69-70`):

```sql
CONSTRAINT employee_financial_records_record_type_check
    CHECK (record_type IN ('salary', 'commission', 'advance', 'bonus', 'discount'))
```

`server/utils/report-helpers.ts` já tem `bonus: 'Bônus'` no mapa de labels de status. E o filtro de "Tipo" (`recordType`) em `CommissionsFilters.vue`/`EmployeesFilters.vue` **já tem a opção "Bônus" na tela**, hoje sem efeito nenhum:

```ts
const recordTypeOptions: TagFilterOption[] = [
  { value: 'commission', label: 'Comissões', color: 'primary', icon: 'i-lucide-badge-percent' },
  { value: 'bonus', label: 'Bônus', color: 'info', icon: 'i-lucide-gift' }
]
```

Ou seja: **o schema e o filtro já foram desenhados prevendo bônus, mas a feature em si nunca foi construída** — nenhum código, em lugar nenhum, jamais insere uma linha com `record_type = 'bonus'`. Selecionar "Bônus" no filtro hoje só retorna lista vazia.

Também relevante: `service_order_id` na tabela é **nullable** (`ON DELETE SET NULL`) — o schema já comporta um registro financeiro sem OS vinculada, mas nenhum código hoje usa isso (o único inserter, `service-order-commissions.ts`, sempre grava `service_order_id` preenchido, porque é sempre uma comissão de OS).

## 3. Obstáculo real: os relatórios assumem que toda linha tem uma OS válida

`server/utils/employee-report.ts` (usado pelo Relatório de Funcionários e pela tela de detalhe do funcionário) filtra os registros de comissão assim:

```ts
const matchingCommissionRecords = financialRecords.filter((record) => {
  if (String(record?.employee_id || '') !== employeeId) return false
  const orderId = normalizeId(record?.service_order_id)
  const order = orderId ? ordersMap.get(orderId) : null
  if (!order || !orderPassesFilters(order)) return false   // <- exige OS válida, sempre
  ...
})
```

Uma linha de bônus (`service_order_id = null`) **sempre** cairia em `!order` e seria excluída — não importa se o filtro de tipo (`recordType`) foi ajustado para "Bônus" ou não. O mesmo padrão de "precisa ter uma OS que passe nos filtros" muito provavelmente existe em `server/utils/employee-commission-report.ts` e `server/api/reports/commissions.get.ts` (não confirmado linha a linha para os três, mas a suposição de "toda comissão tem uma OS" está espalhada pelo motor de relatórios inteiro, coerente com o fato de nunca ter existido um `record_type` sem OS até hoje).

**Isso precisa ser corrigido como parte desta feature**, não é um detalhe menor: a lógica de filtro de "comissões" nesses três lugares precisa aceitar registros sem OS quando `record_type = 'bonus'` — pulando a checagem de status/pagamento da OS (que não existe pra bônus) e filtrando só pela data de referência do próprio registro contra o período selecionado.

## 4. Modelo de dados proposto

Quatro peças nomeadas, cada uma resolvendo exatamente um requisito do pedido — nenhuma reaproveita os motores de comissão por item/categoria.

### 4.1 `bonuses` — o bônus em si (identidade)

```sql
create table bonuses (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id),
  name             varchar(255) not null,        -- ex: "Meta de vendas — Peças"
  description      text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       varchar(255),
  updated_by       varchar(255),
  deleted_at       timestamptz
);
```

Repara que **não tem** `goal_amount`/`bonus_amount`/`commission_base` aqui — esses três campos são versionados (próxima seção), porque são exatamente o que muda ao longo do tempo.

### 4.2 `bonus_value_versions` — histórico de valores (append-only)

```sql
create table bonus_value_versions (
  id               uuid primary key default gen_random_uuid(),
  bonus_id         uuid not null references bonuses(id) on delete cascade,
  commission_base  varchar(10) not null check (commission_base in ('revenue', 'profit')),
  goal_amount      numeric(15,2) not null,   -- a meta a bater
  bonus_amount     numeric(15,2) not null,   -- valor pago se bater a meta
  effective_from   date not null,            -- a partir de qual mês esse valor vale (sempre dia 1)
  created_at       timestamptz not null default now(),
  created_by       varchar(255),
  unique (bonus_id, effective_from)
);
```

**Editar o valor de um bônus nunca faz `UPDATE`** — sempre insere uma nova linha aqui. O histórico pedido (seção 1, item 3) é, literalmente, "todas as linhas desta tabela para esse `bonus_id`" — não precisa de uma tabela de auditoria separada, o histórico *é* a tabela.

**`effective_from` marca o período válido de cada versão** (ajuste pedido pelo usuário): uma versão vale a partir do mês que ela declara até o mês anterior ao `effective_from` da próxima versão (cadeia aberta — nunca precisa dar `UPDATE` numa versão antiga para "fechá-la", a próxima versão já implicitamente encerra a validade da anterior). Isso resolve dois problemas de uma vez:
- **"Qual valor valia no mês X"**, tanto para gerar um mês retroativo quanto para mostrar o histórico corretamente: `select ... where bonus_id = X and effective_from <= mês_desejado order by effective_from desc limit 1`.
- **Alterar o valor não precisa afetar o mês corrente imediatamente** — ao criar uma nova versão, quem está editando escolhe o `effective_from` (padrão: mês corrente, mas pode ser o próximo mês, por exemplo, se quiser anunciar a mudança sem já valer agora). O `unique(bonus_id, effective_from)` impede duas versões começando no mesmo mês (nesse caso, a edição deveria substituir/reabrir a versão existente daquele mês, não criar uma segunda).

### 4.3 `bonus_employee_assignments` — quais funcionários (N:N)

```sql
create table bonus_employee_assignments (
  id           uuid primary key default gen_random_uuid(),
  bonus_id     uuid not null references bonuses(id) on delete cascade,
  employee_id  uuid not null references employees(id) on delete cascade,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (bonus_id, employee_id)
);
```

Um bônus pode ter N funcionários atribuídos; um funcionário pode estar em N bônus diferentes ao mesmo tempo (ex: "Meta de peças" e "Meta trimestral" simultâneas). `unique(bonus_id, employee_id)` evita atribuir o mesmo funcionário duas vezes ao mesmo bônus.

### 4.4 `bonus_generations` — cada "gerar" vira uma linha (log + trava de duplicidade + snapshot)

```sql
create table bonus_generations (
  id                    uuid primary key default gen_random_uuid(),
  bonus_id              uuid not null references bonuses(id) on delete cascade,
  employee_id           uuid not null references employees(id) on delete cascade,
  reference_month       date not null,             -- sempre dia 1 do mês gerado
  commission_base       varchar(10) not null,       -- snapshot do valor vigente usado
  goal_amount           numeric(15,2) not null,     -- snapshot
  bonus_amount          numeric(15,2) not null,     -- snapshot
  achieved_amount       numeric(15,2) not null,     -- quanto o funcionário vendeu naquele mês — o "X" do X/X
  goal_met              boolean not null,
  financial_record_id   uuid references employee_financial_records(id) on delete set null,  -- null se não bateu a meta e não foi liberado mesmo assim
  created_at            timestamptz not null default now(),
  created_by            varchar(255),
  unique (bonus_id, employee_id, reference_month)
);
```

Essa tabela faz três coisas de uma vez:
- **Trava de duplicidade** — o `unique(bonus_id, employee_id, reference_month)` impede gerar o mesmo mês duas vezes para o mesmo funcionário (diferente da comissão, que evita duplicidade recalculando um delta contra "quanto já foi recebido pela OS" — bônus não tem esse conceito, então precisa da própria trava).
- **Snapshot para o histórico** — uma vez gerado, o mês fica congelado aqui (valor da meta, valor do bônus, quanto foi realizado) mesmo que o valor do bônus mude depois ou as vendas do mês sejam alteradas retroativamente.
- **X/X ao vivo vs. histórico**: para o mês corrente (ainda não gerado), o "X/X" da tela de detalhe é calculado na hora; para meses já gerados, vem direto desta tabela — sem recalcular.

### 4.5 Uma coluna nova em `employee_financial_records`

```sql
alter table public.employee_financial_records
  add column bonus_id uuid references public.bonuses(id) on delete set null;
```

Só para rastreabilidade — permite, a partir de uma linha de `employee_financial_records` com `record_type = 'bonus'`, saber de qual bônus ela veio (útil no relatório de comissões, se quiser linkar de volta pro bônus).

### 4.6 O que deliberadamente **não** é reaproveitado do legado

- Nenhuma das 4 implementações de cálculo por item/categoria (`server/utils/service-order-commissions.ts`, `service-order-item-commissions.ts`, `sales-item-commissions.ts`, `app/utils/service-orders.ts`) é tocada ou reaproveitada — bônus é avaliado por **soma total de vendas do funcionário no mês** (faturamento ou lucro), não por item/categoria, então não tem porque passar pelo motor de comissão por item.
- O que **é** reaproveitado, de propósito, é só a parte já genérica o suficiente: `employee_financial_records` como razão/ledger comum (onde tanto comissão quanto bônus viram linhas `pending`/`paid`), e os dois endpoints de pagamento que já existem — **verificado linha a linha, confirmado que os dois já funcionam para bônus sem nenhuma alteração**:
  - `server/api/reports/commissions/[id]/pay.post.ts` (pagamento individual) não tem nenhuma checagem de `record_type` em lugar nenhum — só carrega o registro por `id`, confere `status !== 'paid'` e segue.
  - `server/api/financial/pay-commissions-bulk.post.ts` (pagamento em lote) tem uma única checagem de tipo (`record_type === 'adiantamento'`, linha 106), que pula o registro — mas `'adiantamento'` **não é um valor válido** do enum real (`salary`/`commission`/`advance`/`bonus`/`discount`, seção 2), então essa checagem nunca é atingida na prática (código morto, não afeta bônus nem nenhum outro tipo).

## 5. Fluxo de geração ("gerar registros do Bônus")

Diferente da comissão (que libera por OS, um evento de pagamento por vez), o bônus é **gerado em lote por padrão**: um clique gera o mês corrente para todos os funcionários atribuídos de uma vez. Também precisa dar pra gerar **um funcionário específico isoladamente** (ex: um caso retroativo, um funcionário que entrou depois, ou um reprocessamento pontual) — o mesmo endpoint cobre os dois casos.

Novo endpoint: `POST /api/bonuses/:id/generate` (body opcional: `{ referenceMonth, employeeId }` — `referenceMonth` default = mês corrente; `employeeId` opcional, restringe a geração a um único funcionário atribuído em vez de todos)

Para cada `bonus_employee_assignments` ativo desse bônus (ou só o `employeeId` informado, se houver):

1. **Pula** se já existe uma linha em `bonus_generations` para `(bonus_id, employee_id, reference_month)` — já foi gerado, idempotente. Essa trava vale igual tanto na geração em lote quanto na de um funcionário só, então gerar isoladamente depois de já ter rodado o lote (ou vice-versa) nunca duplica.
2. Busca a versão vigente **para `reference_month`** (`bonus_value_versions` com o maior `effective_from <= reference_month`, não necessariamente a mais recente cadastrada) — `commission_base`, `goal_amount`, `bonus_amount`.
3. Calcula `achieved_amount`: soma direta de `total_amount` (ou `total_amount - total_cost_amount`, se `commission_base = 'profit'`) das OS desse funcionário com `entry_date` dentro do `reference_month` — a mesma soma que os relatórios já fazem para `grossSales`/`netSales`, só que isolada num cálculo simples (sem passar pelos motores de comissão por item).
4. `goal_met = achieved_amount >= goal_amount`.
5. Se `goal_met` (ou liberado manualmente mesmo sem bater — ver pergunta 3 da seção 9): insere em `employee_financial_records` (`record_type: 'bonus'`, `bonus_id`, `service_order_id: null`, `status: 'pending'`, `amount: bonus_amount`, `reference_date`: último dia do mês, `description: "Bônus — <nome do bônus> — <mês/ano>"`).
6. **Sempre** insere a linha de snapshot em `bonus_generations` — mesmo quando a meta não foi batida e nada é liberado. `financial_record_id` fica `null` nesse caso, mas `achieved_amount`/`goal_amount`/`goal_met` já ficam gravados ali, então o motivo de ter sido pulado ("fez R$ X de uma meta de R$ Y") é sempre consultável depois, sem precisar de nenhuma coluna extra — é exatamente pra isso que a tabela já guarda os dois valores lado a lado (seção 4.4).

Resposta: resumo (`N gerados, M pulados por não bater a meta`), para a UI mostrar um retorno claro depois do clique.

**A partir daqui a linha é um `employee_financial_records` comum, `status: 'pending'`** — os dois endpoints de pagamento já existentes cuidam do resto (marcar como pago, gerar a transação financeira de saída, refletir no Financeiro) — confirmado na seção 4.6 que funcionam sem alteração para `record_type = 'bonus'`.

## 6. Mudanças de UI

### 6.1 Tela nova: lista de bônus (Financeiro)

`app/pages/app/financial/bonuses/index.vue` (nome de rota a confirmar conforme convenção de menu do Financeiro) — lista de bônus cadastrados: nome, base, valor atual (meta/bônus), quantos funcionários atribuídos, ativo/inativo. Botão "Novo bônus" abre um formulário simples (nome, descrição, base de cálculo, meta, valor do bônus — que já entra como a primeira linha em `bonus_value_versions`).

### 6.2 Tela nova: detalhe do bônus

`app/pages/app/financial/bonuses/[id].vue`:

- **Cabeçalho**: nome, descrição, toggle ativo/inativo.
- **Card "Valor atual"**: base, meta, valor do bônus + botão "Alterar valor" (abre modal com base/meta/valor **e um seletor de mês "a partir de quando vale"**, padrão = mês corrente — salvar insere uma nova versão, nunca edita a existente) + "Ver histórico" (tabela: mês de início de vigência, base, meta, valor, criado por/em — todas as versões, mais recente primeiro).
- **Card "Funcionários atribuídos"**: lista com busca/adicionar (exclui quem já está atribuído) e remover; para cada funcionário atribuído, uma linha de progresso do mês corrente — nome, `R$ X / R$ meta`, badge de status (Abaixo da meta / Meta atingida / Meta superada), e:
  - se esse mês já foi processado e a meta foi batida: "Gerado em DD/MM" (com o valor liberado);
  - se esse mês já foi processado mas a meta **não** foi batida: um indicador claro do motivo, ex. "Não gerado — fez R$ X de uma meta de R$ Y" (lendo direto de `bonus_generations.achieved_amount`/`goal_amount`, seção 5, passo 6);
  - se ainda não foi processado: um botão "Gerar" individual nessa linha, além do botão em lote abaixo — chama o mesmo endpoint da seção 5 com `employeeId` preenchido, útil pra reprocessar um funcionário isolado sem re-rodar todo mundo.
- **Botão "Gerar registros do mês"** (topo do card): dispara o endpoint da seção 5 em lote, para todos os funcionários ainda não processados naquele mês; mostra o resumo do resultado (gerados/pulados, com o motivo de cada pulado) ao final.

### 6.3 Formulário de funcionário — a configuração sai daqui, mas a tela de detalhe precisa mostrar o bônus atribuído

Diferente da primeira versão deste documento, **não** entra uma seção "Bônus" no formulário de edição (`app/pages/app/settings/employees/index.vue`) — cadastrar/editar/atribuir continua sendo feito só nas telas do Financeiro (seções 6.1/6.2), pra não duplicar a mesma configuração em dois lugares.

Isso é diferente de **exibir** — a tela de detalhe do funcionário (`app/pages/app/settings/employees/[id].vue`) **precisa** mostrar, ainda que só como leitura, quais bônus estão atribuídos a ele (requisito confirmado pelo usuário, não é mais opcional). Sugestão de posição: um novo card no hero, ao lado do card "Regra de comissão" já existente — "Bônus atribuídos", listando nome do bônus + meta/valor vigente do mês + badge de status do mês corrente (Abaixo da meta / Meta atingida / Meta superada, mesmo cálculo da seção 6.2), cada item linkando para a tela de detalhe do bônus em Financeiro (seção 6.2) para quem tiver permissão de editar. Isso reaproveita a mesma consulta usada pelo `progress.get.ts` da Etapa 4 (seção 8), só filtrada por funcionário em vez de por bônus.

### 6.4 Relatório de Comissões / Relatório de Funcionários — sem mudança de UI, só passam a ter dados

O filtro "Bônus" que já existe em `CommissionsFilters.vue`/`EmployeesFilters.vue` passa a funcionar sozinho assim que a seção 3 (aceitar registro sem OS) e a seção 5 (geração passa a criar linhas `record_type: 'bonus'`) estiverem implementadas — nenhuma mudança nesses dois arquivos de filtro é necessária.

### 6.5 Financeiro — também sem mudança de UI

Uma vez que uma linha de bônus é paga pelos endpoints de pagamento já existentes, ela já gera a transação financeira de saída (categoria "Salários", mesmo caminho que comissão paga já usa hoje) — o requisito "aparecer no financeiro" (seção 1, item 6) já é atendido de graça por esse reaproveitamento, sem precisar de nenhuma tela nova além das da seção 6.1/6.2.

## 7. O que fica fora do escopo da primeira versão (mas vale registrar)

- **Geração automática agendada** (ex: todo dia 1 gera sozinho) — v1 é um clique manual no botão "Gerar registros do mês"; virar um cron é uma evolução possível depois, sem mudar o schema.
- **Metas escalonadas/parciais** (ex: bateu 80%, ganha 50% do bônus) — o pedido é binário (bateu ou não bateu, recebe o valor cheio ou não recebe). Extensível depois com uma tabela de faixas, se necessário.
- **Meta por categoria de produto** (em vez de faturamento/lucro total) — o pedido fala em meta de venda geral, não por categoria.

## 8. Plano de implementação detalhado

Ordem pensada para cada etapa ser testável isoladamente — banco primeiro, depois backend, depois UI.

### Etapa 1 — Migrations

- Criar as 4 tabelas da seção 4 (`bonuses`, `bonus_value_versions`, `bonus_employee_assignments`, `bonus_generations`) + o `alter table employee_financial_records add column bonus_id`.
- Seguir o mesmo padrão de RLS/policies já usado nas outras tabelas escopadas por `organization_id` (checar uma migration recente, ex. a de `employee_financial_records`, como referência de sintaxe).
- **Critério de pronto**: migrations aplicam limpo; os `unique` constraints (seção 4.3 e 4.4) barram duplicidade testado via SQL direto.

### Etapa 2 — Backend: corrigir a suposição "toda comissão tem OS" (seção 3)

- Ajustar `server/utils/employee-report.ts`, `server/utils/employee-commission-report.ts` e `server/api/reports/commissions.get.ts` para não descartar registros com `service_order_id = null` quando `record_type === 'bonus'` — filtrando esses só pela própria `reference_date` contra o período selecionado.
- **Critério de pronto**: uma linha de teste (`insert` manual via SQL, `record_type = 'bonus'`, `service_order_id = null`) aparece no relatório quando o filtro "Bônus" é selecionado, e o total de comissão (que não deve incluir bônus) continua correto.

### Etapa 3 — Backend: CRUD de bônus, versões de valor e atribuições

- `server/api/bonuses/index.get.ts` / `index.post.ts` — listar/criar bônus (criar já grava a primeira linha em `bonus_value_versions` numa transação).
- `server/api/bonuses/[id].get.ts` / `.put.ts` (nome/descrição/ativo) / `.delete.ts` (soft delete).
- `server/api/bonuses/[id]/value-versions.post.ts` — insere uma nova versão com o `effective_from` escolhido (nunca edita a anterior; rejeita com 409 se já existir versão com o mesmo `effective_from`, seção 4.2).
- `server/api/bonuses/[id]/assignments.post.ts` / `.delete.ts` — atribuir/remover um funcionário.
- **Critério de pronto**: todos os endpoints funcionam via curl/Postman antes de qualquer UI existir.

### Etapa 4 — Backend: progresso (X/X)

- Extrair a lógica de soma de faturamento/lucro por funcionário+período que já existe em `employee-report.ts` para uma função compartilhada (reaproveitada tanto pelos relatórios existentes quanto pelo cálculo de progresso do bônus).
- `server/api/bonuses/[id]/progress.get.ts` — devolve, por funcionário atribuído, `achieved_amount` do mês corrente (calculado ao vivo, contra a versão vigente para o mês corrente) e o resultado do último `bonus_generations` para meses já gerados.
- `server/api/employees/[id]/bonuses.get.ts` — mesma consulta de progresso, só que filtrada por funcionário em vez de por bônus (lista todos os bônus atribuídos a ele) — usado pelo card novo da Etapa 6b.
- **Critério de pronto**: os dois endpoints devolvem X/X correto para um funcionário com vendas conhecidas no mês.

### Etapa 5 — Backend: geração (em lote e individual)

- `server/api/bonuses/[id]/generate.post.ts` — implementa o fluxo completo da seção 5, aceitando `referenceMonth` e `employeeId` (opcional) no body.
- Endpoints de pagamento (`commissions/[id]/pay.post.ts`, `pay-commissions-bulk.post.ts`) já confirmados na seção 4.6 — **nenhuma alteração necessária** neles nesta etapa.
- **Critério de pronto**: gerar em lote cria as linhas corretas para todos os funcionários pendentes; gerar um `employeeId` específico afeta só aquele funcionário; pula quem já foi gerado nesse mês (nos dois modos); registra o snapshot (com `financial_record_id` nulo) de quem não bateu a meta; marcar a linha gerada como paga usando o endpoint de pagamento já existente funciona sem alteração.

### Etapa 6 — Frontend

- **6a**: telas do Financeiro — lista (`6.1`) e detalhe (`6.2`): cadastro, alterar valor (com seletor de mês de vigência), histórico de valores, atribuição de funcionários, progresso X/X (com o motivo exibido para quem não bateu a meta), botão de gerar em lote com seletor de mês (padrão: mês corrente) + aviso explícito quando o mês escolhido não for o corrente ("gerando um mês atrasado"), e o botão "Gerar" individual por funcionário na lista de atribuídos.
- **6b**: card "Bônus atribuídos" na tela de detalhe do funcionário (`[id].vue`, seção 6.3) — consumindo `server/api/employees/[id]/bonuses.get.ts` da Etapa 4, com link para a tela de detalhe do bônus correspondente.
- **Critério de pronto**: dá para criar um bônus, atribuir 2+ funcionários, editar o valor (vendo o histórico crescer), gerar o mês corrente e um mês atrasado (com o aviso aparecendo) e ver o resultado — tudo pela UI, sem reload quebrar estado; e a tela de detalhe de cada funcionário atribuído mostra o card com o bônus e o status do mês corrente.

### Etapa 7 — Verificação final

- Confirmar que o filtro "Bônus" já existente nos relatórios mostra as linhas geradas.
- Confirmar que pagar uma linha de bônus gera a transação financeira esperada no Financeiro.
- Rodar `npm run lint` e `npm run typecheck` no projeto inteiro.
- Teste manual do caminho completo: criar bônus → atribuir funcionários → (esperar/simular vendas do mês) → gerar → pagar → conferir no relatório de comissões (filtro Bônus), no Financeiro, e no card de bônus atribuídos na tela do funcionário.

## 9. Perguntas em aberto — todas resolvidas

Todas as perguntas desta seção foram decididas; nada pendente antes de começar a Etapa 1.

1. ~~Mudança de valor no meio do mês~~ — resolvido: `bonus_value_versions.effective_from` (seção 4.2) deixa quem edita escolher se a mudança vale já no mês corrente ou só a partir de um mês futuro.
2. ~~Geração de meses atrasados~~ — resolvido: a UI expõe um seletor de mês (o endpoint da seção 5 já aceita `referenceMonth` pensando nisso), permitindo gerar um mês passado que ficou sem processar — mas com um aviso explícito na tela antes de confirmar (ex: "Você está gerando um mês atrasado — [mês/ano]"), pra deixar claro que não é o fluxo padrão. A trava de duplicidade (`unique(bonus_id, employee_id, reference_month)` em `bonus_generations`, seção 4.4) já cobre o risco de gerar o mesmo mês duas vezes, atrasado ou não.
3. ~~Funcionário que não bate a meta~~ — resolvido: a geração pula (não cria `employee_financial_records`), mas **sempre** grava o snapshot em `bonus_generations` com `achieved_amount`/`goal_amount`/`goal_met: false` — ou seja, o motivo de ter sido pulado ("fez R$ X de uma meta de R$ Y") fica sempre registrado e visível na UI (seção 5, passo 6; seção 6.2), sem precisar de override manual nem de coluna extra.
4. ~~Desatribuir um funcionário no meio do mês~~ — resolvido: fica de fora da geração a partir do momento em que é desatribuído (`bonus_employee_assignments.active = false`). Para casos retroativos, o endpoint de geração (seção 5) e a tela de detalhe (seção 6.2) também suportam gerar **um funcionário isolado**, não só em lote — cobre tanto reprocessar alguém específico quanto agir sobre alguém já desatribuído, se for realmente necessário. A mesma trava de duplicidade da pergunta 2 vale aqui também, então não tem risco de duplicar.
5. ~~Onde no menu do Financeiro~~ — resolvido: a tela de bônus (seção 6.1) entra no menu do Financeiro logo abaixo de "Notas fiscais".
6. ~~Ordem de implementação~~ — resolvido: esta feature (Bônus) segue independente, **sem esperar** por `docs/finance/commissions-configuration-architecture.md` — o usuário decidiu não implementar aquele documento tão cedo, porque tem impacto grande no que já funciona hoje, enquanto Bônus é uma feature nova e isolada. Isso reforça a decisão da seção 4.6 de não depender do motor de comissão legado: como aquele motor não vai ser mexido/migrado no curto prazo, manter Bônus totalmente desacoplado dele evita qualquer bloqueio cruzado entre os dois documentos.
7. ~~Verificação dos endpoints de pagamento~~ — resolvido e já verificado (não só planejado): ver seção 4.6 — `commissions/[id]/pay.post.ts` não tem nenhuma checagem de `record_type`; `pay-commissions-bulk.post.ts` só pula `record_type === 'adiantamento'`, um valor que não existe no enum real (`'advance'` é o valor correto), então essa checagem é código morto. Os dois endpoints já funcionam para bônus sem nenhuma alteração.

Este documento cobre só a análise, o design proposto e o plano de implementação — nenhuma mudança de banco ou código foi feita. Com a seção 9 toda resolvida, o plano da seção 8 está pronto para execução assim que você der o sinal para começar a Etapa 1.

## 10. Bug encontrado e corrigido — "Faturamento - peças" calculava igual a "Lucro"

Depois da feature em produção, uma 4ª base de cálculo (`revenue_minus_parts`, "Faturamento menos peças") foi adicionada em `supabase/migrations/20240101000081_add_employee_net_profit_bonus_base.sql`, ao lado de `employee_net_profit`. O comentário da própria migration já descrevia `revenue_minus_parts` com a **mesma fórmula** de `profit` ("service order total - parts cost"), e `sumAchievedAmount()` (`server/utils/bonuses.ts`) implementava fielmente essa especificação: os dois ramos (`profit` e `revenue_minus_parts`) caíam no mesmo `return sum + (gross - partsCost)`, usando `order.total_amount`/`order.total_cost_amount` — totais da OS inteira, sem nenhuma distinção entre os dois nomes. Na prática, dois itens diferentes no seletor da UI (com descrições quase idênticas em `FormModal.vue`/`ValueModal.vue`) sempre produziam o mesmo número.

**Correção**: `revenue_minus_parts` passou a ser calculado **por item**, com a mesma atribuição por funcionário que o Relatório de Itens Vendidos usa (`server/api/reports/sales-items.get.ts`) — para cada OS elegível do mês, soma-se `item.total_amount - (item.cost_amount × quantity)` só dos itens em que este funcionário aparece em `item.commissions[]` (o snapshot por item gravado por `service-order-item-commissions.ts`). OS sem esse snapshot por item (anteriores ao cutover do motor de comissão, ou sem itens) caem de volta no cálculo antigo por OS inteira, já que não há atribuição por item para ler.

`profit` continua com o cálculo simples por OS inteira (não mudou) — agora as duas opções realmente significam coisas diferentes: `profit` é uma aproximação rápida por OS, `revenue_minus_parts` é o valor preciso, item a item, coerente com o que o Relatório de Itens Vendidos mostra para aquele funcionário.

Arquivos alterados: `server/utils/bonuses.ts` (`ServiceOrderForBonus` ganhou `items`; nova função `sumItemsRevenueMinusParts()`; `fetchOrdersForBonusProgress()` passou a buscar a coluna `items`), `app/components/financial/bonuses/FormModal.vue` e `ValueModal.vue` (descrições/fórmulas dos dois cards atualizadas para deixar a diferença explícita). Nenhuma migration nova foi necessária — o enum de `commission_base` já aceitava o valor, só o cálculo estava errado.
