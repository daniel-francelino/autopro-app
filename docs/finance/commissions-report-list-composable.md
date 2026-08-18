# Composable para gerenciar a lista do relatório de comissões (sem recarregar a tela)

## 1. Pedido

Hoje, em `app/pages/app/reports/commissions.vue`, pagar ou excluir uma comissão (single ou bulk) recarrega a tabela inteira — pisca o skeleton de loading, perde a posição de scroll e refaz a busca do zero. O pedido: um composable que gerencie os dados da tela (lista + paginação + agregados) e, depois de pagar/excluir, atualize só o necessário sem esse recarregamento completo.

## 2. Causa raiz, verificada no código

### 2.1 `resetAndRefresh()` é chamado depois de toda mutação

`commissions.vue:228-236`:

```ts
async function resetAndRefresh() {
  accumulatedItems.value = []
  selectedIds.value = []
  if (page.value !== 1) {
    page.value = 1
  } else {
    await refresh()
  }
}
```

Chamado pelos cinco handlers de mutação: `handleBulkPay` (367), `payCommission` (396), `confirmPayFromModal` (411), `confirmDelete` (427), `handleBulkDelete` (451) — ou seja, **todo** pagamento ou exclusão, single ou bulk, passa por aqui.

Duas coisas ruins acontecem, dependendo de quantas páginas já foram carregadas:

- **Se `page === 1`** (caso comum: usuário ainda não rolou pra baixo): `refresh()` reexecuta o `useAsyncData` (linha 183) com o mesmo `queryKey`. Isso muda `status` pra `'pending'`, e como `accumulatedItems.value = []` já zerou a lista, `AppDataTableInfinite` mostra o skeleton inteiro (`loading && !hasItems`, confirmado em `AppDataTableInfinite.vue:372`) até a resposta voltar.
- **Se `page > 1`** (usuário já rolou/carregou mais páginas): `page.value = 1` muda o `queryKey` (linha 179-181), o que dispara o `watch: [queryKey]` do `useAsyncData` (linha 202) — refaz a busca só da página 1, e o `watch(data, ...)` (linha 209-217) **substitui** `accumulatedItems` inteiro pelo resultado dessa única página. Todo o scroll incremental que o usuário já tinha carregado (páginas 2, 3...) é descartado, não só a linha que mudou.

Em ambos os casos, o problema é o mesmo: uma mutação em **um único registro** dispara um recarregamento de **toda a lista visível**, via o mesmo mecanismo usado para trocar de filtro.

### 2.2 O composable certo pra isso já existe no projeto — só não é usado aqui

`app/composables/useInfiniteList.ts` já resolve exatamente esse problema, e já está em produção em `app/pages/app/service-orders.vue` (linhas 94-126). Ele expõe:

- `load()` — primeira página (mount / reset).
- `loadMore()` — próxima página (scroll infinito).
- `softRefresh()` — reexecuta **todas as páginas já carregadas em paralelo** e substitui a lista **atomicamente** (nunca limpa antes de repor), preservando a posição de scroll. É comentado no próprio arquivo (linhas 17-20) como a operação pra usar "after edit / delete / status-change operations" — exatamente o caso de pagar/excluir uma comissão.
- `reset()` — limpa e chama `load()`. É o equivalente ao comportamento atual de troca de filtro, não precisa mudar.

`service-orders.vue` já usa esse padrão: `advanceStatus()` (mudança de status de uma OS, uma mutação pontual) chama `forceReload()` (linha 378-380), que é só um alias pra `softRefresh()` — não `reset()`. `commissions.vue` nunca adotou esse composable; a paginação ali foi escrita à mão com `useAsyncData` + `accumulatedItems` + `page`, antes ou em paralelo à criação do `useInfiniteList`.

### 2.3 Detalhe que valida a proposta: `summary`/`charts`/`employees` não dependem da página

