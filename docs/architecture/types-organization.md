# Organização de tipos TypeScript

Status: análise (nenhum arquivo de código foi alterado). Data: 2026-11-12. Branch: dev.
Método: contagens por `grep`/`find` (regex `^export (interface|type|enum)` e `^\s*(interface|type) [A-Z]`). Contagens são aproximadas (não pegam `export type { }` nem tipos multilinha atípicos). Itens marcados **[Hipótese]** não foram verificados.
Pendente (não verificado por limite de turnos): impacto exato de cada fase no `pnpm typecheck`; como o Nuxt trata `app/types/*.ts` (não-`.d.ts`) em auto-import (todos os imports existentes são explícitos via `~/types/...`).

## 1. Inventário (verificado)

### Arquivos de tipos dedicados
| Local | Arquivos | Tipos exportados |
|---|---|---|
| `app/types/` | 20 | ~280 (habits 43, financial 27, tasks 18, appointments 17, feedback 16, knowledge 16, goals/ideas/journal/life-os 15 cada, service-orders 12, index.d.ts 11, notifications 9, onboarding 8, workshop 5, nfse/products/guided-tour 4, clients 2, organization 1) |
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
Validação em todas as fases: `pnpm typecheck` antes e depois, salvando a saída; comparar **contagem de erros por arquivo** (baseline ~548 pré-existentes; não precisa zerar, apenas não aumentar em nenhum arquivo e não criar erros novos). `pnpm exec eslint <arquivos tocados>`. Rodar testes focados dos módulos tocados.

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
