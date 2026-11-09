// Mapeia uma rota para um rótulo de área (lista fechada). Nunca expõe qual registro foi aberto.
// A 1ª regra que casar vence. Mantenha em sincronia com docs/metrics/usage-metrics-plan.md §5.1.

type Rule = [RegExp, string]

const RULES: Rule[] = [
  [/^\/admin(\/|$)/, 'Admin'],
  [/^\/(403|app\/forbidden)(\/|$)/, 'Sem acesso'],
  [/^\/(subscription|checkout)(\/|$)/, 'Assinatura'],
  [/^\/app\/(subscribe|billing)(\/|$)/, 'Assinatura'],
  [/^\/app\/settings\/subscription(\/|$)/, 'Assinatura'],
  [/^\/onboarding(\/|$)/, 'Onboarding'],
  [/^\/(login|signup|forgot-password|reset-password)(\/|$)/, 'Entrar'],
  [/^\/pricing(\/|$)/, 'Planos'],
  [/^\/app\/?$/, 'Painel'],
  [/^\/app\/service-orders(\/|$)/, 'Ordens de serviço'],
  [/^\/app\/financial\/(service-invoices|taxes)(\/|$)/, 'Fiscal'],
  [/^\/app\/financial\/(commissions|bonuses)(\/|$)/, 'Comissões e bônus'],
  [/^\/app\/financial(\/|$)/, 'Financeiro'],
  [/^\/app\/products(\/|$)/, 'Estoque e compras'],
  [/^\/app\/(customers|vehicles)(\/|$)/, 'Clientes e veículos'],
  [/^\/app\/appointments(\/|$)/, 'Agenda'],
  [/^\/app\/reports(\/|$)/, 'Relatórios'],
  [/^\/app\/settings\/(employees|roles)(\/|$)/, 'Equipe e acesso'],
  [/^\/app\/settings(\/|$)/, 'Configurações'],
  [/^\/app\/(support|feedback|consulting)(\/|$)/, 'Suporte']
]

/** Páginas públicas de conteúdo (sistema-para-oficina-mecanica, comissao-mecanico…) contam como "Site". */
export function analyticsArea(pathname: string): string {
  const path = (pathname.split('?')[0] ?? '').split('#')[0] || '/'
  if (path === '/') return 'Site'
  for (const [pattern, area] of RULES) {
    if (pattern.test(path)) return area
  }
  if (!path.startsWith('/app')) return 'Site'
  return 'Outras'
}
