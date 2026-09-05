# Relatório de Funcionários — seleção múltipla + accordion com carregamento sob demanda

Este documento cobre a implementação da seleção de **um ou mais funcionários** no relatório de funcionários (`app/pages/app/reports/employees.vue`), com cada funcionário selecionado exibido dentro de um **accordion** (ícone + nome como título) cujo conteúdo só é buscado no servidor quando o usuário efetivamente **expande** aquele item.

## 1. Pedido

> No relatório de funcionário deve ser possível selecionar um ou mais funcionários. O bloco de estatísticas + abas (OS trabalhadas / Comissões / Itens vendidos) deve ficar dentro de um accordion, cujo header tem um ícone e o nome do funcionário como título. E pensar em como otimizar o processamento dos dados para não sobrecarregar — por exemplo, só carregar os dados do funcionário quando o accordion dele é aberto.

Três exigências, nessa ordem: (1) seleção múltipla, (2) um accordion por funcionário com ícone+nome no header, (3) busca **lazy**, por funcionário, disparada pela expansão do item — não pela seleção.

## 2. Como funcionava antes

| Arquivo | Papel |
|---|---|
| `app/pages/app/reports/employees.vue` | Página. Mantinha `employeeId: string` (seleção única) via `useReportQueryParam`, disparava **um único** `useAsyncData` para `/api/reports/employees` com esse `employeeId`, e renderizava estatísticas + abas + tabela diretamente no template, para aquele funcionário. |
| `app/components/reports/employees/EmployeesFilters.vue` | Filtros. O funcionário era escolhido em `UiAsyncPaginatedSelect` (busca com paginação, mas seleção única — `v-model="employeeId"` como `string`). |
| `app/components/reports/employees/EmployeesStats.vue` | Os 5 cards de estatística (venda bruta, despesas, comissão, comissão de outros, venda líquida). Sem mudança nesta implementação. |
| `server/utils/employee-report.ts` (`getEmployeeReport`) | Já recebia **um único** `employeeId` por chamada. Busca **todas** as `service_orders`, `employees`, `clients`, `product_categories` e `employee_financial_records` da organização (via `fetchAllOrganizationRows`, sem filtro de funcionário na query) e só filtra por `employeeId` depois, em memória — ver seção 4.1. Também devolve, em toda chamada (mesmo sem `employeeId`), a lista completa de `{ value, label }` de funcionários da organização, usada para popular o filtro. |
| `server/api/reports/employees.get.ts`, `server/api/reports/export-employees.post.ts` | Fininhos — só repassam `query`/`body` pra `getEmployeeReport`. **Não foram alterados** nesta implementação (seção 4). |

Como só existia um funcionário selecionável, não havia problema de "múltiplos relatórios pesados ao mesmo tempo" — era sempre exatamente uma chamada a `getEmployeeReport`.

## 3. Arquitetura nova

Três componentes novos/alterados, nenhuma mudança no backend:

```
employees.vue (página)
 ├─ ReportsEmployeesFilters          → v-model:employee-ids (string[], antes era employee-id: string)
 └─ ReportsEmployeesAccordion        → 1 item por funcionário selecionado
     └─ ReportsEmployeesAccordionPanel (× N, montado só quando o item abre)
         ├─ ReportsEmployeesStats     (reaproveitado sem alteração)
         ├─ UTabs (OS / Comissões / Itens — estado local, não é mais URL)
         └─ AppDataTableInfinite + export CSV/PDF
```

