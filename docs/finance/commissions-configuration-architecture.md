# Configuração de comissões — nova tela, múltiplas regras e categorias

> **Atualização**: depois de validar a arquitetura de Bônus em `docs/finance/bonuses-feature-design.md`, a decisão para Comissões também muda: a configuração não deve ficar escondida dentro do cadastro do funcionário. Comissões passam a ser uma **estrutura própria**, com CRUD novo dentro do **Financeiro**, no mesmo espírito de Bônus: entidade configurável, atribuível a funcionários, com regras versionáveis, histórico claro e motor isolado antes de substituir o legado.
>
> Também fica decidido que **Categorias de Comissão** não devem continuar como uma ação secundária dentro da visão geral de Produtos. Elas precisam de um CRUD próprio no menu **Produtos**, porque são parte central da configuração de produtos e impactam diretamente as regras de comissão.

## 1. Pedido

Hoje um funcionário tem **exatamente uma** regra de comissão no próprio cadastro (`employees`): tipo, valor, base de cálculo e categorias elegíveis. O problema prático é que, para representar taxas diferentes por categoria, o usuário precisa cadastrar a mesma pessoa como vários funcionários "falsos".

O objetivo novo é construir uma arquitetura melhor para configuração de comissões:

1. Criar uma **nova tela de Comissões no Financeiro**, não uma configuração dentro de Funcionários.
2. Permitir cadastrar **configurações de comissão** com múltiplas regras.
3. Atribuir cada configuração a um ou mais funcionários.
4. Permitir regras diferentes por categoria, mantendo a restrição de que uma categoria não pode gerar ambiguidade dentro da mesma configuração.
5. Manter histórico/snapshot suficiente para que comissões já geradas não mudem quando a configuração for editada.
6. Substituir gradualmente o legado, sem quebrar OS, relatórios ou pagamentos já existentes.
7. Criar um CRUD próprio para **Categorias de Comissão/Categorias de Produto** dentro do menu Produtos.

## 2. Estado atual

### 2.1 Comissão fica pendurada em `employees`

`supabase/migrations/20240101000013_create_employees.sql` define os campos atuais:

```sql
has_commission        boolean       not null default false
commission_type       varchar(20)   -- 'percentage' | 'fixed_amount'
commission_amount     numeric(15,2)
commission_base       varchar(10)   -- 'revenue' | 'profit'
commission_categories jsonb         -- array JSON de product_categories.id
```

`commission_categories` vazio/nulo significa "vale para todas as categorias". Quando há valores, funciona como allowlist de categorias.

Esse modelo é simples, mas ficou pequeno para a regra real do negócio: ele só permite uma taxa por funcionário. Não existe identidade própria para a configuração, não existe lista de regras, não existe histórico de mudanças da configuração e o banco não consegue garantir que uma categoria não foi configurada de forma ambígua.

### 2.2 O formulário atual fica em Funcionários

A UI fica em `app/pages/app/settings/employees/index.vue`, dentro do modal/formulário de funcionário. A tela `app/pages/app/settings/employees/[id].vue` exibe a regra de forma somente leitura.

Isso mistura responsabilidades:

- Funcionário deveria cadastrar pessoa, acesso e dados básicos.
- Comissão é regra financeira de remuneração.
- Categoria usada para comissão vem do catálogo de produtos.

Por isso a nova proposta move o CRUD principal para **Financeiro > Comissões**, deixando Funcionários apenas com leitura/resumo das configurações atribuídas.

### 2.3 O cálculo está duplicado em quatro motores

A mesma lógica de elegibilidade/taxa aparece em:

| # | Arquivo | Quando roda |
|---|---|---|
| 1 | `server/utils/service-order-item-commissions.ts` | Snapshot por item ao criar/editar OS |
| 2 | `server/utils/service-order-commissions.ts` | Liberação real da comissão em `employee_financial_records` |
| 3 | `server/utils/sales-item-commissions.ts` | Relatórios de Funcionários e Itens Vendidos |
| 4 | `app/utils/service-orders.ts` | Preview ao vivo no frontend |

Todos leem os 5 campos antigos de `employees`. A nova arquitetura deve criar um motor consolidado e testável, para depois trocar esses quatro pontos com menos risco.

### 2.4 O ledger histórico já ajuda

`employee_financial_records` já é o lugar certo para guardar o resultado financeiro gerado. A migration `20240101000054_add_employee_commission_snapshot_fields.sql` adicionou snapshots como:

