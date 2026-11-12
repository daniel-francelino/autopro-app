# Organização de tipos TypeScript

Status: análise (nenhum arquivo de código foi alterado). Data: 2026-11-12. Branch: dev.
Método: contagens por `grep`/`find` (regex `^export (interface|type|enum)` e `^\s*(interface|type) [A-Z]`). Contagens são aproximadas (não pegam `export type { }` nem tipos multilinha atípicos). Itens marcados **[Hipótese]** não foram verificados.
Atualizado em 2026-11-12 (ver seção 8): baseline do typecheck medido (444 erros em 66 arquivos); pareceres de arquitetura, auditoria financeira e de reports incorporados. Pendente: como o Nuxt trata `app/types/*.ts` (não-`.d.ts`) em auto-import (todos os imports existentes são explícitos via `~/types/...`); exige `nuxt prepare`.

## 1. Inventário (verificado)

### Arquivos de tipos dedicados
| Local | Arquivos | Tipos exportados |
|---|---|---|
| `app/types/` | 20 na medição original; **14 hoje** (6 removidos no commit `8d26958`: goals, habits, ideas, journal, knowledge, tasks) | ~280 na medição original (habits 43, financial 27, tasks 18, appointments 17, feedback 16, knowledge 16, goals/ideas/journal/life-os 15 cada, service-orders 12, index.d.ts 11, notifications 9, onboarding 8, workshop 5, nfse/products/guided-tour 4, clients 2, organization 1). Os números dos módulos removidos não se aplicam mais. |
| `server/types/` | 3 | 48 (fiscal.ts 23, focus-nfe.ts 24, audit.d.ts 1) |
| `lib/` (compartilhado app+server) | 5 arquivos com tipos | 28 |

### Tipos fora das pastas de tipos
| Área | Arquivos | Tipos exportados | Tipos locais (não exportados) |
|---|---|---|---|
| `app/pages` | 50 | - | 204 |
| `app/components` | 14 exportam / 62 têm locais | 22 | 147 |
| `app/composables` | 7 | 15 | - |
| `app/utils` | 4 | 8 | - |
| `app/constants` | 1 | 1 | - |
| `server/api` | 41 com locais / 1 exporta | 2 | 108 |
| `server/utils` | 24 exportam / 38 têm declarações | 61 | 100 (incl. exportados) |

Leitura: ~460 declarações locais em pages/components/server-api contra ~330 em pastas de tipos. A maior parte dos tipos do projeto não está em pasta de tipos.

### Convenções existentes (verificado)
- Imports sempre explícitos: `from '~/types/<arquivo>'` (service-orders 22 usos, feedback 11, nfse 7, life-os 7, products 6, financial 6, appointments 6, clients 4...). Não há dependência de auto-import para tipos.
- Server não importa de `app/types` (0 ocorrências de `~/types` em server para contagem de arquivos relevante; `app` não importa de `server/`: 0). O compartilhamento app<->server acontece via `lib/` (ex.: `app/utils/service-orders.ts:1-8` importa `ResolvedCommissionRule` de `lib/utils/employee-commission-engine`).
- `app/types/` já é organizado por domínio (um arquivo por contexto). Isso é a estrutura que o usuário propôs; ela já existe para ~20 domínios.

## 2. Problemas

### Alta
1. **Duplicação massiva de "Record" shapes em reports no server.** `EmployeeRecord` declarado 7x (`server/api/reports/commissions.get.ts:8`, `export-commissions.post.ts:9`, `export-sales-items.post.ts:45`, `sales-items.get.ts:24`, `server/utils/employee-commission-report.ts:5`, `server/utils/employee-report.ts:26`, `app/pages/app/reports/employees.vue:2`); `ClientRecord` 7x (ex.: `debtors.get.ts:38`, `sales-items.get.ts:19`, `employee-report.ts:21`); `ServiceOrderRecord` 6x (`commissions.get.ts:13`, `debtors.get.ts:9`, `sales-items.get.ts:63`, `employee-report.ts:53`...). Risco: cada cópia descreve colunas diferentes do mesmo `select`, derivam silenciosamente quando o schema muda. **[Hipótese]** parte das divergências são intencionais (cada query seleciona colunas distintas); precisa comparar campo a campo antes de unificar.
2. **Nenhum tipo gerado do Supabase.** `grep "Database"` em app/server não retorna nada; todos os `*Record` são escritos à mão e não são verificados contra o schema. Raiz da duplicação acima. (Verificado: sem uso de `Database`; **[Hipótese]** não existe `database.types.ts` gerado no repo.)

