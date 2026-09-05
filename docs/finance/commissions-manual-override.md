# Comissão manual por OS — plano de implementação

> Planeja uma feature nova: permitir aplicar, para **um funcionário em uma OS específica**, uma comissão diferente da configurada no plano padrão dele — **selecionando uma configuração de comissão já existente** em Financeiro > Comissões (não digitando um valor solto), já que essa configuração pode ter várias regras por categoria. Ex: funcionário tem "Comissão mecânicos — padrão" (9% sobre faturamento) atribuída; numa OS pontual, o gestor aplica a configuração "Comissão mecânicos — plantão" (15%, ou um conjunto de regras por categoria diferente) **só nessa OS**, com motivo obrigatório e log de auditoria. Constrói em cima do que já existe: o motor novo (`lib/utils/employee-commission-engine.ts`, docs/finance/commissions-configuration-architecture.md), o CRUD de comissões (`server/utils/employee-commission-plans.ts`) e a feature de "Recalcular" já implementada em `server/utils/service-order-commissions.ts` / `app/components/service-orders/detail/OSResponsiblesCard.vue`. Só documento — nenhum código de produto muda por este arquivo (o motor de override em si já está em implementação nesta mesma sessão, ver §9).

## 1. Objetivo e caso de uso

Hoje a comissão de um funcionário numa OS vem sempre da(s) configuração(ões) atribuída(s) a ele em **Financeiro > Comissões** (`employee_commission_plans` → versão vigente → regra aplicável por categoria/default), resolvida por `resolveEmployeeCommissionRulesForEmployees()`. Não existe forma de dizer "nesta OS específica, para este funcionário específico, use uma configuração diferente" — a única forma hoje seria editar a atribuição dele (o que mudaria a comissão em *todas* as OS, não só nesta) ou criar um plano novo e reatribuir.

Caso de uso do pedido: um funcionário tem "Comissão mecânicos — padrão" atribuída (9% sobre faturamento). Numa OS pontual, por um motivo específico (ficou até tarde, serviço mais complexo, etc.), o gestor quer que **essa OS específica** use uma configuração diferente — que pode ser uma taxa simples diferente ou um conjunto de regras por categoria diferente, dependendo de qual configuração ele escolher — sem alterar a atribuição padrão do funcionário e sem precisar reatribuir/desatribuir planos.

Requisitos explícitos do pedido:
1. Aplicar uma **configuração de comissão existente** (não um valor digitado na hora) para um funcionário, escopada a uma OS — a configuração escolhida sobrepõe as regras normais dele nessa OS.
2. Motivo obrigatório.
3. Log de auditoria (quem, quando, por quê, valor anterior → novo, qual configuração foi aplicada).

**Por que selecionar uma configuração em vez de digitar tipo/valor/base na hora** (mudança em relação à primeira versão deste plano): uma configuração de comissão (`employee_commission_plans`) pode ter **várias regras**, uma por categoria de produto, mais uma regra default — exatamente o mesmo motivo que levou a arquitetura toda a sair de "funcionário tem um tipo/valor/base" (os 5 campos legados) para o modelo novo (`docs/finance/commissions-configuration-architecture.md` §1). Um override "digite um valor" reintroduziria a mesma limitação que o modelo novo resolveu — só serviria pra taxa única, não pra "essa OS usa uma comissão diferente por categoria também". Selecionar uma configuração existente evita isso e reaproveita o motor de resolução por categoria que já existe, sem inventar um segundo formato de regra.

## 2. Estado atual (o que já existe e vai ser reaproveitado)

- **Motor de resolução** (`lib/utils/employee-commission-engine.ts`): `resolveEffectiveCommissionVersion`, `getApplicableCommissionRule`/`matchCommissionRule`, `computeCommissionAmount`, `computeEmployeeOrderCommission`. Pura, sem I/O, compartilhada entre client (`app/utils/service-orders.ts`) e server (`server/utils/service-order-*.ts`).
- **Resolução por funcionário**: `resolveEmployeeCommissionRulesForEmployees(supabase, organizationId, employeeIds, referenceDate)` em `server/utils/employee-commission-plans.ts` devolve `Map<employeeId, ResolvedCommissionRule[]>` — a lista de regras do(s) plano(s) vigente(s) atribuído(s) a cada funcionário.
- **Resolução por plano** (peça que falta e este plano adiciona — §5.1): hoje só existe resolução *por funcionário* (via `employee_commission_plan_assignments`). Não existe uma função que resolve as regras vigentes de um plano dado só o `plan_id`, sem passar por atribuição — é exatamente o que o override precisa (usar as regras de um plano que não está necessariamente atribuído a este funcionário).
- **CRUD de comissões**: `GET /api/commissions?activeOnly=true` já lista planos ativos com nome/descrição/resumo da versão vigente (usado pela tela Financeiro > Comissões) — reaproveitado aqui como fonte do seletor de override, sem endpoint novo de listagem.
- **Liberação real**: `releaseServiceOrderCommissions()` em `server/utils/service-order-commissions.ts` — recalcula `computeEmployeeEntitlements()` a partir de `rulesByEmployeeId`, atualiza `service_orders.items[].commissions[]` (via `computeServiceOrderItemsWithCommissionSnapshots`) e libera/estorna `employee_financial_records` proporcionalmente ao recebido.
- **Recalcular (já implementado)**: `releaseServiceOrderCommissions()` aceita `employeeId` + `reason` opcionais — escopa o recálculo a um funcionário, bloqueia se ele já tem comissão paga nessa OS, e grava uma entrada em `service_orders.commission_manual_adjustments_log` (jsonb, coluna criada em `20240101000093_add_commission_manual_adjustments_log_to_service_orders.sql`).
- **UI**: `OSResponsiblesCard.vue` (detail) já tem, por funcionário responsável, o badge de comissão + popover de detalhamento por item + popover "Regras de comissão do funcionário" (mostra as regras vigentes, recém-adicionado) + botão "Recalcular" com modal de motivo obrigatório (`AppConfirmModal`), condicionado a `canUpdate`.

