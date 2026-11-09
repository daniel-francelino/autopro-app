# Testes

Plano completo: [docs/testing/test-plan.md](../docs/testing/test-plan.md) · Falhas conhecidas: [docs/testing/known-failures.md](../docs/testing/known-failures.md)

## Como rodar

| Comando | O que roda | Precisa de |
|---|---|---|
| `pnpm test` | L0 estático + L1/L2 unidade + L3-lite (handlers reais com banco em memória) + fluxos em memória | nada |
| `pnpm test:watch` | idem, em modo observação | nada |
| `pnpm test:coverage` | `pnpm test` + cobertura (`coverage/`) | nada |
| `pnpm test:api` | `tests/api` contra Postgres real | Supabase **local** (`supabase start`) |
| `pnpm test:e2e` | Playwright (Chromium): fluxos de visitante sempre; fluxos logados só com Supabase local | `pnpm exec playwright install chromium`; para os logados, as 3 variáveis `E2E_SUPABASE_*` (ver abaixo) |

`pnpm test:api` sem Supabase local **pula** os testes e diz o motivo. No CI use `REQUIRE_API_TESTS=1` para transformar "indisponível" em falha. O setup **recusa** qualquer `TEST_SUPABASE_URL` que não seja `localhost`/`127.0.0.1`.

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
| `pnpm test:stack` | sobe a stack, roda `tests/api` e o Playwright (visitante + logado) e derruba |
| `pnpm test:stack --only=e2e` | só o Playwright (`--only=api`: só os testes de banco) |
| `pnpm test:stack --keep` | não derruba no fim (para depurar; derrube com `pnpm stack:down`) |
| `pnpm test:stack --project=desktop --grep money` | o que não é flag do script vai para o Playwright |
| `pnpm stack:up` / `pnpm stack:down` | só sobe / derruba a stack |

Com a stack no ar (`pnpm stack:up`), também dá para rodar `pnpm test:e2e` direto, exportando `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY` e `E2E_SUPABASE_SERVICE_ROLE_KEY` (valores em `supabase/e2e/stack.env`). O servidor do teste ignora o `.env` do projeto (que aponta para o Supabase real) e **recusa** qualquer URL que não seja local. Dados de referência extras da stack (ex.: ações de permissão, KF-21) entram como `supabase/e2e/seed/*.sql`.

Sem as variáveis, esses arquivos são **pulados** (com o motivo) e o resto roda. O mundo de teste (organizações A/B/pendente, usuários admin, funcionário, dono da plataforma, sem oficina) é criado em `tests/e2e/support/world.ts` e apagado no fim.

## Estrutura

```
tests/
  static/            L0  lê o código-fonte (matriz de guards, planos, migrations, claims)
    baselines/       catracas: listas de exceções que só podem diminuir
  unit/
    lib/             L1  funções puras (motor de comissão, analytics, utils do front)
    server-utils/    L1/L2  utilitários de servidor (com Supabase falso)
    handlers/        L3-lite  handlers REAIS de server/api + Supabase falso
  flows/             L4  fluxos de ponta a ponta em memória (conferem o estado final)
  api/               L3  contra Supabase local (precisa de Docker)
  e2e/               L5  Playwright (support/: env, mundo de teste, fixtures de login e API)
  helpers/           fake-supabase, handler-harness, h3-stub, factories, db
  setup/             globais do Vitest e proteção contra banco real
```

## Convenções

- **Bug conhecido** → `it.fails('comportamento correto', …)` com comentário `KF-nn` e item em `known-failures.md`. Quando corrigir, o Vitest avisa e a marca sai.
- **Catraca**: a lista em `static/baselines/*.json` só pode encolher. Regravar após corrigir: `UPDATE_BASELINE=1 pnpm test`.
- Nome do teste descreve o **comportamento** (`recusa pagar OS já paga`), não o arquivo.
- Todo teste cria os próprios dados; datas dependem de `vi.setSystemTime`; `TZ=America/Sao_Paulo` é fixado no `vitest.config.ts`.
- Nada de dado real: CPFs de teste vêm de `fakeCpf()`.

## Limites do L3-lite

O `fake-supabase` implementa só o encadeamento usado (`select/eq/is/in/insert/update/delete/maybeSingle/single`). **Não** simula gatilhos, RPC, índices únicos nem joins (`select('*, rel(*)')`). Handlers que dependem disso vão para `tests/api`.
