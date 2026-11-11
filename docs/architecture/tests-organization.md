# Organização da suíte de testes

> Público: quem escreve e mantém testes do autopro-app.
> Status: **implementado em grande parte** (ver §0). Verificado em 2026-11-11 por leitura do repo e do git. A suíte **não foi executada** nesta revisão; a imagem Docker de produção ainda não terminou o build.
>
> O texto de §1 a §8 é o **diagnóstico original** e usa os nomes antigos (`unit`, `api`, `helpers`, `NN-*.e2e.ts`). A estrutura atual está em `tests/README.md`. Decisões respondidas estão em §9; o que sobrou está em §0.

## 0. Status da implementação (2026-11-11)

Evidência = arquivo ou comando verificado no repo. "Não executado" = o comportamento não foi rodado nesta revisão.

### 0.1 Fases

| Fase | Situação | Evidência |
|---|---|---|
| 0(a) Linha de base de execução | **Não feita.** Nenhuma medição registrada; `tests-performance-measurements.md` não existe | — |
| 0(b) Rótulos e documentação | **Feito** | `tests/README.md`; `docs/testing/test-plan.md:13` |
| 0(c) Gerador do inventário de `docs/testing/domains/` | **Não localizado** (busca em `scripts/` sem resultado) | — |
| 1 Apoio em `tests/support/` | **Feito.** Fixtures renomeados para `auth-fixtures.ts` e `order-fixtures.ts`; alias `h3` em `vitest.config.ts:10` | `tests/support/`, `tests/e2e/support/auth-fixtures.ts`, `tests/e2e/service-orders/support/order-fixtures.ts` |
| 2 Mover por domínio | **Feito.** `fast/<domínio>/` (access, admin, audit, auth, commissions, financial, flows, lib, reports, service-orders, users). `db/` ficou plano (3 arquivos). `static/baselines/` mantido | `tests/fast/`, `tests/db/` |
| 3 Projetos e nomes | **Feito.** Projetos `fast` e `db`; `api` virou alias em `scripts/test-stack.mjs:33`; numeração removida das E2E de OS | `vitest.config.ts:26,37`; `package.json:14-17` |
| 4 Redundância | **Só o mapa** (rascunho, nenhuma asserção removida) | `docs/architecture/tests-redundancy-map.md` (não versionado) |

### 0.2 Opções de desempenho (§10.3)

| Opção | Situação | Evidência |
|---|---|---|
| 1 Medir antes | **Não feito** | — |
| 2 Reutilizar `.output` com carimbo | **Feito** (sem validação por execução de invalidação) | `scripts/test-stack.mjs:57-101`; cache `.output` em `.github/workflows/ci.yml` |
| 3 Rodar subconjunto | **Funciona** via `--grep`; tags `@mobile` e `@demo-seed` existem | `tests/e2e/service-orders/volume-seed-demo.e2e.ts:57` |
| 4 Separar camadas por gatilho | **Já era assim no CI** (`static`, `api`, `e2e`) | `.github/workflows/ci.yml` |
| 5 Stack reutilizável | **Feito**: `--keep` e `--reuse` | `scripts/test-stack.mjs:4-5` |
| 6a Snapshot de banco com migrations | **Não feito** | — |
| 6b Uma consulta de migrations aplicadas | **Feito** | `supabase/e2e/migrate.sh:20-28` |
| 7 Esperas fixas por condição | **Feito**: nenhum `waitForTimeout` em `tests/` | `tests/e2e/support/settle.ts` |
| 8 Paralelismo | **Não medido** | — |
| 9 Regra `@mobile` | **Mantida** | `playwright.config.ts` |
| 10 Cache no CI | **Parcial**: Chromium e `.output` feitos; imagens Docker não | `.github/workflows/ci.yml` (cache do Chromium e de `.output`) |
| 11 Seed demo opcional | **Feito**: tag `@demo-seed` e `--with-demo-seed` | `scripts/test-stack.mjs:9,31,223` |
| 12 Build de teste sem módulos | **Não feito** (não recomendado como primeira ação) | — |

### 0.3 Docker (novo, fora do plano original)

- `Dockerfile` com três alvos: `build` (pnpm + `nuxt build` com 8 GB de heap), `test` (build + Chromium do Playwright) e `runtime` (imagem de prod, só `.output`, usuário `node`, porta 3000).
- `.dockerignore` exclui `node_modules`, `.nuxt`, `.output`, `.env*`, `docs` e demais saídas locais.
- `docker-compose.app.yml` é um overlay do `docker-compose.e2e.yml`, com o serviço `tests` (perfil `app`, container `autopro-e2e-tests`). Ele usa `network_mode: service:gateway`, então enxerga a stack em `127.0.0.1:8000`, que é aceito pelo guard de `tests/support/global-setup.ts`.

Comandos (ainda **não executados até o fim**):

```bash
# Imagem de produção
docker build --target runtime -t autopro-app:prod .

# Testes na stack Docker: db e E2E contra o build de produção (.output)
docker compose -f docker-compose.e2e.yml -f docker-compose.app.yml --env-file supabase/e2e/stack.env --profile app run --rm tests

# Derrubar a stack e apagar os dados
docker compose -f docker-compose.e2e.yml -f docker-compose.app.yml --env-file supabase/e2e/stack.env down -v
```

Status: o build da imagem `runtime` foi iniciado e ainda não concluiu (`nuxt build` do servidor em andamento). O alvo `test` não foi executado.

### 0.4 Pendências

1. Rodar a imagem de prod e o alvo `test` até o fim; registrar o resultado aqui.
2. Carregar o seed demo no fluxo de teste (decisão 4, §9). O ramo `/seed` de `supabase/e2e/migrate.sh:37` existe, mas nenhum compose monta `/seed`. Hoje `--with-demo-seed` roda `scripts/seed/load-demo.mjs` pelo host.
3. Adicionar alvos ao `Makefile` para o container de testes e a imagem de prod (decisão 7, §9).
4. Linha de base (0a) e medições de §10.5, agora possíveis pelo container.
5. Snapshot de migrations (6a), cache de imagens Docker no CI (10) e verificação da ordem independente dos E2E de OS (P5, com `--workers=1` em ordem inversa).
6. Fase 4: aprovação da matriz (§4) por `test-reviewer` antes de remover qualquer asserção.