`server/api/reports/commissions.get.ts`: `summary` (linhas 150-167) e `charts`/`statusDistribution` (169-187) são calculados a partir de `normalizedRecords` — **todos** os registros que passaram pelo filtro, antes de `paginate()` (linha 227) fatiar por página. Ou seja, para o mesmo conjunto de filtros, a resposta da página 1, da página 2 ou de qualquer outra traz exatamente o mesmo `summary`/`charts`/`employees`. Isso importa porque esses três valores hoje vêm do mesmo `useAsyncData` que a lista (linhas 205-207) — ao migrar a lista para outro mecanismo de busca, dá pra capturar `summary`/`charts`/`employees` de **qualquer** chamada ao fetcher (inclusive as paralelas de um `softRefresh()` com várias páginas carregadas) sem risco de inconsistência entre elas.

## 3. Proposta: `useCommissionsReportList`

Um composable novo, específico da tela, que embrulha `useInfiniteList` e devolve tudo que `commissions.vue` precisa pra renderizar — lista, paginação e os três agregados — atrás de uma única chamada. Sugestão de local: `app/composables/useCommissionsReportList.ts` (mesmo nível de `useReportDateRange.ts`/`useReportQueryParam.ts`, que já são composables genéricos de relatório).

```ts
// app/composables/useCommissionsReportList.ts
export interface CommissionReportItem {
  id: string
  employee_name: string
  order_number: string | null
  order_entry_date: string | null
  order_status: string | null
  order_payment_status: string | null
  reference_date: string
  amount: number
  status: string
}

interface CommissionSummary {
  totalCommissions?: number
  totalPaid?: number
  totalPending?: number
  employeeCount?: number
  count?: number
}

interface CommissionCharts {
  byEmployee: Array<{ name: string, total: number, paid: number, pending: number }>
  statusDistribution: Array<{ name: string, value: number, color: string }>
}

interface EmployeeOption {
  value: string
  label: string
}

interface CommissionsReportResponse {
  data?: {
    items?: CommissionReportItem[]
    summary?: CommissionSummary
    pagination?: { totalItems?: number } | null
    charts?: CommissionCharts
    employees?: EmployeeOption[]
  }
}

export interface CommissionsListFilters {
  dateFrom: Ref<string>
  dateTo: Ref<string>
  selectedEmployees: Ref<string[]>
  commissionStatus: Ref<string[]>
  recordType: Ref<string[]>
  orderStatusFilters: Ref<string[]>
  paymentStatusFilters: Ref<string[]>
  paymentMethods: Ref<string[]>
  sortBy: Ref<string>
  sortOrder: Ref<string>
}

export function useCommissionsReportList(filters: CommissionsListFilters, pageSize = 20) {
  const requestFetch = useRequestFetch()
  const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

  const summary = ref<CommissionSummary>({})
  const charts = ref<CommissionCharts>({ byEmployee: [], statusDistribution: [] })
  const employees = ref<EmployeeOption[]>([])

  const list = useInfiniteList<CommissionReportItem>(
    async ({ cursor, limit, signal }) => {
      const page = Math.floor(cursor / limit) + 1
      const res = await requestFetch<CommissionsReportResponse>('/api/reports/commissions', {
        headers: requestHeaders,
        signal,
        query: {
          dateFrom: filters.dateFrom.value,
          dateTo: filters.dateTo.value,
          page,
          pageSize: limit,
          employeeIds: filters.selectedEmployees.value.length ? filters.selectedEmployees.value : undefined,
          status: filters.commissionStatus.value.length === 1 ? filters.commissionStatus.value[0] : undefined,
          recordType: filters.recordType.value.length === 1 ? filters.recordType.value[0] : undefined,
          orderStatusFilters: filters.orderStatusFilters.value.length ? filters.orderStatusFilters.value : undefined,
          paymentStatusFilters: filters.paymentStatusFilters.value.length ? filters.paymentStatusFilters.value : undefined,
          paymentMethods: filters.paymentMethods.value.length ? filters.paymentMethods.value : undefined,
          sortBy: filters.sortBy.value,
          sortOrder: filters.sortOrder.value
        }
      })
      // summary/charts/employees são iguais em qualquer página, pro mesmo filtro (seção 2.3) —
      // seguro sobrescrever a cada chamada, inclusive as paralelas de um softRefresh().
      summary.value = res.data?.summary ?? {}
      charts.value = res.data?.charts ?? { byEmployee: [], statusDistribution: [] }
      employees.value = res.data?.employees ?? []
      return {
        items: res.data?.items ?? [],
        total: res.data?.pagination?.totalItems ?? 0
      }
    },
    { pageSize }
  )

  watch(
    [
      filters.dateFrom, filters.dateTo, filters.selectedEmployees, filters.commissionStatus,
      filters.recordType, filters.orderStatusFilters, filters.paymentStatusFilters,
      filters.paymentMethods, filters.sortBy, filters.sortOrder
    ],
    () => list.reset()
  )

  return { ...list, summary, charts, employees }
}
```

