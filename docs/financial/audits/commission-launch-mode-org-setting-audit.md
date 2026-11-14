# Auditoria financeira: modo de comissão como configuração da organização

Data: 2026-11-14. Auditor: financial-auditor (somente leitura). Escopo: diff no working tree de `server/api/service-orders/[id]/process-payment.post.ts` (`syncOrderReleaseModeFromOrg`), `server/api/service-orders/index.post.ts`, `server/api/organizations/index.put.ts`, `server/utils/service-order-commissions.ts` (só comentário), migração `supabase/migrations/20240101000110_add_commission_release_mode_to_organizations.sql`, `app/components/service-orders/PaymentModal.vue` (exibição).
Base: `docs/business/commission-launch-mode-org-setting.md` (9.1), `docs/engineering/commission-launch-mode-implementation-plan.md`.
Legenda: [V] verificado no código; [H] hipótese; [Q] depende de consulta a dados reais (não executada; sem autorização para produção).

## Veredito

**Aprovado com ressalvas (sem bloqueio financeiro de código).** O cálculo (proporcional x integral) não mudou; a feature não altera receita nem caixa; não agrava a lógica de KF-40/FIN-3. As ressalvas são de dimensionamento (OS legadas, premissa "todas as orgs usam full" não verificada em dados) e de aderência literal à regra 9.1 (OS com plano já gerado não sincronizam; regenerar pagamento reabre o modo). Recomenda-se rodar as consultas da seção 5 em ambiente autorizado antes do go-live.

## 1. Cálculo proportional x full

- [V] Motor inalterado: o diff em `service-order-commissions.ts` é só comentário (`:243-247`). `receivedRatio = full ? 1 : min(1, max(0, recebido/total))` (`:431-433`), `released = min(total, total*ratio)` (`:533`), delta/claw-back (`:555-601`) sem mudança. O motor continua lendo apenas `service_orders.commission_release_mode`, nunca a org.
- [V] Exemplo (coberto por SYN-1/SYN-2): OS 1.000, comissão 100, recebido 100. Proportional libera 10; full libera 100.
- [V] Testes executados (fast): `commission-mode-sync`, `organizations-put-commission-mode`, `financial-payments`, `money-flows`, `undo-payment`, `service-order-payments`: 6 arquivos, 166 passaram, 11 expected-fail (falhas conhecidas pré-existentes), 0 falhas.

## 2. Pontos de fixação do modo [V]

- Criação (`index.post.ts:233-243`): OS nasce com o modo da org; falha de leitura = 500 sem insert. Update não toca o modo; `orderPayload` é montado campo a campo, cliente não injeta o modo.
- Pagamento (`process-payment.post.ts:160`, `:191`): sincroniza após todas as validações e antes de qualquer gravação de parcela/liberação; só se `count(employee_financial_records commission da OS) = 0`; escrita condicional `.neq`. Fecha a parte "gravação antes das validações" do DI-10. Se uma etapa posterior falhar, a OS fica com o modo da org sem plano, o que é inócuo (será o mesmo valor na próxima tentativa).
- Nenhum outro chamador do motor sincroniza (`installments/[id]/pay`, `receive-extra-payment`, `installments/[id].delete`, `receipt-reversal`, `generate-commissions`).

## 3. Findings priorizados

### FA-CLM-1 (Média) OS legadas sem comissão migram ao modo da org (padrão `full`) no próximo `process-payment`
- [V] Toda OS existente tem `proportional` como valor default da coluna (migração 000074), exceto as que tiveram o switch marcado. Afetadas: OS não excluídas, status ainda não pago pelo plano (sem linha de parcela `kind <> 'down_payment'`), sem nenhuma comissão. Ao gerar o plano, passam a `full` e liberam 100% da comissão como `pending` na geração do plano, independentemente do recebido.
- Efeito financeiro: antecipação do passivo de comissão (pending) dessas OS, de "proporcional ao caixa" para "integral no plano". Não altera receita, caixa nem o valor total da comissão; altera o momento e a exposição em caso de inadimplência/cancelamento.
- Mitigante: se a premissa de 9.1 ("todas as orgs usam full hoje", i.e., o usuário marcava o switch) for verdadeira, o efeito líquido é zero. A premissa não está verificada em dados [Q]. Sinal-only (down payment) não libera comissão [V], portanto OS com sinal também entram nesse grupo.
- Ação: rodar Q1 e Q3 (seção 5). Se Q3 mostrar orgs que deixavam OS em proportional com frequência, definir o modo dessas orgs como `proportional` logo após a migração (decisão do stakeholder, sem mudança de código).