| Arquivo | Papel |
|---|---|
| `app/components/reports/employees/EmployeesFilters.vue` | `employeeId: string` → `employeeIds: string[]`. Trocado `UiAsyncPaginatedSelect` por `UiTagFilter` (mesmo padrão multi-seleção com iniciais já usado em `CommissionsFilters.vue`) — ver seção 5.1. |
| `app/pages/app/reports/employees.vue` | Não busca mais o relatório em si. Busca só a lista de funcionários para o filtro (via `/api/employees`, não mais via `/api/reports/employees` — seção 4.2) e delega tudo mais para `ReportsEmployeesAccordion`. |
| `app/components/reports/employees/EmployeesAccordion.vue` **(novo)** | Monta os `items` do `UAccordion` (um por funcionário selecionado, com `icon`/`label`) e controla **quais itens já foram abertos ao menos uma vez** — é o componente que decide quando um `EmployeesAccordionPanel` é montado. |
| `app/components/reports/employees/EmployeesAccordionPanel.vue` **(novo)** | Todo o conteúdo que antes vivia direto em `employees.vue` (stats, abas, tabela, export), agora parametrizado por `employeeId`/`employeeName` como props em vez de estado global da página. Busca seu próprio relatório via `$fetch('/api/reports/employees', { query: { employeeId: props.employeeId, ... } })` no `onMounted`. |

## 4. Otimização: o que muda quanto a chamadas ao servidor

### 4.1 Por que "lazy por accordion" é a otimização certa aqui

`getEmployeeReport` (`server/utils/employee-report.ts:157-217`) busca as **cinco tabelas inteiras da organização** a cada chamada — `service_orders`, `employees`, `clients`, `product_categories`, `employee_financial_records`, via `fetchAllOrganizationRows` sem filtro de funcionário na query SQL — e só filtra por `employeeId` depois, em memória (linha 236 em diante: `orders.filter(order => orderPassesFilters(order) && isEmployeeResponsible(order))`). Ou seja: **cada chamada a este endpoint já custa "buscar a oficina inteira"**, independente de quantos funcionários o filtro final devolve.

Isso significa que, se a página disparasse uma chamada por funcionário **assim que ele é selecionado** (ao marcar a caixinha no filtro, por exemplo), selecionar 8 funcionários de uma vez geraria 8 buscas completas e simultâneas da organização inteira — 8× o custo de rede/CPU do servidor por uma única interação do usuário, a maior parte disso para dados que o usuário talvez nunca role até ver.

A exigência do pedido ("só carregar quando abre o accordion") resolve exatamente isso: **nenhuma chamada é feita por seleção** — só por expansão manual de um item. Selecionar 8 funcionários e nunca abrir nenhum accordion custa **zero** chamadas a `/api/reports/employees`.

### 4.2 A lista de funcionários do filtro não usa mais o endpoint pesado

Antes, a lista de `{ value, label }` para popular o seletor de funcionário vinha embutida na resposta de `/api/reports/employees` (`employee-report.ts:204-217`, campo `employees`) — ou seja, **mesmo sem nenhum funcionário selecionado**, a página já pagava o custo de buscar as cinco tabelas inteiras só para montar a lista do filtro.

Como agora essa lista precisa existir **antes** de qualquer seleção (para o usuário escolher quem quer ver), e o resto do relatório passou a ser buscado por funcionário sob demanda, fazia sentido desacoplar as duas coisas. `employees.vue` agora busca a lista via `GET /api/employees` (`server/api/employees/index.get.ts`) — um endpoint já existente no projeto (usado em `app/pages/app/settings/employees/index.vue`, `ServiceOrdersFilters.vue`, etc.), que faz uma única query `SELECT * FROM employees WHERE organization_id = ...` e nada mais. Nenhuma OS, cliente, categoria ou lançamento financeiro é tocado só para montar o filtro.

### 4.3 Reabrir um funcionário já visto não refaz a busca

`UAccordion` do Nuxt UI, por padrão (`unmount-on-hide: true`), **destrói** o conteúdo de um item ao recolher e recria do zero ao reabrir — o que faria `EmployeesAccordionPanel` perder seu estado e refazer o fetch a cada toggle aberto/fechado/aberto.

`EmployeesAccordion.vue` passa `:unmount-on-hide="false"`, então o componente do painel, uma vez criado, **permanece montado** (só fica visualmente escondido) mesmo depois de o usuário recolher o item. Só falta então impedir que ele monte antes da primeira abertura — para isso, `EmployeesAccordion.vue` mantém um `Set` (`renderedIds`) com os ids de funcionário que já foram abertos ao menos uma vez, e só renderiza `<ReportsEmployeesAccordionPanel v-if="renderedIds.has(item.value)">` dentro do slot `#body`:

```ts
// app/components/reports/employees/EmployeesAccordion.vue
const openValues = ref<string[]>([])
const renderedIds = ref<Set<string>>(new Set())

watch(openValues, (values) => {
  if (values.some(value => !renderedIds.value.has(value))) {
    renderedIds.value = new Set([...renderedIds.value, ...values])
  }
}, { immediate: true })
```

Resultado: cada funcionário é buscado **no máximo uma vez** por conjunto de filtros, não importa quantas vezes o usuário abra/feche o accordion dele.

### 4.4 Mudar um filtro compartilhado só afeta quem já foi aberto

Os filtros compartilhados (período, status da OS, status de pagamento, forma de pagamento, status da comissão, tipo de registro) continuam vivendo em `employees.vue` e descem como props para `EmployeesAccordion` → `EmployeesAccordionPanel`. Dentro de cada painel:

```ts
// app/components/reports/employees/EmployeesAccordionPanel.vue
onMounted(loadReport)
watch(
  [() => props.dateFrom, () => props.dateTo, () => props.orderStatusFilters, /* ... */],
  loadReport,
  { deep: true }
)
```

Como o `watch` só existe dentro de instâncias de `EmployeesAccordionPanel` já montadas, e um painel só monta quando seu accordion é aberto (seção 4.3), **mudar o período ou um filtro não dispara requisição nenhuma para funcionários cujo accordion nunca foi aberto** — só os painéis já visíveis (ou já vistos e mantidos montados) refazem a busca. Isso é uma continuação natural da mesma otimização: o custo de rede escala com "quantos accordions o usuário decidiu ver", nunca com "quantos ele selecionou".

## 5. Decisões de design

### 5.1 Seleção múltipla via `UiTagFilter`, não um novo componente

`app/components/reports/commissions/CommissionsFilters.vue` já resolve exatamente esse padrão — múltiplos funcionários, com iniciais, num `UiTagFilter` (`app/components/ui/TagFilter.vue`) — usado no relatório de Comissões. `EmployeesFilters.vue` reaproveita o mesmo padrão (mesma função `getInitials`, mesmo mapeamento `{value, label, color: 'neutral', initials}`), trocando só o rótulo (`employeeLabel` passa de `'Funcionário'` para `'Funcionários'`, plural) e o placeholder. Evita introduzir um segundo componente de seleção múltipla de funcionários na base de código.

`UiTagFilter` não tem busca por texto (é uma lista com checkbox, sem campo de busca) — aceitável aqui porque é o mesmo componente e a mesma limitação já aceita em produção no relatório de Comissões, para a mesma entidade (funcionários da organização).

### 5.2 Accordion `type="multiple"`, todos fechados por padrão

Nenhum item abre automaticamente ao ser selecionado. Essa foi uma decisão deliberada, não uma omissão: se um funcionário recém-selecionado abrisse sozinho, selecionar vários de uma vez voltaria a disparar várias buscas simultâneas — exatamente o cenário que a seção 4.1 evita. O usuário expande manualmente quem quer ver primeiro.

### 5.3 Cabeçalho do accordion = suporte nativo do `UAccordion`, sem slot customizado

O pedido era "ícone + nome do funcionário como título". O componente `UAccordion` do Nuxt UI já renderiza `item.icon` (ícone à esquerda) e `item.label` (título) automaticamente a partir do array `items`, sem precisar de um slot `#leading` customizado:

```ts
// EmployeesAccordion.vue
const items = computed(() => props.employees.map(employee => ({
  label: employee.name,
  value: employee.id,
  icon: 'i-lucide-user-round'
})))
```

`i-lucide-user-round` foi escolhido por já ser o ícone usado para "funcionário" no resto da página (era o `icon`/`item-icon` do seletor antigo em `EmployeesFilters.vue`).

### 5.4 A aba (OS / Comissões / Itens) virou estado local de cada painel, não mais da URL

