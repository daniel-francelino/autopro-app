# Correcao de typecheck e organizacao de tipos - area app/**

Data: 2026-11-12. Escopo: `app/**` apenas. Sem commit. Nenhuma mudanca em server/, lib/, nuxt.config.ts.

## Resultado

- Baseline app/**: 157 erros em 53 arquivos (de 444 no total).
- Medicao intermediaria (`pnpm typecheck` run 2, feita antes das ultimas correcoes): 10 erros em app/**.
- Depois da run 2 corrigi 7 desses 10 (ver "Pos-medicao"). **Essas correcoes NAO foram revalidadas pelo typecheck** (limite de execucoes). Esperado: restam 3 erros que expoem bugs reais (abaixo). eslint limpo nos arquivos tocados (70 arquivos em app/).
- Nao ha testes unitarios para os componentes tocados (grep em tests/: so e2e/db). Nenhum teste executado.

## Antes/depois por arquivo (baseline -> run 2)

Zerados (0 na run 2): company.vue (18), products/categories.vue (13), onboarding.vue (12), purchases.vue [products] (parcial, ver abaixo), purchase-requests (9), inventory (5), suppliers (4), RuleListEditor (5), PaymentModal (6 -> 1 na run 2 -> corrigido depois), CreateModal (5), admin/fiscal/companies (4), AsyncPaginatedSelect (10), reports/purchases (3), reports/suppliers (2), reports/costs/debtors (1 cada), OSItemsCard/OSHeader/Slideover/OSInstallmentsCard, charts Area/Donut/Line, layouts app/admin, TagFilter, TeamsMenu, UserMenu, useOneSignal, AppConfirmModal, HistoryModal, vehicles/FormModal, VehiclesModal, accounts/machines/taxes FormModal, ProductsFormModal, FinancialSummaryCard, NfseCancelModal, taxes.vue, subscribe.vue, useInfiniteList, company.vue.

Restantes na run 2 (10): AppDataTable (8 -> 1), ChartsBar (1 -> 1 novo), customers/FormModal (1), BasicInfoCard (1 novo, causado pela unificacao de MasterProductItem), PaymentModal (1), DateRangePicker (2 -> 1: `reka-ui` nao resolvivel), purchases.vue (2 novos de mudancas minhas), vehicles.vue (1), subscription.vue (1).

## Pos-medicao (corrigido, nao revalidado)

AppDataTable (helper `withAccessors` + destructuring), ChartsBar (formatter `number | string`), BasicInfoCard (usa `MasterProductItem`), PaymentModal (`addMonthsToDate` com `slice(0, 10)`), DateRangePicker (tipo `DateRange` local, sem `reka-ui`), purchases.vue (`part_id as string | null`; `unit_sale_price` via `:model-value`/`@update:model-value`).

## Bugs reais revelados (NAO corrigidos, decisao do dono)

1. `app/pages/app/vehicles.vue` (~758): `USlideover :ui="{ width: 'max-w-2xl' }"`. `width` nao existe no Nuxt UI 4; a largura nunca e aplicada. Provavel correcao: `ui.content`. Mudanca visual, nao feita.
2. `app/pages/subscription.vue` (120): `plan.period` nao existe em `Plan` (usePlans); o `<span>` renderiza vazio.
3. `app/components/customers/FormModal.vue` (473): `USelectMenu v-model="employeeToAdd"` com `value-key="id"` entrega o id (string), mas `employeeToAdd` e `Employee | null` e o codigo usa `employeeToAdd.value.id` (undefined se for string). Possivel bug de runtime ao adicionar funcionario responsavel. Verificar manualmente.
4. `useInfiniteList`: `loadMore` e o soft refresh chamam o fetcher sem `signal` (so o primeiro load aborta). Tipo ajustado para `signal?: AbortSignal` (sem mudar runtime). Requisicoes de paginacao nao sao canceláveis.
5. `app/pages/app/subscribe.vue`: schema da collection `pricing` (`content.config.ts`) nao declara `plans`, mas o YAML fornece em runtime. Resolvido com cast local (`as unknown as`); correcao real e declarar `plans` no schema (fora do escopo).
6. `purchases.vue`: `unit_sale_price` era tipado `number | null` mas recebe `''` do input; tipo alargado para `number | string | null`.

## Consolidacao de tipos

- Fase 1: `app/types/index.d.ts` - removidos BlogPost, Sale, SaleStatus, Stat, Member, Period, Range, Notification (0 usos por grep) e imports orfaos. Mantidos User/UserStatus/Mail (Mail usado por inbox).
- Fase 2: novo `app/types/ui.ts` com `BadgeColor = NonNullable<BadgeProps['color']>` (tipo do Nuxt UI) e `ViewMode = 'table' | 'card'`. 21 declaracoes locais substituidas (somente conjuntos identicos). Mantidos locais: `BadgeColor` 5 valores em `entries/DetailSlideover.vue`, `ViewMode` de `EmployeesAccordionPanel.vue` e `employees/[id].vue` (outro conceito), `BadgeColor` em `app/types/feedback.ts` (modulo separado, nao tocado). Mapas `STATUS_COLOR`, `PAYMENT_STATUS_COLOR` e mapas locais de cor passaram a `Record<string, BadgeColor>`.
- Fase 2/3: em `app/types/financial.ts`: `PaymentMethod` (4 copias identicas), `BankAccountItem` (7 copias: FormModal, FullscreenModal, OSInstallmentsCard, DownPaymentModal, ExtraPaymentModal, PaymentModal, financial/index.vue) e `PaymentTerminalItem` (4 copias identicas). `BankAccountItem = { id; account_name; bank_name?: string|null; preferred_payment_method?: string|null }`; `preferred_payment_method` permanece `string` (texto livre, conforme 8.2). Nao reutilizei `BankAccount` existente: tem `account_name` opcional e index signature `[key: string]: unknown`, o que quebraria os campos obrigatorios.
- Nao consolidado: `BankAccountItem` de `pages/app/reports/commissions.vue` (campos opcionais `account_name?`/`bank_name?: string`, shape diferente, uso unico).
- Fase 4: `MasterProductItem` (4 copias + `MasterProductSelected` do BasicInfoCard) unificado em `app/types/service-orders.ts` (campos `description?`/`notes?` nullable; eliminou 2 erros "dois tipos com o mesmo nome"). `vehicles.vue` `ServiceOrder` virou `Pick` de `ServiceOrder` de service-orders.ts. `WorkshopOrganization`/`WorkshopCurrentUser` tipados em `types/workshop.ts` (substituem `Record<string, unknown>`; corrigem TeamsMenu, UserMenu, onboarding). `Vehicle`/`Employee*` NAO consolidados: shapes divergem por tela e nao havia margem para validar sem mais typechecks.
- Secao 7 (tipos sem uso): nao tocada.

## Decisoes de correcao

- `interface` -> `type` em ProductCategory, CategoryRow, SupplierReportItem, DebtorReportItem/DebtorOrderRow (type alias e atribuivel a `Record<string, unknown>` do AppDataTable).
- `v-model.number` em UInput `type="number"` (7 arquivos): o Nuxt UI ja converte com `looseToNumber` quando `type === 'number'`, entao o runtime e identico; so o tipo muda.
- `admin/fiscal/companies.vue`: campos `string | number` viraram `string`, carregados com `String(company.x ?? '')` (consumo posterior ja usa `Number(...)`/`String(...)`).
- `company.vue`: `FormState` (tipo) trata nullable como opcional; `logo_url` mantem `null`.
- `TagFilter.isHexColor` virou type guard; `confirmColor` tipado com `BadgeColor`.
- Casts `row.original as X` nos templates de tabelas (purchases, purchase-requests, inventory, suppliers, reports/purchases): slots do AppDataTable entregam `Record<string, unknown>`.
- Charts: `computed<ApexOptions>`.
- Layouts: cast de itens para `CommandPaletteItem[]` (NavigationMenuItem aceita `chip: false`).
- CreateModal: `as unknown as ServiceOrderRaw` (objeto parcial deliberado para o calculo de comissao; nao altera o calculo).
- PaymentModal: `today()` via `slice(0, 10)` (mesmo resultado) e guarda de indice.
- `purchases`/`purchase-requests`: `USelectMenu` de `part_id` e inputs `code`/`notes` com `:model-value ... ?? undefined` + handler manual, preservando o valor armazenado (null/undefined) como antes.

## Riscos

- Ultimas correcoes e as marcadas "nao revalidado" nao passaram por typecheck; podem restar 0-3 erros alem dos 3 bugs reais.
- Mudancas em templates (`:model-value`/`@update`) exigem teste manual das telas: compras, solicitacoes de compra, baixa de OS (pre-preenchimento por `preferred_payment_method`, cond. 8.2), modais de pagamento.
- `.number` e `MasterProductItem` opcional: consumidores leem `description`/`notes` possivelmente `undefined`.
- Arquivos do repo usam CRLF no working tree; mantive o EOL original de cada arquivo.
- Alguns arquivos estao como staged no indice (nao fui eu que rodei `git add`); nada foi commitado.
- Reports: `app/pages/app/reports/*` ajustados so no lado app (casts/`type`); contratos de `server/api/reports` nao tocados.

## Fechamento dos 6 erros restantes

`pnpm typecheck` termina com 0 erros. Em `AppDataTable.vue`, `withAccessors` e o cast de `meta` passaram a usar `as unknown as` (ColumnDef e uma uniao) e o retorno de `normalizeColumn` foi tipado com `as DataTableColumn`. Em `customers/FormModal.vue`, `employeeToAdd` virou `ref<string | undefined>`, pois `value-key="id"` faz o USelectMenu entregar o id e nao o objeto; `addEmployee` usa o valor direto, sem mudar a UX. Em `vehicles.vue`, `ui.width` (inexistente no USlideover) virou `ui.content: 'max-w-2xl'`, o que aplica a largura pretendida. Em `subscription.vue`, o tipo `Plan` nao tem `period` e nenhum dado o fornece; o template passou a exibir o texto fixo "/mês", coerente com "por mês" em `settings/subscription.vue`. A periodicidade mensal e inferida da UI existente, nao de um campo de dados.
