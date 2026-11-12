# Cenários de teste por endpoint, lote G2

Domínios: purchases (5 handlers), purchase-returns (4), purchase-requests (6). Total: **15 handlers**.
Escopo: apenas desenho. Nenhum teste foi implementado, escrito ou executado. Nenhum código de produção foi alterado.
**Revisão obrigatória por `test-reviewer` antes da implementação.**

## Notas gerais

- As colunas "teste dedicado" em `docs/testing/domains/*.md` podem estar desatualizadas, e a suíte não foi executada. O status vem de busca textual em `tests/` (grep), não de execução.
- Já provado em `tests/fast/access/guard-matrix.test.ts` (referenciado, não duplicado): 401 sem sessão e rotas admin só para owner. Nenhuma linha repete "sem sessão".
- Helpers: `tests/support/handler-harness.ts`, `fake-supabase.ts`, `factories.ts`. Guard: `server/utils/require-org-permission.ts`. Padrão: `tests/fast/service-orders/money-flows.test.ts`.
- Camada padrão `fast`; `db` só para RLS, constraint única, transação. Sem E2E.
- Fato verificado no código: **nenhum dos 15 handlers chama `requireOrgPermission`**; todos usam `requireAuthUser` + `resolveOrganizationId`. As **12 escritas de G2** aparecem no baseline KF-09 (`tests/static/baselines/write-routes-without-permission.json`, verificado no arquivo): purchases 4 (post, put, delete, pay), purchase-returns 3 (post, put, delete), purchase-requests 5 (post, put, delete, authorize, reject). Os 3 GET não estão no baseline. Linhas "emp-sem -> 403" são o comportamento correto e ficam como **KF-09 (it.fails)**. Regras que dependem de decisão do PO ficam como **it.todo** (não it.fails, não "Correto") até a OQ ser respondida. Chaves de permissão não existem: `<perm>` = a definir (G2-OQ-01).
- Nenhum handler de G2 escreve estoque, saldo ou extrato (verificado por grep: só tabelas `purchases`, `purchase_returns`, `purchase_requests`). Cenários de integridade de dados descrevem o comportamento correto e dependem de G2-OQ-02/03/04.
- Os `find` de PUT/DELETE/pay/authorize/reject filtram `organization_id` e `deleted_at is null` (verificado em purchases PUT/DELETE; padrão idêntico nos demais, por leitura de grep). O `update` seguinte filtra só por `id` (G2-SD-09, hipótese).
- Status/papéis: owner, admin, emp-sem (sem a permissão), emp-com. "iso" = duas orgs (A logada, B dona do registro) com `createFakeSupabase`; org vem da sessão, nunca do corpo.
- Org suspensa / assinatura expirada: não há checagem nestes handlers (grep). Fica em G2-OQ-05; não há linha de teste até a decisão.

---

## 1. purchases (5 handlers, 25 linhas: 3 covered, 1 covered by KF-09 it.fails, 5 it.todo, 16 gap)

Fonte: `server/api/purchases/`. POST exige `supplier_id`, `bank_account_id`, `purchase_date`, `total_amount` (só presença); `payment_status` default `pending`. PUT repassa lista de campos do corpo, inclusive `payment_status`, `total_amount`, `items`. DELETE é soft e chama `recordAudit`. `pay` marca `paid` + `payment_date` (default hoje), 400 se já paga.