```sql
commission_type
commission_percentage
commission_base
item_name
item_amount
item_cost
```

Isso deve ser preservado e ampliado: a configuração nova pode mudar ao longo do tempo, mas cada comissão gerada precisa continuar explicando qual regra gerou aquele valor.

### 2.5 Categorias hoje estão escondidas na visão geral de Produtos

Hoje `app/pages/app/products/index.vue` abre `ProductsCategoriesModal.vue` por um botão "Categorias". Esse modal usa os endpoints de `product-categories` e a tabela `product_categories`.

Para o usuário, isso ficou pequeno demais para a importância da feature. Essas categorias são usadas no catálogo e também determinam onde uma comissão se aplica. Por isso devem virar uma tela própria no menu Produtos.

Lembrando que temos uma tela de Categorias Financeiras, que deve ter features que seja bom para essa tela também.

## 3. Decisão de arquitetura

### 3.1 Comissões viram entidade própria no Financeiro

Seguir o mesmo caminho conceitual de Bônus:

- Bônus: `Financeiro > Bônus`, entidade própria, atribuições, geração e histórico.
- Comissões: `Financeiro > Comissões`, entidade própria, regras, atribuições e histórico.

A configuração deixa de ser "o funcionário tem estes cinco campos" e passa a ser:

> "Existe uma configuração de comissão, com uma ou mais regras, atribuída a um ou mais funcionários."

Isso melhora:

- Manutenção: editar regra financeira em um lugar financeiro.
- Reuso: a mesma configuração pode ser atribuída a vários funcionários.
- Histórico: alterações não sobrescrevem a explicação de comissões já geradas.
- Permissão: `commissions.*` pode ser controlado separado de `employees.*`.
- UI: a tela de detalhe da comissão pode mostrar regras, funcionários, categorias cobertas e impacto antes de aplicar.

### 3.2 Funcionários deixam de ser a origem da configuração

O cadastro de funcionário não deve criar/editar regra de comissão na nova estrutura. Ele deve apenas mostrar, em leitura:

- se o funcionário recebe comissão;
- quais configurações estão atribuídas a ele;
- quais regras/categorias estão vigentes;
- link para `Financeiro > Comissões`, quando o usuário tiver permissão.

Na implementação final, `has_commission` pode ser mantido como flag operacional/cache simples, mas a fonte real passa a ser a atribuição em `employee_commission_plan_assignments`.

### 3.3 Categorias ficam no menu Produtos

Criar uma tela nova:

`app/pages/app/products/categories.vue`

Menu:

```ts
Produtos
  Visão geral
  Categorias
  Estoque
  Fornecedores
  Autorizações
  Compras
  Devoluções
```

Essa tela substitui o modal `ProductsCategoriesModal.vue` como experiência principal. O botão atual "Categorias" na visão geral pode ser removido ou virar apenas atalho para `/app/products/categories`.

Nome recomendado no menu: **Categorias**. Na tela, usar copy mais explícita quando necessário: "Categorias usadas para organizar produtos e definir regras de comissão".

## 4. Modelo de dados proposto

### 4.1 `employee_commission_plans` — configuração de comissão

```sql
create table employee_commission_plans (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            varchar(255) not null,
  description     text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      varchar(255),
  updated_at      timestamptz not null default now(),
  updated_by      varchar(255),
  deleted_at      timestamptz,
  deleted_by      varchar(255),
  unique (organization_id, name)
);
```

Exemplos:

- "Comissão mecânicos — padrão"
- "Comissão vendedor — pneus"
- "Comissão gerente — lucro"

Essa tabela é a identidade da configuração. Ela não guarda taxa diretamente porque uma configuração pode ter várias regras.

### 4.2 `employee_commission_plan_assignments` — funcionários atribuídos

```sql
create table employee_commission_plan_assignments (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references employee_commission_plans(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  varchar(255),
  deleted_at  timestamptz,
  deleted_by  varchar(255),
  unique (plan_id, employee_id)
);
```

Uma configuração pode ser atribuída a vários funcionários. Um funcionário também pode ter mais de uma configuração ativa, desde que não haja conflito de categoria entre elas. A validação de conflito precisa considerar todas as regras ativas atribuídas ao funcionário.

### 4.3 `employee_commission_rule_versions` — versões das regras

```sql
create table employee_commission_rule_versions (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references employee_commission_plans(id) on delete cascade,
  effective_from date not null, -- sempre dia 1
  notes          text,
  created_at     timestamptz not null default now(),
  created_by     varchar(255),
  unique (plan_id, effective_from)
);
```

