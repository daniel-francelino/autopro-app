# Análise de testes por domínio

> Um arquivo por pasta de `server/api`. Cada um traz o inventário automático de rotas (guard e teste dedicado), os riscos e os cenários a criar com prioridade.
> Ordem sugerida de execução: **service-orders → financial → reports → commissions → bank-accounts**, depois os demais por quantidade de P0.
> Inventário de rotas, guards e testes feito em 2026-11-09; atualize à mão conforme os testes forem criados.

| Domínio | Rotas | Com teste dedicado | Escritas sem permissão | Cenários | P0 |
|---|---:|---:|---:|---:|---:|
| [financial](financial.md) — Financeiro (lançamentos, categorias, contas a pagar/receber) | 17 | 1 | 13 | 8 | 3 |
| [fiscal](fiscal.md) — Fiscal (NFS-e, municípios, empresa) | 17 | 5 | 0 | 6 | 3 |
| [reports](reports.md) — Relatórios | 19 | 6 | 6 | 8 | 3 |
| [service-orders](service-orders.md) — Ordens de serviço | 18 | 8 | 13 | 10 | 3 |
| [stripe](stripe.md) — Stripe (webhook e checkout) | 3 | 1 | 2 | 4 | 3 |
| [auth](auth.md) — Autenticação | 13 | 8 | 4 | 6 | 2 |
| [bank-accounts](bank-accounts.md) — Contas bancárias | 4 | 0 | 3 | 5 | 2 |
| [billing](billing.md) — Cobrança (Stripe, lado do cliente) | 5 | 0 | 3 | 4 | 2 |
| [bonuses](bonuses.md) — Bônus | 13 | 0 | 0 | 6 | 2 |
| [commissions](commissions.md) — Planos de comissão (configuração) | 11 | 0 | 0 | 6 | 2 |
| [employees](employees.md) — Funcionários | 10 | 0 | 5 | 6 | 2 |
| [purchases](purchases.md) — Compras | 5 | 0 | 4 | 6 | 2 |
| [roles](roles.md) — Papéis e permissões | 7 | 3 | 0 | 4 | 2 |
| [admin](admin.md) — Painel do owner (`/api/admin/**`) | 39 | 25 | 0 | 5 | 1 |
| [clients](clients.md) — Clientes | 5 | 1 | 4 | 4 | 1 |
| [feedback](feedback.md) — Feedback do usuário | 7 | 0 | 4 | 3 | 1 |
| [notifications](notifications.md) — Notificações | 3 | 0 | 2 | 2 | 1 |
| [payment-terminals](payment-terminals.md) — Maquininhas | 4 | 0 | 3 | 3 | 1 |
| [product-categories](product-categories.md) — Categorias de produto | 4 | 0 | 0 | 2 | 1 |
| [products](products.md) — Produtos / peças / estoque | 6 | 0 | 4 | 5 | 1 |
| [profile](profile.md) — Perfil | 2 | 0 | 1 | 2 | 1 |
| [purchase-requests](purchase-requests.md) — Solicitações de compra | 6 | 0 | 5 | 3 | 1 |
| [purchase-returns](purchase-returns.md) — Devoluções de compra | 4 | 0 | 3 | 3 | 1 |
| [users](users.md) — Usuários | 5 | 2 | 5 | 3 | 1 |
| [appointments](appointments.md) — Agendamentos | 4 | 0 | 3 | 3 | 0 |
| [master-products](master-products.md) — Produtos mestres | 4 | 0 | 3 | 2 | 0 |
| [metrics](metrics.md) — Métricas de uso | 1 | 1 | 0 | 2 | 0 |
| [organizations](organizations.md) — Organização (oficina) | 4 | 0 | 3 | 3 | 0 |
| [parts](parts.md) — Peças | 4 | 0 | 3 | 3 | 0 |
| [settings](settings.md) — Configurações / notificações | 5 | 0 | 3 | 2 | 0 |
| [supabase](supabase.md) — Saúde do Supabase | 1 | 1 | 0 | 1 | 0 |
| [suppliers](suppliers.md) — Fornecedores | 5 | 0 | 4 | 3 | 0 |
| [taxes](taxes.md) — Impostos | 4 | 0 | 3 | 3 | 0 |
| [vehicles](vehicles.md) — Veículos | 5 | 1 | 3 | 3 | 0 |

Total de cenários a criar: **139** (P0: **42**).
