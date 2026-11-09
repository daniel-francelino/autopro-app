import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Datas do sistema são em horário de Brasília (docs/testing/test-plan.md D6).
process.env.TZ = process.env.TZ || 'America/Sao_Paulo'

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url))

const alias = {
  'h3': root('./tests/helpers/h3-stub.ts'),
  '~~': root('.'),
  '~': root('./app'),
  '@': root('./app')
}

export default defineConfig({
  resolve: { alias },
  test: {
    // Dois "projects": o que roda sem Docker (unit) e o que exige Supabase local (api).
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/static/**/*.test.ts', 'tests/unit/**/*.test.ts', 'tests/flows/**/*.test.ts'],
          setupFiles: ['tests/setup/unit-globals.ts']
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'api',
          environment: 'node',
          include: ['tests/api/**/*.test.ts'],
          globalSetup: ['tests/setup/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: false
        }
      }
    ],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts', 'server/utils/**/*.ts', 'app/utils/**/*.ts'],
      reporter: ['text-summary', 'html']
    }
  }
})