### FA-CLM-2 (Média, aderência à regra) DIC-03: OS com plano já gerado e sem comissão não sincronizam
- [V] `process-payment` rejeita com 409 se existe plano (`:141-143`) antes de sincronizar; os demais pontos de recebimento não chamam a sincronização. Logo, OS legadas com plano gerado e nenhuma parcela paga (ratio 0, logo sem comissão), ou sem responsáveis com comissão, ficam `proportional` para sempre, mesmo com a org em `full`. Diverge da leitura literal de 9.1 linha 113-114 ("no pagamento, se nenhuma comissão foi liberada, o modo é atualizado").
- Impacto financeiro: conservador. Essas OS liberam comissão conforme o caixa (menos exposição que `full`). Não há perda nem pagamento indevido; há inconsistência de política (dentro de uma org `full`, parte das OS libera proporcional) e possível reclamação de funcionário que esperava 100%. Tamanho: Q2.
- Ação: decisão do stakeholder: (a) aceitar e documentar (recomendado do ponto de vista de risco financeiro), ou (b) estender a sincronização ao recebimento de parcela/pagamento avulso, com o mesmo critério de contagem. Não é bloqueante financeiro.

### FA-CLM-3 (Média, comportamento novo) Regenerar pagamento reabre o modo da OS
- [V] `payment.delete.ts` bloqueia se há comissão `paid` (`:48-62`) e apaga fisicamente todas as comissões pending (`:92-114`). Depois disso a contagem é 0 e o próximo `process-payment` relê a org. Uma OS que liberou em `proportional` pode virar `full` (e vice-versa) ao regenerar. Antes da feature, `full` era irreversível (DI-10/P41); agora o modo segue a org quando não resta comissão. Caracterizado em teste (P41c/SYN-16 no plano de testes).
- Impacto financeiro: só sobre comissão pending (paid bloqueia a operação). Sem perda de caixa; muda timing do passivo. Mesmo raciocínio vale para cancelar todas as parcelas via `installments/[id].delete` e gerar novo plano.
- Ação: registrar na doc de negócio que "fixo após a 1ª liberação" significa "enquanto existir alguma linha de comissão na OS". Sem mudança de código.

### FA-CLM-4 (Baixa) KF-40/FIN-3 não agravados na lógica; base de exposição pode crescer
- [V] `cancel.post.ts`, `payment.delete.ts`, `installments/[id].delete.ts`, `service-order-receipt-reversal.ts` e o motor não estão no diff. Em `full`, estorno continua sem claw-back (ratio fixo 1, delta 0) e cancelamento continua removendo comissão paga e revertendo o lançamento (KF-40), exatamente como antes.
- O número de OS em `full` pode aumentar (FA-CLM-1, padrão `full` para orgs novas, fim do opt-out por OS). Se a premissa de 9.1 for verdadeira, a exposição prática é a mesma. Positivo: a org agora pode escolher `proportional` de forma global, o que reduz a exposição; antes não havia como.
- Ação: manter FIN-3 aberto; dimensionar com Q5.

### FA-CLM-5 (Baixa) Rastreabilidade da sincronização
- [V] Sem evento de histórico por decisão (D4). Mas a mudança fica no diff de `recordAudit` do `process-payment` (`before = order` lido antes da sincronização, `after = updatedOrder`; `commission_release_mode` não está em `DEFAULT_IGNORE` de `server/utils/audit/record.ts`), e cada `commission.released` carrega `release_mode` (`service-order-commissions.ts:515`). Lacuna: se o motor falhar após a sincronização, o diff não é anexado (o modo persistiu). Baixo impacto, pois o valor é o da org.
- [V] Mudança da org auditada com from/to (`organizations/index.put.ts:82-89`), validação `IN ('proportional','full')` com 400, `null` rejeitado.