## 1. Diagnóstico com evidências

### 1.1 Inventário (confirmado)

78 arquivos em `tests/` (contagem por `find`). Runners e projetos em `vitest.config.ts` e `playwright.config.ts`:

| Pasta | Arquivos | Projeto | Evidência |
|---|---|---|---|
| `static/` | 2 testes + 6 baselines | Vitest `unit` | `vitest.config.ts:25` (include) |
| `unit/lib` 4, `unit/server-utils` 9, `unit/handlers` 11, `unit/audit` 3 | 27 | Vitest `unit` | `vitest.config.ts:25` |
| `flows/` | 1 | Vitest `unit` | `vitest.config.ts:25` |
| `api/` | 3 | Vitest `api` (Postgres real, `fileParallelism: false`) | `vitest.config.ts:33-41` |
| `e2e/` 7 + `e2e/service-orders/` 12 | 19 | Playwright (`testMatch **/*.e2e.ts`) | `playwright.config.ts` |
| apoio | 19 (`helpers` 6, `setup` 3, `e2e/support` 3, `e2e/service-orders/support` 7) | | |

### 1.2 Problemas

**P1. Rótulos de camada não batem com as pastas (confirmado).**
`tests/README.md:9` e `:56-57` chamam `handlers/` de "L3-lite" e `flows/` de "L4", mas ambos rodam no projeto `unit` (`package.json:14` `vitest run --project unit`), que "não precisa de nada". `unit/handlers/money-flows.test.ts:1-3` se declara "L3-lite" e usa handlers reais com `createFakeSupabase` (`:6`). O nome `unit` descreve mal: são testes de integração em memória. O que realmente separa as pastas de topo é o que a execução exige (nada, Postgres, navegador), e essa divisão está correta.

**P2. Domínio espalhado (confirmado em parte).**
Pagamento de OS aparece em `unit/handlers/{service-order-payments,financial-payments,money-flows}.test.ts`, `unit/server-utils/{payments-l2,commissions-release}.test.ts`, `flows/undo-payment.test.ts`, `e2e/money-flows.e2e.ts` e `e2e/service-orders/{06,07,08}-*.e2e.ts`. Autorização está em `guard-matrix`, `guards-l2`, `financial-permissions`, `users-roles-security`, `owner-panel-security`, `admin-panel`, `admin-audit-logs` e outros. Não há convenção que diga onde procurar "onde X é testado".

**P3. Nomes e apoio dispersos (confirmado).**
- Sufixos `-l2` (`guards-l2`, `payments-l2`), `-lite`, `-utils`, `-security`, `-consistency` sem regra.
- Dois `fixtures.ts` diferentes: `tests/e2e/support/fixtures.ts:1` (mundo por worker, login, `Api`) e `tests/e2e/service-orders/support/fixtures.ts:1` (catálogo e `shop`; este importa o primeiro em `:4`).
- Apoio em quatro pastas.

**P4. Códigos de cenário sem ponte local (confirmado).**
Ex.: `tests/unit/handlers/financial-payments.test.ts:2` (`P45–P48, C37…` apontando para `docs/testing/financial-core-test-analysis.md`) e `:104` `describe('P45 / KF-43: …')`. Os códigos mais repetidos nos unit/flows são `R2`, `M1`, `KF-24`, `KF-09`. Alguns já estão no título do `describe`; outros só no comentário do cabeçalho. Não há índice código -> arquivo.

**P5. Numeração `01–12` nas E2E de OS (parcialmente confirmado).**
Todos os arquivos só usam `test.describe.configure({ timeout })` (ex.: `01-listing.e2e.ts:13`); nenhum usa `serial`. `playwright.config.ts` não define `fullyParallel` nem `workers`, e `e2e/support/fixtures.ts:1` declara "um mundo por worker" (`world.ts` cria orgs/usuários próprios e `cleanup`). Logo, arquivos distintos não compartilham estado e a ordem não é garantida pelo Playwright. A numeração é só ordenação visual e espelho do catálogo `docs/testing/e2e-service-orders.md:63` (que lista os nomes numerados). Isso é forte evidência, mas **não foi comprovado por execução**.

**P6. CORRIGIDO: `12-volume-seed-demo` não é seeder.**
O rascunho dizia que era carga/seed e propunha movê-lo para `scripts/seed/`. A leitura mostra o contrário (`12-volume-seed-demo.e2e.ts:1-2`): é teste **somente leitura** contra o seed demo já carregado (`pnpm seed:demo`, 1.265 OS), que se **pula com motivo** se o seed não existe (`:26-28`, `beforeEach` com `test.skip`). Ele depende de `supabase/seeders/demo/demo.meta.json` (`:11`) e de login demo fixo (`:10`). O problema real é outro: é um teste que, no CI, sempre pula, e o `beforeAll` dele é o único do conjunto. Ele deve continuar sendo teste; precisa de uma marca (`@demo-seed`) ou projeto Playwright próprio, não de ser movido para `scripts/`.

**P7. Documentação divergente (confirmado, contagens corrigidas).**
- `docs/testing/test-plan.md:13` diz "o repositório não tem nenhum teste". Falso hoje.
- `test-plan.md` §3.2 (`:90`) é "Estrutura de pastas proposta", sem relação com o real.
- Referências a `tests/…` fora de `tests/`: grep encontra 51 arquivos, dos quais ~5 são falsos positivos (rascunho anterior, `.claude/commands/build.md:35` "tests/checks", `extraction-spec.md` x2). **34 são `docs/testing/domains/*.md`**, mais `docs/testing/{test-plan,e2e-scenarios,e2e-service-orders,known-failures}.md`, `docs/admin/owner-panel-plan.md`, `docs/audit/audit-log-plan.md`, `supabase/seeders/demo/README.md:21`, `.github/workflows/ci.yml:43,64`, `scripts/test-stack.mjs:3`, `docker-compose.e2e.yml:1`, `eslint.config.mjs:11`, `playwright.config.ts`, `vitest.config.ts`.
- `docs/testing/domains/auth.md:3` diz que o inventário é "automático (código-fonte + `tests/`)" e lista rotas "citadas em `tests/`". Não achei o gerador em `scripts/` nem em `package.json`. **Se existe, ele varre `tests/` por texto e pode depender de nomes de arquivo**; isso precisa ser descoberto antes de mover.