Antes, `view` era um único `useReportQueryParam` global — fazia sentido quando só existia um funcionário na tela. Com N painéis simultâneos, cada um pode estar numa aba diferente (ex.: ver "Comissões" do funcionário A e "Itens vendidos" do funcionário B ao mesmo tempo); manter isso num único parâmetro de URL não seria representável. `EmployeesAccordionPanel.vue` mantém `view` como `ref` local (`orders` por padrão), não persistido na URL — trade-off aceito: recarregar a página perde a aba ativa de cada painel (volta para "OS trabalhadas"), mas o comportamento de "cada painel pode estar numa aba diferente" passa a existir, o que não era possível antes.

### 5.5 Exportação (CSV/PDF) continua por funcionário, sem mudança no backend

O botão de exportar já vivia dentro da tabela (`toolbar-right` do `AppDataTableInfinite`) e já operava sobre `employeeId` + a aba ativa (`view`) — ao mover esse bloco inteiro para dentro de `EmployeesAccordionPanel.vue`, o comportamento fica automaticamente "um botão de exportar por painel, exportando o funcionário e a aba daquele painel", sem precisar tocar em `server/api/reports/export-employees.post.ts`.

## 6. O que não mudou (por design)

- **Nenhum endpoint do backend foi alterado.** `server/utils/employee-report.ts`, `server/api/reports/employees.get.ts` e `server/api/reports/export-employees.post.ts` continuam recebendo exatamente um `employeeId` por chamada — a "seleção múltipla" é inteiramente uma composição, no frontend, de N chamadas independentes ao endpoint de um único funcionário, uma por accordion aberto.
- **`ReportsEmployeesStats.vue`** não mudou — só passou a receber `summary` vindo do estado local do painel em vez de um `computed` da página.
- Os filtros compartilhados (período, status da OS, status de pagamento, forma de pagamento, status da comissão, tipo de registro) continuam se aplicando a **todos** os funcionários igualmente — não há filtro por-funcionário.

## 7. Casos de borda

- **Nenhum funcionário selecionado**: mantém o mesmo card de estado vazio de antes (`UIcon` + texto), só com o texto ajustado para o plural ("Selecione um ou mais funcionários").
- **Remover um funcionário já aberto da seleção**: o item correspondente do `UAccordion` some junto (a lista `items` é derivada de `props.employees`), destruindo o `EmployeesAccordionPanel` daquele funcionário. Se o mesmo funcionário for selecionado de novo depois, ele volta **fechado** — `renderedIds` continua com o id antigo, mas como o item some e reaparece via `v-for`, o Vue trata como um item novo e o painel só remonta quando reaberto manualmente.
- **Erro ao buscar o relatório de um funcionário**: cada painel tem seu próprio `toast.add(...)` de erro (`EmployeesAccordionPanel.vue`), isolado dos demais — um funcionário falhando ao carregar não afeta os outros painéis já abertos.

## 8. Como testar manualmente

1. Abrir `/app/reports/employees`, confirmar que o filtro de funcionário agora aceita múltipla seleção (badges/iniciais no lugar do texto único de antes).
2. Selecionar 2-3 funcionários sem abrir nenhum accordion — checar na aba Network que **nenhuma** chamada a `/api/reports/employees` foi feita (só a chamada inicial a `/api/employees`, uma vez).
3. Expandir o accordion de um funcionário — confirmar que **uma** chamada a `/api/reports/employees?employeeId=...` aparece, com stats/abas/tabela preenchidos.
4. Colapsar e reabrir o mesmo funcionário — confirmar que **nenhuma nova chamada** é feita (dado já em memória).
5. Com dois funcionários abertos, trocar o período (data) no filtro — confirmar que **só** os dois painéis abertos refazem a busca; um terceiro funcionário selecionado mas nunca aberto continua sem nenhuma chamada.
6. Exportar CSV/PDF a partir de um painel aberto — confirmar que o arquivo gerado corresponde àquele funcionário e à aba ativa daquele painel especificamente.
