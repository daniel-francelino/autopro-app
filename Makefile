# Atalhos para o dia a dia. `make help` lista os alvos. Todo alvo chama um script pnpm equivalente,
# então quem não tem `make` (Windows sem Git Bash/winget) usa direto: pnpm <script> (ver coluna "pnpm").
.DEFAULT_GOAL := help

.PHONY: help install lint typecheck test test-watch test-db test-e2e test-all stack-up stack-down stack-reuse seed-demo test-e2e-demo build build-force check clean-output

help: ## Lista os alvos
	@awk -F':.*## ' '/^[a-zA-Z0-9_-]+:.*## /{printf "  %-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Instala as dependências (pnpm install)
	pnpm install

lint: ## ESLint (pnpm lint)
	pnpm lint

typecheck: ## Typecheck do Nuxt (pnpm typecheck)
	pnpm typecheck

test: ## Projeto fast + static: sem Docker, segundos (pnpm test)
	pnpm test

test-watch: ## Projeto fast em modo observação (pnpm test:watch)
	pnpm test:watch

test-db: ## Sobe a stack, roda tests/db no Postgres real e derruba (pnpm test:stack --only=db)
	pnpm test:stack --only=db

test-e2e: ## Build (só se o código mudou) + Playwright contra a stack (pnpm test:stack --only=e2e). ARGS="--grep money" repassa ao Playwright
	pnpm test:stack --only=e2e $(ARGS)

test-all: ## db + e2e completos, como no CI (pnpm test:stack)
	pnpm test:stack $(ARGS)

stack-up: ## Sobe a stack Docker e a deixa no ar (pnpm stack:up)
	pnpm stack:up

stack-down: ## Derruba a stack e apaga os dados (pnpm stack:down)
	pnpm stack:down

stack-reuse: ## Roda db+e2e na stack que já está no ar, sem subir nem derrubar (pnpm test:stack:reuse)
	pnpm test:stack:reuse $(ARGS)

seed-demo: ## Carrega o seed demo (1.265 OS) na stack no ar (pnpm seed:demo)
	pnpm seed:demo

test-e2e-demo: ## Sobe a stack, carrega o seed demo e roda só o spec @demo-seed (pnpm test:e2e:demo)
	pnpm test:e2e:demo

build: ## Build de produção para o E2E, pulado se o carimbo bate (pnpm build:e2e)
	pnpm build:e2e

build-force: ## Força o build de produção para o E2E (pnpm test:stack --only=build --build)
	pnpm test:stack --only=build --build

check: lint typecheck test ## Lint + typecheck + testes rápidos (antes de commitar)

clean-output: ## Apaga .output e .test-output (builds e relatórios gerados)
	rm -rf .output .test-output