**P8. NOVO: acoplamentos de caminho que o rascunho não listava.**
- `tests/helpers/source-scan.ts:5` calcula `ROOT` como dois níveis acima do arquivo; `:47` hardcoda `tests/static/baselines`. Mover `helpers/` para `support/` mantém a profundidade (ok); mover `static/baselines` quebra `source-scan.ts:47` e as mensagens `codebase.test.ts:50`.
- `eslint.config.mjs:11` usa glob `tests/**/*.ts`: seguro.
- `scripts/test-stack.mjs:73` chama `--project api` explicitamente (o rascunho só citava `package.json` e o CI). Renomear projeto exige mudar aqui também.
- `tests/static/e2e-stack.test.ts` lê `ci.yml`, `docker-compose.e2e.yml`, etc. como texto (`:5-48`): qualquer edição de CI na Fase 3 pode quebrar esse teste.
- `vitest.config.ts:10` define o alias `h3` para `tests/helpers/h3-stub.ts`: caminho do alias precisa mudar na Fase 1.

### 1.3 Causa raiz (mantida)

As pastas misturam dois eixos: o que a execução exige (nada, Postgres, navegador) e a forma do código (`handlers`, `server-utils`, `lib`). Nenhum responde "qual regra de negócio este teste protege?".

## 2. Princípios

1. Pasta de topo = custo/infraestrutura de execução (já é assim; manter).
2. Dentro do topo, pasta = domínio **somente quando houver 2 ou mais arquivos**; senão, fica na raiz da camada. Hoje há ~55 testes sem E2E e ~12 domínios candidatos; pastas de 1 arquivo só adicionam navegação.
3. Nome do arquivo = assunto, sem código de camada (`payments.test.ts`, não `payments-l2.test.ts`).
4. Um comportamento tem uma camada canônica (§4).
5. Código de cenário no título do `describe` (como `financial-payments.test.ts:104` já faz) e índice único em docs.
6. Apoio em um lugar só (`tests/support/`) com nomes únicos.
7. Cada fase deve ser verificável por comparação mecânica (lista de títulos de teste antes/depois), não por "ficou verde".

## 3. Estrutura alvo

```
tests/
  static/                 # lê código-fonte; sem app (mantém baselines/)
  fast/                   # sem Docker; funções puras + Supabase falso (hoje unit/ + flows/)
    access/ admin/ audit/ auth/ commissions/ financial/ reports/ service-orders/ users/
    flows/                # jornadas multi-domínio (undo-payment)
    lib/                  # utilitários sem domínio claro (analytics, app-utils, recurrence, site-check até classificar)
  db/                     # Postgres real (hoje api/); plano: manter plano (3 arquivos) ou admin/ audit/
  e2e/                    # Playwright
    support/              # env, world, auth-fixtures
    service-orders/       # sem numeração; support/ com order-fixtures
  support/                # antigos helpers/ + setup/
```

Observação: `fiscal/`, `bonuses/`, `roles/` do rascunho ficam fora até existir 2 arquivos (`bonuses.test.ts` entra em `commissions/`; não há teste de fiscal).

### 3.1 Alternativas

- **A (mínima, recomendada como primeiro passo):** só corrigir rótulos e documentação, sem mover nada; opcionalmente renomear `unit/handlers` para `unit/integration`-like. Resolve P1/P7 por custo quase zero e deixa P2 para depois. É a menos arriscada.
- **B (rascunho original):** topo por infraestrutura, domínio no meio, renomear projetos para `fast`/`db`. Resolve P2, custa ~51 arquivos com referências, 40 imports e CI.
- **C (domínio no topo):** rejeitada, espalha scripts e CI.
- **Nota sobre renomear projetos:** `unit`->`fast` e `api`->`db` tocam `package.json:14-18`, `scripts/test-stack.mjs:73`, `ci.yml` e README; o ganho é só semântico. Pode ser adiado sem prejudicar o resto.

## 4. Matriz de camada canônica

Corrige o rascunho: a matriz M1 (sem sessão -> 401) **não é estática**; `unit/handlers/guard-matrix.test.ts:1-2` executa handlers reais com Supabase falso. A camada `static/` guarda apenas catracas por varredura de fonte (`unguarded-routes.json`, etc.).

| Comportamento | Camada canônica | Complemento permitido |
|---|---|---|
| Rota existente exige guard (varredura) | `static/` (catraca) | nenhum |
| Sem sessão -> 401 em todo handler | `fast/access` (M1) | nenhum por domínio |
| Permissão por papel (403) | `fast/<domínio>` | 1 E2E de smoke (`11-permissions-isolation`) |
| Isolamento por `organization_id` | `fast/<domínio>` (filtros) | `db/` para constraint/RPC reais; E2E de smoke |
| Saldo, parcela, estorno, comissão | `fast/financial`, `fast/service-orders`, `fast/commissions` | `db/` para gatilho/índice (o próprio `money-flows.test.ts:2-3` já diz que gatilho/RPC fica no `api`); E2E 1-2 caminhos |
| Número de relatório bate com a fonte | `fast/reports` | E2E só confirma renderização |
| Cálculo (arredondamento, vigência) | `fast/` | nunca E2E |
| Navegação, modal, login | `e2e/` | |

A frase "RLS não se aplica" do rascunho foi removida: não há evidência no código lido.

Regra: um E2E não repete asserção de valor que um teste `fast/` já prova. **Antes de aplicar**, precisa de levantamento por comportamento (ver Fase 4); o rascunho não o fez.

## 5. Convenções

- `fast/` e `db/`: `<assunto>.test.ts`; sem `-l2`, `-lite`, `-utils`, `-security`, `-consistency`. Colisão de nomes ao tirar sufixos é possível (`admin-panel.test.ts` existe em `unit/handlers` e `api`); aceitável por estarem em pastas de camada diferentes.
- E2E: `<fluxo>.e2e.ts`, sem número.
- Fixtures E2E: `auth-fixtures.ts` e `order-fixtures.ts`. Renomear `fixtures.ts` -> `auth-fixtures.ts` é rename real (nome diferente), sem o problema de capitalização no Windows.
- Prefixos `helpers-*.ts` em `service-orders/support` permanecem; renomeá-los é opcional e de baixo valor (já estão numa pasta própria).
- `describe('[P45] …')` onde o código existir; `docs/testing/scenario-index.md` opcional.