| ID | Método e caminho | Pri | Camada | Pré-condições | Passos | Resultado esperado | Integridade de dados | Status | Evidência |
|---|---|---|---|---|---|---|---|---|---|
| PUR-10 | GET /api/purchases | P1 | fast | Org A: 3 compras (1 soft-deleted, 1 paid), org B: 1 | GET; `payment_status=paid`; `sort_by=invalid`; `page_size=500`; paginação | 200; sem deletadas nem de B; filtro funciona; sort inválido cai no padrão; page_size limitado; `total` correto | Leitura | gap | - |
| PUR-06a | GET /api/purchases | P0 | fast | Org B com compra | GET como A com `organization_id=B` na query | Só itens de A | - | gap | - |
| PUR-11 | POST /api/purchases | P1 | fast | Org A, fornecedor e conta de A | POST com campos obrigatórios | 200 `{item}`; `organization_id`=A; `created_by`=email; `payment_status`='pending' | Total gravado = enviado | gap | - |
| PUR-12 | POST /api/purchases | P1 | fast | - | Omitir cada obrigatório; corpo vazio | 400 com mensagem do campo | Nada inserido | gap | - |
| PUR-12b | POST /api/purchases | P1 | fast | - | `total_amount` negativo, string, NaN; `purchase_date` inválida; `payment_status` fora do conjunto | 400 (correto; hoje sem validação, G2-SD-02). Candidato it.fails | Nada inserido | gap | - |
| PUR-04 | POST /api/purchases | P1 | fast | - | `items` com soma != `total_amount`; arredondamento 0,1+0,2 | Regra de total e arredondamento indefinida (total = soma dos itens? 2 casas?). Hoje sem validação (G2-SD-02) | total == soma(items) conforme regra | it.todo, aguarda G2-OQ-03 | - |
| PUR-06b | POST /api/purchases | P0 | fast | Org A logada; fornecedor/conta de B | POST com `organization_id`=B no corpo; depois com `supplier_id`/`bank_account_id` de B | Org do corpo ignorada. Ids de B: 400/404 (correto; hoje aceita, G2-SD-01). Candidato it.fails | Nenhuma linha em B; sem FK cruzada | gap | - |
| PUR-06c | POST /api/purchases | P2 | fast | owner/admin/emp-sem/emp-com | POST por perfil | owner/admin/emp-com 200; emp-sem 403. KF-09 | - | gap | baseline KF-09 (estática) |
| PUR-13 | PUT /api/purchases/:id | P1 | fast | Compra de A | PUT `{notes, due_date}` | 200; só campos enviados mudam; `updated_by` | Total inalterado | gap | - |
| PUR-14 | PUT /api/purchases/:id | P1 | fast | - | id inexistente; soft-deleted | 404 `Compra não encontrada` | Nada alterado | gap | - |
| PUR-15 | PUT /api/purchases/:id | P0 | fast | Compra `pending` | PUT `{payment_status:'paid'}` | Se PUT pode marcar `paid` sem passar por `pay` é decisão de produto (G2-SD-03) | status paid implica data e efeito financeiro definido | it.todo, aguarda G2-OQ-02 | - |
| PUR-15b | PUT /api/purchases/:id | P1 | fast | Compra `paid` | PUT `{total_amount, items}` | Recusar ou refletir no financeiro: decisão de produto | total pago == total da compra | it.todo, aguarda G2-OQ-02 | - |
| PUR-02a | PUT /api/purchases/:id | P0 | fast | Compra com itens | PUT altera `items` | Estoque coerente com a regra definida (G2-OQ-04) | Delta de estoque == delta de itens | gap | - |
| PUR-06d | PUT /api/purchases/:id | P0 | fast | Compra de B | PUT como A; PUT com `organization_id` no corpo; `supplier_id` de B | 404 e nada muda; `organization_id` do corpo ignorado (já fora da lista de campos); id de B recusado (G2-SD-01) | Registro de B intacto | gap | - |
| PUR-06e | PUT /api/purchases/:id | P2 | fast | 4 perfis | PUT por perfil | emp-sem 403 (KF-09) | - | gap | baseline KF-09 |
| PUR-16 | DELETE /api/purchases/:id | P1 | fast | Compra pending de A | DELETE | 200; `deleted_at`/`deleted_by` preenchidos; some do GET; `recordAudit` com `before` | Registro preservado (soft) | gap | - |
| PUR-16b | DELETE /api/purchases/:id | P1 | fast | id inexistente / já deletada | DELETE duas vezes | 404 na segunda | - | gap | - |
| PUR-03 | DELETE /api/purchases/:id | P0 | fast | Compra paga | DELETE | Correto: estorna efeito financeiro e estoque, ou recusa (G2-OQ-02/04). Candidato it.fails (G2-SD-04) | Saldo e estoque voltam; sem devolução ativa órfã | gap | - |
| PUR-06f | DELETE /api/purchases/:id | P0 | fast | Compra de B; 4 perfis | DELETE como A; por perfil | 404, B intacta; emp-sem 403 (KF-09) | `deleted_at` de B nulo | gap | - |
| PUR-01a | POST /api/purchases/:id/pay | P0 | fast | Compra pending A | pay com `payment_date` | 200, `paid`, data gravada | - | covered | `tests/fast/financial/financial-payments.test.ts` (P45/KF-43) |
| PUR-01b | POST /api/purchases/:id/pay | P0 | fast | Compra paga | pay de novo | 400 `Esta compra já foi paga`, sem mudança | Sem duplo efeito | covered | idem |
| PUR-01c | POST /api/purchases/:id/pay | P0 | fast | Compra de B | pay como A | 404, B continua pending | - | covered | idem |
| PUR-01d | POST /api/purchases/:id/pay | P0 | fast | Perfis sem papel / owner | pay | Sem permissão 403 | - | covered by KF-09 it.fails | `tests/fast/access/financial-permissions.test.ts` (it.fails KF-09; handler não chama `requireOrgPermission`). Não é teste de permissão passando |
| PUR-01e | POST /api/purchases/:id/pay | P0 | fast | Compra pending com `bank_account_id` | pay | Saldo, extrato e despesa ao pagar (docs PUR-01). Hoje só muda status, testado como decisão de produto em KF-43 | Saldo == soma dos extratos | it.todo, aguarda G2-OQ-02 | KF-43 documenta o comportamento atual |
| PUR-01g | POST /api/purchases/:id/pay | P1 | fast | `payment_date` inválida ("abc", futura) | pay | Regra de validação indefinida (hoje gravada sem validar, G2-SD-02) | - | it.todo, aguarda G2-OQ-10 | - |

