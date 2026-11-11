# Testes

Plano completo: [docs/testing/test-plan.md](../docs/testing/test-plan.md) · Falhas conhecidas: [docs/testing/known-failures.md](../docs/testing/known-failures.md)

## Como rodar

| Comando | O que roda | Precisa de |
|---|---|---|
| `pnpm test` | projeto `fast`: `static/` (lê o código) + `fast/` (funções puras, handlers reais com Supabase falso em memória e fluxos em memória) | nada |
| `pnpm test:watch` | idem, em modo observação | nada |
| `pnpm test:coverage` | `pnpm test` + cobertura (`coverage/`) | nada |
| `pnpm test:db` (apelido `test:api`) | projeto `db`: `tests/db` contra Postgres real | Supabase **local** (`pnpm stack:up` ou `supabase start`) |
| `pnpm test:e2e` | Playwright (Chromium): fluxos de visitante sempre; fluxos logados só com Supabase local | `pnpm exec playwright install chromium`; para os logados, as 3 variáveis `E2E_SUPABASE_*` (ver abaixo) |

`pnpm test:db` sem Supabase local **pula** os testes e diz o motivo. No CI use `REQUIRE_API_TESTS=1` para transformar "indisponível" em falha. O setup **recusa** qualquer `TEST_SUPABASE_URL` que não seja `localhost`/`127.0.0.1`.

## E2E por fluxo (Playwright)

Cada arquivo em `tests/e2e/*.e2e.ts` é um **fluxo de ações**, não uma tela:

| Arquivo | Fluxo | Precisa de Supabase local |
|---|---|---|
| `routing.e2e.ts` | visitante barrado nas áreas protegidas, páginas públicas, mobile (E1, E10, E11) | não |
| `guest-flows.e2e.ts` | validação de login/cadastro/recuperação, recusa de credenciais, navegação entre telas de acesso, API fechada para visitante | não |
| `auth-session.e2e.ts` | entrar → usar → sair, senha errada, sessão encerrada | sim |
| `routing-by-profile.e2e.ts` | para onde vai cada perfil (dono da plataforma, admin, funcionário, sem oficina, onboarding pendente) e 403 nas rotas do dono (E2, E3) | sim |
| `admin-panel.e2e.ts` | menu agrupado do /admin, navegação, menu do usuário reduzido, busca, tema | sim |
| `money-flows.e2e.ts` | OS → receber (à vista, parcelado, em partes) → saldo/extrato no banco → desfazer → cancelar → despesa avulsa → relatórios → isolamento entre oficinas | sim |
| `app-smoke.e2e.ts` | abre cada tela do app logado: sem erro de JS, sem API 5xx, sem redirecionamento | sim |

### Stack local (Docker): banco, Auth e API prontos

`docker-compose.e2e.yml` sobe **só o que o app usa**: Postgres, Auth (GoTrue), REST (PostgREST), Storage e um gateway em uma porta (`127.0.0.1:54421`). As migrations de `supabase/migrations` são aplicadas na subida e as chaves de teste são fixas (`supabase/e2e/stack.env`, geradas por `generate-keys.mjs`). Os dados ficam em memória: `down` apaga tudo. As portas (54421/54422) não colidem com as do `supabase start`.