## 6. Mapeamento de migração

| Hoje | Destino | Nota |
|---|---|---|
| `helpers/*`, `setup/*` | `support/` | 40 linhas de import (`grep from '…/(helpers|setup)/'`); alias `h3` em `vitest.config.ts:10`; `source-scan.ts` |
| `unit/lib/{analytics,app-utils}`, `unit/server-utils/{recurrence,site-check}` | `fast/lib/` | classificação por domínio é decisão do time |
| `unit/lib/employee-commission-engine`, `unit/server-utils/{commissions-release,bonuses}` | `fast/commissions/` | |
| `unit/lib/auth-middleware`, `unit/server-utils/auth-utils` | `fast/auth/` | |
| `unit/server-utils/guards-l2`, `unit/handlers/guard-matrix`, `financial-permissions`, `users-roles-security` | `fast/access/` (ou `users/`) | `guard-matrix` é lido por `codebase.test.ts` e `financial-permissions.test.ts` (citação textual) |
| `unit/handlers/{admin-panel,admin-audit-logs,owner-panel-security}`, `server-utils/admin-panel-utils` | `fast/admin/` | |
| `unit/audit/*` | `fast/audit/` | |
| `unit/handlers/{service-order-edit,service-order-payments,money-flows}`, `server-utils/payments-l2`, `handlers/financial-payments` | `fast/service-orders/` e `fast/financial/` | dividir por assunto só na Fase 4, não ao mover |
| `unit/handlers/reports-consistency`, `server-utils/reports` | `fast/reports/` | |
| `flows/undo-payment` | `fast/flows/` | profundidade muda (2 -> 3) |
| `api/*` | `db/` (plano) | manter plano evita mudar profundidade |
| `static/*` | `static/` | não mover `baselines/` |
| `e2e/service-orders/NN-*` | **feito**: sem numeração (`listing.e2e.ts`, `creation.e2e.ts`…) | `docs/testing/e2e-service-orders.md:63` ainda cita os nomes numerados (pendente) |
| `e2e/.../12-volume-seed-demo` | **feito**: `volume-seed-demo.e2e.ts`, tag `@demo-seed`, seed opcional via `--with-demo-seed` | ver P6 e §9 item 4 |

## 7. Fases

**Fase 0 (sem mover nada).** (a) Medir linha de base: `pnpm test` e `pnpm test:api` (com Docker), guardando a **lista de títulos** (`vitest run --reporter=json`) e a contagem de passou/pulou. (b) Corrigir `tests/README.md` (rótulos) e `docs/testing/test-plan.md:13` e §3.2. (c) Achar o gerador do inventário de `docs/testing/domains/*` (P7).

**Fase 1 (apoio).** `helpers/`+`setup/` -> `support/`; renomear os dois `fixtures.ts`. Atualizar alias `h3`, `source-scan.ts`, `vitest.config.ts` (`setupFiles`, `globalSetup`), 40 imports. Profundidade não muda.

**Fase 2 (mover por domínio).** `git mv` por grupo. Conteúdo não muda. Pastas `unit/<x>/` e `fast/<dom>/` têm a mesma profundidade, então `../../../server` (74 ocorrências) e `../../support` continuam válidos; só `flows/` precisa de um `../` extra e `api/` se for para `db/<dom>/`. Atualizar `include` do Vitest e ~46 docs/configs.

**Fase 3 (nomes, scripts, E2E).** Opcional: renomear projetos (`package.json`, `test-stack.mjs:73`, `ci.yml`, README, `e2e-stack.test.ts`). Remover numeração das E2E de OS.

**Fase 4 (redundância).** Remover asserções repetidas segundo §4.

### 7.1 Fase de maior risco

Dois candidatos:

- **Fase 2** é a mais arriscada de **quebra** (muito toque, 74 caminhos de `vi.mock`/imports relativos, docs e geradores), mas é mecânica e detectável: falha em segundos.
- **Fase 4** é a mais arriscada de **perda silenciosa**: apagar asserção não derruba nada. O rascunho a deixa como último passo, o que é correto, mas ele não define o critério de remoção.

Pré-condições concretas:

Para a Fase 2:
1. Linha de base da Fase 0 gravada (lista de títulos por arquivo, contagem de pulados).
2. Um commit/PR por grupo, `git mv` sem edição de conteúdo no mesmo commit que o move, para o git detectar rename.
3. Verificação automática: mesma lista de títulos de testes depois (diff vazio).
4. `grep` de `vi.mock\('\.\./` e `from '\.\./` nos arquivos movidos; `flows/undo-payment` com `../` ajustado.
5. Gerador de inventário dos docs identificado e rodado (ou aceitar que os docs de domínio ficam desatualizados e atualizá-los por busca e troca).
6. `pnpm test:api` e `pnpm test:stack --only=e2e` executados ao menos na PR final, porque o CI roda `tests/api` e E2E por Docker e o rascunho só exigia `pnpm test`.
7. Plano para não mover `static/baselines` (acoplado em `source-scan.ts:47`).

Para a Fase 4:
1. Matriz §4 aprovada por `test-reviewer`.
2. Para cada asserção removida, apontar o teste que cobre o mesmo comportamento (tabela comportamento -> arquivo:linha).
3. Uma PR por domínio; revisão independente obrigatória.
4. Mutação manual ou teste de mutação opcional em regra financeira antes de remover.

## 8. Riscos

- Suíte não executada; "verde" na linha de base é desconhecido.
- P5 e a independência dos E2E de OS não foram provados por execução (`--workers=1` em ordem inversa seria o teste barato).
- E2E dependem de Docker; mover arquivos sem rodar a stack pode esconder quebra de import até o CI.
- Edições em `ci.yml` podem quebrar `static/e2e-stack.test.ts`.
- Gerador de inventário dos docs não localizado.
- A contagem de domínios (35 arquivos em `docs/testing/domains/`, 34 `.md` de domínio mais README) é maior do que o necessário para as pastas de teste; usá-la como taxonomia completa criaria pastas vazias.