## 3. Decisão de arquitetura

### 3.1 Sem tabela nova, sem coluna de "estado atual" separada — o log é a fonte da verdade

Uma comissão manual por OS precisa de duas coisas: (a) um **estado atual** (existe override ativo para este funcionário nesta OS? qual configuração?) e (b) um **histórico** (quem aplicou, quando, por quê, o que havia antes). A abordagem mais simples que já se encaixa no que existe: **event-sourcing num único array append-only** — o mesmo `commission_manual_adjustments_log` que a feature de Recalcular já grava, com campos novos opcionais para descrever o override.

O estado atual de um funcionário = a última entrada do log (nessa OS) que tenha `override_action` preenchido:
- se for `'apply'`, o override está ativo, usando as regras vigentes do plano `override_commission_plan_id` daquela entrada;
- se for `'remove'`, não há override ativo (foi removido, volta pro(s) plano(s) atribuído(s) normalmente);
- se não houver nenhuma entrada com `override_action`, nunca houve override.

Reaplicar (`'apply'` de novo, com um plano diferente) sobrescreve o anterior só como *estado atual* — a entrada antiga continua no array, então "atribuição padrão → override pra 'Comissão plantão' (motivo X) → depois trocado pro override 'Comissão gerente' (motivo Y) → depois removido" fica auditável na íntegra sem precisar de tabela extra.

**Por que não uma tabela `service_order_commission_overrides`?** Foi considerada, mas somaria: uma migration de schema novo, RLS, upsert/soft-delete, e sincronização entre "estado atual" e "log" (dois lugares podendo divergir). Como o volume de overrides por OS é pequeno e o log inteiro já é lido de qualquer forma toda vez que a OS é recalculada, escanear o array é barato e elimina a categoria inteira de bug "estado e log dessincronizados".

**Trade-off aceito:** a mesma coluna guarda dois tipos de evento (recálculo simples e aplicação/remoção de override) — por isso o nome genérico `commission_manual_adjustments_log` (não `commission_recalculation_log`, nome original antes de ser renomeado nesta mesma sessão, ainda sem dado real gravado). Ver decisão 12.3.

### 3.2 Override referencia um plano existente — reaproveita a resolução por categoria, não uma regra sintética

**Isto substitui a primeira versão deste plano**, que modelava o override como uma única regra flat digitada na hora (tipo/valor/base). Um plano de comissão (`employee_commission_plans`) já resolve, pra uma data de referência, exatamente o que o override precisa: uma lista de `ResolvedCommissionRule[]` (potencialmente várias regras por categoria + uma default) — a mesma estrutura usada por qualquer funcionário no fluxo normal. O override é então: **"nesta OS, para este funcionário, use as regras vigentes do plano X em vez das regras do(s) plano(s) atribuído(s) a ele"**.

Isso significa que:
- Aplicar o override não calcula nada sozinho — só troca a **fonte** das regras, e deixa o motor existente (`computeEmployeeOrderCommission`, que já lida com múltiplas regras por categoria) fazer o resto, sem mudança nenhuma nele.
- Qualquer plano ativo da organização pode ser escolhido como override — **não precisa estar atribuído ao funcionário**. É o mesmo catálogo que já aparece em Financeiro > Comissões.
- O override resolve por **data de referência** igual a qualquer plano (`resolveEffectiveCommissionVersion`) — se o plano escolhido tiver uma nova versão publicada depois do override ter sido aplicado, a próxima liberação/recálculo já usa a versão vigente na data da OS, igual ao fluxo normal.

**Importante — o override é um *patch* por categoria, não uma substituição total.** Um plano de override raramente cobre todas as categorias que o(s) plano(s) padrão do funcionário cobrem. Exemplo real: o funcionário tem "Comissão mecânicos — padrão" com 9% em "cabeçote" e 20% em "motor"; o gestor aplica um override que só define 15% em "cabeçote" (motivo: fez esse item específico com mais cuidado). O esperado é que os itens de "cabeçote" nesta OS usem 15%, mas os itens de "motor" continuem em 20% — o override não disse nada sobre "motor", então não há o que sobrepor ali.