Nota (ex-PUR-01f, removido): `pay.post.ts` nunca lê `bank_account_id` (verificado por leitura; só atualiza `payment_status`, `payment_date`, `updated_by`). Uma asserção "saldo de B intacto" seria vacuosa e não vira cenário.

---

## 2. purchase-returns (4 handlers, 19 linhas: 0 covered, 2 it.todo, 17 gap)

Fonte: `server/api/purchase-returns/`. POST exige `purchase_id`, `supplier_id`, `return_date`, `reason` (conjunto: warranty, wrong_part, manufacturing_defect, damaged_product, incompatible, other), `total_returned_amount`, `returned_items` (lista). `status` fora de `pending|completed` vira `pending` silenciosamente (G2-SD-10). GET busca por fornecedor/compra via subconsultas. PUT passa `purchase_id`, `status`, `total_returned_amount`, `returned_items` direto.

| ID | Método e caminho | Pri | Camada | Pré-condições | Passos | Resultado esperado | Integridade de dados | Status | Evidência |
|---|---|---|---|---|---|---|---|---|---|
| PRT-10 | GET /api/purchase-returns | P1 | fast | Org A: 3 devoluções (1 deletada, 1 completed); org B: 1 | GET; `status=completed`; `search` por fornecedor e por compra; `sort_by` inválido; page_size 500 | 200; sem deletadas e sem B; busca só encontra fornecedor/compra de A | Leitura | gap | - |
| PRT-03a | GET /api/purchase-returns | P0 | fast | `search` casa fornecedor de B | GET como A | Nenhum item de B (subconsultas filtram por org) | - | gap | - |
| PRT-11 | POST /api/purchase-returns | P1 | fast | Compra paga de A | POST válido | 200; `organization_id`=A; `status` default pending | Ligada à compra original | gap | - |
| PRT-12 | POST /api/purchase-returns | P1 | fast | - | Omitir cada obrigatório; `reason` fora do conjunto; `returned_items` não lista | 400 por campo | Nada inserido | gap | - |
| PRT-12b | POST /api/purchase-returns | P1 | fast | - | `status:'xyz'`; `total_returned_amount` negativo/string | Correto: 400 (hoje status vira pending, G2-SD-10; total sem validação). Candidato it.fails | - | gap | - |
| PRT-01 | POST /api/purchase-returns | P0 | fast | Compra com item qtd 5 | Devolver qtd 6; devolver 3 e depois 3 | Correto: 400 acima do comprado, acumulando devoluções anteriores (G2-SD-05). Candidato it.fails | Soma devolvida <= comprada; estoque nunca negativo | gap | - |
| PRT-01b | POST /api/purchase-returns | P0 | fast | Compra de A | `total_returned_amount` > total da compra | Correto: 400 (G2-SD-05) | devolvido <= total da compra | gap | - |
| PRT-02 | POST /api/purchase-returns | P1 | fast | Compra paga | POST com status completed | Ajuste financeiro conforme regra de produto (G2-OQ-02); hoje nenhum (G2-SD-05) | Saldo/extrato coerentes | gap | - |
| PRT-03b | POST /api/purchase-returns | P0 | fast | Compra e fornecedor de B | POST como A com `purchase_id` de B; `organization_id`=B no corpo | Correto: 404/400, corpo ignorado (hoje `purchase_id` aceito sem lookup, G2-SD-01). Candidato it.fails | Nada em B | gap | - |
| PRT-03c | POST /api/purchase-returns | P1 | fast | Compra soft-deleted | POST | Correto: 400/404 | - | gap | - |
| PRT-03d | POST /api/purchase-returns | P2 | fast | 4 perfis | POST por perfil | emp-sem 403 (KF-09) | - | gap | baseline KF-09 |
| PRT-13 | PUT /api/purchase-returns/:id | P1 | fast | Devolução de A | PUT `{reason, status:'completed'}` | 200; só campos enviados | Efeito de completar (G2-OQ-02) | gap | - |
| PRT-14 | PUT /api/purchase-returns/:id | P1 | fast | - | id inexistente / deletada | 404 `Devolução não encontrada` | - | gap | - |
| PRT-15 | PUT /api/purchase-returns/:id | P0 | fast | Devolução completed | PUT altera `total_returned_amount`, `returned_items`, `purchase_id`, `status` de volta | Estado concluído terminal ou com estorno: decisão de produto; validações do POST (G2-SD-05, G2-SD-10) | Valor devolvido imutável após concluir | it.todo, aguarda G2-OQ-09 e G2-OQ-02 | - |
| PRT-03e | PUT /api/purchase-returns/:id | P0 | fast | Devolução de B; compra de B | PUT como A; PUT com `purchase_id` de B | 404 e B intacta; id cruzado recusado (G2-SD-01) | - | gap | - |
| PRT-03f | PUT /api/purchase-returns/:id | P2 | fast | 4 perfis | PUT por perfil | emp-sem 403 (KF-09) | - | gap | baseline KF-09 |
| PRT-16 | DELETE /api/purchase-returns/:id | P1 | fast | Devolução pending A | DELETE | 200; soft; audit com `before` | Registro preservado | gap | - |
| PRT-16b | DELETE /api/purchase-returns/:id | P1 | fast | completed / já deletada | DELETE | completed: estorno ou recusa (G2-OQ-02); deletada: 404 | Estoque/financeiro revertidos se completed | it.todo, aguarda G2-OQ-02 e G2-OQ-09 (parte "deletada: 404" pode ser gap separado) | - |
| PRT-03g | DELETE /api/purchase-returns/:id | P0 | fast | Devolução de B; 4 perfis | DELETE como A; por perfil | 404, B intacta; emp-sem 403 (KF-09) | - | gap | - |

