# Testes

Plano completo: [docs/testing/test-plan.md](../docs/testing/test-plan.md) · Falhas conhecidas: [docs/testing/known-failures.md](../docs/testing/known-failures.md)

## Como rodar

| Comando | O que roda | Precisa de |
|---|---|---|
| `pnpm test` | L0 estático + L1/L2 unidade + L3-lite (handlers reais com banco em memória) + fluxos em memória | nada |
| `pnpm test:watch` | idem, em modo observação | nada |
| `pnpm test:coverage` | `pnpm test` + cobertura (`coverage/`) | nada |
| `pnpm test:api` | `tests/api` contra Postgres real | Supabase **local** (`supabase start`) |
| `pnpm test:e2e` | Playwright (Chromium) | `pnpm exec playwright install chromium` |

`pnpm test:api` sem Supabase local **pula** os testes e diz o motivo. No CI use `REQUIRE_API_TESTS=1` para transformar "indisponível" em falha. O setup **recusa** qualquer `TEST_SUPABASE_URL` que não seja `localhost`/`127.0.0.1`.

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
  e2e/               L5  Playwright
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