Se o override *substituísse* a lista de regras inteira (a implementação inicial deste plano fazia isso, foi corrigido antes de qualquer uso real), itens de "motor" ficariam sem nenhuma regra aplicável — comissão zerada silenciosamente, um resultado que ninguém pediu. A fonte "nesta OS, para este funcionário, use as regras vigentes do plano X" (linha acima) precisa ser lida como **"...para as categorias que o plano X cobre"**, não "em vez de qualquer regra do funcionário".

### 3.3 Novo helper server: resolução de regras por plano (sem depender de atribuição)

```ts
// server/utils/employee-commission-plans.ts (novo)

/**
 * Regras vigentes de UM plano específico, na data de referência — mesma
 * resolução por versão que resolveEmployeeCommissionRules() já faz por
 * funcionário, mas dado o plan_id diretamente, sem passar por
 * employee_commission_plan_assignments. É o que a comissão manual por OS
 * usa: o plano escolhido não precisa estar atribuído ao funcionário.
 */
export async function resolveCommissionPlanRules(
  supabase: SupabaseClient,
  organizationId: string,
  planId: string,
  referenceDate: string = currentCommissionMonthStart()
): Promise<ResolvedCommissionRule[]> {
  const plan = await fetchCommissionPlan(supabase, organizationId, planId)
  if (!plan || !plan.active) return []

  const versions = await fetchCommissionRuleVersions(supabase, planId)
  const effectiveVersion = resolveEffectiveCommissionVersion(versions, referenceDate)
  if (!effectiveVersion) return []

  const rules = await fetchCommissionRulesForVersion(supabase, effectiveVersion.id)
  return rules.map(rule => ({ ...rule, plan_id: planId }))
}
```

Monta em cima de funções que já existem no mesmo arquivo (`fetchCommissionPlan`, `fetchCommissionRuleVersions`, `fetchCommissionRulesForVersion`) — é literalmente o corpo do loop que `resolveEmployeeCommissionRules()` já faz por plano, só que chamado pra um `planId` direto em vez de vir de uma lista de atribuições.

### 3.4 Helpers puros no engine: `getActiveCommissionOverride` / `resolveEffectiveCommissionRules`

Como resolver um plano exige banco (`resolveCommissionPlanRules`, acima), a função pura em `lib/utils/employee-commission-engine.ts` não pode mais *calcular* o override sozinha (não como na v1 deste plano, que sintetizava uma regra sem I/O) — ela recebe as regras do(s) plano(s) de override **já resolvidas por fora** (pelo chamador, que tem acesso a banco/API) e só decide, por funcionário, se usa essas regras ou as normais:

```ts
// lib/utils/employee-commission-engine.ts (novo)

export type CommissionOverrideAction = 'apply' | 'remove'

export interface CommissionOverrideState {
  employeeId: string
  commissionPlanId: string
  /** Snapshot do nome do plano no momento em que o override foi aplicado — continua correto mesmo se o plano for renomeado/inativado depois. */
  commissionPlanName: string | null
}

/** Entrada do log de ajuste manual — ver §4 para o shape completo. */
export interface CommissionManualAdjustmentLogEntry {
  employee_id: string
  employee_name: string | null
  reason: string
  previous_amount: number
  new_amount: number
  recalculated_by_email: string | null
  recalculated_by_name: string | null
  recalculated_at: string
  override_action?: CommissionOverrideAction
  override_commission_plan_id?: string | null
  override_commission_plan_name?: string | null
}

/** Última entrada com override_action para o funcionário, ou null. */
export function getActiveCommissionOverride(
  log: CommissionManualAdjustmentLogEntry[],
  employeeId: string
): CommissionOverrideState | null { /* ... */ }

/** IDs distintos de plano referenciados por overrides ATIVOS no log — o que o chamador precisa resolver via resolveCommissionPlanRules() (server) ou buscar via GET /api/commissions/:id/rules (client) antes de chamar resolveEffectiveCommissionRules(). */
export function getActiveOverridePlanIds(log: CommissionManualAdjustmentLogEntry[]): string[] { /* ... */ }

/**
 * Por funcionário com override ativo: concatena [regras do plano de
 * override, ...regras do plano normal] — NÃO substitui. Isso já basta pra
 * dar a semântica de "patch por categoria" descrita em 3.2, de graça, por
 * causa de como getApplicableCommissionRule() resolve hoje: ela usa
 * rules.find(...), que devolve o primeiro elemento do array que bate —
 * então uma categoria que o override cobre encontra a regra do override
 * primeiro (está na frente), e uma categoria que o override NÃO cobre passa
 * direto pelas regras do override (nenhuma bate) e encontra a regra normal
 * mais adiante no mesmo array. O mesmo vale pra regra default: se o
 * override tiver uma default, ela vem antes e vence; se não tiver, o
 * find() continua e acha a default do plano normal, se houver. Zero mudança
 * em getApplicableCommissionRule()/computeEmployeeOrderCommission().
 * `planRulesByPlanId` precisa conter, no mínimo, as entradas de
 * getActiveOverridePlanIds(log) — pura: não busca nada, não muta os Maps
 * recebidos.
 */
export function resolveEffectiveCommissionRules(
  rulesByEmployeeId: Map<string, ResolvedCommissionRule[]>,
  log: CommissionManualAdjustmentLogEntry[],
  planRulesByPlanId: Map<string, ResolvedCommissionRule[]>
): Map<string, ResolvedCommissionRule[]> { /* ... */ }
```