## 9. Decisões (respondidas pelo usuário)

| # | Decisão | Resposta | Situação |
|---|---|---|---|
| 1 | Escopo | Fazer A e B | Feito (fases 0 a 3, §0.1) |
| 2 | Renomear projetos Vitest | Renomear (`fast`, `db`) | Feito; `api` é alias |
| 3 | Taxonomia | Uma pasta por domínio | Feito em `tests/fast/`; `db/` plano |
| 4 | `12-volume-seed-demo` | Deve ser seed para o Playwright ter dados | Tag `@demo-seed` e `--with-demo-seed` feitos. **Pendente:** seed dentro do container (§0.4, item 2) |
| 5 | Códigos de cenário | Manter o código como prefixo do título | Regra de §5; índice opcional não criado |
| 6 | Execução | Implementar tudo e depois abrir o PR | Em andamento; nada commitado por esta revisão |
| 7 | Quem roda a linha de base com Docker | Docker disponível; quer ajuda via comandos (Makefile) | Imagens e overlay criados (§0.3); alvos do Makefile **pendentes** |

---

## 10. Desempenho da execução dos testes

> Análise de leitura (nenhum build, Docker ou teste foi executado). **Fato** = verificado no código/configuração, com `arquivo:linha`. **Estimativa** = inferência sem medição. O repositório não contém nenhuma medição de tempo por etapa (`.test-output/` só tem `coverage`), então **nenhum número de minutos abaixo é medido**; os "30 min ou mais" relatados pelo time são um relato, não um dado do repositório.

### 10.1 Diagnóstico: onde o tempo provavelmente vai

O que roda em cada `pnpm test:stack` (fato, `scripts/test-stack.mjs`), sempre em sequência:

1. `docker compose up -d --wait` (linha 64): sobe a stack do zero.
2. `vitest run --project api` (linha 73), se `--only` for `all` ou `api`.
3. `nuxt build` (linha 90), **a cada execução**, a menos que se passe `--no-build` (linha 89).
4. `playwright test` com `E2E_SERVER=prod` (linha 98).
5. `docker compose down -v` no `finally` (linha 108): apaga tudo; a próxima execução recomeça do passo 1.

Scripts do `package.json` (fato): `test:stack` = `node scripts/test-stack.mjs` (linha 23); `test:e2e` = `playwright test` puro, que usa `nuxt dev` (linha 19); `stack:up` e `stack:down` existem (linhas 20 e 22), mas `test:stack` não reaproveita uma stack já no ar.

Ordem provável de custo (a ordem é **estimativa**; a existência de cada etapa é fato):

| # | Etapa | Evidência | Avaliação |
|---|---|---|---|
| 1 | **`nuxt build` em toda execução** | `scripts/test-stack.mjs:89-96`; `nuxt.config.ts:25-36` (9 módulos, incl. `@nuxt/content`, `nuxt-og-image`, `@nuxtjs/sitemap`, `@vite-pwa/nuxt`, `@nuxt/image`, `@nuxt/ui`); `nuxt.config.ts:114-119` (`prerender: true` em `/`, `/pricing`, `/perguntas-frequentes`, `/llms.txt` e uma rota por página de `content/paginas`); `nuxt.config.ts:134-137` (sourcemap de cliente ligado); PWA gera service worker/workbox (`:232-268`). Não existe variável que desligue módulos em teste (a única condicional por ambiente é `analyticsEnabled`/`oneSignalEnabled`, que não afetam o tempo de build). | Candidato nº 1 (estimativa). Build de produção com 2 bundles (cliente + servidor Nitro), prerender e sourcemaps costuma ser a etapa mais longa. O comentário em `test-stack.mjs:86-87` diz que o `nuxt dev` passa de 3 min na primeira subida, o que indica que a compilação não é barata em nenhum modo. |
| 2 | **Subida da stack + migrations** | `docker-compose.e2e.yml:113-131` (serviço `migrate`); `supabase/e2e/migrate.sh:20-28`: para cada um dos 102 arquivos de `supabase/migrations`, um `psql` de consulta + um `psql --single-transaction` (>= 204 processos `psql`); espera de schemas com `sleep 2` em laço de até 90 tentativas (`:10-14`); `down -v` + `tmpfs` (`docker-compose.e2e.yml:34-35`) zeram o banco, então **as 102 migrations são reaplicadas a cada execução**. O gateway só fica saudável após `migrate` terminar (`:135-144`). | Fato: reaplica tudo toda vez. Estimativa: dezenas de segundos a poucos minutos; o `tmpfs` já mitiga I/O. O `sleep 2` e os healthchecks de 3 s (`:36-40`, `:69-73`, `:155-159`) adicionam granularidade de segundos, não minutos. Imagens são baixadas se não estiverem no cache do Docker (`--quiet-pull`, `test-stack.mjs:64`). |
| 3 | **Suíte Playwright em si** | 19 arquivos `*.e2e.ts` (7 em `tests/e2e/` + 12 em `tests/e2e/service-orders/`), cerca de 200 ocorrências de `test(` (contagem por grep, aproximada). Sem `fullyParallel` e sem `workers` em `playwright.config.ts`: vale o padrão do Playwright (testes de um arquivo em série; arquivos distribuídos entre workers; workers = metade dos núcleos lógicos, **comportamento padrão do Playwright, não verificado aqui**). Specs de OS têm `describe.configure({ timeout: 180_000 })` (ex.: `01-listing.e2e.ts:13`, `02-creation.e2e.ts:8`, `03-commission-preview.e2e.ts:10`, `04-status-editing.e2e.ts:8`), contra o padrão de 60 s (`playwright.config.ts:15`). | Provável 2ª ou 3ª etapa mais cara. Os 180 s são **limites**, não tempo gasto; mas indicam que o autor esperou testes lentos (provavelmente em dev). Em produção a maioria deve terminar bem abaixo disso (estimativa). |
| 4 | **Mundo de teste por worker e login** | `tests/e2e/support/fixtures.ts:41-48`: `world` com `scope: 'worker'`, criado uma vez por worker e apagado no fim. `world.ts:66-77`: 3 organizações, 2 assinaturas, 2 conjuntos de 9 categorias, 5 papéis, 6 usuários (`auth.admin.createUser`) e 6 perfis, ordem de 20-25 chamadas HTTP em série. `cleanup` (`world.ts:79-86`) apaga 6 usuários em série. Login é **por API** (`fixtures.ts:7-10`, `loginViaApi`), não pela UI; 1 `POST /api/auth/login` por `loginAs`/`apiAs`. | Fato: é barato por construção. Estimativa: segundos por worker. Não é gargalo relevante; só pesa se o número de workers crescer muito. |
| 5 | **Esperas fixas** | Apenas 4 `waitForTimeout` nos specs de negócio: `01-listing.e2e.ts:231` (500 ms), `08-installments-extra-down-payment.e2e.ts:210` (2000 ms) e `:291` (1500 ms), `11-permissions-isolation.e2e.ts:259` (1500 ms); mais `12-volume-seed-demo.e2e.ts:50` (400 ms em laço de até 200 iterações, pior caso 80 s). | Fato: o total fixo é ~5,5 s fora do spec 12. Irrelevante para o tempo total; relevante como fonte de flakiness. |
| 6 | **Seed demo (1.265 OS)** | `12-volume-seed-demo.e2e.ts:16` (timeout 600 s), `:24-28` (pula quando `demo.meta.json` ou as OS não existem). O seed é carregado manualmente por `pnpm seed:demo` (`package.json:21`, `scripts/seed/load-demo.mjs`, não lido). `docker-compose.e2e.yml` monta apenas `/migrations` e `/e2e` (`:128-129`); o ramo `/seed` de `migrate.sh:31-37` aponta para um diretório que não é montado. | Fato: o `test:stack` **não carrega** o seed, então o spec 12 é pulado e **não** contribui para os 30 min. O custo existe só quando alguém roda `pnpm seed:demo` antes. Custo do loader: **não medido** (script não lido). |
| 7 | **Projetos desktop/mobile** | `playwright.config.ts:27-30`: o `mobile` usa `grep: /@mobile/`. Só 3 pontos marcados: `routing.e2e.ts:38` (describe), `01-listing.e2e.ts:281`, `06-receive-payment.e2e.ts:324`. O CI roda só `--project=desktop` (`ci.yml:96`). | Fato: o mobile **não duplica** a suíte; roda poucos testes. Custo desprezível. |
| 8 | **Traces, vídeo, retries** | `trace: 'retain-on-failure'`, `video: 'off'` (`playwright.config.ts:23-25`); `retries: 1` só no CI (`:16`). | Fato: custo baixo. No CI, cada falha custa o dobro (retry), mas só em falha. |
| 9 | **Testes `api`** | `vitest.config.ts:43` `fileParallelism: false`; `globalSetup` (`tests/setup/global-setup.ts:17-42`) só faz um `fetch` de 3 s para checar o Supabase: **não** aplica migrations nem sobe stack. | Fato: serial por segurança (arquivos compartilham o mesmo banco). O comentário do CI diz "cerca de 2 min" para o job `api` (`ci.yml:43`; relato, não medição). |