---

## 3. purchase-requests (6 handlers, 27 linhas: 0 covered, 4 it.todo, 23 gap)

Fonte: `server/api/purchase-requests/`. POST exige `supplier_id` e `items` (lista não vazia); `request_number` = `SOL-` + (count de TODAS as solicitações da org, inclusive deletadas) + 1; total soma `parseFloat(estimated_total_price)||0`; status inicial `waiting`. PUT não aceita `status`. `authorize`/`reject` só transitam de `waiting` (400 caso contrário).

| ID | Método e caminho | Pri | Camada | Pré-condições | Passos | Resultado esperado | Integridade de dados | Status | Evidência |
|---|---|---|---|---|---|---|---|---|---|
| PRQ-10 | GET /api/purchase-requests | P1 | fast | Org A: 3 (1 deletada, 1 authorized); org B: 1 | GET; `status=authorized`; sort inválido; page_size 500 | 200; sem deletadas e sem B; filtros corretos | Leitura | gap | - |
| PRQ-03a | GET /api/purchase-requests | P0 | fast | Org B com solicitação | GET como A com `organization_id=B` | Só A | - | gap | - |
| PRQ-11 | POST /api/purchase-requests | P1 | fast | Org A com 2 solicitações | POST com 2 itens | 200; `request_number`=`SOL-00003`; status `waiting`; total = soma dos itens | Total == soma(estimated_total_price) | gap | - |
| PRQ-12 | POST /api/purchase-requests | P1 | fast | - | sem `supplier_id`; `items` ausente, vazio, não lista | 400 | Nada inserido | gap | - |
| PRQ-12b | POST /api/purchase-requests | P1 | fast | - | `estimated_total_price` "abc"/negativo | Correto: 400 (hoje NaN vira 0, G2-SD-11). Candidato it.fails | total confiável | gap | - |
| PRQ-11b | POST /api/purchase-requests | P1 | db | Duas criações simultâneas na org A | 2 POST em paralelo | Números distintos (correto). Hoje count+1 sem trava (G2-SD-08, hipótese) | `request_number` único por org | gap | - |
| PRQ-11d | POST /api/purchase-requests | P2 | fast | Org A com 1 deletada | POST | Número não reutiliza o da deletada (comportamento atual: count inclui deletadas). Confirmar com G2-OQ-06 (renomeado de PRQ-11c) | - | gap | - |
| PRQ-11c | POST /api/purchase-requests | P1 | fast | Org A | POST com `total_request_amount` diferente da soma dos itens | Handler usa `body.total_request_amount ?? totalAmount`, então o cliente sobrescreve o total. Comportamento esperado indefinido | total == soma(items) conforme regra | it.todo, aguarda G2-OQ-11 | `purchase-requests/index.post.ts` |
| PRQ-03b | POST /api/purchase-requests | P0 | fast | Fornecedor de B | POST como A com `supplier_id` de B e `organization_id`=B | Corpo ignorado; id cruzado recusado (G2-SD-01). Candidato it.fails | Nada em B; contador só da org A | gap | - |
| PRQ-03c | POST /api/purchase-requests | P2 | fast | 4 perfis | POST por perfil | emp-sem 403 (KF-09) | - | gap | baseline KF-09 |
| PRQ-13 | PUT /api/purchase-requests/:id | P1 | fast | Solicitação waiting A | PUT `{notes, justification}`; PUT `{status:'authorized'}` | 200 nos campos; `status` ignorado (não está na lista) | Status só muda por authorize/reject | gap | - |
| PRQ-14 | PUT /api/purchase-requests/:id | P1 | fast | - | id inexistente / deletada | 404 `Solicitação não encontrada` | - | gap | - |
| PRQ-15 | PUT /api/purchase-requests/:id | P1 | fast | Solicitação authorized/rejected | PUT `items`/`total_request_amount` | Edição em estado terminal e recálculo do total são decisões de produto (G2-SD-12, G2-SD-11) | total == soma(items) conforme regra | it.todo, aguarda G2-OQ-09 | - |
| PRQ-03d | PUT /api/purchase-requests/:id | P0 | fast | Solicitação de B | PUT como A; `purchase_id`/`supplier_id` de B | 404; id cruzado recusado (G2-SD-01) | B intacta | gap | - |
| PRQ-03e | PUT /api/purchase-requests/:id | P2 | fast | 4 perfis | PUT por perfil | emp-sem 403 (KF-09) | - | gap | baseline KF-09 |
| PRQ-16 | DELETE /api/purchase-requests/:id | P1 | fast | waiting A | DELETE | 200; soft; audit | Preservada | gap | - |
| PRQ-16b | DELETE /api/purchase-requests/:id | P1 | fast | authorized com `purchase_id` | DELETE; DELETE de já deletada | authorized com compra gerada: recusar (G2-SD-12, hipótese); deletada: 404 | Compra gerada não fica órfã | it.todo, aguarda G2-OQ-09 (parte "deletada: 404" pode ser gap separado) | - |
| PRQ-03f | DELETE /api/purchase-requests/:id | P0 | fast | Solicitação de B; 4 perfis | DELETE como A; por perfil | 404 B intacta; emp-sem 403 (KF-09) | - | gap | - |
| PRQ-01a | POST /api/purchase-requests/:id/authorize | P0 | fast | waiting A | authorize | 200; `authorized`, `authorization_date`, `authorized_by`=email | Transição única | gap | - |
| PRQ-01b | POST /api/purchase-requests/:id/authorize | P0 | fast | authorized, rejected | authorize de novo; authorize de rejeitada | 400 `Somente solicitações com status "aguardando"...`; sem mudança | Estados terminais | gap | - |
| PRQ-01c | POST /api/purchase-requests/:id/authorize | P0 | fast | 4 perfis | authorize por perfil | Correto: permissão própria (docs PUR-01); hoje só login. emp-sem 403, KF-09/G2-SD-06. Candidato it.fails | Quem autoriza fica em `authorized_by` | gap | - |
| PRQ-02 | POST /api/purchase-requests/:id/authorize | P1 | fast | waiting A | authorize 2 vezes | Segundo authorize já retorna 400 (coberto por PRQ-01b). Geração única de compra só se OQ decidir que authorize gera compra; hoje nada é gerado (G2-SD-07) | 1 compra por solicitação | it.todo, aguarda G2-OQ-07 | - |
| PRQ-03g | POST /api/purchase-requests/:id/authorize | P0 | fast | Solicitação de B; deletada; inexistente | authorize como A | 404, B intacta | - | gap | - |
| PRQ-01d | POST /api/purchase-requests/:id/reject | P0 | fast | waiting A | reject | 200; `rejected`; quem/quando gravado | Transição única | gap | - |
| PRQ-01e | POST /api/purchase-requests/:id/reject | P0 | fast | authorized, rejected | reject | 400 `Somente solicitações com status "aguardando"...` | Authorized não vira rejected | gap | - |
| PRQ-01f | POST /api/purchase-requests/:id/reject | P0 | fast | 4 perfis | reject por perfil | emp-sem 403 (KF-09/G2-SD-06). Candidato it.fails | - | gap | - |
| PRQ-03h | POST /api/purchase-requests/:id/reject | P0 | fast | Solicitação de B | reject como A | 404, B intacta | - | gap | - |