Editar uma configuração de comissão deve criar uma nova versão, não sobrescrever a anterior. O mesmo raciocínio de `bonus_value_versions` se aplica aqui: para calcular uma OS numa data, busca-se a última versão com `effective_from <= data_de_referencia`.

Isso evita um problema clássico: "mudei a comissão hoje e o relatório antigo mudou junto". Não deve mudar. Comissão gerada fica com snapshot; configuração vigente é usada só para novos cálculos.

### 4.4 `employee_commission_rules` — regras dentro de uma versão

> **Atualização** (migration `20240101000088`, follow-up à `20240101000085` já aplicada): na implementação, o usuário questionou o sentido de `fixed_amount` como "valor fixo" solto — numa regra que vive no nível de categoria/plano (não mais amarrada a um único pedido, como no legado), "valor fixo" não tem unidade óbvia (por item? por pedido? por mês, viraria redundante com o Bônus?). Decisão: `fixed_amount` passou a significar precisamente **valor fixo por unidade vendida na categoria** (`commission_amount * quantidade`, independente do preço do item — ex: "R$20 por pneu vendido"), e `commission_base` passou a ser opcional: obrigatório para `percentage` (é sobre o quê a taxa incide), `null` para `fixed_amount` (não tem base, é por unidade). Um `CHECK` garante essa correspondência no banco. O SQL abaixo já reflete o estado final (as duas migrations combinadas).

```sql
create table employee_commission_rules (
  id                 uuid primary key default gen_random_uuid(),
  version_id         uuid not null references employee_commission_rule_versions(id) on delete cascade,
  name               varchar(255),
  commission_type    varchar(20) not null check (commission_type in ('percentage', 'fixed_amount')),
  -- percentage: taxa (%) sobre commission_base.
  -- fixed_amount: valor fixo em R$ POR UNIDADE vendida na categoria
  -- (commission_amount * quantidade), independente do preço do item.
  commission_amount  numeric(15,2) not null,
  commission_base    varchar(10) check (commission_base in ('revenue', 'profit')),  -- obrigatório só para 'percentage'
  is_default         boolean not null default false,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  constraint employee_commission_rules_base_matches_type_check check (
    (commission_type = 'percentage' and commission_base is not null)
    or (commission_type = 'fixed_amount' and commission_base is null)
  )
);
```

`is_default = true` representa a regra "catch-all": vale para itens sem categoria ou para categorias não cobertas por regra específica. Recomendo permitir no máximo uma regra default por versão.

### 4.5 `employee_commission_rule_categories` — categorias de cada regra

```sql
create table employee_commission_rule_categories (
  rule_id     uuid not null references employee_commission_rules(id) on delete cascade,
  category_id uuid not null references product_categories(id) on delete restrict,
  primary key (rule_id, category_id)
);
```

Validações necessárias no backend:

- A mesma categoria não pode aparecer em duas regras da mesma versão.
- Ao atribuir múltiplos planos ao mesmo funcionário, a mesma categoria não pode ficar coberta por dois planos ativos ao mesmo tempo.
- Uma versão só pode ter uma regra default.
- Se não houver regra default, item sem categoria não gera comissão. Essa é uma mudança em relação ao legado e deve ser decidida antes do corte. Para preservar compatibilidade, recomendo sempre criar uma regra default no backfill.

### 4.6 Snapshot em `employee_financial_records`

Adicionar rastreabilidade para a nova configuração:

```sql
alter table public.employee_financial_records
  add column commission_plan_id uuid references public.employee_commission_plans(id) on delete set null,
  add column commission_rule_id uuid references public.employee_commission_rules(id) on delete set null,
  add column commission_rule_version_id uuid references public.employee_commission_rule_versions(id) on delete set null,
  add column commission_rule_name varchar(255),
  add column commission_amount_snapshot numeric(15,2);
```

As colunas antigas de snapshot (`commission_type`, `commission_percentage`, `commission_base`, `item_name`, `item_amount`, `item_cost`) continuam úteis. As novas colunas só dão o vínculo com a configuração nova.

## 5. Motor de cálculo proposto

Criar um utilitário único:

`server/utils/employee-commission-plans.ts`

Responsabilidades:

- carregar os planos ativos atribuídos a um funcionário;
- resolver a versão vigente pela data de referência;
- montar um índice de categorias por regra;
- validar conflitos;
- escolher a regra aplicável para cada item;
- calcular valor por tipo/base;
- devolver snapshots prontos para persistir.

