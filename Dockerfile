# Imagens Docker do autopro-app. Alvos:
#   runtime -> imagem de produção (só .output, roda como usuário node, porta 3000)
#   test    -> build + Playwright/Chromium + código, para rodar tests/db e tests/e2e dentro do container
#
#   docker build --target runtime -t autopro-app:prod .
#   docker compose -f docker-compose.e2e.yml -f docker-compose.app.yml --env-file supabase/e2e/stack.env --profile app run --rm tests
#
# O build não recebe segredos: o runtimeConfig do Nuxt lê SUPABASE_*/STRIPE_* do ambiente em runtime.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm AS build
# pnpm vem do campo packageManager do package.json (corepack).
RUN corepack enable
WORKDIR /app
COPY . .
# Store do pnpm em cache do BuildKit: reinstalações sem baixar tudo de novo.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
# Mesmo heap usado pelo build:e2e (scripts/test-stack.mjs): o padrão (~4 GB) estoura no Nitro.
ENV NODE_OPTIONS=--max-old-space-size=8192
RUN pnpm build

FROM build AS test
RUN pnpm exec playwright install --with-deps chromium
# Mesma ordem do CI: integração (Postgres real) e depois E2E contra o build de produção (.output).
CMD ["sh", "-c", "pnpm exec vitest run --project db && E2E_SERVER=prod pnpm exec playwright test --project=desktop"]

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
