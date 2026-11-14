# Modo de lançamento de comissões como configuração da organização

Status: análise (sem alteração de código). Data: 2026-11-14.
Legenda: [V] verificado no código/doc com referência; [H] hipótese a confirmar.

## 1. Resumo

Hoje a escolha existe por OS, no modal de pagamento, como um switch "Liberar 100% da comissão agora". O padrão é liberação **proporcional ao recebido**. O dono do produto quer fixar isso por organização. A viabilidade é alta, mas há dois pontos que exigem decisão antes de construir: (a) o que acontece com a opção por OS e (b) o risco financeiro já conhecido do modo `full` (pagar comissão sem entrada de dinheiro, KF-40/DI-10).

## 2. Fluxo atual (evidência)

### 2.1 Opções existentes [V]
Só existem dois modos, coluna `service_orders.commission_release_mode` varchar(20) NOT NULL DEFAULT `'proportional'`, CHECK IN (`proportional`,`full`) (`supabase/migrations/20240101000074_add_commission_release_mode_to_service_orders.sql:21-25`).

- `proportional` (padrão): `receivedRatio = min(1, recebido/total)`; a comissão liberada acompanha o que o cliente pagou (`server/utils/service-order-commissions.ts:430-432`, `:532`). Se há estorno de recebimento, o sistema faz claw-back dos registros `pending` (`:557` em diante; comentário em `:390`).
- `full`: `receivedRatio = 1`; libera 100% do direito mesmo sem recebimento (`:430-431`).

Obs.: "lançamento" aqui significa geração/liberação de `employee_financial_records` (record_type `commission`). Pagar a comissão ao funcionário é outro passo (`pay-commissions-bulk`, relatório de comissões). Não confundir com o "modo" analisado.

### 2.2 Onde a escolha é feita [V]
- UI: `app/components/service-orders/PaymentModal.vue:68-70` (estado `releaseCommissionsInFull`), `:73` (já full), `:429-448` (switch; texto: "vale para esta OS e não pode ser desfeita pela tela"), `:335` e `:341` (envio no payload).
- API: `server/api/service-orders/[id]/process-payment.post.ts:40` lê `releaseCommissionsInFull`; `:82-92` grava `commission_release_mode='full'` na OS ("one-way switch"); `:94-103` grava evento de histórico `commission.release_mode_changed` (`{to:'full'}`, idempotency key por OS). Permissão `orders.pay` (`:22`).
- Motor: `releaseServiceOrderCommissions` (`server/utils/service-order-commissions.ts:248`) é o único que grava `employee_financial_records` (`docs/finance/commissions-step8-engine-cutover.md:27`). É chamado em recebimento de parcela, pagamento avulso, geração do plano com `full` e via `POST /api/service-orders/:id/generate-commissions`.
- Outras leituras: `app/components/service-orders/detail/Modal.vue:318,473` (exibe o modo; default `'proportional'`), `server/api/reports/commissions/[id].get.ts:354`, `app/types/service-orders.ts:21,149`.
- Pagamento em lote: `pay-entries-bulk` e `pay-commissions-bulk` **não** usam o modo; pagam lançamentos/comissões já geradas. Têm o problema de rollback silencioso (FIN-1, `docs/engineering/pending-bulk-payment-rollback.md`, `docs/engineering/pending.md:96`), independente desta feature. Não foi encontrado fluxo de pagamento de OS em lote que escolha o modo [V por grep: `releaseCommissionsInFull`/`commission_release_mode` só aparecem em process-payment].

### 2.3 Regras e estados já conhecidos (risco herdado) [V, docs de auditoria]
- O modo é irreversível e persiste após falha da requisição e após `payment.delete` (DI-10, `docs/data-integrity/audits/comissoes-integridade.md:101-107`; teste P41 caracteriza como "por desenho"). Nota: os números de linha citados em DI-10 estão defasados (hoje a gravação está em `process-payment.post.ts:82-92`); a gravação do modo ocorre antes das validações do plano (`:105-132`), então uma falha posterior deixa a OS em `full` sem plano [V pela ordem do código lido].
- KF-40 (P0): `cancel.post.ts` remove comissão já `paid` e estorna o dinheiro; alcançável com `full` (`docs/testing/known-failures.md:150`).
- Em `full` estornos de recebimento não fazem claw-back (DI-10).
- Doc de regras: não está definido se a comissão é devida na conclusão, faturamento ou recebimento (`docs/financial/audits/comissoes/01-regras-de-negocio.md:31`). A regra oficial é decisão pendente de negócio.
- Auditoria: a mudança por OS gera evento de histórico visível só na visibilidade `commission` (`docs/architecture/os-history-timeline.md:261`).

