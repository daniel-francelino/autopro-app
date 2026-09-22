# Cálculo do próximo número de OS via função SQL (em vez de buscar todas as linhas no app)

## 1. Pedido / sintoma relatado

Usuário reclamando que não consegue criar uma OS: o campo "Número" já vem preenchido com uma sugestão, ele confirma sem alterar, e o backend recusa por número duplicado. A sugestão de correção que a API devolve nesse erro sofre do mesmo problema e pode se repetir.

## 2. Causa raiz

A sugestão de número (`GET /api/service-orders/next-number`) e o recálculo de número após duplicata (dentro de `POST /api/service-orders`) fazem os dois a mesma coisa hoje: buscam **todas** as linhas de `number` da organização e calculam o maior número em JavaScript (`computeNextOsNumber`, `server/utils/service-order-number.ts:12-28`).

```ts
// server/api/service-orders/next-number.get.ts:11-15
const { data: existingOrders, error } = await supabase
  .from('service_orders')
  .select('number')
  .eq('organization_id', organizationId)
  .is('deleted_at', null)
```

O mesmo padrão se repete em dois pontos de `server/api/service-orders/index.post.ts`: na geração automática do número (linhas 76-82, quando o create chega sem `number`) e no recálculo da sugestão depois de detectar duplicata (linhas 101-107).

Dois problemas nessa abordagem:

1. **Sem paginação/limite** — o PostgREST (Supabase) corta o resultado em 1000 linhas por padrão quando a query não pagina. Organizações com mais de 1000 OS ativas recebem só uma fatia arbitrária (sem `order by`), e `computeNextOsNumber` calcula o maior número **dentro dessa fatia incompleta** — podendo sugerir um número que já existe fora dela. Confirmado que pelo menos uma organização já está na casa das 700+ OS ativas e crescendo (dump `service_orders_rows.csv`, organização `fda7436b-...`, OS4000 até OS4589 só nessa faixa).
2. **Regex do parser exige 4+ dígitos** — `VALID_OS_NUMBER_REGEX = /^OS(\d{4,})$/i` (`service-order-number.ts:2`) ignora qualquer número de OS com menos de 4 dígitos ao calcular o maior. Uma organização cujo histórico legítimo é `OS1`...`OS52` (confirmado no mesmo dump, organização `386614c4-...`) tem todo esse histórico ignorado e a sugestão cai no fallback fixo `OS4000`, sem relação com a sequência real.
3. **`DEFAULT_START_OS_NUMBER = 4000` é fixo no código e ignora a preferência que o cliente já pode configurar.** `organizations.initial_service_order_number` (`supabase/migrations/20240101000001_create_organizations.sql:60,83`, default `1`) existe exatamente para isso — é editável em `Configurações > Empresa` (`app/pages/app/settings/company.vue:736-749`, campo "Número inicial de OS": *"As novas ordens de serviço serão numeradas a partir deste valor"*) e salvo via `PUT /api/organizations` (`server/api/organizations/index.put.ts:32`). **Nenhum dos dois cálculos atuais (`computeNextOsNumber`, nem a versão RPC original deste documento) lê essa coluna** — o valor configurado pelo cliente nunca é considerado, e todo mundo cai no `4000` fixo. Isso é o detalhe mais provável por trás de "a sugestão vem com o número errado": o cliente configura, por exemplo, "começar em 100" ou "começar em 5000", e a sugestão continua ignorando isso.

Mesmo corrigindo só o regex, o problema de paginação continua: `fetchAllOrganizationRows` (`server/utils/supabase-pagination.ts`, já usado em ~15 rotas de relatório para não cair no limite de 1000) resolveria a truncagem, mas ainda transfere todas as linhas de `number` da organização pela rede só para calcular um `MAX` — desperdício de leitura no Supabase que cresce junto com o volume de OS, e que roda toda vez que o modal de criar OS é aberto.

## 3. Solução: mover o cálculo para dentro do Postgres via função SQL (RPC)