---

## SD: defeitos suspeitos (candidatos a it.fails + entrada KF)

| ID | Defeito | Status | Evidência | Cenários |
|---|---|---|---|---|
| G2-SD-01 | POST/PUT de purchases, purchase-returns e purchase-requests aceitam `supplier_id`, `bank_account_id`, `purchase_id` do corpo sem validar que pertencem à org da sessão: não há `from('suppliers'|'bank_accounts'|'purchases')` nesses handlers. | **Verificado** (leitura de `purchases/index.post.ts`, grep dos demais: nenhuma consulta de lookup em POST) | `server/api/purchases/index.post.ts` L24-35 | PUR-06b, PUR-06d, PRT-03b, PRT-03e, PRQ-03b, PRQ-03d |
| G2-SD-02 | Sem validação de tipo/faixa em `total_amount`, `payment_status`, `purchase_date`, `payment_date`; só presença. | **Verificado** (POST L13-20; pay usa `body.payment_date \|\|` direto) | `purchases/index.post.ts`, `pay.post.ts` | PUR-12b, PUR-04, PUR-01g |
| G2-SD-03 | PUT de purchases aceita `payment_status:'paid'` sem passar pelo `pay`. | **Verificado** (`payment_status` na lista updatable) | `purchases/[id].put.ts` L32-34 | PUR-15 |
| G2-SD-04 | DELETE de compra não reverte nada, não checa paga nem devoluções vinculadas. | **Verificado** (só `update deleted_at`) | `purchases/[id].delete.ts` | PUR-03 |
| G2-SD-05 | Devolução sem validar quantidade/valor <= comprado, sem ajuste de estoque nem financeiro. | **Verificado** (POST só presença; sem lookup da compra) | `purchase-returns/index.post.ts` | PRT-01, PRT-01b, PRT-02 |
| G2-SD-06 | `authorize`/`reject` só exigem login; docs esperam permissão própria. | **Verificado** (só `requireAuthUser`). Docs descrevem a expectativa: o que é "correto" depende de G2-OQ-01 | `purchase-requests/[id]/*.post.ts` | PRQ-01c, PRQ-01f |
| G2-SD-07 | `authorize` não gera compra; docs PUR-02 esperam geração única. | **Verificado** que não gera; se deveria gerar é G2-OQ-07 | `authorize.post.ts` L35-49 | PRQ-02 |
| G2-SD-08 | `request_number` por `count+1` sem trava: corrida gera número duplicado. | **Hipótese** (código verificado; corrida não demonstrada, e pode haver índice único) | `purchase-requests/index.post.ts` L19-26 | PRQ-11b |
| G2-SD-09 | `update` sem filtro `organization_id` após o `find` (janela TOCTOU). | **Hipótese**; só confirmado em purchases PUT que o update filtra por `id` | `purchases/[id].put.ts` L43-46 | cobertura indireta pelas linhas iso (RLS em db, G2-OQ-08) |
| G2-SD-10 | Devolução: `status` inválido vira `pending` sem erro. | **Verificado** | `purchase-returns/index.post.ts` L29 | PRT-12b |
| G2-SD-11 | Solicitação: total com `parseFloat(...)\|\|0` (lixo vira 0); PUT aceita `total_request_amount` sem recalcular. | **Verificado** | `purchase-requests/index.post.ts`, `[id].put.ts` L30-33 | PRQ-12b, PRQ-15 |
| G2-SD-12 | Solicitação authorized/rejected pode ser editada ou excluída sem guarda de estado. | **Hipótese** (nenhuma guarda no código; regra de negócio não confirmada) | PUT/DELETE de purchase-requests | PRQ-15, PRQ-16b |