API conceitual:

```ts
resolveEmployeeCommissionRules({
  employeeId,
  referenceDate,
  assignedPlans,
  item
})
```

Regra de resolução:

1. Se o item tem `category_id`, procurar uma regra específica para aquela categoria.
2. Se não houver regra específica, usar regra default vigente.
3. Se o item não tem `category_id`, usar regra default vigente.
4. Se não houver regra aplicável, não gera comissão para aquele item.

Para preservar o comportamento atual no backfill, todo funcionário que hoje tem `commission_categories` vazio deve virar uma configuração com regra default.

## 6. CRUD novo de Comissões no Financeiro

### 6.1 Lista

Nova rota:

`app/pages/app/financial/commissions/index.vue`

Menu:

```ts
Financeiro
  Visão geral
  Categorias
  Contas bancárias
  Impostos
  Maquininhas
  Notas fiscais
  Bônus
  Comissões
```

A lista deve mostrar:

- nome da configuração;
- status ativo/inativo;
- versão vigente;
- resumo das regras vigentes;
- quantidade de funcionários atribuídos;
- categorias cobertas;
- data da última alteração;
- ações de criar, editar, duplicar, inativar e excluir.

Botão principal: **Nova comissão** ou **Nova configuração**. Sugestão de label: **Nova comissão**, porque é mais natural para o usuário.

### 6.2 Detalhe

Nova rota:

`app/pages/app/financial/commissions/[id].vue`

Estrutura sugerida:

- Cabeçalho: nome, descrição, status, ações.
- Card "Versão vigente": mês de início, regras, base, percentual/valor.
- Card "Regras": lista editável da versão atual.
- Card "Funcionários atribuídos": adicionar/remover funcionários, com busca.
- Card "Categorias cobertas": mostra categorias usadas e alerta de categorias duplicadas/conflitos.
- Card "Histórico de versões": versões anteriores com quem criou, quando começou a valer e o que mudou.
- Área de impacto: preview opcional com OS recentes/itens recentes para validar se a regra cobre o que se espera.

Editar regras deve abrir um modal que pergunta "a partir de qual mês esta alteração vale". Salvar cria uma nova linha em `employee_commission_rule_versions` e copia as regras para essa nova versão.

### 6.3 Funcionários

`app/pages/app/settings/employees/index.vue` deixa de ser o lugar de edição de comissão.

Mudanças:

- Remover, no corte final, os campos antigos do modal de funcionário.
- Manter um resumo somente leitura: "Comissões atribuídas".
- Linkar para a configuração em `Financeiro > Comissões`.

`app/pages/app/settings/employees/[id].vue` deve ganhar um card de leitura com:

- configurações ativas atribuídas;
- regra default;
- categorias específicas;
- vigência atual;
- link para editar no Financeiro, se permitido.

## 7. CRUD de Categorias no menu Produtos

### 7.1 Rota nova

Criar:

`app/pages/app/products/categories.vue`

Essa tela usa a tabela existente `product_categories` e os endpoints atuais de `server/api/product-categories`, ampliando a experiência de modal para CRUD completo.

### 7.2 UI esperada

A tela deve ter:

- tabela/lista com busca;
- nome;
- descrição;
- quantidade de produtos vinculados;
- quantidade de regras de comissão que usam a categoria;
- ações de criar, editar, excluir;
- confirmação de exclusão com impacto;
- estado vazio.

Se a categoria estiver em uso por produto ou regra de comissão, recomendo bloquear exclusão direta e oferecer:

- inativar/soft delete quando seguro;
- ou migrar produtos/regras para outra categoria antes de excluir.

### 7.3 Backend

Os endpoints atuais já existem:

- `GET /api/product-categories`
- `POST /api/product-categories`
- `PUT /api/product-categories/:id`
- `DELETE /api/product-categories/:id`

Melhorias recomendadas:

- adicionar paginação e busca consistente para a tela CRUD;
- retornar contadores de uso (`products_count`, `commission_rules_count`);
- validar permissões com `products.read/create/update/delete`;
- impedir exclusão quando a categoria estiver vinculada a regras de comissão vigentes;
- manter `description`, que já existe no schema, visível no formulário.

## 8. Plano por steps

O plano fica dividido em steps para separar duas fases bem diferentes:

- **Steps 1 a 6**: constroem a estrutura nova em paralelo, sem depender dos campos antigos de `employees`.
- **Steps 7 a 10**: fazem a migração do legado para a estrutura nova. Esses ficam por último de propósito, porque são os que mexem no comportamento real de cálculo.

