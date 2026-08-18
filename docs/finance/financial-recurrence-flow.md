# Fluxo de recorrência financeira — bugs encontrados e redesenho

Este documento cobre exclusivamente a **recorrência** de lançamentos financeiros (`financial_transactions.recurrence`) — não confundir com **parcelamento** (`is_installment`/`installment_count`), que é um conceito separado no mesmo módulo e já funciona corretamente hoje (gera todas as parcelas de uma vez, na criação — é justamente o padrão que a seção 5 propõe copiar para a recorrência).

Três partes: (1) auditoria completa do que existe hoje e por que está quebrado, com números reais de produção; (2) redesenho do fluxo, com a decisão já dada pelo time de **gerar todas as ocorrências no momento da criação**, já que não há cron/scheduled task na infra hoje; (3) redesenho do modal de criação/edição em abas (seção 10), incluindo uma lista editável de ocorrências pra recorrência — o mesmo recurso que o parcelamento já tem, porque o vencimento e o valor de uma ocorrência individual podem precisar de ajuste manual (ex.: aluguel que vence dia 31 e o mês seguinte não tem dia 31; reajuste anual de valor).

**Nota de implementação**: a Fase 0 e a Fase 1 original (seção 7) já foram implementadas com um contrato mais simples — só `recurrence_count`, sem lista editável. A seção 10 e a Fase 1 revisada (mesma seção 7) descrevem a evolução desse contrato para `occurrences[]`, no mesmo molde do parcelamento — é a próxima etapa, ainda não implementada.

## 1. Contexto — como o fluxo deveria funcionar

Ao criar um lançamento com recorrência mensal ou anual (ex.: aluguel, assinatura), o sistema deveria gerar automaticamente as ocorrências futuras (próximo mês, o mês seguinte, etc.), permitir editar "somente este" ou "este e os próximos", e manter cada ocorrência como uma linha própria em `financial_transactions` (pagável, excluível, editável individualmente).

## 2. Schema atual (verificado)

`supabase/migrations/20240101000021_create_financial_transactions.sql`:

```sql
recurrence                      varchar(20),
recurrence_end_date             date,
parent_recurrence_id            uuid REFERENCES financial_transactions(id) ON DELETE SET NULL,
...
CONSTRAINT financial_transactions_recurrence_check
    CHECK (recurrence IS NULL OR recurrence IN ('non_recurring', 'monthly', 'annual'))
```

Pontos-chave:
- **Só existem 3 valores válidos no banco**: `non_recurring`, `monthly`, `annual` (inglês). Não existe `'weekly'`/`'semanal'` no CHECK constraint — nunca existiu.
- `parent_recurrence_id` aponta pro lançamento raiz da série (mesma ideia de `parent_transaction_id` para parcelamento, só que para recorrência).
- Índice `idx_financial_transactions_parent_recurrence_id` já existe, pronto para a travessia da série — só falta algo popular a coluna.

## 3. Catálogo de bugs confirmados

Cada item foi confirmado lendo o código atual (não é suposição) — arquivo e linha exatos.

### Bug 1 (CRÍTICO) — a geração automática de ocorrências foi deletada e nada a substituiu

`server/api/financial/check-recurring.post.ts` **não existe mais no repositório.** Foi removido no commit `2b697da` ("...refactor: remove unused check-recurring and entries endpoints"), na mesma leva em que um endpoint genuinamente morto (`entries.post.ts`) foi removido — só que este não era morto, era o único código que criava a próxima ocorrência de uma série.

Recuperei o arquivo do histórico (`git show 2b697da^:server/api/financial/check-recurring.post.ts`) para referência — ele:
- Buscava lançamentos com `recurrence IN ('mensal','anual')` e `recurrence_end_date IS NULL` e `recurring_parent_id IS NULL` (ou seja, séries "sem fim" e ainda raiz).
- Para cada série com **11 ou menos** ocorrências `pendente` restantes, criava mais uma (empurrando a janela pra sempre manter ~12 pendentes à frente).
- Não era chamado por nada — confirmei que não há scheduled task no `nuxt.config.ts`, não há `pg_cron` em nenhuma migration, e o `.github/workflows/ci.yml` só roda lint/typecheck em push, sem cron. Ou seja, **já era automação morta antes mesmo de o arquivo ser deletado** — precisaria de um cron/scheduler que nunca existiu nesta infra.
- Além disso, o arquivo já estava desalinhado com o schema atual: usava a coluna `recurring_parent_id` (não existe — a coluna real é `parent_recurrence_id`) e valores em português (`'mensal'`, `'pendente'`) que violam os `CHECK constraints` atuais (`financial_transactions_recurrence_check`, `financial_transactions_status_check`). **Reviver o arquivo como estava não resolveria nada** — precisaria de reescrita completa mesmo que fosse só "trazer de volta".

**Impacto real, confirmado nos dados de produção** (`supabase/migrations/financial_transactions_rows (1).csv`, exportação completa da tabela, 3257 linhas):

| Métrica | Valor |
|---|---|
| Lançamentos com `recurrence = 'monthly'` | 912 |
| Lançamentos com `recurrence = 'annual'` | **0** (nenhum ainda — o bug 2 abaixo nunca foi visto na prática, mas está latente) |
| Séries com `parent_recurrence_id` preenchido (ou seja, que já tiveram filhos gerados) | 68 séries, ~11 ocorrências cada |
| Lançamentos mensais **"raiz" que nunca geraram nenhuma ocorrência filha** (série "congelada" desde a criação) | **123** (não deletados) |
| Data de vencimento mais antiga entre os congelados | `2025-12-20` — já **7+ meses vencido** sem nenhuma ocorrência seguinte gerada, considerando a data atual (2026-07-24) |

As 68 séries com filhos já existentes foram geradas **enquanto o endpoint ainda estava no ar** (antes do commit `2b697da`) — os filhos mais recentes chegam até `2027-01`/`2027-02`, ou seja, ainda têm ~6 meses de "buffer" antes de precisar de mais ocorrências. As 123 séries "congeladas" são o problema visível **agora**: usuário marcou recorrência mensal esperando que o sistema continuasse gerando, e nunca mais gerou nada.

### Bug 2 (ALTO) — `annual` (valor real do banco) não é reconhecido em nenhum normalizador de leitura fora do `FormModal`

O banco só grava `'annual'` (inglês) para recorrência anual — confirmado pelo `recurrenceForApi()` do form (`app/components/financial/entries/FormModal.vue:60-65`), que mapeia a opção da UI `'yearly'` → `'annual'` antes de enviar ao backend. Mas todo normalizador de **leitura** fora desse arquivo só reconhece a grafia em português `'anual'`, nunca `'annual'`:

| Arquivo:linha | Função | O que checa | O que falta |
|---|---|---|---|
| `app/pages/app/financial/index.vue:110-117` | `normalizeRecurrenceValue` | `normalized === 'anual'` | nunca checa `'annual'` |
| `app/pages/app/financial/index.vue:740-747` | `formatRecurrence` | `normalized === 'yearly'` | como o normalizer acima nunca devolve `'yearly'` pra um valor real `'annual'`, cai no fallback e imprime **"annual"** cru na tabela |
| `app/components/financial/entries/DetailSlideover.vue:82-89` | `normalizeRecurrence` | `v === 'anual'` | mesma lacuna |
| `app/components/financial/entries/DetailSlideover.vue:130-137` | `recurrenceLabelMap` | chaves `monthly/mensal/yearly/anual/weekly/non_recurring` | **não tem chave `annual`** — imprime "annual" cru no badge |
| `app/components/financial/entries/FormModal.vue:227-235` | `isEditingRecurring` | `['mensal', 'anual', 'monthly', 'yearly'].includes(rec)` | **também não tem `'annual'`** — ver Bug 6 |