## 3. Configurações da organização (onde guardar) [V]

- Tela: `app/pages/app/settings/company.vue`. Card "Sistema" em `:738-760`, campo `initial_service_order_number` (`:747-758`), validação zod `int().min(1)` em `:57`, carga com fallback `?? 1` em `:97`, campo desabilitado sem `canUpdate`.
- API: `server/api/organizations/index.put.ts`. Permissão `settings.update` (`:8`), tenant via `resolveOrganizationId` (`:11`) e `.eq('id', organizationId)` (`:50`). Whitelist `allowedFields` (`:15-36`) — campos novos precisam ser incluídos. Grava `updated_by` (email) (`:45`).
- Schema: `organizations.initial_service_order_number int NOT NULL DEFAULT 1` (`supabase/migrations/20240101000001_create_organizations.sql:60`), default 4000 para novas orgs (`...000096...sql:13`).
- Lacunas do endpoint [V]: não valida valores no servidor (repassa o body para a whitelist), não chama `recordAudit` nem grava evento com valor anterior/novo. Isso é aceitável para número de OS, mas **não** para uma regra financeira.

## 4. O card "Sistema" é o lugar certo?

Parcialmente. Tecnicamente é o ponto natural (mesma tela, mesma permissão, mesmo endpoint). Do ponto de vista de produto:
- O card chama-se "Sistema" e hoje trata de numeração; uma regra financeira com efeito sobre pagamento ao funcionário ficaria escondida e semanticamente distante.
- [H] Recomendação de UX: criar card próprio ("Financeiro" ou "Comissões") na mesma página, com texto explicando as consequências de cada modo. Se o stakeholder preferir manter simples, o card Sistema funciona, desde que haja descrição clara e aviso de confirmação. Decisão de layout é do ux-ui-designer/product-owner.
- Confirmar se `settings.update` é a permissão adequada, ou se alterar regra financeira deve exigir permissão mais restrita (ver perguntas).

## 5. Análise de impacto

| Tema | Análise |
|---|---|
| Valor padrão / migração | Nova coluna em `organizations`, ex.: `commission_release_mode varchar(20) NOT NULL DEFAULT 'proportional'` com o mesmo CHECK. Todas as orgs existentes ficam `proportional`, que é o comportamento atual quando ninguém marca o switch. Sem backfill de OS. [H] Antes, checar em dados reais (com autorização) quantas orgs usam `full` por OS; se alguma usa com frequência, o padrão dela deveria ser `full` para não mudar o comportamento. |
| Histórico retroativo | A config só deve valer para OS **sem modo definido ainda**. O valor da OS (`service_orders.commission_release_mode`) deve continuar sendo o de verdade na liberação (`service-order-commissions.ts:430`). Mudar a config da org não pode tocar OS existentes nem recalcular comissões. Ponto crítico: a coluna da OS tem NOT NULL DEFAULT `proportional`, então hoje não distingue "padrão" de "escolhido proporcional". Ver opção B abaixo. |
| Override pontual | Hoje existe o override por OS (só para `full`, one-way). Manter ou remover é decisão de negócio (P1). |
| Tenant | Coluna na linha da própria org; o PUT já filtra por `organizationId` resolvido da sessão. Leitura no motor deve usar a org da OS/`organizationId` do contexto, nunca do body. |
| Permissão | Hoje `settings.update` edita toda a empresa. Alterar regra financeira com esse papel é amplo demais [H]; avaliar permissão dedicada ou restrição a owner/admin. |
| Auditoria | O PUT não registra valor antigo/novo. A mudança deve gerar registro (via `recordAudit`, já usado nos handlers de OS, ou log equivalente) com org, usuário, antes, depois, data. |
| Relatórios | `reports/commissions/[id].get.ts:354` já lê o modo por OS e continua válido. Relatórios que somam comissão "liberada" mudam de ritmo para orgs que adotarem `full`: comissão a pagar aparece antes da receita recebida. Atenção a lucro vs caixa (CLAUDE.md: não confundir receita, caixa e lucro). |
| Dados históricos já em `full` | Permanecem; sem reversão. |