### Step 1 — CRUD de Categorias em Produtos

Objetivo: tirar Categorias do modal escondido na visão geral de Produtos e transformar em uma tela própria.

Escopo:

- Criar `app/pages/app/products/categories.vue`.
- Adicionar item "Categorias" no menu Produtos.
- Reaproveitar os endpoints atuais de `server/api/product-categories`.
- Evoluir o retorno com busca, paginação e contadores de uso.
- Transformar o botão "Categorias" da visão geral em atalho ou removê-lo.

Critério de pronto:

- O usuário consegue criar, editar, buscar e excluir categorias em **Produtos > Categorias**.
- A tela mostra impacto de uso por produtos e, quando existir, por regras de comissão.

### Step 2 — Estrutura base de Comissões

Objetivo: criar o schema novo de comissões sem ainda trocar o cálculo legado.

Escopo:

- Criar `employee_commission_plans`.
- Criar `employee_commission_plan_assignments`.
- Criar `employee_commission_rule_versions`.
- Criar `employee_commission_rules`.
- Criar `employee_commission_rule_categories`.
- Adicionar colunas de rastreabilidade em `employee_financial_records`.
- Criar actions/permissões `commissions.create/read/update/delete`.
- Aplicar RLS seguindo o padrão das tabelas escopadas por `organization_id`.

Critério de pronto:

- O banco aplica limpo.
- As tabelas novas existem e não alteram nenhum cálculo atual.
- Conflitos básicos são barrados: categoria duplicada na mesma versão, duas regras default na mesma versão e vínculo com categoria inexistente.

### Step 3 — Backend CRUD de Comissões

Objetivo: expor a configuração nova por API antes da UI.

Endpoints:

- `GET /api/commissions`
- `POST /api/commissions`
- `GET /api/commissions/:id`
- `PUT /api/commissions/:id`
- `DELETE /api/commissions/:id`
- `POST /api/commissions/:id/versions`
- `POST /api/commissions/:id/assignments`
- `DELETE /api/commissions/:id/assignments/:employeeId`
- `GET /api/commissions/:id/impact`

Critério de pronto:

- Dá para criar configuração, criar versão, cadastrar regras, atribuir funcionários e consultar detalhe sem nenhuma UI.
- As permissões `commissions.*` são respeitadas.

### Step 4 — UI de Comissões no Financeiro

Objetivo: entregar a nova tela de configuração.

Escopo:

- Criar `app/pages/app/financial/commissions/index.vue`.
- Criar `app/pages/app/financial/commissions/[id].vue`.
- Adicionar item "Comissões" no menu Financeiro.
- Criar componentes/modais para regra, nova versão, funcionário atribuído e impacto.
- Seguir o padrão de Bônus: lista, detalhe, histórico, atribuições e ações claras.

Critério de pronto:

- O usuário consegue configurar comissões sem abrir o cadastro de funcionário.
- A tela mostra versão vigente, regras, funcionários atribuídos e histórico.

### Step 5 — Leitura de Comissões no Funcionário

Objetivo: preparar Funcionários para deixar de ser a origem da configuração.

Escopo:

- Adicionar card de leitura em `app/pages/app/settings/employees/[id].vue`.
- Mostrar configurações de comissão atribuídas ao funcionário.
- Mostrar regra default, categorias específicas e vigência atual.
- Linkar para `Financeiro > Comissões` quando o usuário tiver permissão.

Critério de pronto:

- Funcionário mostra as comissões atribuídas como leitura.
- Ainda não remove os campos antigos do formulário; isso fica para os steps finais de migração.

### Step 6 — Motor consolidado em paralelo

Objetivo: criar e validar o cálculo novo sem ainda substituir os quatro motores antigos.

Escopo:

- Criar `server/utils/employee-commission-plans.ts`.
- Resolver plano ativo por funcionário.
- Resolver versão vigente por data.
- Resolver regra por categoria/default.
- Calcular comissão por percentual ou valor fixo, usando faturamento ou lucro.
- Devolver snapshot pronto para persistir em `employee_financial_records`.
- Criar equivalente client-safe ou endpoint de preview para a tela de OS.

Casos mínimos de teste:

- categoria específica;
- regra default;
- sem default;
- item sem categoria;
- conflito entre planos;
- versão vigente por data;
- comissão percentual sobre faturamento;
- comissão percentual sobre lucro;
- comissão fixa.