**Pontos de CI** (`.github/workflows/ci.yml`): jobs `static` (`:12`), `api` (`:44`) e `e2e` (`:72`, só em PR para `main` ou no agendamento noturno `:7-8`, timeout 40 min). Cache existente: apenas o store do pnpm via `setup-node` `cache: pnpm` (`:25`, `:59`, `:87`). **Não há cache** de `.nuxt`, `.output`, do Chromium do Playwright (`:92-93` reinstala com `--with-deps` a cada execução) nem das imagens Docker. O job `e2e` sempre faz o `nuxt build` (não usa `--no-build`, `:96`) e os jobs `api` e `e2e` sobem, cada um, sua própria stack e reaplicam as 102 migrations.

**Conclusão do diagnóstico (inferência, não medição):** a causa mais provável da lentidão é a soma de `nuxt build` completo + stack Docker recriada + 102 migrations reaplicadas, **repetidos em toda execução**, e não o custo dos testes em si. O time contornou o build usando `nuxt dev`, que troca o custo do build por compilação sob demanda; mas `test-stack.mjs:86-87` já registra que o dev passa de 3 min na primeira subida, então ele só compensa em sessão longa com servidor reaproveitado (`reuseExistingServer`, `playwright.config.ts:36`).

### 10.2 Por que o servidor de dev é mais rápido, mas menos preciso

Mais rápido porque: não há build antecipado, a compilação é sob demanda por rota, o servidor pode ser reaproveitado (`reuseExistingServer: !process.env.CI`, `playwright.config.ts:36`) e a Vite compila só o que é visitado.

O que o dev esconde (conhecimento geral de Nuxt/Vite aplicado a este projeto; nenhum incidente concreto foi verificado):

- **Compilação na primeira visita de cada tela:** o 1º acesso a cada rota paga a transformação dos módulos; os timeouts de 15-45 s e os 180 s dos specs de OS foram dimensionados para isso. O comentário em `12-volume-seed-demo.e2e.ts:67` ("dev server is slower than production") admite a diferença. Efeito: limites de tempo frouxos que não detectam regressão de desempenho em produção.
- **Build de produção diferente:** minificação, tree-shaking, code splitting, ordem de CSS e remoção de código condicionado a `import.meta.dev`. Um import que só funciona porque o dev carrega tudo, ou um efeito colateral eliminado pelo tree-shaking, só falha no build.
- **SSR e hidratação:** em dev, mismatches de hidratação viram avisos; em produção, o payload e as rotas pré-renderizadas (`nuxt.config.ts:114-119`) mudam o caminho de renderização. `/app/**` tem `prerender: false` (`:120-121`), mas `/`, `/pricing` e as páginas de conteúdo são estáticas só no build.
- **Módulos que só atuam em produção:** o PWA/service worker está desligado em dev (`devOptions.enabled: false`, `nuxt.config.ts:272-274`); `analyticsEnabled` e `oneSignalEnabled` dependem de `NODE_ENV === 'production'` (`:89-91`, `:95-97`); robots, sitemap e OG image são gerados no build. Bugs de service worker/cache, de robots/sitemap e de telemetria **não são exercitados em dev**.
- **Variáveis de ambiente:** o `runtimeConfig` lê `process.env` no build (`nuxt.config.ts:73-85`; comentário em `test-stack.mjs:86-87`); um valor ausente no build pode passar em dev e falhar em produção.