## 6. Riscos

1. **R1 (alto): `full` como padrão da org amplia a exposição a KF-40 e DI-10.** Hoje o risco é limitado às OS onde o usuário marcou o switch; com config da org, toda OS da empresa fica exposta (cancelamento apaga comissão paga; sem claw-back em estorno; sem reversão). Recomendo tratar KF-40 antes ou junto de habilitar `full` em nível de org.
2. **R2 (alto): mudar config sem trilha de auditoria** de regra que move dinheiro.
3. **R3 (médio): ambiguidade padrão vs. escolha** na coluna da OS (NOT NULL DEFAULT `proportional`), que impede saber se a OS "herda" da org ou foi decidida. Pode causar mudança retroativa se a leitura passar a consultar a org em vez da OS.
4. **R4 (médio): gravação do modo antes das validações** em `process-payment` (DI-10) pode fixar `full` em OS sem plano; com herança da org isso se repetiria em escala se o ponto de fixação continuar o mesmo.
5. **R5 (médio): corrida entre alteração da config e pagamento em andamento.** Sem decisão sobre "quando fixar o modo na OS" o resultado é não determinístico.
6. **R6 (baixo): permissão ampla** (`settings.update`) para regra financeira.
7. **R7 (baixo, independente): FIN-1** nos pagamentos em lote, não causado nem resolvido por esta feature.

## 7. Dúvidas de negócio (decisão do stakeholder)

1. O modo da org terá os mesmos dois valores (proporcional ao recebido / 100% ao gerar o plano) ou haverá outros momentos (na conclusão da OS, na quitação total)? Os rótulos exatos em pt-BR?
2. Mantém-se o override por OS no pagamento? Opções: remover; manter só para quem tem permissão específica; manter como exceção com motivo.
3. A mudança da config vale só para OS futuras (recomendado) ou também para OS ainda sem plano de pagamento?
4. Em que momento o modo é "congelado" na OS: na criação, na conclusão ou ao gerar o plano de pagamento?
5. Quem pode alterar? `settings.update` basta ou precisa permissão própria (owner/admin)?
6. Existem orgs hoje que usam `full` de forma recorrente (para definir o padrão delas na migração)?
7. Se `full` na org: o negócio aceita pagar comissão sem recebimento, e qual a política ao cancelar/estornar (devolução, desconto no próximo pagamento)? Resolve KF-40.
8. A mudança de configuração exige confirmação explícita e motivo?

## 8. Opções de implementação

- **Opção A: só a config da org, lida em tempo real** pelo motor, sem congelar na OS. Simples, mas viola histórico: mudar a config alteraria o cálculo de OS em andamento. **Não recomendada.**
- **Opção B (recomendada):** coluna `organizations.commission_release_mode` (default `proportional`) e **congelamento na OS** no primeiro ponto de fixação (hoje `process-payment`): se a OS ainda não tem decisão, copia o valor da org. Para distinguir "sem decisão" de "proporcional escolhido", ou a coluna da OS passa a aceitar NULL (migração cuidadosa, tratando NULL como `proportional` na leitura), ou grava-se uma marca/evento de fixação [H: avaliar com software-architect]. Remove (ou restringe, conforme decisão 2) o switch do modal e substitui por texto informativo "Modo da empresa: X". Whitelist do PUT + validação no servidor (`IN ('proportional','full')`) + auditoria antes/depois.
- **Opção C: config da org como valor inicial sugerido** e switch mantido no modal para override. Menor mudança de UX, preserva flexibilidade, mas não cumpre "definido uma vez" e mantém risco R1 por OS.

