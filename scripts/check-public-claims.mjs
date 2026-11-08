// Falha se o conteúdo público afirmar algo que o produto não cumpre
// (ver docs/seo/geo-audit-brasil.md §2.1 e §8). Roda junto com o lint.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Termos que só podem aparecer em frases que NEGAM o recurso (allowNegation)
// ou que nunca podem aparecer.
const FORBIDDEN = [
  { term: /oficina completa/i, why: 'plano inexistente' },
  { term: /carta de corre[cç][aã]o/i, why: 'recurso inexistente', allowNegation: true },
  { term: /nf-e/i, why: 'só há NFS-e', allowNegation: true },
  // boleto é forma de pagamento válida nas OS dos clientes; só vale para a assinatura
  { term: /boleto/i, why: 'assinatura só no cartão', allowNegation: true, only: /(faq|pricing)\.ya?ml$|index\.vue$/ },
  { term: /sem (precisar )?cadastrar cart[aã]o/i, why: 'não há teste sem cartão' },
  { term: /teste gr[aá]tis|per[ií]odo de teste|testar antes de assinar/i, why: 'não há trial', allowNegation: true },
  { term: /m[uú]ltiplas unidades/i, why: 'não há multiunidade' }
]

const NEGATION = /\b(n[aã]o|sem|nem|nenhum|nenhuma)\b|apenas|s[oó]\b/i
const LINE_BREAK = /\r?\n/

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const files = [
  ...walk('content').filter(f => /\.(md|ya?ml)$/.test(f)),
  'app/pages/index.vue'
]

const problems = []

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(LINE_BREAK)

  lines.forEach((line, index) => {
    // YAML: valor sem aspas contendo ": " vira objeto ([object Object] no llms.txt/JSON-LD).
    if (/\.(md|ya?ml)$/.test(file)) {
      const yaml = line.match(/^\s*(?:- )?(title|description|answer|label|content):\s+([^'"\s].*)$/)
      if (yaml && yaml[2].includes(': ')) {
        problems.push(`${file}:${index + 1}: valor YAML com ": " precisa de aspas (${yaml[1]})`)
      }
    }

    for (const rule of FORBIDDEN) {
      if (!rule.term.test(line)) continue
      if (rule.only && !rule.only.test(file)) continue
      // perguntas ("O AutoPro emite NF-e?") só citam o termo; a resposta é checada à parte
      if (/\?['"]?\s*$/.test(line)) continue
      if (rule.allowNegation && NEGATION.test(line)) continue
      problems.push(`${file}:${index + 1}: "${line.trim().slice(0, 90)}" (${rule.why})`)
    }
  })
}

// Preços citados em texto devem existir em usePlans.ts.
const plans = readFileSync('app/composables/usePlans.ts', 'utf8')
const prices = new Set([...plans.matchAll(/price:\s*'R\$\s*(\d+)'/g)].map(m => m[1]))
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(LINE_BREAK)
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/R\$\s*(\d{3})\b/g)) {
      // exemplos de cálculo (comissão) não são preços de plano
      if (!prices.has(match[1]) && !/exemplo|comiss[aã]o|custo|→/i.test(line)) {
        problems.push(`${file}:${index + 1}: valor R$ ${match[1]} não existe em usePlans.ts`)
      }
    }
  })
}

if (problems.length) {
  console.error('Afirmações públicas inconsistentes:\n' + problems.map(p => `  - ${p}`).join('\n'))
  process.exit(1)
}
console.log(`check-public-claims: ${files.length} arquivos OK`)