| Comando | O que faz |
|---|---|
| `pnpm test:stack` | sobe a stack, roda `tests/db` e o Playwright (visitante + logado) e derruba; imprime o tempo por etapa |
| `pnpm test:stack --only=e2e` | só o Playwright (`--only=db`: só os testes de banco; `--only=build`: só o build) |
| `pnpm test:stack --keep` | não derruba no fim (para depurar; derrube com `pnpm stack:down`) |
| `pnpm test:stack --reuse` | usa a stack já no ar: não sobe, não derruba, não reaplica migrations (`migrate.sh` é idempotente via `_e2e_migrations`) |
| `pnpm test:stack --build` / `--no-build` | força / nunca roda o build. Padrão: só builda se o carimbo `.output/build-stamp.json` (hash de `app server lib content public`, config, lockfile, `.env*` e variáveis de build) não bate |
| `pnpm test:stack --with-demo-seed` | carrega o seed demo (`scripts/seed/load-demo.mjs`, 1.265 OS) na stack antes do Playwright; o spec `@demo-seed` deixa de pular (`pnpm test:e2e:demo` roda só ele) |
| `pnpm test:stack --project=desktop --grep money` | o que não é flag do script vai para o Playwright |
| `pnpm stack:up` / `pnpm stack:down` | só sobe / derruba a stack |
| `make help` | mesmos comandos como alvos do `Makefile` (opcional; todo alvo chama um script pnpm) |

Se a porta 3100 já estiver ocupada (ex.: um `nuxt dev` aberto), o modo prod não reaproveita o servidor e falha; use `E2E_PORT=3101`.

Com a stack no ar (`pnpm stack:up`), também dá para rodar `pnpm test:e2e` direto, exportando `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY` e `E2E_SUPABASE_SERVICE_ROLE_KEY` (valores em `supabase/e2e/stack.env`). O servidor do teste ignora o `.env` do projeto (que aponta para o Supabase real) e **recusa** qualquer URL que não seja local. Dados de referência extras da stack (ex.: ações de permissão, KF-21) entram como `supabase/e2e/seed/*.sql`.

Sem as variáveis, esses arquivos são **pulados** (com o motivo) e o resto roda. O mundo de teste (organizações A/B/pendente, usuários admin, funcionário, dono da plataforma, sem oficina) é criado em `tests/e2e/support/world.ts` e apagado no fim.

## Estrutura

A pasta de topo é o que a execução exige (nada, Postgres, navegador); dentro de `fast/`, uma pasta por domínio (`docs/testing/domains/`).

```
tests/
  static/            lê o código-fonte (matriz de guards, planos, migrations, claims)
    baselines/       catracas: listas de exceções que só podem diminuir
  fast/              projeto Vitest "fast": sem Docker
    access/ admin/ audit/ auth/ commissions/ financial/ reports/ service-orders/ users/
    flows/           jornadas multi-domínio em memória (conferem o estado final)
    lib/             utilitários sem domínio claro (analytics, utils do front, recorrência, site-check)
  db/                projeto Vitest "db": contra Postgres real (precisa de Docker)
  e2e/               Playwright (support/: env, mundo de teste, auth-fixtures, settle; service-orders/support/: order-fixtures)
  support/           fake-supabase, handler-harness, h3-stub, factories, db, source-scan, env, global-setup, fast-globals
```

Código de cenário vai como prefixo no título do `describe` (ex.: `[P45] …`). Marcas Playwright: `@mobile` (projeto mobile), `@demo-seed` (precisa do seed demo).

## Convenções

- **Bug conhecido** → `it.fails('comportamento correto', …)` com comentário `KF-nn` e item em `known-failures.md`. Quando corrigir, o Vitest avisa e a marca sai.
- **Catraca**: a lista em `static/baselines/*.json` só pode encolher. Regravar após corrigir: `UPDATE_BASELINE=1 pnpm test`.
- Nome do teste descreve o **comportamento** (`recusa pagar OS já paga`), não o arquivo.
- Todo teste cria os próprios dados; datas dependem de `vi.setSystemTime`; `TZ=America/Sao_Paulo` é fixado no `vitest.config.ts`.
- Nada de dado real: CPFs de teste vêm de `fakeCpf()`.

## Limites do Supabase falso (`fast/`)

O `fake-supabase` implementa só o encadeamento usado (`select/eq/is/in/insert/update/delete/maybeSingle/single`). **Não** simula gatilhos, RPC, índices únicos nem joins (`select('*, rel(*)')`). Handlers que dependem disso vão para `tests/db`.