Só o `normalizeRecurrence` do próprio `FormModal.vue` (linhas 48-58) checa as duas grafias (`v === 'anual' || v === 'annual'`) — por isso o dropdown de edição mostra "Anual" selecionado corretamente, mesmo a lista e o detalhe mostrando o texto cru. É exatamente a mesma classe de bug já documentada para `category` em `docs/finance/financial-categories-crud.md` (seção 2.2), só que nunca catalogada para `recurrence`. Como não há nenhum lançamento anual em produção ainda (tabela acima), o impacto real hoje é zero — mas é uma bomba-relógio pro primeiro usuário que marcar "Anual".

**Efeito colateral no `duplicate()`**: `app/pages/app/financial/index.vue:612-656` usa `normalizeRecurrenceValue(entry.recurrence)` pra decidir quanto avançar a data ao duplicar (`+1 mês` se `'monthly'`, `+1 ano` se `'yearly'`). Como `'annual'` nunca vira `'yearly'`, duplicar um lançamento anual **não avança a data** — mantém o `due_date` idêntico ao original, silenciosamente.

### Bug 3 (ALTO) — "Este e os próximos" é um no-op silencioso, porque nada grava `parent_recurrence_id`

`server/api/financial/update-recurring.post.ts:134-139` agrupa a série via `parent_recurrence_id`. Busquei (`grep`) toda escrita dessa coluna em `server/` e `app/` — ela só é **lida**, nunca **escrita**, em nenhum fluxo atual:
- `server/api/financial/index.post.ts` (criação) nunca seta `parent_recurrence_id` — nem no branch de parcelamento (linhas 51,75, que aliás zera `recurrence` também, ver Bug 5) nem no branch de lançamento único (linha 104, só grava `recurrence`, nunca vincula a um pai).
- `duplicate()` do frontend (`index.vue:633-646`) também não envia esse campo.
- O único código que um dia escreveu isso (o `check-recurring.post.ts` deletado) usava o nome de coluna errado (`recurring_parent_id`) — nunca teria funcionado mesmo rodando.

Efeito: `rootRecurringId` em `update-recurring.post.ts:134` sempre resolve pro próprio id do lançamento sendo editado (nunca tem um pai), a busca por filhos (`parent_recurrence_id.eq.<id>`) sempre retorna vazio, e só a própria linha é atualizada — mesmo o diálogo dizendo explicitamente *"aplicar as alterações também para os próximos meses desta recorrência"* (`FormModal.vue:746`). O usuário acha que atualizou a série inteira; só uma linha mudou, sem nenhum aviso.

Também explica por que `FormModal.vue:230-232` checa um campo (`recurring_parent_id`) que **não existe no schema** — sempre `undefined`, morto desde que foi escrito.

### Bug 4 (MÉDIO) — `update-recurring.post.ts` não protege lançamentos já pagos

`server/api/financial/update-recurring.post.ts:144-150` filtra a série só por `due_date >= baseDate` — **sem checar `status`**. Se uma ocorrência futura já estiver `status: 'paid'` (pago adiantado, fora de ordem), ela entra no lote:
- `updateData.status = entry.status` (linha 172) preserva `'paid'`.
- `reverterExtrato()` (linha 183, guardado só por `status === 'paid'`) reverte o extrato/saldo bancário já lançado.
- `registrarExtratoContaBancaria()` (linha 192) relança um **novo** extrato com o valor/data atualizados.

Ou seja: editar "este e os próximos" pode reescrever retroativamente o valor de um lançamento já pago e conciliado, e recriar o lançamento no extrato bancário — sem nenhuma confirmação de que está mexendo em histórico já fechado. (Hoje isso não se manifesta na prática só porque o Bug 3 já impede a série de ter mais de uma linha — mas é preciso corrigir os dois juntos, senão o Bug 3 esconde o Bug 4.)

### Bug 5 (MÉDIO) — recorrência + parcelamento podem ser marcados juntos, e a recorrência é descartada em silêncio

`app/components/financial/entries/FormModal.vue`: o campo "Recorrência" (linhas 572-580) e o checkbox "Criar lançamento parcelado?" (linhas 604-609, só na criação) são controles independentes, sem exclusão mútua nem watcher. Dá pra marcar `recurrence = monthly` **e** `is_installment = true` ao mesmo tempo.

`server/api/financial/index.post.ts:35` decide pelo branch de parcelamento sempre que `body.is_installment && installmentList.length > 1` — e esse branch **hardcoda `recurrence: null`** tanto no pai (linha 51) quanto em cada filho (linha 75). `body.recurrence` nunca é lido nesse caminho. A escolha de recorrência do usuário some sem toast, sem validação, sem indício.

### Bug 6 (ALTO, achado nesta investigação, mesma causa-raiz do Bug 2) — o diálogo "somente este / este e os próximos" nunca aparece para lançamentos anuais

`FormModal.vue:227-235`:
```ts
const isEditingRecurring = computed(() => {
  if (!props.entry) return false
  const rec = String(props.entry.recurrence || '').toLowerCase()
  const hasParent = Boolean(props.entry.recurring_parent_id) || Boolean(props.entry.parent_recurrence_id)
  const isRecurring = ['mensal', 'anual', 'monthly', 'yearly'].includes(rec)
  return hasParent || isRecurring
})
```
`rec` vem do valor **cru** salvo no banco (`props.entry.recurrence`), que para um lançamento anual real é `'annual'` — **não está na lista** (`'anual'`/`'yearly'` estão, `'annual'` não). E `hasParent` é sempre `false` (Bug 3). Resultado: para um lançamento anual, `isEditingRecurring` é sempre `false` — o diálogo de "somente este / este e os próximos" **nunca abre**, e `save()` (linha 374-378) vai direto pro PUT de edição única, sem o usuário nem saber que a opção existiria. Para mensal funciona (`'monthly'` está na lista), só anual está quebrado.

### Bug 7 (ALTO, achado nesta revisão) — editar uma parcela permite marcar recorrência ao mesmo tempo, sem nenhuma trava

O Bug 5 (seção acima) e a correção da seção 6.1/10.7 cobrem a **criação** — `index.post.ts` rejeita (400) `is_installment` + `recurrence` juntos. Mas a combinação inválida também é alcançável **editando** uma parcela já existente, e nada impede isso hoje:

- `FormModal.vue:598-606`, o `USelectMenu` de Recorrência só fica desabilitado quando `!isEditing && form.is_installment` — ou seja, **nunca** durante edição (`isEditing === true` sempre torna essa expressão falsa), mesmo que a linha sendo editada já seja uma parcela (`form.is_editing_installment === true`, setado em `FormModal.vue:286` a partir de `e.is_installment`). Um usuário editando a 3ª parcela de um parcelamento pode simplesmente escolher "Mensal" no campo de Recorrência.
- `isEditingRecurring` (linha 249-255) é calculado a partir de `props.entry.recurrence`/`parent_recurrence_id` — os valores **originais** da linha, não o que o usuário acabou de selecionar no formulário. Uma parcela não tem recorrência original, então `isEditingRecurring` fica `false`, o diálogo "somente este/este e os próximos" nunca aparece, e `save()` vai direto pro `PUT /api/financial/:id` (linha 405).
- `server/api/financial/[id].put.ts:19-24` busca a linha existente selecionando só `id, type` — não valida `is_installment`/`recurrence` de forma nenhuma, muito menos a combinação dos dois. O `allowed` array (linha 30) inclui os dois campos sem nenhuma checagem cruzada.

Resultado: salvar nessa situação grava um `financial_transactions` com `is_installment = true` **e** `recurrence = 'monthly'` simultaneamente no banco — o mesmo estado inconsistente que o Bug 5 evita na criação, só que alcançável pela edição. Precisa de duas correções, não uma:
1. **Frontend**: desabilitar os controles de Recorrência quando `form.is_editing_installment` for `true` (independente de `isEditing`), com uma dica explicando o motivo ("Esta linha já faz parte de um parcelamento").
2. **Backend**: `[id].put.ts` precisa buscar `is_installment`/`recurrence` da linha existente (não só `id, type`), calcular o estado **resultante** (existente com o `body` aplicado por cima) e rejeitar (400) se os dois ficarem truthy ao mesmo tempo — mesma mensagem de erro do `index.post.ts`, idealmente numa função compartilhada em vez de duplicar a checagem nos dois arquivos.

### Achados menores (não são bugs de comportamento, mas valem registrar)

- **`'weekly'`/`'semanal'` é código morto/vestigial**: `recurrenceOptions` no `FormModal.vue:309-313` só oferece "Sem recorrência" / "Mensal" / "Anual" — nunca "Semanal". E mesmo que fosse possível chegar lá, `recurrenceForApi()` (linhas 60-65) não tem branch pra `'weekly'` — cairia no `return null` (recorrência descartada). Como o CHECK constraint do banco nunca permitiu `'weekly'`, isso nunca poderia ter existido em produção. Os normalizadores de leitura (`normalizeRecurrenceValue`, `normalizeRecurrence` em 2 arquivos) mantêm um branch pra `'semanal'`/`'weekly'` que nunca é alcançável com dados reais — recomendo remover esse código morto ao mexer nessas funções (item de limpeza, não bug).
- **`docs/finance/financial-categories-crud.md`** ainda cita `server/api/financial/check-recurring.post.ts` como se existisse (referência a "resolver `category_id`" nesse arquivo) — está descrevendo um arquivo já deletado antes daquele documento ser escrito. Vale corrigir essa referência quando este documento for incorporado.
- **`[id].put.ts`** (edição de uma única linha) não mexe em `bank_account_statements` mesmo quando o lançamento já é `paid` e o valor/data mudam — diferente de `update-recurring.post.ts`, que reverte/relança o extrato. Isso é uma inconsistência mais ampla do módulo financeiro (fora do escopo de recorrência), só registrando para não ser confundido com os bugs acima.

## 4. Nenhum relatório depende de `recurrence`/`parent_recurrence_id` para lógica de agregação

Busquei em `server/api/reports/`: só `costs-profit.get.ts:216` referencia `recurrence`, e apenas para repassar o valor cru no payload de exibição — não filtra nem agrupa por ele. Nenhum relatório quebra com a correção proposta abaixo.

## 5. Decisão de arquitetura: gerar todas as ocorrências na criação (sem cron)

Confirmado com o time: como não existe cron/scheduled task nesta infra (nem Nitro scheduled tasks, nem `pg_cron`, nem função externa agendada), o modelo "gera uma ocorrência de cada vez, sob demanda de um job periódico" está descartado. A recorrência passa a funcionar **exatamente como o parcelamento já funciona hoje**: ao marcar recorrência, o sistema gera **todas** as ocorrências de uma vez, no momento da criação, vinculadas via `parent_recurrence_id`.

Isso exige decidir **quantas** ocorrências gerar de uma vez — ao contrário do parcelamento (que tem um total fixo natural, "10x de R$100"), uma recorrência é conceitualmente ilimitada ("aluguel todo mês, para sempre"). Duas informações já existem no schema/UI pra isso:
- `recurrence_end_date` (já existe na tabela e no form, campo "Encerrar recorrência em", `FormModal.vue:582-588`) — mas hoje é **opcional** e, nos dados reais, a maioria das 912 linhas mensais não tem esse campo preenchido (só 8 valores distintos de `recurrence_end_date` entre todas as linhas mensais, a maioria vazia).
- Um contador de repetições, no mesmo espírito do `installmentCountOptions` (`FormModal.vue:106-109`, 2x a 24x) — não existe hoje para recorrência.

**Decisão confirmada com o time**: teto de **60 ocorrências** por vez (5 anos de mensal) — mesmo valor pra criação e pra extensão (seção 6.7).

**Proposta, simplificada**: reaproveitar o padrão já validado do parcelamento — um campo **"Quantidade de ocorrências"** (obrigatório quando recorrência ≠ "Sem recorrência", mesmo componente de seleção `installmentCountOptions` já usado, agora com opções até 60). **Quem decide quantas linhas são criadas é sempre essa quantidade — só ela, nada mais.**

**Revisado (ver seção 10.4a)**: `recurrence_end_date` deixa de ser um campo que o usuário preenche à mão — vira um **valor calculado**, derivado da própria lista de ocorrências (é o `due_date` da última linha, ou — no caso de uma extensão — recalculado depois de cada extensão). O usuário não escolhe essa data diretamente; ela só aparece na tela como informação, sempre coerente com o que foi de fato gerado. Continua não entrando em nenhum cálculo de *quantas* ocorrências criar — isso continua sendo só a quantidade escolhida — mas passa a ser **escrita pelo backend a partir do resultado**, em vez de **lida do usuário como entrada livre**.

Cada ocorrência gerada é uma linha `financial_transactions` normal, com `status = 'pending'` (exceto potencialmente a primeira, se o usuário já quiser marcá-la `paid` na criação — mesmo campo `status` que já existe no form hoje), `recurrence` igual à raiz, e `parent_recurrence_id` apontando pra raiz (a raiz em si tem `parent_recurrence_id = null`) — espelhando exatamente `parent_transaction_id`/`current_installment` do parcelamento.

## 6. Cenários (análise completa)

### 6.1 Criar um lançamento recorrente

**Revisado — ver seção 10 para o desenho completo da UI (abas) e o motivo da mudança de contrato.** Resumo:

1. Usuário marca (na aba Recorrência) que o lançamento é recorrente, escolhe Mensal/Anual e a quantidade de ocorrências — o formulário gera automaticamente uma lista com uma linha por ocorrência (data + valor + status), pré-preenchida mas **editável linha a linha**, igual à lista de parcelas que o parcelamento já tem.
2. `POST /api/financial` passa a aceitar `recurrence` + `occurrences: { number, due_date, amount, status }[]` — mesmo formato de `installments[]` já aceito hoje, não mais um `recurrence_count` cru (esse campo deixa de ser enviado ao backend; continua existindo só no frontend, sincronizado com `occurrences.length`, pra alimentar o seletor de quantidade).
3. O array já vem com as datas/valores calculados (mesma lógica de `addMonths`/`addYears`, seção 6.1 antiga) — o usuário só edita o que for diferente do padrão antes de salvar. O backend não recalcula nada, só valida (`occurrences.length` entre 1 e 60) e insere exatamente o que veio no array.
4. Insere a primeira linha do array (raiz, `parent_recurrence_id = null`), depois as restantes com `parent_recurrence_id = <id da raiz>` — mesmo padrão de "insere pai, depois insere filhos com `.map()`" já usado no branch de parcelamento (`index.post.ts:38-87`) e no branch de recorrência já implementado (que este contrato substitui).
5. **Trava mútua exclusão (fecha o Bug 5)**: se `body.is_installment && body.recurrence`, rejeitar com 400 antes de fazer qualquer insert — nunca silenciosamente descartar um dos dois. Espelhado no frontend: as abas Recorrência e Parcelamento são mutuamente exclusivas (seção 10) — ativar uma desativa a outra, não só uma validação de última hora.

### 6.2 Editar "somente este"

Sem mudança de comportamento — continua sendo `PUT /api/financial/:id`, atualiza só a linha clicada. Já funciona hoje (é o caminho padrão quando `isEditingRecurring` é `false`, ou quando o usuário escolhe "Somente este" no diálogo).

### 6.3 Editar "este e os próximos"

Com `parent_recurrence_id` agora populado de verdade (seção 6.1), `update-recurring.post.ts` volta a encontrar a série real. Duas correções obrigatórias antes disso valer a pena:
- **Corrigir o Bug 2/6** (vocabulário `annual`) — senão a opção nunca aparece pra série anual.
- **Corrigir o Bug 4** (filtrar por `status`) — `entriesToUpdate` deve excluir qualquer ocorrência já `paid` (ou pelo menos exigir uma confirmação extra e explícita se o usuário realmente quer reescrever uma ocorrência paga — recomendo simplesmente excluir, no mesmo espírito de "nunca reverter dinheiro já baixado sem ação isolada e deliberada" já usado no fluxo de exclusão de parcela de OS, ver `docs/service-orders/delete-paid-installment.md`).

Fluxo final: editar valor/descrição/categoria/conta bancária de uma ocorrência e escolher "este e os próximos" propaga para toda ocorrência da mesma série com `due_date >= a editada` **e `status = 'pending'`** — pagas ficam de fora, sempre.

### 6.4 Excluir uma ocorrência (cenário novo, não existia antes desta mudança)

Hoje a exclusão financeira já suporta motivo obrigatório (`docs` não específico, mas o fluxo já existe em `financial/index.vue:543-575`, single e bulk). Com geração antecipada, passa a fazer sentido também oferecer **"excluir esta e as futuras"** (ex.: assinatura cancelada a partir de determinado mês) — hoje isso exigiria selecionar manualmente cada linha futura na tabela e usar a exclusão em massa já existente, o que já funciona mas é manual. Proposta: no detalhe de uma ocorrência que faz parte de uma série (`recurringSiblings.length > 0`), oferecer um atalho que pré-seleciona (via `rowSelection`) todas as ocorrências da série com `due_date >= a atual e status='pending'`, entregando pro mesmo modal de exclusão em massa que já existe (`showBulkDeleteModal`) — **não precisa de endpoint novo**, é reaproveitar o que já existe com uma pré-seleção mais inteligente. Ocorrências já pagas nunca entram nessa pré-seleção automática (mesmo princípio do item 6.3) — se o usuário realmente quiser excluir uma paga, continua tendo que selecioná-la manualmente, mesmo comportamento de hoje.

### 6.5 Marcar uma ocorrência isolada como paga

Sem mudança — `pay(entry)` (`index.vue:466-481`) e o bulk-pay já operam por linha/seleção, independente de série. Continuam corretos: pagar uma ocorrência nunca deveria afetar as demais.

### 6.6 `duplicate()` numa entrada com recorrência real

Hoje `duplicate()` (`index.vue:612-656`) é pensado pra "criar mais uma ocorrência manualmente" — mas, com a criação passando a gerar todas as ocorrências de uma vez (seção 5), duplicar uma entrada que **já pertence a uma série** criaria uma segunda linha solta, fora da série (sem `parent_recurrence_id`), confundindo a série real com uma cópia avulsa. Proposta: esconder/desabilitar o botão "Duplicar" quando `entry.recurrence` não for "Sem recorrência" **ou** `entry.parent_recurrence_id` não for nulo — para essas linhas, a ação que faz sentido é ver a série (`recurringSiblings` no detalhe) ou criar um lançamento avulso novo do zero, não "duplicar". `duplicate()` continua existindo normalmente pra entradas não-recorrentes (incluindo parceladas — esse caso já é tratado à parte, olhando `entry.recurrence`, que é `null` numa parcela).

### 6.7 Fim da série e extensão (detalhado para implementação já nesta rodada)

Como todas as ocorrências já nascem geradas de uma vez, "fim da série" deixa de ser um evento que o sistema precisa detectar em tempo real — é só a última linha já inserida na criação (ou na última extensão, ver abaixo). Não há necessidade de nenhum job de "encerrar recorrência quando a data chegar".

Mas como o teto por vez é 60 (5 anos de mensal, seção 5) e um aluguel real pode continuar por muito mais tempo que isso, **estender uma série já existente precisa ser uma ação de primeira classe**, não um "pedido futuro" — é o caminho normal e esperado pra qualquer recorrência de longa duração nesta infra sem cron.

**Onde aparece**: no detalhe de qualquer ocorrência que pertença a uma série real (`entry.recurrence !== 'non_recurring'` e/ou `recurringSiblings.length > 0`, `DetailSlideover.vue`), um botão **"Adicionar mais ocorrências"** — no mesmo lugar/slot onde "Duplicar" ficava antes de ser escondido pra essas linhas (seção 6.6). Também pode aparecer na linha da tabela (`index.vue`), substituindo o botão de duplicar pra entradas recorrentes.

**Fluxo**:
1. Usuário clica em "Adicionar mais ocorrências" a partir de **qualquer** ocorrência da série (não precisa ser a última nem a raiz — o backend resolve isso).
2. Abre um diálogo simples pedindo só a quantidade (mesmo componente de seleção usado na criação, 1x–60x).
3. Confirma → chama o novo endpoint (abaixo) → toast de sucesso → recarrega a lista/detalhe.

**Novo endpoint**: `POST /api/financial/:id/extend-recurrence`

Body: `{ additional_count: number }` (1 a 60).