Em vez de trazer as linhas para o app e calcular o máximo em JS, uma função SQL calcula o próximo número **inteiramente no banco** e devolve um único valor escalar. Não transfere nenhuma linha de `number`, não depende de paginação, e resolve os três problemas da seção 2 na mesma mudança: o parser interno usa `[0-9]+` (sem mínimo de dígitos), e o piso do cálculo passa a ser `organizations.initial_service_order_number` em vez do `4000` fixo.

### 3.1 Regra de cálculo

O próximo número é sempre o **maior entre**:
- o maior número de OS já usado pela organização, mais 1 (continua a sequência real); e
- `initial_service_order_number` configurado pela organização (nunca sugere abaixo do piso que o cliente escolheu, mesmo que o histórico de OS ainda não tenha chegado lá — ex.: cliente configura "começar em 5000" hoje, histórico real ainda está em `OS52`, próxima sugestão deve ser `OS5000`, não `OS53`).

Quando a organização não tem nenhuma OS com número reconhecível, o resultado é só o `initial_service_order_number` configurado (que já nasce com `1` por padrão na criação da organização, e o cliente ajusta em `Configurações > Empresa` quando quiser outra faixa — seção 2, item 3).

**Decisão do time**: o `4000` fixo era intencional como "número de vitrine" para organizações novas (parecer um negócio já estabelecido) — então o comportamento é mantido, mas corrigido para vir da coluna em vez de estar hardcoded no código. `organizations.initial_service_order_number` passa a ter `DEFAULT 4000` (migration `20240101000096`, seção 3.2.1), em vez do `DEFAULT 1` original. Isso só afeta organizações criadas **a partir de agora** — `ALTER COLUMN ... SET DEFAULT` não retroage sobre linhas existentes, então organizações já cadastradas mantêm o valor que já têm hoje (a maioria em `1`, por terem sido criadas antes desta correção). Quem quiser um número inicial diferente continua ajustando em `Configurações > Empresa`, como sempre.

### 3.2 Migration nova

Próximo número livre é `20240101000095` (confirmado: até `20240101000094` já está em uso).

```sql
-- 20240101000095_add_next_service_order_number_function.sql
CREATE OR REPLACE FUNCTION public.next_service_order_number(p_organization_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT 'OS' || GREATEST(
    (SELECT initial_service_order_number FROM public.organizations WHERE id = p_organization_id),
    COALESCE(
      (SELECT MAX((regexp_match(number, '^OS([0-9]+)$', 'i'))[1]::integer)
       FROM public.service_orders
       WHERE organization_id = p_organization_id
         AND deleted_at IS NULL),
      0
    ) + 1
  );
$$;

COMMENT ON FUNCTION public.next_service_order_number(uuid) IS
  'Calcula o próximo número de OS (formato OS<n>) para uma organização, direto no banco — evita trazer todas as linhas de service_orders.number para o app só para achar o maior número, e respeita organizations.initial_service_order_number como piso mínimo (ver docs/service-orders/next-number-rpc-fix.md).';

GRANT EXECUTE ON FUNCTION public.next_service_order_number(uuid) TO authenticated;
```

Sem `ALTER TABLE`, sem índice novo — puramente aditiva, sem risco de lock/downtime em `service_orders`/`organizations`. `STABLE` (não `VOLATILE`) porque não escreve nada e o resultado só muda se as tabelas mudarem entre chamadas na mesma transação. `CREATE FUNCTION`/`GRANT EXECUTE` são recursos padrão do Postgres — sem extensão nenhuma envolvida, liberado no plano free do Supabase.

Se a organização mudar `initial_service_order_number` **depois** de já ter OS com números maiores, o `GREATEST` garante que isso não "recua" a sugestão — o piso só entra em jogo quando é de fato maior que a sequência atual.

### 3.2.1 Migration do novo default (`initial_service_order_number`)

Próximo número livre depois da 095 é `20240101000096`.

```sql
-- 20240101000096_set_initial_service_order_number_default_to_4000.sql
ALTER TABLE public.organizations
    ALTER COLUMN initial_service_order_number SET DEFAULT 4000;
```