Pontos de design:

- **`cursor`/`limit` → `page`/`pageSize`**: `useInfiniteList` é genérico e pagina por cursor numérico (offset de itens); a API de comissões pagina por número de página. A conversão (`page = cursor / limit + 1`) fica escondida dentro do composable — `commissions.vue` não precisa saber disso, assim como hoje não sabe que `service-orders.vue` usa cursor puro contra uma API diferente.
- **`summary`/`charts`/`employees` como refs à parte**: `useInfiniteList` só gerencia `items`/`total` (é genérico, não devia saber de agregados específicos de comissões). Capturá-los como efeito colateral dentro do fetcher é a peça que faz esse composable ser "de comissões" e não só uma reexportação do genérico.
- **O `watch` dos filtros substitui o par `watch(...) { accumulatedItems = []; page = 1 }` + `queryKey` computado** (`commissions.vue` 170-181 hoje) por uma única lista de dependências chamando `reset()` — mesmo efeito (volta pra página 1, mostra skeleton, busca de novo), só que sem precisar montar uma string de cache key manualmente.

## 4. Migração em `commissions.vue`

### 4.1 O que sai

- `page`, `accumulatedItems`, `totalFromServer`, `queryKey`, o bloco `useAsyncData` (183-203), os dois `computed` de `summary`/`charts`/`employees` (205-207), o `watch(data, ...)` que acumula páginas (209-217), `hasMore`/`loadingMore` (219-220), `loadMore()` (222-226) e `resetAndRefresh()` (228-236).

### 4.2 O que entra

```ts
const {
  items: accumulatedItems,
  total: totalFromServer,
  hasMore,
  isLoading,
  isLoadingMore,
  loadMore,
  softRefresh,
  reset: resetList,
  summary,
  charts,
  employees
} = useCommissionsReportList({
  dateFrom, dateTo, selectedEmployees, commissionStatus, recordType,
  orderStatusFilters, paymentStatusFilters, paymentMethods, sortBy, sortOrder
})
```

`AppDataTableInfinite` troca `:loading="status === 'pending' && page === 1"` por `:loading="isLoading"` e `:loading-more="loadingMore"` por `:loading-more="isLoadingMore"` — `isLoading` só fica `true` durante `load()`/`reset()`, nunca durante `softRefresh()`, que é exatamente o comportamento que corrige a queixa original: pagar uma comissão não deve mais acionar o skeleton.

### 4.3 Handlers de mutação: trocar `resetAndRefresh()` por `softRefresh()`

| Handler | Linha hoje | Depois de sucesso |
|---|---|---|
| `handleBulkPay` | 367 | `softRefresh()`; limpar só os ids que estavam em `pendingIds` de `selectedIds` |
| `payCommission` (caminho direto, não-antiga) | 396 | `softRefresh()`; remover `id` de `selectedIds` |
| `confirmPayFromModal` | 411 | `softRefresh()`; remover `payConfirmTarget.value.id` de `selectedIds` |
| `confirmDelete` | 427 | `softRefresh()`; remover `targetId` de `selectedIds` |
| `handleBulkDelete` | 451 | `softRefresh()`; limpar os ids excluídos de `selectedIds` |

Exemplo (`payCommission`, hoje linhas 393-400):

```ts
try {
  await $fetch(`/api/reports/commissions/${id}/pay`, { method: 'POST' })
  toast.add({ title: 'Comissão marcada como paga!', color: 'success' })
  selectedIds.value = selectedIds.value.filter(v => v !== id)
  await softRefresh()
} catch {
  toast.add({ title: 'Erro ao pagar comissão', color: 'error' })
}
```