Lógica:
1. Carrega o lançamento `:id` (404 se não existir/estiver deletado/for de outra organização).
2. 400 se `entry.recurrence` for nulo ou `'non_recurring'` — "Este lançamento não faz parte de uma recorrência".
3. Resolve `rootId = entry.parent_recurrence_id ?? entry.id` (mesma lógica já usada em `update-recurring.post.ts:134`).
4. Busca toda a série (raiz + filhos, mesma query de `update-recurring.post.ts:137-140`, filtrando `deleted_at IS NULL`). 404 se a raiz não existir mais (ex.: foi excluída).
5. **Lançamento-modelo**: entre todas as linhas da série, pega a que tem o **maior `due_date`** (a mais recente/futura) — não necessariamente a raiz. É dela que vêm `description`, `amount`, `type`, `category_id`, `bank_account_id`, `notes` pras novas linhas. Motivo: se o usuário já usou "este e os próximos" (seção 6.3) pra mudar o valor ou a categoria da série a partir de um certo ponto, é esse valor mais recente que deve continuar se repetindo — não o valor original da raiz, que pode estar desatualizado.
6. Calcula as próximas `additional_count` datas a partir do `due_date` do lançamento-modelo, avançando 1 mês (ou 1 ano, se `annual`) por ocorrência — mesma lógica de `addMonths`/`addYears` já usada na geração inicial (seção 6.1) e em `update-recurring.post.ts:44-64`.
7. Insere `additional_count` linhas novas, todas `status: 'pending'`, `parent_recurrence_id: rootId`, `recurrence` igual ao da raiz, demais campos copiados do lançamento-modelo (passo 5).
8. Retorna `{ success: true, created: additional_count }`.

**Sem teto de vida total da série**: o limite de 60 (seção 5) vale só *por chamada* (criação ou extensão) — uma série pode ser estendida indefinidamente, uma vez a cada ~5 anos (mensal), sem limite de quantas vezes isso pode ser feito. É o preço aceito de não ter cron: o usuário precisa voltar e clicar "Adicionar mais ocorrências" periodicamente para séries de longuíssima duração — mas isso é raro (a maioria dos contratos tem prazo) e é uma ação simples de um clique.

### 6.8 Exclusão/edição de categoria usada por uma série inteira

Sem impacto — `category_id` é por linha (FK), independente de recorrência. Editar ou remover uma categoria segue exatamente as regras já existentes em `docs/finance/financial-categories-crud.md`, sem nenhuma interação nova com recorrência.

### 6.9 Dados legados (as 68 séries ativas + as 123 "congeladas") — decisão: não fazer backfill

**Decisão confirmada com o time: sem backfill.** As 123 séries mensais "congeladas" e as 68 séries parciais (seção 3, Bug 1) ficam exatamente como estão — nenhuma migration/script vai gerar ocorrências retroativas ou estender essas séries automaticamente.

Na prática, para quem já tem uma dessas séries: a linha antiga continua existindo sozinha (ou com os filhos que já tinha), sem nenhuma ocorrência nova sendo criada por conta própria. Se o usuário quiser continuar recebendo/pagando aquele lançamento nos próximos meses, a saída é usar a extensão manual (seção 6.7, "Adicionar mais ocorrências") a partir da última linha existente daquela série — o mesmo endpoint novo serve tanto pra estender uma série criada do zero já corrigida quanto pra "resgatar" uma série antiga que parou de crescer, contanto que a linha raiz ainda exista (não tenha sido excluída). Não é uma ação automática — é o usuário decidindo, quando notar que precisa, exatamente como qualquer outra extensão.

## 7. Plano de implementação (fases)

### Fase 0 — Corrigir os bugs de vocabulário e proteção, independente da geração antecipada
1. Padronizar todos os normalizadores de leitura (`index.vue:110-117`, `740-747`; `DetailSlideover.vue:82-89`, `130-137`; `FormModal.vue:227-235`) para reconhecer `'annual'` (o valor real gravado), mantendo `'anual'`/`'yearly'` só como fallback de exibição pra dado legado, nunca como o valor primário esperado. Remover os branches mortos de `'weekly'`/`'semanal'` ao mexer nessas funções (achado menor, seção 3).
2. Corrigir `FormModal.vue:230-231`: remover a checagem do campo inexistente `recurring_parent_id`; manter só `parent_recurrence_id`.
3. `update-recurring.post.ts:144-150`: adicionar filtro `entry.status === 'pending'` na composição de `entriesToUpdate` (fecha o Bug 4).
4. **Pronto quando**: um lançamento anual mostra "Anual" em toda tela (lista, detalhe, formulário) e o diálogo "somente este / este e os próximos" abre corretamente pra ele; editar "este e os próximos" nunca mais toca uma ocorrência `paid`.

### Fase 0-b — Fechar o Bug 7 (ainda não implementada)
4b. `FormModal.vue`: desabilitar os controles da aba Recorrência quando `form.is_editing_installment` for `true`, com dica explicando o motivo.
5b. `server/api/financial/[id].put.ts`: buscar `is_installment`/`recurrence` da linha existente, calcular o estado resultante (existente + `body`) e rejeitar (400) se ficar com os dois truthy — mesma checagem do `index.post.ts`, de preferência numa função compartilhada.
6b. **Pronto quando**: não existe nenhum caminho (criação ou edição, UI ou chamada direta à API) que grave uma linha com `is_installment = true` e `recurrence` não nulo ao mesmo tempo.

### Fase 1 — Geração antecipada na criação

> ✅ **Implementado com o contrato original** (`recurrence_count` cru, sem lista editável) — itens 5-7 abaixo, como entregues. **Superseded pela Fase 1-b** (itens 5b-7b), que troca o contrato para `occurrences[]` editável — ver seção 10.

5. ~~`FormModal.vue`: novo campo "Quantidade de ocorrências" (visível quando `recurrence !== NO_RECURRENCE`), reaproveitando o componente já usado por `installmentCountOptions`. Exclusão mútua entre o bloco de recorrência e o checkbox de parcelamento (seção 6.1).~~
6. ~~`server/api/financial/index.post.ts`: novo branch (paralelo ao de parcelamento) — quando `body.recurrence` e `body.recurrence_count > 1`, gera a raiz + N-1 filhos com `parent_recurrence_id`, mesma mecânica de datas de `addMonths`/`addYears`.~~
7. ~~**Pronto quando**: marcar "Mensal, 12x" na criação gera 12 linhas de uma vez, vinculadas por `parent_recurrence_id`, sem precisar de nenhum job rodando depois.~~

### Fase 1-b — Abas + lista editável de ocorrências (seção 10, ainda não implementada)

5b. `FormModal.vue`: reorganizar em `UTabs` (Geral / Recorrência / Parcelamento, seção 10.2), com texto de ajuda fixo no topo de cada uma das abas Recorrência e Parcelamento (seção 10.4 item 0, seção 10.6). Mover os campos existentes de Geral e o bloco de parcelamento pra dentro das respectivas abas, sem mudar o comportamento deles.
6b. Aba Recorrência: toggle "É recorrente?" (desabilitado se `form.is_editing_installment`, fecha o Bug 7 — Fase 0-b) + tipo + quantidade, gerando `editableOccurrences` (mesmo padrão de `editableInstallments`, mas repetindo o valor em vez de dividir — seção 10.4) — lista com vencimento/valor editáveis por linha, botão adicionar/remover, sem validação de soma, com "Encerra em" calculado e somente-leitura (seção 10.4a) em vez do antigo campo de data livre.
7b. Aba Recorrência durante edição: sem lista, só tipo + "Encerra em" (somente leitura) + aviso "faz parte de uma recorrência" (seção 10.5).
8b. `server/api/financial/index.post.ts`: trocar o branch de recorrência pra ler `body.occurrences[]` explícito em vez de calcular `addMonths`/`addYears` internamente, e passar a calcular/gravar `recurrence_end_date` em todas as linhas a partir da última ocorrência do array (seção 10.7).
9b. `server/api/financial/[id]/extend-recurrence.post.ts`: depois de inserir as novas ocorrências, atualizar `recurrence_end_date` em toda a série (raiz + filhos) pra refletir a nova última data (seção 10.7).
10b. Rótulo dinâmico do campo "Valor" (seção 10.3) — decisão em aberto (seção 11) antes de implementar o texto exato.
11b. **Pronto quando**: o modal tem 3 abas, cada uma com seu texto de ajuda; a aba Recorrência gera uma lista editável antes de salvar (igual ao parcelamento), sem pedir uma data de encerramento manual; o backend recebe e grava exatamente o que veio na lista, calculando e mantendo `recurrence_end_date` sozinho (na criação e em toda extensão).

