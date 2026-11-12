# Documentações do projeto

Esta pasta guarda documentos técnicos e de produto que orientam implementação, migração e decisões de arquitetura.

## Ordem de execução dos planos de painel, auditoria, métricas, SEO e GEO

Os cinco planos abaixo dependem uns dos outros. Ordem recomendada (revisada em 2026-11-08):

1. **Segurança da API** — [painel do owner, Fase 0](admin/owner-panel-plan.md#8-fases): rotas abertas entre oficinas e permissões por papel não checadas no servidor. Não depende de nada; vem antes de qualquer tela nova.
2. **Afirmações públicas** — [GEO, Fase 0](seo/geo-audit-brasil.md#21-afirmações-públicas--produto-verificado): o FAQ de `/pricing` promete recursos que não existem.
3. **Auditoria Fase 0–1** e **Métricas Fase 1** — mesmo plugin Nitro e mesmo `event.context`; podem andar juntas.
4. **SEO técnico** (Fase 1) → **GEO** Fases 1–2.
5. **Telas do painel** (`/admin/audit`, `/admin/metrics`, ficha da oficina, cobrança, GEO, sistema) conforme os dados ficam disponíveis.

## Auditoria

- [Plano de auditoria e log de ações do usuário](audit/audit-log-plan.md)

## Painel do owner

- [Plano do painel do owner (estado atual, segurança e telas)](admin/owner-panel-plan.md)

## Pendências

- [Pendências do projeto (vários temas: controle de acesso, financeiro, qualidade, layout, documentação)](engineering/pending.md)

## Segurança

- [Auditoria de chaves, permissões e rotas da API (2026-11-12)](security/access-control-audit-2026-11-12.md)
- [Plano faseado de implantação do controle de acesso (concluído)](engineering/access-control-rollout-plan.md)
- [Mapa de rotas e permissões](security/access-control-route-map.md)

## Testes

- [Plano de testes automatizados (unidade, endpoints, fluxos e E2E)](testing/test-plan.md)

## Métricas

- [Plano de métricas de uso do sistema](metrics/usage-metrics-plan.md)

## SEO

- [Auditoria de SEO (2026-11-08)](seo/seo-audit-2026-11-08.md)
- [Auditoria de GEO — foco Brasil](seo/geo-audit-brasil.md)

## Financeiro

- [Bônus por meta](finance/bonuses-feature-design.md)
- [Configuração de comissões](finance/commissions-configuration-architecture.md)
- [Lista do relatório de comissões](finance/commissions-report-list-composable.md)
- [Categorias financeiras](finance/financial-categories-crud.md)
- [Recorrência financeira](finance/financial-recurrence-flow.md)

## Ordens de serviço

- [Fluxo de pagamento atual](service-orders/payment-flow-current.md)
- [Redesign do fluxo de pagamento](service-orders/payment-flow-redesign.md)
- [Exclusão de parcela paga](service-orders/delete-paid-installment.md)

## Relatórios

- [Relatório de lucro](reports/profit-report.md)
- [Relatório de funcionários com multi-select](reports/employees-multi-select-accordion.md)