Isso é chamado nos lugares que hoje recebem `rulesByEmployeeId` "cru": o motor server (`releaseServiceOrderCommissions`, `computeServiceOrderItemsWithCommissionSnapshots`) e o preview client (`computeServiceOrderCommissionBreakdown` em `app/utils/service-orders.ts`) — cada um resolve `planRulesByPlanId` do seu próprio jeito (server via `resolveCommissionPlanRules`, client via um fetch novo, §6.1) e passa pro helper puro decidir.

## 4. Modelo de dados

### 4.1 Sem migration de schema nova

`commission_manual_adjustments_log` já é `jsonb`. Os campos novos são opcionais e não exigem alteração de coluna. **Nenhuma migration de banco é necessária para este plano**, além de, opcionalmente, um `COMMENT ON COLUMN` atualizado.

### 4.2 Shape estendido da entrada de log

```ts
export type CommissionManualAdjustmentLogEntry = {
  employee_id: string
  employee_name: string | null
  reason: string
  previous_amount: number
  new_amount: number
  recalculated_by_email: string | null
  recalculated_by_name: string | null
  recalculated_at: string

  // Novos — presentes só quando esta entrada representa uma aplicação ou
  // remoção de comissão manual (não um "Recalcular" simples).
  override_action?: 'apply' | 'remove'
  /** ID do plano aplicado. null quando override_action = 'remove'. */
  override_commission_plan_id?: string | null
  /** Nome do plano no momento da aplicação (snapshot — sobrevive a rename/inativação do plano). null quando override_action = 'remove'. */
  override_commission_plan_name?: string | null
}
```

Três lugares (mesmo padrão já usado hoje entre server/app):
- `lib/utils/employee-commission-engine.ts` — definição canônica (novo, §3.4)
- `server/utils/service-order-commissions.ts` — `export type { CommissionManualAdjustmentLogEntry }` re-exportado de lib
- `app/types/service-orders.ts` — `ServiceOrderCommissionManualAdjustmentLogEntry` importado de lib

### 4.3 Exemplo de array após um ciclo completo

```json
[
  {
    "employee_id": "e1", "employee_name": "Anderson dos Santos",
    "reason": "Ficou até tarde neste serviço",
    "previous_amount": 20.40, "new_amount": 34.00,
    "recalculated_by_email": "gestor@oficina.com", "recalculated_by_name": "Gestor",
    "recalculated_at": "2026-09-05T22:10:00.000Z",
    "override_action": "apply",
    "override_commission_plan_id": "9f1c...",
    "override_commission_plan_name": "Comissão mecânicos — plantão"
  },
  {
    "employee_id": "e1", "employee_name": "Anderson dos Santos",
    "reason": "OS revisada, valor manual não se aplica mais",
    "previous_amount": 34.00, "new_amount": 20.40,
    "recalculated_by_email": "gestor@oficina.com", "recalculated_by_name": "Gestor",
    "recalculated_at": "2026-09-06T09:00:00.000Z",
    "override_action": "remove",
    "override_commission_plan_id": null,
    "override_commission_plan_name": null
  }
]
```

## 5. Backend

### 5.1 `resolveCommissionPlanRules` — novo, ver §3.3

### 5.2 `releaseServiceOrderCommissions` (`server/utils/service-order-commissions.ts`)

Novo parâmetro opcional, só usado junto com `employeeId` (mesma exigência de `reason` que já existe hoje):

```ts
overrideAction?: 'apply' | 'remove'
overrideCommissionPlanId?: string   // obrigatório se overrideAction = 'apply'
```

Fluxo (dentro da função, dado que `order` já foi carregado com `commission_manual_adjustments_log`):