Critério de pronto:

- O cálculo novo está testado isoladamente.
- Nenhum fluxo real de OS, relatório ou pagamento depende dele ainda.

### Step 7 — Migração: backfill do legado

Objetivo: copiar a configuração atual de `employees` para o modelo novo.

Para cada funcionário com `has_commission = true`:

- criar um plano, ou agrupar em planos compartilhados quando configurações forem idênticas;
- criar a primeira versão vigente;
- copiar `commission_type`, `commission_amount` e `commission_base`;
- transformar `commission_categories` em linhas de `employee_commission_rule_categories`;
- se `commission_categories` estiver vazio, criar regra default;
- atribuir o plano ao funcionário.

Critério de pronto:

- Todo funcionário com comissão antiga tem configuração equivalente no novo módulo.
- Uma comparação entre legado e novo motor retorna os mesmos valores para casos conhecidos.

### Step 8 — Migração: trocar os motores de cálculo

> Detalhamento completo (auditoria dos 4 motores legados, divergências já existentes entre eles, estratégia de fallback, modo sombra e decisões em aberto) em `docs/finance/commissions-step8-engine-cutover.md`.

Objetivo: fazer o sistema passar a calcular comissões pela estrutura nova.

Ordem recomendada:

1. Preview frontend em `app/utils/service-orders.ts`.
2. Relatórios em `server/utils/sales-item-commissions.ts`.
3. Snapshot por item em `server/utils/service-order-item-commissions.ts`.
4. Liberação real em `server/utils/service-order-commissions.ts`.

Critério de pronto:

- OS novas geram snapshots usando a configuração nova.
- Registros em `employee_financial_records` recebem `commission_plan_id`, `commission_rule_version_id` e `commission_rule_id`.
- Valores continuam equivalentes ao legado após backfill.

### Step 9 — Migração: remover a UI antiga

Objetivo: impedir que o usuário continue editando os campos antigos.

Escopo:

- Remover campos de comissão do formulário de funcionário.
- Atualizar card de detalhe do funcionário para ler apenas as configurações novas.
- Atualizar badges de responsáveis na OS para mostrar "comissão por regra/categoria" em vez de uma taxa única.
- Remover dependências visuais de `commission_type`, `commission_amount`, `commission_base` e `commission_categories`.

Critério de pronto:

- Não há caminho visível para editar os 5 campos antigos.
- Toda edição de comissão acontece em **Financeiro > Comissões**.

### Step 10 — Migração final de banco

Objetivo: remover o legado depois de validar o corte.

Só depois de validar em produção:

- remover `commission_type`, `commission_amount`, `commission_base`, `commission_categories` de `employees`;
- avaliar se `has_commission` continua como flag operacional ou se vira derivado das atribuições ativas;
- remover código morto que lia os campos antigos;
- revisar exports e relatórios para garantir que leem apenas snapshots/estrutura nova.

Critério de pronto:

- O schema antigo não é mais necessário.
- O sistema calcula, exibe, exporta e paga comissões usando somente o novo modelo.

## 9. Pontos de atenção

- **Ambiguidade de categoria**: uma categoria não pode gerar duas comissões para o mesmo funcionário, a menos que exista decisão explícita de permitir soma de planos. Recomendo não permitir soma na v1.
- **Regra default**: preservar compatibilidade criando default no backfill quando o legado valia para todas as categorias.
- **Item sem categoria**: no legado ele sempre conta. Na estrutura nova, recomendo que conte apenas quando houver regra default, e garantir default no backfill.
- **Histórico**: editar regra deve criar versão nova; comissão gerada deve guardar snapshot.
- **Pagamentos**: continuar usando `employee_financial_records` e os endpoints de pagamento existentes, como Bônus faz.
- **Relatórios**: `reports/commissions` continua listando registros gerados. A tela nova de Comissões configura a regra; o relatório mostra o resultado financeiro.

## 10. Decisões já assumidas

1. Comissões terão CRUD próprio em **Financeiro > Comissões**.
2. Configuração de comissão sai do cadastro de Funcionários.
3. Funcionários passam a mostrar apenas resumo/leitura das comissões atribuídas.
4. Categorias terão CRUD próprio em **Produtos > Categorias**.
5. A estrutura nova será versionada, seguindo o padrão mental de Bônus.
6. A troca do motor legado será gradual, com backfill antes do corte.

Este documento cobre a análise e o plano de implementação. Nenhuma mudança de banco ou código foi feita por este documento.