`ALTER COLUMN ... SET DEFAULT` só muda o valor aplicado em **novos** `INSERT`s — não altera nenhuma linha existente. `server/api/stripe/webhook.post.ts:155-164` (onde a organização é criada no cadastro, via webhook do Stripe) não passa `initial_service_order_number` no `insert()`, então o valor sempre vem do default da coluna — nenhuma mudança de código necessária ali, só a migration.

### 3.3 Pontos de chamada a trocar

Os três lugares que hoje buscam `existingOrders`/`allOrders` e chamam `computeNextOsNumber` (JS) passam a chamar o RPC:

```ts
const { data: nextNumber, error } = await supabase
  .rpc('next_service_order_number', { p_organization_id: organizationId })
```

- `server/api/service-orders/next-number.get.ts:11-23` — retorno vira `{ number: nextNumber }`.
- `server/api/service-orders/index.post.ts:75-83` — geração automática do número no create sem `number`.
- `server/api/service-orders/index.post.ts:100-107` — recálculo de sugestão depois de detectar duplicata.

`computeNextOsNumber` (`service-order-number.ts:12-28`) fica sem uso depois da troca — remover junto, não deixar código morto. `normalizeOsNumber` continua (ainda normaliza o que o usuário digita manualmente).

## 4. Efeitos colaterais a cobrir (checklist de implementação)

- [x] Migration `20240101000095_add_next_service_order_number_function.sql` (seção 3.2), com o `GREATEST(initial_service_order_number, maior número + 1)` (seção 3.1).
- [x] Migration `20240101000096_set_initial_service_order_number_default_to_4000.sql` (seção 3.2.1) — novas organizações voltam a começar em `OS4000` por padrão.
- [x] `next-number.get.ts`: trocar a query + `computeNextOsNumber` pelo `.rpc(...)` (seção 3.3).
- [x] `index.post.ts`: trocar os dois pontos (geração automática e recálculo pós-duplicata) pelo `.rpc(...)`.
- [x] Remover `computeNextOsNumber` e `VALID_OS_NUMBER_REGEX`/`DEFAULT_START_OS_NUMBER` de `service-order-number.ts` (ficaram sem uso); mantido só `normalizeOsNumber`.
- [x] Tratar erro do `.rpc()` do mesmo jeito que as queries atuais tratam erro de `.select()` (500 com a mensagem do Postgres).
- [x] Conferir que `PUT /api/organizations` (`server/api/organizations/index.put.ts:32`) continua sendo o único caminho de escrita de `initial_service_order_number` — a função SQL só lê a coluna, sem mudança lá.
- [ ] **Pendente**: aplicar as duas migrations (095 e 096) no projeto Supabase (`supabase db push` ou SQL Editor do dashboard) — não foram executadas contra o banco, só criadas no repositório.
- [ ] **Pendente**: `npm run lint`/`npm run typecheck` completos no projeto (rodei lint só nos 3 arquivos tocados; não rodei o typecheck do Nuxt).

## 5. Critérios de aceite

- Abrir o modal de criar OS sugere o número correto mesmo em organizações com mais de 1000 OS ativas (sem depender de paginação no app).
- Organizações cujo histórico tem números com menos de 4 dígitos (ex. `OS1`...`OS52`) recebem sugestão contínua (`OS53`), não um salto para `OS4000`.
- A sugestão nunca vem abaixo do `initial_service_order_number` configurado pela organização em `Configurações > Empresa`, mesmo quando o histórico de OS ainda não alcançou esse valor.
- Uma organização nova (criada depois da migration 096) recebe `OS4000` como primeira sugestão, igual ao comportamento anterior — só que agora vindo do `DEFAULT` da coluna, não de uma constante fixa no código. Organizações já existentes mantêm o valor que já tinham configurado.
- Nenhuma linha de `service_orders.number` trafega da API para o app só para calcular a sugestão — a função SQL devolve um único valor.
- O fluxo de duplicata (usuário confirma a sugestão, ela já foi usada por outra criação concorrente) continua funcionando: a nova sugestão recalculada também vem do mesmo RPC.

## 6. Status

Implementado no código (migrations, `next-number.get.ts`, `index.post.ts`, limpeza de `service-order-number.ts`). Falta aplicar as migrations `095` e `096` no Supabase do projeto — ver checklist da seção 4.
