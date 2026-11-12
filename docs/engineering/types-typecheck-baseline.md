# Baseline do typecheck (Fase 0 - types-organization.md §5)

- Data: 2026-11-12
- Comando: `pnpm typecheck` (= `nuxt typecheck` -> `vue-tsc -b`), saída bruta em `docs/engineering/types-typecheck-baseline.raw.txt`
- Branch: dev (com alterações não commitadas apenas em docs)
- Exit code: 1 (falha por erros de tipo do vue-tsc; sem falha de ambiente)
- Total de erros (linhas `error TS`): 444
- Arquivos com erro: 66
- Observação: o doc cita ~548; o valor real medido é 444.

## Erros por arquivo

| Erros | Arquivo |
|---:|---|
| 74 | server/api/reports/costs-profit.get.ts |
| 66 | server/api/reports/dashboard-stats.get.ts |
| 62 | server/utils/profit-report-helpers.ts |
| 18 | app/pages/app/settings/company.vue |
| 13 | app/pages/app/products/categories.vue |
| 12 | app/pages/onboarding.vue |
| 11 | nuxt.config.ts |
| 10 | server/api/reports/export-sales-items.post.ts |
| 10 | app/components/ui/AsyncPaginatedSelect.vue |
| 9 | app/pages/app/products/purchases.vue |
| 9 | app/pages/app/products/purchase-requests.vue |
| 8 | server/routes/llms.txt.get.ts |
| 8 | server/api/reports/debtors.get.ts |
| 8 | server/api/reports/customers.get.ts |
| 8 | app/components/AppDataTable.vue |
| 6 | server/api/reports/overview.get.ts |
| 6 | server/api/reports/export-commissions.post.ts |
| 6 | server/api/reports/commissions.get.ts |
| 6 | app/components/service-orders/PaymentModal.vue |
| 5 | app/pages/app/products/inventory.vue |
| 5 | app/components/service-orders/CreateModal.vue |
| 5 | app/components/financial/commissions/RuleListEditor.vue |
| 4 | server/api/reports/suppliers.get.ts |
| 4 | server/api/reports/purchases.get.ts |
| 4 | server/api/reports/export-purchases.post.ts |
| 4 | server/api/admin/subscriptions/chart.get.ts |
| 4 | app/pages/app/products/suppliers.vue |
| 4 | app/pages/admin/fiscal/companies.vue |
| 3 | app/pages/app/reports/purchases.vue |
| 2 | server/api/reports/profit-cash-flow.get.ts |
| 2 | server/api/reports/profit-by-order.get.ts |
| 2 | server/api/admin/subscriptions/index.get.ts |
| 2 | app/pages/app/vehicles.vue |
| 2 | app/pages/app/reports/suppliers.vue |
| 2 | app/composables/useInfiniteList.ts |
| 2 | app/components/vehicles/FormModal.vue |
| 2 | app/components/ui/TagFilter.vue |
| 2 | app/components/ui/DateRangePicker.vue |
| 2 | app/components/service-orders/detail/Slideover.vue |
| 2 | app/components/service-orders/detail/OSItemsCard.vue |
| 2 | app/components/service-orders/detail/OSHeader.vue |
| 2 | app/components/customers/VehiclesModal.vue |
| 2 | app/components/UserMenu.vue |
| 2 | app/components/TeamsMenu.vue |
| 1 | app/pages/subscription.vue |
| 1 | app/pages/app/subscribe.vue |
| 1 | app/pages/app/reports/debtors.vue |
| 1 | app/pages/app/reports/costs.vue |
| 1 | app/pages/app/financial/taxes.vue |
| 1 | app/layouts/app.vue |
| 1 | app/layouts/admin.vue |
| 1 | app/composables/useOneSignal.ts |
| 1 | app/components/service-orders/detail/OSInstallmentsCard.vue |
| 1 | app/components/service-orders/create/FinancialSummaryCard.vue |
| 1 | app/components/products/ProductsFormModal.vue |
| 1 | app/components/financial/taxes/FormModal.vue |
| 1 | app/components/financial/machines/FormModal.vue |
| 1 | app/components/financial/accounts/FormModal.vue |
| 1 | app/components/financial/NfseCancelModal.vue |
| 1 | app/components/customers/HistoryModal.vue |
| 1 | app/components/customers/FormModal.vue |
| 1 | app/components/charts/ChartsLine.vue |
| 1 | app/components/charts/ChartsDonut.vue |
| 1 | app/components/charts/ChartsBar.vue |
| 1 | app/components/charts/ChartsArea.vue |
| 1 | app/components/AppConfirmModal.vue |
