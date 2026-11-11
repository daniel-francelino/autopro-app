import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

export const rel = (path: string) => relative(ROOT, path).replace(/\\/g, '/')

export const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

export interface Handler {
  /** caminho relativo, ex.: server/api/clients/index.post.ts */
  file: string
  method: string | null
  source: string
  size: number
}

export function listHandlers(): Handler[] {
  return walk(join(ROOT, 'server/api'))
    .filter(f => f.endsWith('.ts'))
    .map((abs) => {
      const file = rel(abs)
      const m = file.match(/\.(get|post|put|patch|delete)\.ts$/)
      return { file, method: m ? m[1]! : null, source: readFileSync(abs, 'utf8'), size: statSync(abs).size }
    })
}

export const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete'])

export const AUTH_GUARDS = /\b(requireAuthUser|requireOwner|requireOrgPermission|resolveOrganizationId)\b/
export const PERMISSION_GUARDS = /\b(requireOrgPermission|requireOwner)\b/

/**
 * Baselines "só podem diminuir" (catraca). Guardam a lista atual de exceções conhecidas;
 * o teste falha se aparecer exceção nova OU se uma exceção antiga tiver sido corrigida
 * (para forçar a limpeza da lista). Regenerar: UPDATE_BASELINE=1 pnpm test
 */
export function checkRatchet(name: string, current: string[]) {
  const path = join(ROOT, 'tests/static/baselines', `${name}.json`)
  const sorted = [...new Set(current)].sort()

  if (process.env.UPDATE_BASELINE === '1' || !existsSync(path)) {
    writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`)
    return { added: [] as string[], fixed: [] as string[], total: sorted.length }
  }

  const baseline: string[] = JSON.parse(readFileSync(path, 'utf8'))
  return {
    added: sorted.filter(x => !baseline.includes(x)),
    fixed: baseline.filter(x => !sorted.includes(x)),
    total: sorted.length
  }
}
