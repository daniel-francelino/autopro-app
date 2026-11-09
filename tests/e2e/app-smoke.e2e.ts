// Fluxo: abrir cada tela principal do app logado. Pega página quebrada (erro de JS, API 5xx, redirecionamento
// inesperado) depois de qualquer mudança, sem precisar de um teste por tela.
// Precisa do Supabase local (ver support/env.ts); sem ele o spec é pulado.
import { expect, skipUnlessAuth, test } from './support/fixtures'

skipUnlessAuth(test)

const SCREENS: Array<[string, string]> = [
  ['Dashboard', '/app'],
  ['Ordens de serviço', '/app/service-orders'],
  ['Clientes', '/app/customers'],
  ['Veículos', '/app/vehicles'],
  ['Agenda', '/app/appointments'],
  ['Financeiro', '/app/financial'],
  ['Contas bancárias', '/app/financial/accounts'],
  ['Categorias financeiras', '/app/financial/categories'],
  ['Comissões', '/app/financial/commissions'],
  ['Bônus', '/app/financial/bonuses'],
  ['Maquininhas', '/app/financial/machines'],
  ['Impostos', '/app/financial/taxes'],
  ['Produtos', '/app/products'],
  ['Estoque', '/app/products/inventory'],
  ['Fornecedores', '/app/products/suppliers'],
  ['Compras', '/app/products/purchases'],
  ['Categorias de produtos', '/app/products/categories'],
  ['Relatórios', '/app/reports'],
  ['Relatório: lucro', '/app/reports/profit'],
  ['Relatório: custos', '/app/reports/costs'],
  ['Relatório: devedores', '/app/reports/debtors'],
  ['Relatório: comissões', '/app/reports/commissions'],
  ['Relatório: clientes', '/app/reports/customers'],
  ['Relatório: compras', '/app/reports/purchases'],
  ['Configurações', '/app/settings'],
  ['Empresa', '/app/settings/company'],
  ['Funcionários', '/app/settings/employees'],
  ['Papéis e permissões', '/app/settings/roles'],
  ['Assinatura', '/app/settings/subscription'],
  ['Notificações', '/app/settings/notifications']
]

test.describe('Fluxo: telas do app abrem sem erro', () => {
  for (const [name, path] of SCREENS) {
    test(`${name} (${path})`, async ({ page, loginAs }) => {
      await loginAs('admin')
      const pageErrors: string[] = []
      const serverErrors: string[] = []
      page.on('pageerror', e => pageErrors.push(e.message))
      page.on('response', (r) => {
        if (r.url().includes('/api/') && r.status() >= 500) serverErrors.push(`${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()}`)
      })

      await page.goto(path)
      await page.waitForLoadState('networkidle')

      expect(new URL(page.url()).pathname, 'não pode ser redirecionada').toBe(path)
      expect(pageErrors, `erro de JavaScript:\n${pageErrors.join('\n')}`).toEqual([])
      expect(serverErrors, `API respondeu 5xx:\n${serverErrors.join('\n')}`).toEqual([])
    })
  }
})