**Quando o dev pode mascarar bug real:** fluxos que dependem de hidratação, service worker/PWA, rotas pré-renderizadas, SEO/robots/sitemap, limites de tempo de carregamento, código condicionado a `NODE_ENV` e qualquer regressão de bundle (import quebrado, chunk faltando). **Quando é aceitável:** lógica de handler/API (servida pelo Nitro de forma equivalente), regras de negócio validadas pela UI sem dependência de hidratação ou de módulos de produção, e iteração local em um spec isolado.

### 10.3 Opções, em ordem de custo/benefício

| # | Opção | Ganho esperado | Risco | Como validar |
|---|---|---|---|---|
| 1 | **Medir primeiro** (seção 10.5). | Evita otimizar a etapa errada. | Nenhum. | Ver 10.5. |
| 2 | **Reutilizar o build (`.output`) quando o código não mudou.** Já existe `--no-build` (`test-stack.mjs:20`, `:89`), mas depende de disciplina humana. Melhoria sugerida: um carimbo (hash dos diretórios `app/`, `server/`, `lib/`, `content/`, `nuxt.config.ts`, lockfile e das variáveis de build) gravado ao lado de `.output` e comparado antes de decidir pular o build. No CI, `actions/cache` com essa chave para `.output`. | Alto: elimina o que provavelmente é a maior etapa nas execuções repetidas. | Servir um `.output` desatualizado dá falso verde ou falso vermelho. Também o `reuseExistingServer` (`playwright.config.ts:36`) pode reaproveitar um servidor antigo na porta 3100. | Alterar um texto de tela, rodar, e confirmar que o hash invalida o build e que o spec enxerga a mudança. |
| 3 | **Rodar só o subconjunto afetado.** Já funciona: `pnpm test:stack --only=e2e --project=desktop --grep OS-F` (argumentos extras vão ao Playwright, `test-stack.mjs:6`, `:23`), ou passar caminhos de arquivo. Padronizar tags (`@mobile`, `@demo-seed`) e o prefixo do código de cenário no título (decisão 5 da seção 9). | Alto no dia a dia, sem mudança de infraestrutura. | Esquecer um spec dependente. Mitigação: suíte completa antes do PR. | Conferir com `playwright test --list --grep ...` (não executa testes) quais cenários seriam rodados. |
| 4 | **Separar camadas por gatilho** (alinhado à seção 4 e à decisão 2 de renomear `unit`->`fast`, `api`->`db`): `fast` (sem Docker) a cada mudança/pré-commit; `db` no push; E2E em PR para `main` e noturno. O CI já segue quase isso (`ci.yml:12`, `:44`, `:72-73`). | Médio: corta o que roda por commit. | Bug de integração descoberto tarde (só no PR). | Registrar no CI qual camada pega cada defeito (por falha de job). |
| 5 | **Stack Docker uma vez por sessão.** Usar `pnpm stack:up` uma vez e `--keep` (`test-stack.mjs:19`, `:107`); `migrate.sh` é idempotente (`_e2e_migrations`, `:3`, `:17-23`) e só aplica o que falta, então reiniciar sem `down -v` evita reaplicar 102 migrations. Falta um modo explícito "não subir/derrubar" no runner (hoje o `up --wait` roda sempre, `:64`, mas é rápido se a stack já está no ar). | Alto para sessões de depuração/iteração. | Estado sujo entre execuções (os specs criam e apagam seu mundo; `cleanup` roda em `finally`, `fixtures.ts:44-47`, mas um processo morto no meio pode deixar dados). Reiniciar a stack periodicamente. | Rodar a mesma suíte duas vezes seguidas na mesma stack e comparar o resultado. |
| 6 | **Acelerar as migrations sem mudar a semântica.** (a) Imagem/snapshot de banco com as migrations já aplicadas, regenerada quando `supabase/migrations/` mudar (chave = hash dos arquivos); (b) reduzir os processos `psql` em `migrate.sh:20-28` (uma consulta única das migrations já aplicadas em vez de uma por arquivo). | Médio (depende da medição do passo `stack-up`). | (a) o snapshot divergir das migrations reais; manter o hash como invalidação. (b) quase nulo. | Comparar o schema (`pg_dump --schema-only`) da stack normal e da stack por snapshot. |
| 7 | **Substituir esperas fixas por condição.** Os 4 `waitForTimeout` (10.1, item 5) viram `expect.poll`/`waitForResponse`/`expect(locator)` (o `01-listing.e2e.ts:227` já usa `waitForResponse`). No spec 12, trocar o laço de 400 ms por espera na contagem de cards. | Baixo no tempo total (~5,5 s); alto na estabilidade. | Alterar teste exige revisão (fora desta tarefa). | Rodar o spec 20 vezes (`--repeat-each=20`) antes e depois. |
| 8 | **Paralelismo do Playwright.** Cada worker cria seu próprio mundo com sufixo aleatório (`world.ts:41`, `randomUUID().slice(0, 8)`), então organizações e usuários **não colidem entre workers**; em teoria é seguro. Riscos reais: (a) o spec 12 lê a org demo, só leitura (`:2`); (b) specs que consultam listas globais (`platformOwner`, `admin-panel.e2e.ts`) podem enxergar dados de outros workers; (c) o Postgres em `tmpfs` e uma única instância Nuxt viram o limite. | Médio a alto, se hoje a máquina está subutilizada (estimativa). | Flakiness por dados compartilhados; carga excessiva no servidor único. | Rodar com `--workers=1`, `2`, `4` e comparar duração e taxa de falha (3 repetições cada); só aumentar se a falha não subir. Revisar manualmente os specs que consultam listas globais. |
| 9 | **Projeto mobile só nos fluxos marcados.** Já é assim (`playwright.config.ts:29`). Nenhuma ação, apenas **manter a regra**: todo novo teste móvel precisa de `@mobile`. | Nenhum ganho adicional. | -- | -- |
| 10 | **Cache no CI.** Além do store do pnpm (já existe): cachear o Chromium do Playwright (`~/.cache/ms-playwright`, chave pela versão do `@playwright/test`), `.output` (chave da opção 2) e as imagens Docker do compose. Evitar `playwright install --with-deps` quando o cache acerta (`ci.yml:92-93`). | Médio no CI (estimativa). | Cache envenenado por chave incompleta. | Comparar a duração do passo antes e depois nos logs do job. |
| 11 | **Marcar o seed de demo como opcional.** Marcar o spec 12 com `@demo-seed` e filtrar por tag; ele já pula sozinho sem seed (`:24-28`). A decisão do usuário (seção 9, item 4) é que o seed sirva para o Playwright ter dados: se for carregado na stack, medir o custo do loader e **carregar só quando o grep incluir `@demo-seed`**. | Evita pagar o seed nas execuções que não precisam. | Seed acoplado a uma org fixa (`demo.meta.json`); testes pulados silenciosamente (mostrar o motivo no relatório). | `playwright test --list --grep @demo-seed`. |
| 12 | **Reduzir o custo do próprio build em teste** (avaliar com cuidado): desligar `sourcemap.client` (`nuxt.config.ts:136`) e módulos sem efeito nos testes (`nuxt-og-image`, `@nuxtjs/sitemap`, `@nuxtjs/robots`) por variável de ambiente só no build de teste. | Médio (a medir). | Alto: o build de teste deixa de ser o de produção e o ganho de precisão diminui. Só se a medição compensar; **não recomendado como primeira ação**. | Comparar o tempo de `nuxt build` com e sem a variável; manter ao menos um E2E contra o build completo no CI. |

