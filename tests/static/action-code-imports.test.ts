// Guarda de regressão: o Nuxt NÃO importa app/constants automaticamente. Um .vue/.ts que usa
// `ActionCode.X` sem importar o enum quebra só em tempo de execução (ReferenceError ao abrir a tela),
// e nem o ESLint nem os testes de handler detectam. Aconteceu na Fase 4 (3 componentes).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const APP = join(ROOT, 'app')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(vue|ts)$/.test(name)) out.push(full)
  }
  return out
}

describe('app: ActionCode usado sempre importado', () => {
  it('every file in app/ that uses ActionCode.X imports ActionCode', () => {
    const offenders = walk(APP)
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        const uses = /\bActionCode\.[A-Z_]+/.test(source)
        const imports = /import\s*\{[^}]*\bActionCode\b[^}]*\}\s*from\s*['"][^'"]+['"]/.test(source)
        // o próprio arquivo que declara o enum não precisa importar
        const declares = /export\s+enum\s+ActionCode\b/.test(source)
        return uses && !imports && !declares
      })
      .map(file => relative(ROOT, file).replace(/\\/g, '/'))

    expect(offenders, `Usa ActionCode sem import (ReferenceError em runtime):\n${offenders.join('\n')}`).toEqual([])
  })
})