### FA-CLM-6 (Informativo) Receita x caixa x comissão e relatórios
- [V] Nada no diff cria/altera parcelas, `financial_transactions` de receita, `payment_status` ou valores de OS. Comissão só vira saída de caixa quando paga (`pay-commissions-bulk`, `reports/commissions/[id]/pay`), fluxos não alterados. Em `full`, "comissão a pagar" pode superar a proporção do recebido: isso é a regra aceita, não erro; relatórios não devem ser lidos como lucro realizado.
- [V] Único relatório que lê o modo: `server/api/reports/commissions/[id].get.ts:354` (modo atual da OS, fallback `proportional` irrelevante com NOT NULL). Agregados (`commissions.get.ts`, exportações, `employees.get.ts`) usam `employee_financial_records`, sem dependência do modo. Nenhum relatório lê o modo da org.
- [V] `PaymentModal.vue` só exibe: modo da OS se há comissão (mesmo critério do servidor, via `/api/service-orders/:id` sem filtro de status), senão o modo da org. Sem envio de override; o servidor ignora `releaseCommissionsInFull` (SYN-8).

## 4. Não verificado

- Distribuição real de modos e volumes (Q1-Q5): exige dados de produção com autorização.
- Execução da migração (não executada; revisão de schema é escopo do data-integrity-auditor). Testes db/E2E não executados.

## 5. Consultas de dimensionamento (somente leitura; rodar em ambiente autorizado, após aplicar a migração)

```sql
-- Q1: OS legadas que mudarão de modo no próximo process-payment (FA-CLM-1)
SELECT so.organization_id, so.commission_release_mode AS os_mode, o.commission_release_mode AS org_mode,
       count(*) AS qtd, sum(so.commission_amount) AS comissao_estimada, sum(so.total_amount) AS total_os
FROM service_orders so JOIN organizations o ON o.id = so.organization_id
WHERE so.deleted_at IS NULL AND so.status <> 'cancelled'
  AND so.commission_release_mode <> o.commission_release_mode
  AND NOT EXISTS (SELECT 1 FROM employee_financial_records e WHERE e.organization_id = so.organization_id AND e.service_order_id = so.id AND e.record_type = 'commission')
  AND NOT EXISTS (SELECT 1 FROM service_order_installments i WHERE i.organization_id = so.organization_id AND i.service_order_id = so.id AND i.deleted_at IS NULL AND i.kind <> 'down_payment')
GROUP BY 1,2,3;

-- Q2: OS com plano, sem comissão, modo diferente da org: não sincronizam (FA-CLM-2 / DIC-03)
-- mesma query, trocando o segundo NOT EXISTS por EXISTS.

-- Q3: premissa "todas usam full": modo das OS com comissão liberada nos últimos 180 dias
SELECT so.organization_id, so.commission_release_mode, count(DISTINCT so.id)
FROM service_orders so
JOIN employee_financial_records e ON e.service_order_id = so.id AND e.organization_id = so.organization_id AND e.record_type = 'commission'
WHERE e.created_at >= now() - interval '180 days'
GROUP BY 1,2 ORDER BY 1,2;

-- Q4: OS proportional só com comissão pending (candidatas a virar full ao regenerar, FA-CLM-3)
-- Q5: exposição KF-40: OS full com comissão paid e payment_status <> 'paid'
SELECT so.organization_id, count(DISTINCT so.id), sum(e.amount)
FROM service_orders so
JOIN employee_financial_records e ON e.service_order_id = so.id AND e.organization_id = so.organization_id AND e.record_type = 'commission' AND e.status = 'paid'
WHERE so.commission_release_mode = 'full' AND so.payment_status <> 'paid' AND so.deleted_at IS NULL
GROUP BY 1;
```