### Fase 2 — Ações que passam a fazer sentido com séries reais
8. `index.vue`: esconder "Duplicar" para entradas com `recurrence` ativo (seção 6.6), substituindo pelo botão "Adicionar mais ocorrências" (seção 6.7) no mesmo lugar.
9. Novo endpoint `POST /api/financial/:id/extend-recurrence` (seção 6.7) — resolve a raiz da série, pega o lançamento-modelo (maior `due_date`), gera `additional_count` novas ocorrências a partir dele.
10. `DetailSlideover.vue`: mesmo botão "Adicionar mais ocorrências" perto da lista de `recurringSiblings`, mais um diálogo simples de quantidade (1x–60x).
11. `index.vue`/`DetailSlideover.vue`: atalho "excluir esta e as futuras" pré-selecionando as ocorrências pendentes futuras da série no mesmo modal de exclusão em massa já existente (seção 6.4).
12. **Pronto quando**: dá pra estender qualquer série existente (nova ou antiga, contanto que a raiz não tenha sido excluída) a partir de qualquer ocorrência dela, sem limite de quantas vezes; e a exclusão em massa oferece o atalho "esta e as futuras".

Não há Fase 3 de backfill — decisão do time (seção 6.9): os dados legados (68 séries parciais + 123 congeladas) ficam como estão, sem migration retroativa. Quem precisar continuar uma dessas séries usa a extensão manual da Fase 2.

## 8. Critérios de aceite

- Todo lançamento anual é exibido como "Anual" em qualquer tela (lista, detalhe, formulário), nunca como o texto cru "annual".
- O diálogo "somente este / este e os próximos" abre corretamente para séries mensais **e** anuais.
- "Este e os próximos" nunca reescreve uma ocorrência já paga — ela fica de fora do lote, sempre.
- Marcar recorrência + parcelamento ao mesmo tempo é bloqueado **tanto na criação quanto na edição** (400 no backend em `index.post.ts` **e** em `[id].put.ts`, campo/aba desabilitado no formulário nos dois sentidos) — nunca descarta um dos dois silenciosamente, e não dá pra chegar num estado com os dois marcados via edição de uma parcela existente (fecha o Bug 7).
- Criar um lançamento recorrente gera todas as ocorrências solicitadas de uma vez, sem depender de nenhum job externo.
- Dá pra estender qualquer série (a partir de qualquer ocorrência dela) em até 60 novas linhas por chamada, sem limite de quantas vezes — incluindo séries antigas (68 parciais / 123 congeladas) que nunca receberam o tratamento novo, contanto que a raiz ainda exista.
- Nenhum relatório (`costs-profit.get.ts`) quebra com a mudança — confirmado que nenhum agrega/filtra por `recurrence`.
- Os dados legados (68 séries parciais + 123 congeladas) permanecem intocados — nenhuma migration roda contra eles automaticamente (decisão do time, seção 6.9).
- O modal de criação/edição (`FormModal.vue`) organiza os campos em 3 abas: Geral, Recorrência, Parcelamento (seção 10.2).
- Ao criar um lançamento recorrente, o usuário vê e pode editar individualmente o vencimento e o valor de cada ocorrência antes de salvar — mesma capacidade que o parcelamento já tem (seção 10.4).
- O backend (`POST /api/financial`) grava exatamente as datas/valores que vieram no array `occurrences[]` enviado pelo frontend, sem recalcular nada por conta própria.
- Ninguém digita uma "data de encerramento" — ela é sempre calculada a partir da última ocorrência (na criação e depois de cada extensão), nunca fica desatualizada em relação à série real (seção 10.4a).
- As abas Recorrência e Parcelamento têm um texto de ajuda fixo explicando quando usar cada uma e a diferença entre elas (repete vs. divide o valor) — seção 10.4/10.6.

## 9. Decisões do time (registradas para a implementação)

- **Teto de ocorrências geradas por vez**: **60** (5 anos de mensal), tanto na criação (seção 5) quanto na extensão (seção 6.7). Vale igual pra mensal e anual (60x anual = 60 anos — na prática ninguém deve chegar perto disso, mas o mesmo teto simplifica o componente de seleção reaproveitado do parcelamento).
- **`recurrence_end_date` é calculado, não digitado pelo usuário** (revisado — seção 10.4a): não entra em nenhum cálculo de quantas ocorrências gerar — só a quantidade escolhida decide isso; a data em si passa a ser derivada da última ocorrência gerada (ou da última extensão), não mais um campo de texto livre no formulário.
- **Estender uma série esgotada**: coberto em detalhe na seção 6.7, pronto para implementar já nesta rodada — novo botão "Adicionar mais ocorrências" + endpoint `POST /api/financial/:id/extend-recurrence`.
- **Sem backfill**: os dados legados (68 séries parciais + 123 "congeladas") não são tocados por nenhuma migration automática — ficam como estão até que alguém use a extensão manual (seção 6.9) neles, se precisar.

## 10. Redesenho do modal de criação/edição: abas Geral / Recorrência / Parcelamento

### 10.1 Por que mudar

Pedido do time: *"dependendo da quantidade que a pessoa adiciona na recorrência, pode alterar o vencimento, ou o valor. E o parcelamento já sabe."*

Isso tem duas partes:

1. **O modal hoje é um formulário único e comprido** (`app/components/financial/entries/FormModal.vue`, ~820 linhas) — Geral, depois um bloco de Recorrência, depois um bloco de Parcelamento, tudo empilhado verticalmente. Fica difícil de escanear, principalmente porque só um dos dois blocos (Recorrência ou Parcelamento) é relevante por vez — o outro devia ficar visualmente fora do caminho, não só desabilitado.
2. **Recorrência hoje não deixa o usuário ajustar ocorrência por ocorrência**, ao contrário do parcelamento. Confirmado lendo o código atual (`FormModal.vue:96-155`, seção "Installments"): o parcelamento já gera uma lista editável (`editableInstallments`) — cada linha com `número`, `valor`, `vencimento` e `status`, todos editáveis, com botão de adicionar/remover linha (`addInstallment`/`removeInstallment`, linhas 211-233) — antes de enviar pro backend como `installments[]` explícito (`index.post.ts:105-160`). A recorrência, na implementação atual (Fase 0/1 já entregues), só manda um `recurrence_count` cru — o backend é quem calcula as datas mecanicamente (`addMonths`/`addYears`), sem chance de o usuário corrigir nada antes de salvar.