Recomendação: B, com card próprio na tela de empresa, permissão restrita, auditoria, e mitigar KF-40/DI-10 (ao menos mover a gravação do modo para depois das validações) antes de liberar `full` como padrão de org.

## 9. Critérios de aceite sugeridos

1. Toda org existente continua com comportamento idêntico após a migração (`proportional`, salvo decisão da pergunta 6); nenhuma OS ou registro de comissão existente é alterado.
2. Alterar a config da org não modifica `commission_release_mode` de OS que já tiveram o modo fixado nem recalcula comissões geradas.
3. Nova OS que chega ao ponto de fixação herda o modo vigente da org; o valor fica gravado na OS e é usado nas liberações seguintes.
4. O modal de pagamento exibe o modo da empresa e (conforme decisão 2) não oferece, ou restringe, o override.
5. A API rejeita valores fora do domínio e usuários sem a permissão definida (403); a org é sempre a da sessão (teste de isolamento entre `org-a` e `org-b`).
6. Cada alteração de config registra usuário, data, valor anterior e novo.
7. Teste: com `full` na org, o fluxo de `process-payment` mantém os eventos `commission.release_mode_changed` coerentes; com `proportional`, a liberação segue o recebido, incluindo estorno com claw-back.
8. Relatórios de comissão exibem o modo da OS corretamente para OS antigas e novas.
9. Falha em `process-payment` antes da criação do plano não deixa a OS com modo fixado (ou comportamento aprovado e testado).

## 9.1 Decisões do stakeholder (2026-11-14)

- Override por OS: removido. O modal de pagamento só exibe como a comissão está sendo gerada (modo da empresa), sem permitir alterar.
- Modos: somente os 2 atuais, sem novos momentos.
  - `proportional` — rótulo "Conforme o recebimento": libera na proporção do recebido; estorno desfaz a parte pendente.
  - `full` — rótulo "Integral ao gerar o pagamento": libera 100% ao registrar o pagamento da OS, mesmo sem recebimento; estorno não desfaz.
- Abrangência: vale para todas as OS (go-live em produção).
- Permissão: `settings.update` é suficiente.
- Uso atual: todas as organizações usam `full` hoje; padrão na migração = `full`.
- Mudança da configuração: sem diálogo de confirmação e sem pedir motivo. Apenas registrar o evento no log de auditoria (quem mudou, quando, valor anterior e novo) para saber o que aconteceu.
- Local da configuração: card "Sistema" da tela de empresa (`company.vue`), junto do "Número inicial de OS".
- Aplicação do modo (decidido): a OS nasce com o `commission_release_mode` da organização (campo já existente em `service_orders`). No pagamento, se nenhuma comissão foi liberada ainda para a OS, o modo é atualizado pelo modo atual da organização. Após a primeira liberação de comissão, o modo da OS fica fixo. O pagamento deixa de gravar o modo por escolha do usuário (some a gravação antes das validações, DI-10). Todo ponto que cria OS deve gravar o modo da organização (a verificar na spec).
- OS existentes: as que já tiveram comissão liberada ficam como estão, porque o usuário já escolheu o modo (confirmado pelo stakeholder). OS existentes ainda sem comissão liberada seguem o modo da organização (`full`), consequência da regra acima e do mesmo raciocínio (ainda não houve escolha). [Interpretação do analista; corrigir se a intenção for restringir a OS criadas após o deploy.]
- Pendentes: nenhuma decisão de negócio em aberto para a spec. Política de cancelamento/estorno em `full` (KF-40) registrada como FIN-3 em `docs/engineering/pending.md`.

## 10. Referências

- `app/components/service-orders/PaymentModal.vue`
- `server/api/service-orders/[id]/process-payment.post.ts`
- `server/utils/service-order-commissions.ts`
- `server/api/organizations/index.put.ts`, `app/pages/app/settings/company.vue`
- `supabase/migrations/20240101000074_*.sql`, `20240101000001_create_organizations.sql`, `20240101000096_*.sql`
- `docs/data-integrity/audits/comissoes-integridade.md` (DI-10), `docs/testing/known-failures.md` (KF-40), `docs/financial/audits/comissoes/01-regras-de-negocio.md`, `docs/engineering/pending-bulk-payment-rollback.md`