1. Validar: se `overrideAction === 'apply'`, exigir `overrideCommissionPlanId` presente e que o plano exista/esteja ativo na organização (`fetchCommissionPlan`) — 404/400 descritivo se não. Se `overrideAction === 'remove'`, exigir que haja um override ativo pra remover (`getActiveCommissionOverride`) — senão 400.
2. Resolver `planRulesByPlanId`: quando `overrideAction === 'apply'`, `resolveCommissionPlanRules(supabase, organizationId, overrideCommissionPlanId, referenceDate)` pro plano recém-escolhido; junto com isso, resolver também os planos de quaisquer overrides **já ativos** de outros funcionários nesta mesma OS (`getActiveOverridePlanIds(existingLog)`), já que a liberação recalcula todo mundo, não só quem está sendo alterado agora.
3. `const effectiveRulesByEmployeeId = resolveEffectiveCommissionRules(rulesByEmployeeId, logEfetivo, planRulesByPlanId)` — substitui `rulesByEmployeeId` no resto da função (`computeEmployeeEntitlements` e `computeServiceOrderItemsWithCommissionSnapshots`). Pra `overrideAction === 'apply'` no funcionário desta chamada, o "log efetivo" usado pra resolução já precisa refletir a troca (mesma técnica da v1 deste plano: aplicar a troca no Map resultante diretamente pro `employeeId` desta chamada, sem esperar a entrada ser persistida).
4. Resto do fluxo já existente (guarda de comissão paga, `targetEntitlements`, criação/estorno de `employee_financial_records`) roda igual.
5. Ao montar a entrada final do log, incluir `override_action`/`override_commission_plan_id`/`override_commission_plan_name` (nome vem do `fetchCommissionPlan` já carregado no passo 1).

Continua verdade que **aplicar/remover override é um "Recalcular" com uma instrução extra** — reaproveita a guarda de comissão paga, a atualização do snapshot de itens e o fluxo de `employee_financial_records`.

### 5.3 Endpoint

`POST /api/service-orders/:id/generate-commissions` aceita, além de `employeeId`/`reason`:

```ts
{
  employeeId: string
  reason: string
  override?: {
    action: 'apply' | 'remove'
    commissionPlanId?: string   // obrigatório se action = 'apply'
  }
}
```

### 5.4 Novo endpoint: `GET /api/commissions/:id/rules`

```ts
// server/api/commissions/[id]/rules.get.ts (novo)
// GET /api/commissions/:id/rules?referenceDate=YYYY-MM-DD
// Espelha GET /api/employees/:id/commission-rules, mas pra um plano
// diretamente — usado pelo preview client do override (§6.1) pra saber,
// sem esperar uma liberação real, quais regras o plano escolhido tem.
```

Gated por `commissions.read` (mesma permissão de `GET /api/commissions`/`GET /api/commissions/:id` — quem pode ver o catálogo de planos pode ver as regras de um deles). Corpo: chama `resolveCommissionPlanRules` e devolve `{ items: ResolvedCommissionRule[] }`.

### 5.5 `computeServiceOrderItemsWithCommissionSnapshots` — sem mudança de assinatura

Já recebe `rulesByEmployeeId` de fora; quem muda é o que o chamador passa pra dentro (`effectiveRulesByEmployeeId`). `service_orders.items[].commissions[]` reflete o plano de override automaticamente.

## 6. Frontend

### 6.1 Novo composable: `usePlanCommissionRules`

Espelha `useEmployeeCommissionRules` (`app/composables/useEmployeeCommissionRules.ts`), mas por `planId` em vez de `employeeId`, batendo em `GET /api/commissions/:id/rules`:

```ts
// app/composables/usePlanCommissionRules.ts (novo)
export function usePlanCommissionRules() {
  const rulesByPlanId = ref(new Map<string, ResolvedCommissionRule[]>())
  // mesmo padrão de cache/pending de useEmployeeCommissionRules
  async function ensureRules(planIds: string[], referenceDate: string) { /* ... */ }
  return { rulesByPlanId, ensureRules }
}
```

### 6.2 `app/utils/service-orders.ts` — `computeServiceOrderCommissionBreakdown` ganha um parâmetro

Antes: `computeServiceOrderCommissionBreakdown(order, rulesByEmployeeId)`. Depois: `computeServiceOrderCommissionBreakdown(order, rulesByEmployeeId, planRulesByPlanId)` — resolve `resolveEffectiveCommissionRules(rulesByEmployeeId, order.commission_manual_adjustments_log ?? [], planRulesByPlanId)` antes do loop por responsável. `planRulesByPlanId` default pra `new Map()` quando o chamador não usa override (ex: preview de uma OS nova em `CreateModal.vue` sem edição — nunca vai ter override, mas ainda assim precisa alimentar o parâmetro; um Map vazio funciona igual a "sem override" mesmo que o log tenha entradas, já que `resolveEffectiveCommissionRules` simplesmente não encontra a entrada do plano e mantém as regras normais — **decisão a confirmar em 12.6**, ver alternativa de sempre exigir o Map).

Os 2-3 chamadores (`OSResponsiblesCard.vue`, `CreateModal.vue`, `computeServiceOrderResponsibleCommission`) passam a:
1. Coletar `getActiveOverridePlanIds(order.commission_manual_adjustments_log ?? [])`.
2. `usePlanCommissionRules().ensureRules(essesIds, referenceDate)`.
3. Passar `rulesByPlanId.value` como terceiro argumento.

### 6.3 `OSResponsiblesCard.vue` — UI nova

Junto ao badge "Comissão: R$ X", ao popover "Regras de comissão do funcionário" (mostra as regras EFETIVAS — as do override pras categorias que ele cobre, as do plano normal pras demais, ver §3.2) e ao botão "Recalcular", todos já existentes:

- **Badge extra "Comissão manual"** (cor `warning`, ícone `i-lucide-sparkles`) quando `getActiveCommissionOverride(order.commission_manual_adjustments_log, employee_id)` não é null. Tooltip mostra: nome do plano aplicado, o motivo, quem aplicou e quando.
- **Botão "Aplicar comissão diferente"** (ícone `i-lucide-sparkles`, `variant="soft"`) quando não há override ativo e `canUpdate && has_commission_plan` — abre modal com:
  - **Select de configuração de comissão** (`UiAsyncPaginatedSelect` ou `USelectMenu`, mesmo padrão de outros seletores do app) — opções vêm de `GET /api/commissions?activeOnly=true`, mostrando nome + resumo da versão vigente (nº de regras/categorias, igual à lista de Financeiro > Comissões) para o gestor identificar a configuração certa sem sair da tela.
  - Textarea motivo (obrigatório)
  - Mostra, para referência, a configuração atualmente atribuída ao funcionário (nome do(s) plano(s) já resolvido em `rulesByEmployeeId`) e o valor estimado hoje, igual ao modal de Recalcular
- **Quando há override ativo**, o botão vira dois: **"Trocar"** (mesmo modal, com o select pré-selecionado no plano ativo) e **"Remover"** (modal simples: motivo obrigatório + confirmação, chama `override: { action: 'remove' }`).
- Todos chamam o mesmo `POST .../generate-commissions` com `employeeId` + `reason` + `override`, reaproveitando o `toast`/loading state já existente do botão Recalcular.
- Botão "Recalcular" continua igual — com override ativo, recalcula usando o patch (regras do override + regras normais nas categorias que ele não cobre).

### 6.4 Tipos (`app/types/service-orders.ts`)

`ServiceOrderCommissionManualAdjustmentLogEntry` passa a importar o shape de `lib/utils/employee-commission-engine.ts` (já é assim desde a implementação do "Recalcular" — só os campos internos mudam, ver §4.2).

## 7. Regras de negócio / casos de borda

- **Comissão já paga**: mesma guarda que já existe para Recalcular bloqueia aplicar, trocar *e* remover override.
- **Plano de override inativo/excluído depois de aplicado**: `resolveCommissionPlanRules` devolve `[]` se o plano não estiver mais ativo — o funcionário passa a não ter regra aplicável (mesmo tratamento que "funcionário sem plano" no fluxo normal, ver §7 de `docs/finance/commissions-step8-engine-cutover.md`). O nome do plano continua visível no badge/log via o snapshot (`override_commission_plan_name`), então o gestor entende o que aconteceu mesmo com o plano já removido.
- **Plano de override é o mesmo já atribuído ao funcionário**: tecnicamente permitido (não há validação impedindo), mas não muda nada na prática — é um "override" que resolve pras mesmas regras. Não vale a pena bloquear isso explicitamente; o gestor só não teria motivo real pra fazer.
- **Funcionário sem plano nenhum atribuído** (`has_commission_plan = false`): fora de escopo por padrão — mesma decisão da v1 deste plano (ver 12.4).
- **Override cobre só parte das categorias do funcionário** (o caso comum — ver §3.2): categorias que o plano de override não menciona continuam usando a regra do plano padrão do funcionário, não ficam sem comissão. Só um item cai em "sem comissão" se **nem o override nem o plano padrão** tiverem uma regra (específica ou default) pra categoria dele.
- **Override não bate em nenhum item elegível** (nem override nem plano padrão cobrem nenhuma categoria dos itens desta OS): mesma mensagem de erro que "Recalcular" já usa hoje.
- **OS editada depois do override** (itens/desconto/impostos mudam): o override continua ativo e passa a valer sobre os itens novos automaticamente na próxima liberação. Não precisa reaplicar.
- **Nova versão do plano de override publicada depois de aplicado**: a próxima liberação/recálculo resolve a versão vigente na data da OS normalmente (§3.2) — não trava na versão que estava vigente no momento em que o override foi aplicado.
- **Múltiplos funcionários na mesma OS**: overrides são independentes por `employee_id`.
- **Trocar de plano sem remover antes**: "Aplicar"/"Trocar" com `override_action: 'apply'` de novo já substitui o ativo.

## 8. Permissões

Reaproveita `canUpdate` (mesma prop já usada pelo botão "Recalcular") — sem ação de permissão nova pra *aplicar* o override numa OS. O select de configurações usa `GET /api/commissions?activeOnly=true`, que já é gated por `commissions.read` — então, na prática, aplicar um override exige tanto `canUpdate` na OS quanto `commissions.read` (pra sequer listar as opções). Isso é uma restrição a mais que a v1 deste plano não tinha (que só dependia de `canUpdate`) — ver decisão 12.5.

## 9. Plano de implementação por passos