**Mudança de comportamento pequena, mas intencional**: hoje `resetAndRefresh()` zera `selectedIds` **inteiro** a cada mutação (linha 230), mesmo em uma ação de linha única — se o usuário tinha outras comissões marcadas na tabela, elas eram desmarcadas de brinde. Trocar por "remove só o id que acabou de ser pago/excluído" é mais preciso, mas é uma mudança de UX perceptível o suficiente pra vale registrar aqui em vez de deslizar despercebida na implementação.

### 4.4 O que **não** muda

- Troca de filtro/ordenação (o `watch` dos 9 refs) continua chamando um reset completo (`list.reset()`, dentro do composable) — é o comportamento certo aqui, o usuário está pedindo uma consulta nova, não uma atualização pontual.
- `openBulkPay`, `openDetail`, `setDeleteTarget`, export, colunas, mapas de status/cor — nada disso depende de como a lista é buscada, fica igual.

## 5. Trade-offs e casos de borda

- **SSR continua funcionando**: `useInfiniteList.load()` não usa `useAsyncData`, é um fetch manual com `requestFetch` (SSR-aware). O padrão de chamar `await load()` (ou aqui, indiretamente, a primeira carga do composable) no topo do `<script setup>` de uma página já é usado com sucesso em `service-orders.vue:128` (`await loadOrders()`) — não é um risco novo, é um padrão já validado em produção neste projeto.
- **Perda do dedup automático do `useAsyncData`** (mesma `queryKey` evitando fetch duplicado na hidratação): troca por fetch manual sem esse cache. Aceito como trade-off já existente — é o mesmo que `service-orders.vue` já aceitou ao adotar `useInfiniteList`, não é uma regressão introduzida por esta proposta especificamente para comissões.
- **`hasPendingSelection`, `allSelected`, `toggleSelectAll`, `bulkPayItems`, `bulkPayTotal`**: todos leem `accumulatedItems`/`selectedIds` por referência de variável, não pela forma como são preenchidos — continuam funcionando sem alteração, só passam a apontar para `items` (retornado pelo composable) em vez do `ref` local antigo.
- **Itens que saem da lista após a mutação** (uma comissão excluída, ou uma comissão paga quando o filtro ativo é `commissionStatus = ['pending']`): o `softRefresh()` já resolve isso sozinho — ele busca de novo o conteúdo real do servidor pras páginas carregadas, então um item que não bate mais com o filtro simplesmente não volta na resposta. Não precisa de lógica extra de "remover item X da lista na mão".

## 6. Checklist de implementação

- [ ] Criar `app/composables/useCommissionsReportList.ts` (seção 3).
- [ ] `commissions.vue`: remover `page`/`accumulatedItems`/`totalFromServer`/`queryKey`/bloco `useAsyncData`/computeds de `summary`/`charts`/`employees`/`watch(data,...)`/`hasMore`/`loadingMore`/`loadMore()`/`resetAndRefresh()` (seção 4.1); chamar `useCommissionsReportList(...)` (seção 4.2).
- [ ] Trocar `:loading`/`:loading-more` de `AppDataTableInfinite` pelos novos `isLoading`/`isLoadingMore`.
- [ ] Atualizar os cinco handlers de mutação pra `softRefresh()` + remoção pontual de `selectedIds` (seção 4.3): `handleBulkPay`, `payCommission`, `confirmPayFromModal`, `confirmDelete`, `handleBulkDelete`.
- [ ] Conferir que o `watch` de troca de filtro/ordenação chama `reset()` (dentro do composable, nada a mudar no template).
- [ ] Rodar manualmente: pagar uma comissão (single e bulk) e excluir (single e bulk) com a lista rolada além da primeira página — confirmar que a posição de scroll não pula e que o skeleton de carregamento inteiro não aparece.

## 7. Critérios de aceite

- Pagar ou excluir uma comissão (single ou bulk) não mostra mais o skeleton de carregamento da tabela inteira.
- Se o usuário já tinha rolado além da primeira página, essas páginas continuam carregadas depois da mutação — não voltam a mostrar só a página 1.
- `summary`/gráficos continuam corretos depois da mutação (refletem o novo estado agregado do servidor).
- Trocar um filtro ou a ordenação continua recarregando a lista do zero, como hoje.
- Selecionar várias comissões, pagar/excluir uma linha isolada (ação de linha, não em lote) não desmarca as outras que continuavam selecionadas.