Por que isso importa na prática, com exemplos concretos:
- **Vencimento**: um aluguel que vence todo dia 31 — `addMonths` (date-fns) já rola corretamente pro último dia de meses mais curtos (31/01 → 28 ou 29/02), mas o usuário pode querer decidir manualmente se prefere manter "sempre no último dia útil" ou fixar num dia específico em meses menores. Sem uma lista editável, essa decisão nunca chega até o usuário — ele só veria o resultado depois de salvo, no histórico (seção "Histórico da recorrência" do `DetailSlideover.vue`).
- **Valor**: um contrato com reajuste já previsto (ex.: 13º aluguel, ou um valor diferente a partir do 7º mês) precisaria, hoje, ser criado com N ocorrências e depois cada uma editada individualmente uma por uma (via "Editar" + "Somente este", repetido N vezes) — o mesmo resultado que o parcelamento já resolve numa tela só, antes mesmo de salvar.

### 10.2 Estrutura das abas

Usa `UTabs` (já usado no projeto em `app/pages/admin/index.vue:213-355`, `variant="link"`, `items` com `label`/`value`/`slot`/`icon`, um `<template #slotname>` por aba) — mesma API, não introduz um padrão novo.

```html
<UTabs
  v-model="activeTab"
  :items="[
    { label: 'Geral', value: 'general', slot: 'general' as const, icon: 'i-lucide-file-text' },
    { label: 'Recorrência', value: 'recurrence', slot: 'recurrence' as const, icon: 'i-lucide-repeat' },
    { label: 'Parcelamento', value: 'installments', slot: 'installments' as const, icon: 'i-lucide-layers' }
  ]"
  variant="link"
  class="w-full"
>
  <template #general>...</template>
  <template #recurrence>...</template>
  <template #installments>...</template>
</UTabs>
```

Badge/indicador na própria aba (ex.: um ponto colorido ou contagem no label, `'Recorrência · 12x'`) quando aquela aba já tem algo configurado — evita o usuário abrir a aba errada achando que está tudo vazio quando na verdade já preencheu antes de trocar de aba.

**Aba "Recorrência" e "Parcelamento" desabilitadas uma pela outra** (não só os campos internos, seção 6.1 item 5) — se uma tem algo configurado, a outra aparece com `disabled` no próprio item da aba, com tooltip explicando o motivo ("Desative a recorrência para usar parcelamento"). Isso vale também **editando uma linha que já é parcela** (`form.is_editing_installment`) — a aba Recorrência entra desabilitada nesse caso, fechando o Bug 7 (seção 3) pelo lado do frontend; o lado do backend (`[id].put.ts`) é uma correção server-side independente, que precisa existir de qualquer forma (defesa em profundidade — a API não deveria confiar só na UI pra manter esse estado consistente).

### 10.3 Aba "Geral"

Os campos que já existem hoje fora dos blocos de Recorrência/Parcelamento, sem mudança de comportamento: Descrição, Tipo (Entrada/Saída), Valor, Status, 1º Vencimento, Conta bancária, Categoria, Observações.

**Ajuste de rótulo (achado nesta revisão, não catalogado antes)**: o campo de valor tem hoje o rótulo fixo **"Valor total"** (`FormModal.vue:546`), sempre, mesmo para um lançamento simples (sem parcelamento nem recorrência) — onde não existe "total" nenhum, é só "Valor". O rótulo só faz sentido como "Valor total" no contexto de parcelamento (é o total que as parcelas precisam somar, `installmentTotalsMatch`). Para recorrência, o valor também não é um "total a dividir" — é o valor que se repete em cada ocorrência (diferente de parcelamento, que **divide** o total; recorrência **repete** o valor, seção 10.4). Proposta: rótulo dinâmico — `"Valor"` por padrão, `"Valor de cada parcela"` quando a aba Parcelamento está ativa (ou mantém "Valor total" ali, já que o usuário já entende esse rótulo hoje), `"Valor de cada ocorrência"` quando a aba Recorrência está ativa.

### 10.4 Aba "Recorrência" — o novo comportamento

**Diferença conceitual chave, que precisa ficar clara na UI**: parcelamento **divide** um valor total em N partes (`generateInstallments`, `FormModal.vue:125-140`: `base = totalAmount / count`, resto ajustado na 1ª parcela); recorrência **repete** o mesmo valor em N ocorrências (aluguel de R$1.500 × 12 meses = 12 ocorrências de R$1.500, não R$1.500 ÷ 12). A lista editável de recorrência nasce com o mesmo valor em todas as linhas — o usuário edita manualmente só a(s) ocorrência(s) que precisam ser diferentes (reajuste, mês com desconto, etc.), exatamente como hoje já edita manualmente uma parcela específica na lista de parcelamento.

**Layout da aba** (só na criação — `!isEditing`, mesma regra do parcelamento hoje; ver 10.5 para o comportamento na edição):

0. **Texto de ajuda no topo da aba** (item novo, pedido do time — "precisa também ter informações de como utilizar"), um `UAlert` (ou parágrafo `text-muted`) fixo, não fecha sozinho:
   > "Use recorrência para lançamentos que se repetem com o **mesmo valor**, como aluguel, assinaturas ou mensalidades. O sistema já gera todas as ocorrências agora, de uma vez (não existe verificação automática depois) — você pode ajustar o vencimento ou o valor de uma ocorrência específica antes de salvar, e adicionar mais ocorrências depois, quando a série acabar."
1. Toggle "Este lançamento é recorrente?" (mesmo padrão do checkbox "Criar lançamento parcelado?" que já existe, só que na sua própria aba agora) — **desabilitado com tooltip quando `form.is_editing_installment` for `true`** (fecha o Bug 7, seção 3).
2. Se marcado: seletor Mensal/Anual, seletor de quantidade (`recurrenceCountOptions`, já existe, 2x–60x).
3. **Nova lista editável de ocorrências** (`editableOccurrences`, mesmo padrão de `editableInstallments`): uma linha por ocorrência, colunas **Vencimento** e **Valor** editáveis (`UiDatePicker`/`UiCurrencyInput`, mesmos componentes já usados na lista de parcelas), Status só editável na 1ª linha (Pendente/Pago — as demais nascem sempre `Pendente`, mesma regra do parcelamento hoje), botão de remover linha (mínimo 1 linha, não pode zerar a lista).
4. Botão "Adicionar ocorrência" (mesmo texto/posição do "Adicionar parcela" que já existe) — adiciona mais uma linha ao final, com data = última linha + 1 mês/ano e valor = igual à última linha.
5. **Sem validação de soma** (diferença chave do parcelamento, que exige `installmentTotalsMatch`) — como cada ocorrência é independente, não existe "total esperado" pra bater. Mostra só uma soma informativa ("Total da série: R$ X"), sem bloquear o salvamento se ela não "bater" com nada (não há nada pra bater).
6. Regeneração automática: mudar a quantidade regenera a lista preservando as linhas já editadas manualmente que ainda cabem no novo tamanho (mesmo cuidado que `regenerateInstallments` **não** tem hoje — hoje mudar `installment_count` regenera do zero e descarta edições manuais anteriores; vale considerar corrigir os dois ao mesmo tempo, mas registrado aqui como comportamento a decidir, não bloqueia a entrega da recorrência).
7. **"Encerra em" calculado, não digitado** (ver 10.4a) — mostrado como texto somente-leitura logo abaixo da lista, atualizado em tempo real conforme a lista é editada (adicionar/remover linha, ou mudar a data da última linha).