1. **`lib/utils/employee-commission-engine.ts`**: `CommissionOverrideAction`, `CommissionOverrideState`, `CommissionManualAdjustmentLogEntry`, `getActiveCommissionOverride`, `getActiveOverridePlanIds`, `resolveEffectiveCommissionRules` (com o novo parâmetro `planRulesByPlanId`).
2. **`server/utils/employee-commission-plans.ts`**: `resolveCommissionPlanRules` (§3.3).
3. **`server/utils/service-order-commissions.ts`**: parâmetros `overrideAction`/`overrideCommissionPlanId`; validação (plano existe/ativo; remove exige override ativo); resolução de `planRulesByPlanId` (plano novo + planos de overrides já ativos de outros funcionários); troca de `rulesByEmployeeId` por `effectiveRulesByEmployeeId`; campos `override_commission_plan_id`/`override_commission_plan_name` na entrada final do log.
4. **`server/api/service-orders/[id]/generate-commissions.post.ts`**: ler/repassar `override.commissionPlanId`.
5. **`server/api/commissions/[id]/rules.get.ts`**: novo endpoint (§5.4).
6. **`app/composables/usePlanCommissionRules.ts`**: novo composable (§6.1).
7. **`app/utils/service-orders.ts`**: `computeServiceOrderCommissionBreakdown` ganha o parâmetro `planRulesByPlanId`; atualizar os chamadores internos (`computeServiceOrderResponsibleCommission`).
8. **`app/types/service-orders.ts`**: `ServiceOrderCommissionManualAdjustmentLogEntry` passa a importar de lib com os campos novos.
9. **`OSResponsiblesCard.vue`** (e `CreateModal.vue`/`create/ResponsiblesCard.vue`, se também precisarem refletir override numa OS em edição): badge de override ativo, botões Aplicar/Trocar/Remover, modal com select de plano.
10. **Migration opcional** (só comentário): atualizar `COMMENT ON COLUMN service_orders.commission_manual_adjustments_log`.
11. Teste manual ponta a ponta (sem suíte automatizada no repo): aplicar plano A, ver refletido no badge/popover de regras/preview/relatório de itens, trocar pro plano B, remover, tentar aplicar/trocar/remover com comissão já paga (deve bloquear), aplicar um plano com múltiplas categorias e confirmar que cada item usa a regra certa da categoria certa. **Caso específico a confirmar** (é o que motivou a correção do "patch por categoria" em §3.2): funcionário com plano padrão cobrindo 2+ categorias (ex: 9% cabeçote, 20% motor); aplicar um override que só cobre 1 delas (ex: 15% cabeçote) — a categoria não coberta pelo override (motor) precisa continuar na taxa do plano padrão (20%), não ficar zerada.

## 10. Critério de pronto

- [ ] Aplicar uma configuração de comissão existente pra um funcionário numa OS funciona, exige motivo, e o valor liberado/exibido reflete as novas regras imediatamente — inclusive quando a configuração tem regras diferentes por categoria.
- [ ] O badge "Comissão manual" aparece com o nome do plano aplicado e o motivo visíveis (tooltip) enquanto o override está ativo.
- [ ] O popover "Regras de comissão do funcionário" mostra as regras EFETIVAS enquanto o override está ativo: as do plano de override pras categorias que ele cobre, as do plano padrão pras demais (patch, não substituição — ver §3.2).
- [ ] Override que cobre só parte das categorias do plano padrão do funcionário: categorias não cobertas pelo override continuam na taxa do plano padrão, não ficam com comissão zerada.
- [ ] Trocar o override (novo plano) e remover (volta pro plano padrão) funcionam, cada um exigindo motivo.
- [ ] `commission_manual_adjustments_log` guarda o histórico completo (aplicações e remoções), nunca sobrescreve entradas antigas.
- [ ] Tentar aplicar, trocar ou remover override quando o funcionário já tem comissão paga nessa OS é bloqueado com mensagem clara.
- [ ] `service_orders.items[].commissions[]` e os relatórios que dependem dele refletem as regras efetivas (patch) depois de uma liberação.
- [ ] Nenhuma mudança de comportamento para OS/funcionários sem override ativo (regressão zero no fluxo padrão e no "Recalcular" simples já existente).
- [ ] Editar uma OS que já tem override ativo (adicionar/remover item, mudar desconto) preserva o override no snapshot salvo — não precisa de "Recalcular" manual depois pra ele voltar a valer (ver §12.1).
- [ ] O total de comissão mostrado no card Financeiro da OS bate com o total mostrado no card Responsáveis quando há override ativo (ver §12.2).
- [ ] O popover "Regras de comissão do funcionário" aparece tanto no fluxo de criar/editar OS quanto no detalhe já salvo (ver §12.4) — não só num dos dois.

## 11. Impacto em relação à v1 deste plano (código já em implementação)