**Status (2026-11-11):** as opções 2, 5, 6b, 7, 10 (parcial), 11 estão implementadas (ver §0.2). A medição (1) e a linha de base não foram feitas, então H1 a H4 continuam sem confirmação. A 12 não foi implementada.

### 10.4 Recomendação de uso no dia a dia

| Situação | Comando sugerido | Observação |
|---|---|---|
| Mudança em handler/regra (sem tela) | `pnpm test` (projeto `unit`/`fast`, sem Docker). Se tocar SQL/RPC/RLS: `pnpm test:stack --only=api` | Não precisa de build nem de navegador. |
| Mudança em tela, iterando | `pnpm stack:up` e `pnpm test:e2e <arquivo> --project=desktop` (servidor de dev, com `reuseExistingServer`) | **Dev é aceitável**: feedback rápido em um spec. Não conta como validação final. |
| Mudança em tela, validação | `pnpm test:stack --only=e2e --project=desktop --grep <código do cenário>` (build de produção, escopo reduzido) | Usar `--no-build` só se nada mudou desde o último build. |
| Antes de abrir PR | `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm test:stack` (suíte completa, com build) | Dev **não** é aceitável: o CI roda o build de produção. |
| Antes de release | `pnpm test:stack` completo, `--project=mobile` quando aplicável, `@demo-seed` com o seed carregado, e o noturno do CI verde | Dev **não** é aceitável. Smoke manual de PWA/robots/sitemap no build (o dev não os exercita, 10.2). |

Regra geral: o dev server serve para **iterar**; qualquer conclusão ("pronto", "regressão corrigida") deve ser confirmada contra o build de produção (`E2E_SERVER=prod`, `playwright.config.ts:8`, `:34`).

### 10.5 Pré-condições para medir (não executado)

Antes de mudar qualquer coisa, registrar a duração de cada etapa em execução fria e quente, anotando: núcleos de CPU, RAM, se as imagens Docker estavam em cache e se `.output` existia.

1. **Por etapa, sem alterar código:** `test-stack.mjs` já grava um log por etapa em `.test-output/logs/<etapa>.log` (`stack-up`, `api`, `build`, `e2e`, `stack-down`; linhas 34-46), mas não o tempo. Medição mínima sem editar scripts: rodar as etapas separadas com `time` (Git Bash) ou `Measure-Command { ... }` (PowerShell): `pnpm stack:up`, `pnpm exec vitest run --project api` (com as variáveis `TEST_*` de `test-stack.mjs:73-81`), `pnpm exec nuxt build` (com as variáveis de `:90-96`), `pnpm exec playwright test --project=desktop` e `pnpm stack:down`.
2. **Dentro da suíte E2E:** `VERBOSE=1` ativa o reporter `list` (`playwright.config.ts:21`) com duração por teste; alternativamente `--reporter=json` e ordenar por duração. Para o custo do mundo por worker, comparar o 1º teste de cada worker com os seguintes.
3. **Dentro do Docker:** `docker compose ... logs migrate` lista os 102 arquivos (`migrate.sh:24`); cronometrar `up -d --wait` separa a subida das migrations.
4. **Variação:** repetir 3 vezes cada medição e anotar mínimo/mediana; descartar a execução que baixa imagens.
5. **Proposta (outra tarefa, fora do escopo desta análise):** acrescentar a `run()` de `scripts/test-stack.mjs` o registro de início/fim por etapa e um resumo final, publicado no CI (`$GITHUB_STEP_SUMMARY`). Só então escolher entre as opções de 10.3 pelos números.
6. **Hipóteses a confirmar:** (H1) `nuxt build` > 40% do tempo total; (H2) `stack-up` (migrations) em segundo lugar; (H3) a suíte Playwright em produção é menor que as duas anteriores somadas; (H4) workers subutilizados. Se H1 e H2 se confirmarem, as opções 2, 5 e 6 são as prioritárias.

### 10.6 Execução em container (novo, não medido)

O container de testes evita depender do Windows para a linha de base: Linux, Chromium e Postgres da mesma stack do CI. Arquivos: `Dockerfile`, `.dockerignore`, `docker-compose.app.yml` (ver §0.3). Ainda não há medição nem validação de execução; os comandos estão em §0.3.

O alvo `test` roda na ordem do CI (`vitest --project db` e depois `playwright --project=desktop` com `E2E_SERVER=prod`). Ele não cobre o projeto `fast` nem `static`, que rodam em `pnpm test` sem Docker.