### 10.4a `recurrence_end_date` deixa de ser um campo de formulário — vira um valor calculado

Pedido do time: *"Deve fazer um cálculo, no lugar de perguntar para o usuário, ou até pegar a última da ocorrência para saber qual a data de finalização."*

Faz sentido — com a lista editável da seção 10.4, o sistema **já sabe** exatamente quando a série termina: é o `due_date` da última linha. Perguntar isso ao usuário num campo separado (o "Encerrar recorrência em" de hoje, `FormModal.vue:621-628`) é redundante e pode até contradizer a lista (o usuário preenche uma data ali, mas a lista tem uma última linha em outra data — qual vale?). A correção remove a ambiguidade na raiz:

- **O campo deixa de ser um `UiDatePicker` editável.** Vira um texto somente-leitura ("Encerra em: 20/07/2027"), calculado como `editableOccurrences[editableOccurrences.length - 1].due_date` — atualiza sozinho conforme a lista muda (mudar a quantidade, editar a data da última linha, adicionar/remover ocorrência).
- **O backend passa a escrever esse valor sozinho**, em vez de esperar que o usuário informe: ao criar a série (`index.post.ts`, seção 10.7), grava `recurrence_end_date` = `due_date` da última linha de `occurrences[]` em **todas** as linhas da série (raiz e filhos) — não só um valor solto na raiz.
- **Ao estender uma série** (`extend-recurrence.post.ts`, seção 6.7), o mesmo campo precisa ser recalculado e atualizado (`UPDATE` em todas as linhas da série, raiz incluída) para refletir a nova última ocorrência — senão o campo fica desatualizado assim que alguém estende a série, e volta a mentir sobre quando a recorrência "termina". Isso é uma mudança em relação ao endpoint como documentado antes (seção 6.7 dizia que `recurrence_end_date` era só copiado da raiz, sem recalcular) — este documento corrige isso: **toda vez que a série cresce (criação ou extensão), `recurrence_end_date` de todas as suas linhas precisa ser atualizado para a nova última data.**
- **Na edição** (10.5), sem lista, não tem o que calcular ali — mostra só a data que já está gravada (somente leitura, igual hoje), com o link "Ver histórico completo" sendo a forma de conferir/entender de onde ela veio.

### 10.5 Aba "Recorrência" durante a edição

Editar uma ocorrência já existente **não** mostra a lista editável (ela só existe na criação, mesma regra do parcelamento) — mostra só o que já existe hoje: o tipo de recorrência (Mensal/Anual, sem opção de alterar pra "Sem recorrência" nem vice-versa por aqui — trocar o tipo de recorrência de uma série existente não é uma operação definida, fora de escopo) e a data de encerramento calculada (10.4a, somente leitura), mais um aviso equivalente ao que o parcelamento já tem (`FormModal.vue:634-641`, *"Este lançamento faz parte de um parcelamento..."*): **"Este lançamento faz parte de uma recorrência. Editar aqui altera só esta ocorrência, a menos que você escolha 'Este e os próximos' ao salvar."** — reaproveita o mesmo componente `UAlert`, só trocando o texto. Um link/botão "Ver histórico completo" que abre o mesmo `DetailSlideover.vue` (que já lista passado + futuro, ver seção anterior deste documento) é um complemento natural aqui, já que a edição não mostra a série.

### 10.6 Aba "Parcelamento"

Sem mudança de comportamento funcional — é a lista editável que já existe hoje (`FormModal.vue:701-751`), só movida para dentro da própria aba em vez de ficar num bloco condicional dentro do fluxo vertical único. Ganha o mesmo texto de ajuda no topo (item novo, pedido do time), para reforçar a diferença com recorrência:

> "Use parcelamento para **dividir** um valor total em partes — por exemplo, um conserto caro pago em várias vezes. O valor de cada parcela normalmente é uma fração do valor total (ajustável linha a linha, se as parcelas não forem todas iguais). Se o lançamento se repete todo mês com o mesmo valor (aluguel, assinatura), use a aba Recorrência em vez desta."

O toggle "Criar lançamento parcelado?" ganha o mesmo tratamento simétrico do Bug 7: **desabilitado com tooltip quando a Recorrência já estiver ativa** (já existia antes da revisão, `FormModal.vue:649`, `:disabled="form.recurrence !== NO_RECURRENCE"` — mantém, só passa a viver dentro da aba).

### 10.7 Mudança de contrato da API (`POST /api/financial`)

Antes (já implementado, Fase 1 original): `{ recurrence, recurrence_count }` — backend calcula tudo, incluindo um `recurrence_end_date` que só existia se o usuário tivesse preenchido manualmente (campo opcional, sem relação com a lista).

Depois (este redesenho): `{ recurrence, occurrences: [{ number, due_date, amount, status }, ...] }` — mesmo formato de `installments[]`, backend só valida e insere, não recalcula datas/valores. `server/api/financial/index.post.ts` precisa trocar o branch de recorrência (que hoje gera as datas internamente com `addMonths`/`addYears`) para ler o array explícito, no mesmo molde do branch de parcelamento logo abaixo dele no mesmo arquivo — os dois branches ficam estruturalmente quase idênticos (a única diferença real: parcelamento divide o valor entre as linhas antes de montar o array no frontend; recorrência repete). **Novo, além do array**: o backend calcula `recurrence_end_date = occurrences[occurrences.length - 1].due_date` e grava esse valor em **todas** as linhas inseridas (raiz e filhos) — deixa de vir do `body` como campo solto (seção 10.4a).

`server/api/financial/[id]/extend-recurrence.post.ts` (extensão de série já esgotada) muda em um ponto, além do já implementado: depois de inserir as `additional_count` novas linhas, precisa fazer um `UPDATE` em **toda a série** (raiz + todos os filhos, a mesma query que já usa pra montar `seriesEntries`) setando `recurrence_end_date` = `due_date` da última linha recém-criada — senão o campo fica desatualizado assim que a série é estendida (seção 10.4a). Continua sem lista editável nesta rodada — só o diálogo de quantidade (seção 6.7); se depois quiser o mesmo nível de controle (editar data/valor das novas ocorrências antes de confirmar a extensão), é uma extensão natural do mesmo padrão, mas não foi pedida agora — registrado como decisão em aberto (seção 11).

## 11. Decisões em aberto desta revisão (seção 10)

- **Extensão de série (`extend-recurrence`) ganha lista editável também?** Hoje é só um número; poderia virar a mesma lista editável da criação. Não pedido explicitamente — confirmar antes de implementar.
- **Regeneração ao mudar a quantidade preserva edições manuais?** Hoje, no parcelamento, mudar a quantidade descarta as edições feitas nas linhas existentes (regenera do zero). Vale decidir se a recorrência deve se comportar igual (mais simples, consistente) ou diferente (preserva o que já foi editado manualmente, só ajusta as linhas novas/removidas) — e, se a decisão for "preservar", se isso deveria valer pro parcelamento também, já que é o mesmo componente de lista.
- **Rótulo dinâmico do campo "Valor"** (seção 10.3): proposta registrada, não confirmada — decidir o texto exato de cada variação antes de implementar.