A primeira versão deste documento (override como tipo/valor/base digitado) já estava parcialmente implementada nesta sessão antes desta correção: `lib/utils/employee-commission-engine.ts` (`buildOverrideRule`, versão anterior de `resolveEffectiveCommissionRules`), `server/utils/service-order-commissions.ts`, `server/api/service-orders/[id]/generate-commissions.post.ts`, `app/utils/service-orders.ts`, `app/types/service-orders.ts`. Esse código precisa ser ajustado pro modelo de "selecionar um plano" descrito aqui — principalmente trocar `overrideCommissionType/Amount/Base` por `overrideCommissionPlanId` em todo lugar, e adicionar a resolução via `resolveCommissionPlanRules`/`GET /api/commissions/:id/rules`. A UI (`OSResponsiblesCard.vue`) ainda não tinha sido escrita quando esta correção chegou, então não precisa de rollback — só implementar já com o select de plano.

## 12. Revisão pós-implementação — pontas soltas encontradas e corrigidas

Depois da implementação inicial (patch por categoria incluído), uma revisão pediu explicitamente para achar bugs/pontas soltas em Comissões. Achados, todos corrigidos:

1. **`POST /api/service-orders` (criar/editar OS) ignorava override ativo.** `computeServiceOrderItemsWithCommissionSnapshots` era chamado ali com `rulesByEmployeeId` cru (só o plano padrão), não com as regras efetivas (patch). Consequência real: editar qualquer OS que já tivesse um override manual ativo (adicionar item, mudar desconto, etc.) recomputava `items[].commissions[]` e `commission_amount` **sem o override**, silenciosamente, até a próxima liberação de pagamento ou "Recalcular" corrigir de novo. Corrigido: o endpoint agora busca `existingOrder.commission_manual_adjustments_log`, resolve os planos de override ativos (`getActiveOverridePlanIds` + `resolveCommissionPlanRules`) e usa `resolveEffectiveCommissionRules()` antes de montar o snapshot — mesmo padrão já usado em `releaseServiceOrderCommissions()`.
2. **`Modal.vue` (detalhe da OS) tinha um segundo cálculo de comissão que não sabia de override.** O total mostrado no card Financeiro (`estimatedCommissionAmount`, via `ServiceOrdersDetailOSFinancialCard`) vinha de uma chamada separada a `computeServiceOrderCommissionBreakdown` sem `planRulesByPlanId` — podia divergir do total mostrado em `OSResponsiblesCard.vue` (que já considerava o override) **na mesma página**. Corrigido: `Modal.vue` agora também usa `usePlanCommissionRules()`.
3. **`CreateModal.vue` (criar/editar OS) tinha o mesmo problema no preview ao vivo**, e além disso o objeto sintético `commissionOrderInput` nem carregava `commission_manual_adjustments_log` da OS sendo editada — o preview não tinha como saber que um override existia. Corrigido: `commissionOrderInput` agora inclui o log da OS em edição, e o componente resolve `planRulesByPlanId` do mesmo jeito.
4. **O popover "Regras de comissão do funcionário" nunca foi adicionado no fluxo de criação/edição** (`create/ResponsiblesCard.vue`) — só existia em `OSResponsiblesCard.vue` (detalhe). `EmployeeCommissionDisplay` ganhou um campo `rules` (regras efetivas, patch incluído) e o componente ganhou o mesmo popover, com `categoryNameById` buscado em `loadOptions()` (mesmo padrão dos outros catálogos do modal).
5. **Comentário da migration `20240101000093` ainda descrevia o shape antigo** (`override_commission_type/amount/base`, sem menção ao patch por categoria) — desatualizado desde a correção do design pra "selecionar um plano". Atualizado pra refletir `override_commission_plan_id/name` e a semântica de patch.

Nenhum desses exigiu mudança de schema — todos foram ajustes de "quem chama o quê com quais dados".

## 13. Decisões que precisam confirmação antes de implementar

1. **Reaproveitar `commission_manual_adjustments_log` vs. criar uma coluna/tabela dedicada** (§3.1): recomendo reaproveitar. Mantido da v1.
2. **`overrideAction: 'remove'` sem override ativo**: recomendo erro 400 (evita clique duplo confuso). Mantido da v1.
3. ~~Renomear a coluna/tipo~~ — **decidido**: `commission_manual_adjustments_log`. Mantido da v1.
4. **Override pra funcionário sem plano nenhum** (`has_commission_plan = false`): fora de escopo por padrão — confirmar, ou é caso real a suportar? Mantido da v1.
5. **Exigir `commissions.read` pra aplicar override** (§8): consequência direta de usar `GET /api/commissions` como fonte do seletor — confirmar que isso é aceitável (ex: um encarregado com `canUpdate` em OS mas sem `commissions.read` não conseguiria aplicar override, só recalcular). Se não for aceitável, a alternativa é um endpoint de listagem próprio pro seletor, sem gate de `commissions.read` (mesmo raciocínio de `GET /api/employees/:id/commission-rules`, que deliberadamente não é gated — ver comentário nesse arquivo).
6. **`planRulesByPlanId` ausente/vazio no client quando não há override**: confirmar que um `Map` vazio é aceitável como default nos chamadores que nunca lidam com override (ex: preview de OS nova), em vez de tornar o parâmetro obrigatório em todo lugar só por consistência.
7. **Permissão dedicada** (`commissions.override`) separada de `canUpdate` da OS: fora de escopo agora — confirmar. Mantido da v1.
