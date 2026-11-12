// Imports explícitos: este handler também é tipado no projeto `app` (via tipos de rotas do Nitro),
// onde os auto-imports globais `useSiteConfig`/`queryCollection` são as versões de client.
import { queryCollection } from '@nuxt/content/nitro'
import { useSiteConfig } from '#site-config/server/composables/useSiteConfig'
import { PLAN_DEFINITIONS, PLAN_LICENSES } from '../../app/composables/usePlans'

/**
 * llms.txt em pt-BR (complemento experimental, não é permissão nem garantia).
 * Preços e limites vêm de usePlans.ts; páginas vêm da coleção `paginas`,
 * então só entram URLs que existem.
 */
export default defineEventHandler(async (event) => {
  const site = (useSiteConfig(event).url || '').replace(/\/$/, '')
  const pages = await queryCollection(event, 'paginas').select('title', 'description', 'path').all()

  const plans = PLAN_DEFINITIONS.map((plan) => {
    const license = PLAN_LICENSES[plan.key]
    const employees = license.maxEmployees
      ? `até ${license.maxEmployees} funcionários`
      : 'funcionários ilimitados'
    return `${plan.name} ${plan.price} (${employees}${license.nfseEmission ? ' e NFS-e' : ''})`
  }).join(', ')

  const mainPath = '/paginas/sistema-para-oficina-mecanica'
  const ordered = [...pages].sort((a, b) => Number(b.path === mainPath) - Number(a.path === mainPath))

  const lines = [
    '# AutoPro — sistema para oficinas mecânicas',
    '',
    '> Sistema online para oficinas mecânicas no Brasil: ordens de serviço, clientes, veículos, agenda, estoque, compras, financeiro, comissões de funcionários e emissão de NFS-e (plano Fiscal).',
    '',
    `Atendimento em português. Assinatura mensal paga no cartão: ${plans}. Não emite NF-e de produtos. Não há teste grátis.`,
    '',
    '## Produto',
    `- [Planos e preços](${site}/pricing): Starter, Pro e Fiscal, com limites e recursos`,
    `- [Perguntas frequentes](${site}/perguntas-frequentes): dúvidas de compra`,
    ...ordered.map(page => `- [${page.title}](${site}${page.path.replace('/paginas', '')}): ${page.description}`)
  ]

  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return `${lines.join('\n')}\n`
})