### Média
3. **`BankAccountItem` declarado 8x**, `PaymentMethod` 4x (idênticos, union literal em `OSInstallmentsCard.vue:5`, `DownPaymentModal.vue:4`, `ExtraPaymentModal.vue:4`, `PaymentModal.vue:4`), `BankAccountItem` em `FormModal.vue:6`, `FullscreenModal.vue:24`, `OSInstallmentsCard.vue:6`, `DownPaymentModal.vue:6`, `ExtraPaymentModal.vue:6`, `PaymentModal.vue:6`, `pages/app/financial/index.vue:31`, `pages/app/reports/commissions.vue:26`. Pertencem a `app/types/financial.ts`.
4. **`BadgeColor` 14x e `ViewMode` 13x** locais em componentes/páginas (ex.: `components/financial/entries/DetailSlideover.vue:112` vs `FullscreenModal.vue:4` com conjuntos de valores diferentes; `ViewMode = 'table'|'card'` em 6+ páginas, mas `EmployeesAccordionPanel.vue:11` é outro conceito com o mesmo nome). Divergência real: mesmo nome, uniões distintas. O tipo correto de BadgeColor provavelmente vem do Nuxt UI **[Hipótese]**.
5. **Mesmo conceito em arquivos diferentes**: `ServiceOrder` em `app/types/service-orders.ts:3` e redefinido em `app/pages/app/vehicles.vue:21`; `ServiceOrderItem` 3x; `Vehicle` 3x, `VehicleRecord` 2x; `EmployeeOption`/`EmployeeNameRecord`/`ResponsibleEmployee`/`EmployeeFinancialRecord` (4-5 cópias cada).
6. **Sobras do template Nuxt UI Dashboard em `app/types/index.d.ts`**: `BlogPost`, `Sale`, `Stat`, `Member` sem nenhum uso fora de `app/types` (0 arquivos); `Mail` com 2 usos; `Notification` (`index.d.ts:62`) conflita por nome com o domínio notificações (`app/types/notifications.ts`). Código morto/ambíguo.
7. **Tipos de API response definidos dentro do handler** (`server/api` 108 locais; `server/utils` 61 exportados) e reimplementados na página consumidora, sem fonte única (contrato client/server implícito). Ex.: reports (pages/app/reports/* vs server/api/reports/*).

### Baixa
8. `app/types/workshop.ts` mistura permissões (`PermissionMap`, `WorkshopAction`, `WorkshopRoleAction`) e bootstrap; `RoleAction` está declarado 3x. Nome do arquivo não reflete o conteúdo.
9. `server/types/fiscal.ts` (402 linhas) e `focus-nfe.ts` (402 linhas) são grandes, mas coesos; `app/types/nfse.ts` (4 tipos) espelha parte do fiscal sem referência cruzada **[Hipótese]**.
10. Inconsistência `type` vs `interface` e `.d.ts` (`index.d.ts`, `audit.d.ts`) vs `.ts` sem regra.
11. 7 arquivos com `Schema` local (provavelmente Zod/validação; legítimo, não migrar).

## 3. Duplicações resumidas (top por contagem de declarações)
BadgeColor 14, ViewMode 13, BankAccountItem 8, EmployeeRecord 7, ClientRecord 7, ServiceOrderRecord 6, ResolvedCommissionRule 6 (na verdade 1 definição + 5 imports; falso positivo), EvolutionPoint 5, EmployeeFinancialRecord 5, PaymentMethod 4, MasterProductItem 4, PaymentTerminalItem 4, ResponsibleEmployee 4. Obs.: a contagem de nomes repetidos inclui re-imports multilinha (`type X` dentro de `import {}`) em alguns casos; os pontos acima foram confirmados caminho a caminho.

## 4. Opções de arquitetura

### A. Pasta única centralizada `types/` por domínio (hipótese do usuário)
Mover tudo (app + server) para um só diretório.
- Prós: um lugar para procurar; nomes de domínio alinhados.
- Contras: app e server têm runtime e bundles distintos; centralizar mistura tipos de servidor (fiscal, Focus NFe, linhas do DB) no bundle/IntelliSense do client; tipos de componentes (props locais) perdem coesão; migração enorme (~460 declarações locais). Não há evidência de que a falta de pasta única cause os problemas: o problema real é duplicação, não localização.

### B. Domínio por camada, extraindo só o que é compartilhado (recomendada)
Manter o padrão já existente (`app/types/<domínio>.ts`, `server/types/<domínio>.ts`, `lib/` para app+server). Extrair apenas tipos duplicados ou usados em mais de um arquivo; manter props/tipos de uso único locais ao componente (colocation).
- Prós: segue convenção atual (22 imports `~/types/service-orders` etc.); migração incremental, baixo risco; não cria padrão novo.
- Contras: exige regra clara ("2+ usos => sobe para types/") e revisão em PR.

### C. Tipos derivados do schema (gerar `database.types.ts` com `supabase gen types`) + Option B
Gerar tipos do banco, e derivar `Pick<Tables<'service_orders'>, ...>` nos reports.
- Prós: elimina a causa raiz das duplicações de `*Record`; detecta drift de schema.
- Contras: introduz geração/CI, maior esforço, tipos de joins do PostgREST ainda precisam de composição manual. Requer decisão do time (nova dependência de processo).

### Recomendação: B agora, C como fase opcional depois
Justificativa: a hipótese do usuário (arquivos por domínio) já é a estrutura de `app/types`; o ganho vem de consolidar duplicados (BankAccountItem 8x, EmployeeRecord 7x, etc.), não de mover tudo para uma única pasta. Uma pasta única não resolveria duplicação e aumentaria o risco.

Estrutura proposta (somente adições e fusões; nenhuma renomeação em massa):
```
app/types/
  financial.ts        (+ BankAccountItem, PaymentMethod, PaymentTerminalItem)
  service-orders.ts   (+ ServiceOrder único, ServiceOrderItem, ClientRecord mínimo)
  reports.ts          (NOVO: EmployeeRecord, EvolutionPoint, respostas das páginas de reports)
  ui.ts               (NOVO, pequeno: ViewMode ('table'|'card'); BadgeColor só se não vier do Nuxt UI)
  permissions.ts      (renomear workshop.ts depois; baixo prioridade)
  index.d.ts          (remover sobras do template apenas após confirmar 0 usos)
server/types/
  reports.ts          (NOVO: *Record compartilhados por server/api/reports e server/utils/*-report)
  fiscal.ts, focus-nfe.ts, audit.d.ts (inalterados)
lib/                  (tipos usados por app E server, como já ocorre com employee-commission-engine)
```
Regra: tipo usado em 1 arquivo fica no arquivo; em 2+ do mesmo lado vai para `<lado>/types/<domínio>.ts`; em app e server vai para `lib/`.

## 5. Plano de migração incremental
Validação em todas as fases: `pnpm typecheck` antes e depois, salvando a saída; comparar **contagem de erros por arquivo** (baseline medido em 2026-11-12: **444 erros em 66 arquivos**, ver `docs/engineering/types-typecheck-baseline.md`; não precisa zerar, apenas não aumentar em nenhum arquivo e não criar erros novos). O doc anterior citava ~548, valor incorreto. `pnpm exec eslint <arquivos tocados>`. Rodar testes focados dos módulos tocados.

| Fase | Escopo | Risco | Validação extra |
|---|---|---|---|
| 0 | Salvar baseline do typecheck por arquivo (em `docs/engineering/`, conforme preferência do repo) | Nenhum | - |
| 1 | Remover sobras mortas de `app/types/index.d.ts` (Sale, Stat, Member, BlogPost; revisar Mail/Notification) | Baixo | grep de 0 usos + typecheck |
| 2 | `ViewMode`, `BadgeColor` e `PaymentMethod` idênticos: mover para `app/types/ui.ts` / `financial.ts` (apenas onde o conjunto de valores é idêntico; manter os divergentes locais) | Baixo | typecheck por arquivo |
| 3 | `BankAccountItem` (8 cópias): comparar campos, unificar em `financial.ts` (superconjunto com campos opcionais se divergirem) | Médio (campos obrigatórios podem gerar novos erros) | typecheck + testes de modais de pagamento |
| 4 | `ServiceOrder`, `Vehicle`, `Employee*` duplicados em pages/components: apontar para `app/types/service-orders.ts` | Médio | typecheck |
| 5 | Reports no server: criar `server/types/reports.ts` com `EmployeeRecord`/`ClientRecord`/`ServiceOrderRecord`; usar `Pick`/`Omit` onde os selects diferem | Alto (SQL/select e comissões são financeiros; divergência pode esconder bug) | testes de reports/commissions, comparação de resposta JSON antes/depois, revisão independente |
| 6 (opcional) | Gerar tipos Supabase (Option C) | Alto (processo novo) | decisão do time |

Cada fase deve ser um commit/PR independente e reversível.

## 6. O que NÃO mudar
- Contratos de API (formato de request/response dos handlers em `server/api`): extrair tipo não deve alterar o JSON.
- Tipos gerados ou de terceiros (Supabase, Nuxt UI, `ParsedContent`); `server/types/focus-nfe.ts` e `fiscal.ts` (coesos, ligados à integração fiscal).
- Regras de comissão e cálculos financeiros em `lib/utils/employee-commission-engine` (apenas importar, não mover).
- Tipos de uso único (props, estados locais): manter no componente; os 7 `Schema` locais.
- Imports explícitos `~/types/...` (convenção atual); não depender de auto-import para tipos.
- Não mover para pasta única centralizada nem renomear em massa durante outros trabalhos em andamento em `app/types/`, `server/api/` e `app/pages/`.

## 7. Tipos sem uso

Somente análise; nada foi removido. Data: 2026-11-12.

### 7.1 Método (verificado)
- Script Node descartável (fora do repo) que varre 721 arquivos `.ts/.vue/.mjs/.js/.cjs` em `app/`, `server/`, `lib/`, `tests/` e `scripts/` (`shared/` não existe). `.nuxt/` e `node_modules/` excluídos.
- Declarações: linhas `^export (interface|type|enum) Nome` em `app/`, `server/`, `lib/` (tests/scripts só contam como referências).
- Referência = ocorrência do identificador com word boundary em qualquer linha, fora da linha de declaração, com comentários removidos. Conta import, uso no mesmo arquivo e re-export. A busca é por nome: um mesmo nome declarado em outro lugar mascara (falso "usado"), então a lista de candidatos pode estar subestimada, não superestimada.
- "Cadeia morta": tipo cujas únicas referências estão dentro da declaração de um tipo sem uso (ou de outro tipo da cadeia) no mesmo arquivo; iterado até estabilizar. Aproximação por faixa de linhas (da declaração até a próxima `export`).
- Confirmação manual por grep direto de 8 amostras (CreateTaskPayload, FocusNfeCepQuery, EventOccurrence, HeatmapData, NotificationChannel, GuidedTourKey, CategoryIconValue, TodayAppointment): todas com 1 única ocorrência (a declaração).
- Não rodado: `pnpm typecheck`/ESLint. Não verificado: uso em `.nuxt/`, `supabase/functions`, `content/` e `docs/`, nem nomes montados por string em runtime.

### 7.2 Contagem
| Item | Qtde |
|---|---|
| Tipos exportados analisados | 435 (app/types 257, server/types 48, lib 24, server/utils 58, app/components 22, app/composables 15, app/utils 8, app/constants 1, server/api 2) |
| Sem referência alguma (0 fora da declaração) | 106 |
| Cadeia morta (só referenciados por tipos sem uso) | 40 |
| Total sem uso (direto + cadeia) | 146 |
| Destes, "verificar" | 11 (9 diretos + 2 em cadeia) |
| Candidatos limpos (passaram no grep completo, sem ressalva) | 135 (97 diretos + 38 em cadeia) |

Quase tudo concentra-se em `app/types` (inclui 7 de `index.d.ts` em "verificar") e 1 em `server/types/focus-nfe.ts`. `lib/`, `server/types/fiscal.ts` e `app/types/{clients,nfse,organization,products,service-orders,workshop}.ts` têm 0 sem uso. Em `server/utils`: 1 (verificar); `server/api`: 2 (verificar); components/composables: 0.

> **Removidos:** `app/types/{habits,goals,ideas,journal,knowledge,tasks}.ts` foram removidos por pertencerem ao módulo Kortex (confirmado pelo usuário). Commit `8d26958`. Os itens desses arquivos nas seções 7.3 e 7.4 estão obsoletos; a lista vale só para os arquivos que ainda existem.

Sinal estrutural (verificado por grep): `app/types/{habits,goals,ideas,journal,knowledge,tasks}.ts` têm 0 arquivos importando (`from '~/types/<nome>'`), e `guided-tour.ts`, `knowledge.ts`, `onboarding.ts` não têm nenhum tipo referenciado fora do próprio arquivo. **[Hipótese]** são módulos "Life OS" cujo front/API usa tipos locais ou foi removido; confirmar com o dono do produto antes de remover (ver 7.5).

### 7.3 Candidatos a remoção (passaram no grep completo)
Evidência: "0 referências fora da declaração" (Grupo A) ou "referenciado só na linha N, dentro de tipo sem uso" (Grupo B, `<- N`).

**Grupo A: Payload/Response/Insights/Entidades sem nenhuma referência (risco ALTO, ver 7.5)**
- `app/types/appointments.ts`: 109 CreateCalendarPayload, 116 UpdateCalendarPayload, 123 CreateEventPayload, 136 UpdateEventPayload, 153 CancelOccurrencePayload, 159 EventsListResponse, 90 EventOccurrence, 20 RecurrenceFrequency
- `app/types/feedback.ts`: 81 UpdateFeedbackPayload, 86 AdminUpdateFeedbackPayload, 108 FeedbackInsights
- `app/types/financial.ts`: 106 CreateCategoryPayload, 113 UpdateCategoryPayload, 119 CreateIncomePayload, 129 UpdateIncomePayload, 139 CreateExpensePayload, 148 UpdateExpensePayload, 157 CreateDebtPayload, 163 UpdateDebtPayload, 169 CreateInstallmentPayload, 174 CreateAssetPayload, 180 UpdateAssetPayload, 188 FinancialListResponse, 195 FinancialDashboard, 68 Debt, 94 Asset
- `app/types/goals.ts`: 70 CreateGoalPayload, 77 UpdateGoalPayload, 85 CreateGoalTaskPayload, 90 UpdateGoalTaskPayload, 96 LinkHabitPayload, 102 GoalListResponse, 109 GoalProgressResponse, 115 GoalInsights
- `app/types/guided-tour.ts`: 1 GuidedTourKey, 14 GuidedToursResponse
- `app/types/habits.ts`: 73 CreateHabitTagPayload, 245 CreateHabitPayload, 264 UpdateHabitPayload, 284 LogHabitPayload, 292 CreateIdentityPayload, 297 UpdateIdentityPayload, 302 CreateReflectionPayload, 308 CreateHabitStackPayload, 324 UpdateHabitUserSettingsPayload, 359 HabitListResponse, 385 TodayHabitsResponse, 392 HabitInsights, 426 HeatmapData, 408 CalendarDay, 331 SharedHabitsProgress, 338 SharedHabitCardData, 313 HabitUserSettings, 117 HabitChangeHistory, 152 HabitSettings, 185 HabitVersion, 233 HabitReflection
- `app/types/ideas.ts`: 89 CreateIdeaPayload, 99 UpdateIdeaPayload, 109 CreateIdeaListPayload, 114 UpdateIdeaListPayload, 129 CreateIdeaTagPayload, 135 IdeaListResponse, 142 IdeaDetail
- `app/types/journal.ts`: 69 UpsertEntryPayload, 76 CreateJournalTagPayload, 80 CreateMetricDefinitionPayload, 92 UpdateMetricDefinitionPayload, 110 UpsertMetricValuesPayload, 117 JournalListResponse, 133 JournalInsights
- `app/types/knowledge.ts`: 85 CreateNotePayload, 92 UpdateNotePayload, 100 CreateTagPayload, 105 UpdateTagPayload, 110 LinkNotesPayload, 116 NoteListResponse, 123 NoteDetail, 129 NoteSearchResult, 78 GraphData, 56 NoteTagLink
- `app/types/life-os.ts`: 82 DailyDashboardResponse, 138 CreateLifeAreaPayload, 142 UpdateLifeAreaPayload, 148 LifeAreaListResponse, 153 EntityLinkListResponse
- `app/types/notifications.ts`: 8 NotificationChannel
- `app/types/onboarding.ts`: 53 OnboardingResponse
- `app/types/tasks.ts`: 66 CreateTaskPayload, 74 UpdateTaskPayload, 92 CreateTaskListPayload, 97 UpdateTaskListPayload, 102 CreateTaskTagPayload, 108 TaskListResponse, 115 TaskInsights, 59 TaskTagLink
- `server/types/focus-nfe.ts`: 223 FocusNfeCepQuery (dado de API externa; risco ALTO mesmo sem uso)

**Grupo B: cadeia morta (modelos só usados por tipos do Grupo A; risco MÉDIO; só remover depois do Grupo A)**
- `appointments.ts`: 40 CalendarEvent (<- 160), 64 EventException (<- 58), 78 EventReminder (<- 57), 148 ReminderInput (<- 133), 9 ExceptionType (<- 67), 14 ReminderType (<- 82,149)
- `financial.ts`: 84 DebtInstallment (<- 79), 207 CategorySummary (<- 202), 214 RecentTransaction (<- 203), 223 MonthlyComparison (<- 204)
- `goals.ts`: 124 GoalCategoryStat (<- 120,121)
- `guided-tour.ts`: 12 GuidedTourRegistry (<- 15), 7 GuidedTourEntry (<- 12)
- `habits.ts`: 127 HabitCue (<- 157), 140 HabitReward (<- 158), 161 HabitStack (<- 387), 400 IdentityProgress (<- 397), 414 HeatmapDay (<- 427), 421 WeeklyRate (<- 428), 30 CueType (<- 130), 37 RewardType (<- 143)
- `journal.ts`: 102 MetricValueInput (<- 112), 124 JournalInsightMetric (<- 136)
- `knowledge.ts`: 46 NoteLink (<- 125,126), 63 GraphNode (<- 79), 72 GraphEdge (<- 80), 31 KnowledgeNote (<- 52,53,117,123), 23 KnowledgeTag (<- 41,124)
- `life-os.ts`: 31 EntityLink (<- 154)
- `onboarding.ts`: 45 OnboardingState (<- 54), 33 OnboardingStep, 34 OnboardingStatus, 39 OnboardingProfile, 35 OnboardingPrimaryGoal, 36 OnboardingExperienceLevel, 37 OnboardingGuidanceStyle (referenciados só nas linhas 40-54, dentro de OnboardingState/OnboardingProfile)
- `tasks.ts`: 126 TaskPriorityStat (<- 122), 133 TaskListStat (<- 123)

Cadeias principais: `OnboardingResponse -> OnboardingState -> OnboardingProfile/Step/Status/...`; `EventsListResponse -> CalendarEvent -> EventException/EventReminder -> ExceptionType/ReminderType`; `NoteDetail/NoteListResponse -> KnowledgeNote -> KnowledgeTag/NoteLink`; `GuidedToursResponse -> GuidedTourRegistry -> GuidedTourEntry`; `TodayHabitsResponse -> HabitStack -> HabitCue/HabitReward -> CueType/RewardType`.

### 7.4 "Verificar" (sem referência no grep, mas há dúvida; NÃO recomendado remover)
| Local | Tipo | Motivo da dúvida |
|---|---|---|
| `app/types/index.d.ts:8,39,46,54,70,72` | BlogPost, Member, Stat, Sale, Period, Range | Arquivo `.d.ts` do template; pode ser tratado como ambient/global; confirmar com `pnpm typecheck` antes/depois (fase 1 da seção 5) |
| `app/types/index.d.ts:6` | SaleStatus (cadeia, só usado por `Sale`, linha 57) | Idem; só morre se `Sale` sair |
| `app/utils/financial-category-options.ts:47` | CategoryIconValue | Diretório com auto-import Nuxt; confirmar em `.nuxt/imports.d.ts` após `nuxt prepare` |
| `server/utils/service-order-item-commissions.ts:7` | ServiceOrderCommissionEmployee | Auto-import Nitro; área de comissão (financeiro), mais cautela |
| `server/api/reports/dashboard-stats.get.ts:21` | TodayAppointment | Exportado de handler de API: pode ser contrato consumido pelo front via tipo inferido |
| `server/api/reports/dashboard-stats.get.ts:10` | RecentOrder (cadeia, usado só na linha 125) | Idem; parte da forma da resposta do endpoint |

### 7.5 Severidade/risco de remover
| Grupo | Risco | Justificativa |
|---|---|---|
| `index.d.ts` (template, verificar) | Baixo | Sem uso por nome, mas `.d.ts` exige checagem de typecheck |
| Grupo B (entidades em cadeia) | Médio | Só saem depois do Grupo A |
| Grupo A (Payload/Response de API) | Alto | Descrevem contratos de endpoints; podem ser a única documentação do contrato; podem ser usados por código em edição por outros agentes (`app/pages/`, `server/api/`) |
| `FocusNfeCepQuery` e qualquer tipo de `focus-nfe.ts`/`fiscal.ts` | Alto | Dado de integração externa (fiscal) |
| `server/utils` de comissões/financeiro | Alto | Sem candidatos limpos; só 1 em verificar |

Recomendações (apenas o que passou no grep completo): (1) não remover nada sem confirmar se o módulo Life OS (habits, goals, ideas, journal, knowledge, tasks, appointments, guided-tour, onboarding) está ativo ou descartado; se descartado, remover o arquivo inteiro é mais simples e seguro que tipo a tipo; (2) se ativo, preferir passar a usar esses tipos nas páginas/handlers em vez de apagar; (3) refazer a varredura imediatamente antes de remover, pois há outros agentes editando `app/types/`, `server/api/` e `app/pages/`; (4) validar com `pnpm typecheck` comparando contagem por arquivo e `pnpm exec eslint` nos arquivos tocados.

## 8. Consolidação dos pareceres (2026-11-12)

Fontes (análise estática, sem alteração de código de produção): arquitetura (`software-architect`), auditoria financeira (`financial-auditor`), auditoria de records de reports (`reporting-analyst`) e baseline do typecheck (`developer`). Os IDs de agentes foram trocados na entrega; o conteúdo foi conferido pelo papel de cada relatório.

### 8.1 Arquitetura: aprovar B com ajustes
- **Opção B aprovada**, mantendo `app/types/<domínio>.ts`, `server/types/<domínio>.ts` e `lib/`. A convenção atual já usa `~/types/<arquivo>` (ex.: `service-orders` 22 usos). `server/types/` é importado por caminho relativo, não por alias.
- **Opções A e C rejeitadas como base.** A (pasta única) misturaria contextos de compilação separados (`.nuxt/` tem tsconfigs de app, server, node e shared). C (`Database` ausente) é viável via `supabase/config.toml`, mas não substitui B porque joins do PostgREST continuam manuais.
- **Ajuste 1 (obrigatório):** a regra "2+ usos => sobe para types/" passa a ser **"mesmo conceito E mesmo shape"**. Nomes iguais não bastam: `ViewMode` e `BadgeColor` são exemplos. Para `*Record` de reports, onde o select diverge de propósito, usar `Pick`/`Omit`, não superconjunto.
- **Ajuste 2 (obrigatório):** definir a regra de import de `server/types` (alias ou relativo) antes da fase 5, para não espalhar `../../../../`.
- **Ajuste 3 (obrigatório):** fase 5 bloqueada até comparação do JSON antes/depois e revisão independente.
- **Riscos não cobertos (hipótese, não verificada):** (a) `lib/` não pode importar de `app/` nem de `server/`, para evitar acoplamento bidirecional; (b) `server/types/reports.ts` não deve ser importado pelas páginas. Para o contrato client/server, escolher `lib/` ou inferência de `$fetch` e documentar; (c) Payload/Response da seção 7 podem ser o único contrato documentado da API, então não remover sem decidir se passam a ser usados.

### 8.2 Auditoria financeira: fases 2 e 3
- **Fase 2 (`PaymentMethod`): aprovada.** As 4 cópias são idênticas, com 7 literais (`pix | cash | credit_card | debit_card | bank_slip | transfer | check`) em `app/components/service-orders/PaymentModal.vue:4`, `DownPaymentModal.vue:4`, `ExtraPaymentModal.vue:4` e `detail/OSInstallmentsCard.vue:5`.
- **Fase 3 (`BankAccountItem`): aprovada com condições.** Nenhuma divergência altera valor, arredondamento, estado de pagamento ou comissão; são só de tipo. Superconjunto recomendado: `{ id: string; account_name: string; bank_name?: string | null; preferred_payment_method?: string | null }`. `commissions.vue` e `CommissionsBulkPayModal` podem usar `Pick`/`Partial`.
- **Condição crítica:** `preferred_payment_method` **não** pode virar `PaymentMethod`. É texto livre (placeholder "Ex: PIX, TED" em `financial/accounts/FormModal.vue:150`); valores fora dos aliases viram `null` em `normalizePaymentMethod`. Tipar como union faria o tipo mentir e incentivaria remover o normalizador como "redundante". Validar o pré-preenchimento em `PaymentModal`, `DownPaymentModal` e `ExtraPaymentModal` após a mudança.
- Já existe `BankAccount` em `app/types/financial.ts:230-243` (campos opcionais, `[key: string]: unknown`). Avaliar reutilizá-lo antes de criar outro.

### 8.3 Auditoria de records de reports: fase 5
- **Nenhum bug confirmado.** Divergências são de contrato (cada `select` pede colunas diferentes).
- Os tipos são só de entrada: não são serializados, então `Pick`/`Omit` não altera o JSON, que é montado manualmente.
- Isolamento de tenant fica em `fetchAllOrganizationRows` (`server/utils/supabase-pagination.ts:39-54`: `organization_id` e `deleted_at IS NULL`), não nos tipos.
- **`id`:** obrigatório em `employee-commission-report.ts:26`; opcional em `export-commissions.post.ts:19` e `commissions.get.ts:14`; `string | number` em `export-sales-items.post.ts:46`. Unificar para `string` pode quebrar o comparador do export.
- **Risco silencioso:** campos de valor existem só em parte das cópias. Um tipo amplo esconderia leitura de campo não selecionado, que vira `undefined` → 0 na comissão sem erro de tipo. Por isso `Pick` por consulta, não superconjunto.
- **`debtors.get.ts` usa `select('*')`** e lê `phone` e `email`. Se trocar por colunas explícitas e esquecer esses campos, o typecheck não avisa.
- `export-sales-items.post.ts` e `sales-items.get.ts` podem calcular comissão por regras diferentes (hipótese, a confirmar por teste).
- Não mudar `columns` nesta fase. Passar de `*` para colunas explícitas é mudança de contrato e vai em etapa separada.
- `employees.vue` não lê o relatório (usa `/api/employees`). `CreateModal.vue` e `BasicInfoCard.vue` não são de relatório e ficam fora.

### 8.4 Baseline do typecheck (fase 0, concluída)
- Comando: `pnpm typecheck` (`nuxt typecheck`, `vue-tsc -b`), cerca de 3 a 4 minutos. Exit code 1 vem dos erros de tipo, não de ambiente.
- **Total: 444 erros em 66 arquivos.** Referência para as fases 1 a 5.
- Top 3 concentram 202 erros (45%): `server/api/reports/costs-profit.get.ts` (74), `server/api/reports/dashboard-stats.get.ts` (66) e `server/utils/profit-report-helpers.ts` (62). Todos ficam na área de reports, da fase 5. Comparar a contagem por arquivo antes e depois de qualquer mudança nessa área.
- Arquivos: `docs/engineering/types-typecheck-baseline.md` (tabela completa) e `docs/engineering/types-typecheck-baseline.raw.txt`.

### 8.5 Testes antes de qualquer mudança de código (pré-requisito)
Testes existentes: `tests/fast/reports/reports.test.ts` e `reports-consistency.test.ts`. Não verificado se cobrem os itens abaixo.
1. Snapshot JSON (golden) das respostas de `commissions.get`, `export-commissions.post`, `debtors.get`, `sales-items.get`, `export-sales-items.post`, `employee-report` e `employee-commission-report`, com `tests/helpers/fake-supabase.ts` e fixtures determinísticas.
2. Teste que registra as colunas pedidas em cada chamada de `fetchAllOrganizationRows`, para expor troca de `*` por colunas explícitas.
3. Comparação `sales-items.get` × `export-sales-items.post` para as mesmas ordens: totais, custo de comissão e responsáveis devem ser iguais.
4. Isolamento de tenant: duas organizações e registros com `deleted_at`; nenhum deve aparecer nos relatórios.
5. `debtors.get`: cliente com telefone e e-mail aparece no JSON.
6. `expectTypeOf` sobre os tipos compartilhados, depois da unificação.
7. Para fase 3: testes dos modais de pagamento, incluindo pré-preenchimento de forma de pagamento por `preferred_payment_method`.

### 8.6 Status das fases
| Fase | Status | Pré-requisito |
|---|---|---|
| 0 Baseline | Concluída (444 erros) | - |
| 1 Sobras de `index.d.ts` | Pronta após confirmar 0 usos e `nuxt prepare` | - |
| 2 `PaymentMethod`, `ViewMode`, `BadgeColor` idênticos | Aprovada | typecheck por arquivo |
| 3 `BankAccountItem` | Aprovada com condições (8.2) | testes 7 de 8.5 |
| 4 `ServiceOrder`, `Vehicle`, `Employee*` | Pendente de análise própria | typecheck |
| 5 Records de reports | Bloqueada | testes 1 a 6 de 8.5 e revisão independente |
| 6 Option C (Supabase) | Opcional, depois da fase 5 | decisão do time |
| Remoção de tipos sem uso (7.3) | Bloqueada | decisão sobre módulos Life OS |