## OQ: perguntas para o product-owner

1. **G2-OQ-01** Quais chaves de permissão para purchases, purchase-returns, purchase-requests (incluindo `authorize`/`reject` separadas)? Leitura (GET) deve exigir permissão?
2. **G2-OQ-02** Efeitos financeiros: pagar compra deve lançar despesa, extrato e baixar saldo (KF-43 hoje diz que não)? Excluir compra paga e devolução concluída devem estornar? Devolução de compra paga gera crédito/ajuste?
3. **G2-OQ-03** Total da compra deve ser sempre a soma dos itens? Regra de arredondamento (2 casas)? Desconto/frete existem?
4. **G2-OQ-04** Compra e devolução movimentam estoque? Em que momento (criação, pagamento, recebimento)? Estoque pode ficar negativo?
5. **G2-OQ-05** Organização suspensa ou assinatura expirada deve bloquear escrita nestes domínios? Hoje nenhum handler checa.
6. **G2-OQ-06** Numeração `SOL-` deve ser sequencial sem reaproveitar números de deletadas? Único por org?
7. **G2-OQ-07** Autorizar uma solicitação deve gerar a compra automaticamente? Qual a relação `purchase_id`?
8. **G2-OQ-08** Compras/devoluções/solicitações têm RLS por org e FK cruzada bloqueada no banco (camada db)? Confirmar para definir testes db.
9. **G2-OQ-09** Solicitação autorizada/rejeitada e devolução concluída podem ser editadas ou excluídas?
10. **G2-OQ-10** `payment_date` do `pay`: formato aceito e data futura permitida?
11. **G2-OQ-11** No POST de solicitação, o cliente pode informar `total_request_amount` diferente da soma dos itens, ou o servidor deve sempre recalcular?

## Ordem de implementação para test-engineer (um PR por domínio)

1. **PR 1, purchase-requests**: PRQ-01a/b/d/e e PRQ-03g/h (máquina de estados e isolamento, maior valor, sem dependência de OQ), depois PRQ-10/11/12/13/14/16, iso das escritas, KF-09 e G2-SD-06 como it.fails após G2-OQ-01.
2. **PR 2, purchases**: PUR-10..14, 16, iso (PUR-06a/d/f), depois it.fails de G2-SD-01 (PUR-06b/d), G2-SD-04 e KF-09; PUR-01d já coberto por KF-09 it.fails. it.todo (PUR-04, 15, 15b, 01e, 01g) só viram teste após G2-OQ-02/03/10.
3. **PR 3, purchase-returns**: PRT-10..14, 16, iso, depois it.fails G2-SD-05/G2-SD-10 (aguardam G2-OQ-02/04).
4. **PR 4 (db, opcional)**: PRQ-11b e RLS/FK (G2-OQ-08).

Todo it.fails exige entrada `KF-nn` em `known-failures.md`. Toda linha marcada "KF-09" deve usar o mesmo mecanismo do baseline estático.
