// Catálogo fixo da suíte de Ordem de Serviço (docs/testing/e2e-service-orders.md §3).
// Valores redondos, escolhidos para que cada funcionário tenha uma comissão DIFERENTE na mesma OS e dê para conferir à mão.
// Criado por API na oficina A, uma vez por worker. Os testes só LEEM este catálogo.
import { expect, type Api } from '../../support/auth-fixtures'

export interface ProductRef {
  id: string
  name: string
  categoryId: string | null
  categoryName: string | null
  sale: number
  cost: number
}
export interface EmployeeRef { id: string, name: string }
export interface ClientRef { id: string, name: string, taxId: string }
export interface VehicleRef { id: string, plate: string, label: string }

export interface Catalog {
  categories: { servicos: string, usinagem: string, pecas: string }
  products: Record<'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'P1' | 'P2' | 'P3' | 'K1', ProductRef>
  /** Item adicionado "à mão" (sem produto nem categoria). */
  manual: { name: string, sale: number, cost: number }
  clients: Record<'c1' | 'c2' | 'c3', ClientRef>
  vehicles: Record<'v1' | 'v2' | 'v3', VehicleRef>
  employees: Record<'ana' | 'bruno' | 'carla' | 'diego' | 'elisa' | 'fabio', EmployeeRef>
}

export const idOf = (body: any): string => String(body?.item?.id ?? body?.data?.id ?? body?.id ?? body?.order?.id)

function cpf(seed: number) {
  const d = Array.from({ length: 9 }, (_, i) => (seed * (i + 3) * 7919 + i * 13) % 10)
  const dv = (arr: number[]) => { const s = arr.reduce((a, v, i) => a + v * (arr.length + 1 - i), 0) % 11; return s < 2 ? 0 : 11 - s }
  d.push(dv(d)); d.push(dv(d))
  return d.join('')
}
function cnpj(seed: number) {
  const d = [...Array.from({ length: 8 }, (_, i) => (seed * (i + 5) * 104729 + i * 7) % 10), 0, 0, 0, 1]
  const dv = (arr: number[]) => {
    const w = arr.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const s = arr.reduce((a, v, i) => a + v * w[i]!, 0) % 11
    return s < 2 ? 0 : 11 - s
  }
  d.push(dv(d)); d.push(dv(d))
  return d.join('')
}

/** 'YYYY-MM-01' do mês atual deslocado em `offset` meses (negativo = passado). Mesmo formato do motor de comissão. */
export function monthStart(offset = 0) {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
  return d.toISOString().slice(0, 10)
}

async function ok<T extends { status: number, body: any }>(res: T, what: string) {
  expect(res.status, `${what}: ${JSON.stringify(res.body)}`).toBe(200)
  return res.body
}

export async function buildCatalog(api: Api): Promise<Catalog> {
  const run = Date.now().toString(36)

  // ── categorias ──
  const cat = async (name: string) => idOf(await ok(await api.post('/api/product-categories', { name }), `categoria ${name}`))
  const servicos = await cat('Serviços')
  const usinagem = await cat('Usinagem')
  const pecas = await cat('Peças')
  const catName: Record<string, string> = { [servicos]: 'Serviços', [usinagem]: 'Usinagem', [pecas]: 'Peças' }

  // ── produtos ──
  let code = 1000 + Math.floor(Math.random() * 5000)
  const product = async (name: string, categoryId: string, sale: number, cost: number): Promise<ProductRef> => {
    const id = idOf(await ok(await api.post('/api/products', {
      name, code: code++, type: 'unit', category_id: categoryId, track_inventory: false, unit_sale_price: sale, unit_cost_price: cost
    }), `produto ${name}`))
    return { id, name, categoryId, categoryName: catName[categoryId] ?? null, sale, cost }
  }
  const S1 = await product('Retífica de cabeçote', servicos, 1000, 300)
  const S2 = await product('Troca de óleo', servicos, 150, 50)
  const S3 = await product('Usinagem de bloco', usinagem, 800, 200)
  const S4 = await product('Serviço com centavos', servicos, 33.33, 10)
  const S5 = await product('Serviço no prejuízo', servicos, 100, 150)
  const P1 = await product('Junta do cabeçote', pecas, 200, 120)
  const P2 = await product('Jogo de válvulas', pecas, 480, 300)
  const P3 = await product('Parafuso', pecas, 10, 4)
  const groupItems = [
    { description: 'Troca de óleo (kit)', quantity: 1, sale_price: 150, cost_price: 50 },
    { description: 'Filtro de óleo (kit)', quantity: 1, sale_price: 40, cost_price: 20 }
  ]
  const k1Id = idOf(await ok(await api.post('/api/products', {
    name: 'Kit revisão', code: code++, type: 'group', category_id: servicos, track_inventory: false, group_items: groupItems
  }), 'produto Kit revisão'))
  const K1: ProductRef = { id: k1Id, name: 'Kit revisão', categoryId: servicos, categoryName: 'Serviços', sale: 190, cost: 70 }

  // ── clientes e veículos ──
  const client = async (name: string, type: 'pf' | 'pj', taxId: string, phone: string): Promise<ClientRef> => {
    const id = idOf(await ok(await api.post('/api/clients', { name, person_type: type, tax_id: taxId, phone }), `cliente ${name}`))
    return { id, name, taxId }
  }
  const c1 = await client(`Marcos Pessoa ${run}`, 'pf', cpf(11), '11988880001')
  const c2 = await client(`Transportadora Alfa ${run} Ltda`, 'pj', cnpj(12), '1133330002')
  const c3 = await client(`José d'Ávila ${run}`, 'pf', cpf(13), '11988880003')
  const vehicle = async (clientId: string, plate: string, brand: string, model: string): Promise<VehicleRef> => {
    const id = idOf(await ok(await api.post('/api/vehicles', { client_id: clientId, license_plate: plate, brand, model, year: 2018 }), `veículo ${plate}`))
    return { id, plate, label: `${brand} ${model}` }
  }
  const suffix = run.replace(/[^a-z]/g, '').toUpperCase().padEnd(3, 'X').slice(0, 3)
  const v1 = await vehicle(c1.id, `${suffix}1D23`, 'Fiat', 'Uno')
  const v2 = await vehicle(c1.id, `${suffix}4G56`, 'VW', 'Gol')
  const v3 = await vehicle(c2.id, `${suffix}7H89`, 'Scania', 'R450')

  // ── funcionários e planos de comissão ──
  const employee = async (name: string, n: number): Promise<EmployeeRef> => {
    const id = idOf(await ok(await api.post('/api/employees', { name, person_type: 'pf', tax_id: cpf(100 + n), phone: `1199900${String(n).padStart(4, '0')}` }), `funcionário ${name}`))
    return { id, name }
  }
  const ana = await employee(`Ana ${run}`, 1)
  const bruno = await employee(`Bruno ${run}`, 2)
  const carla = await employee(`Carla ${run}`, 3)
  const diego = await employee(`Diego ${run}`, 4)
  const elisa = await employee(`Elisa ${run}`, 5)
  const fabio = await employee(`Fábio ${run}`, 6)

  const plan = async (name: string, rules: unknown[], effectiveFrom?: string) =>
    idOf(await ok(await api.post('/api/commissions', { name: `${name} ${run}`, rules, ...(effectiveFrom ? { effectiveFrom } : {}) }), `plano ${name}`))
  const assign = async (planId: string, employeeId: string) =>
    ok(await api.post(`/api/commissions/${planId}/assignments`, { employeeId }), 'atribuição de plano')

  const geral = await plan('Geral 10%', [{ commissionType: 'percentage', commissionAmount: 10, commissionBase: 'revenue', isDefault: true }])
  const retifica = await plan('Retífica', [
    { commissionType: 'percentage', commissionAmount: 30, commissionBase: 'profit', isDefault: false, categoryIds: [servicos, usinagem] },
    { commissionType: 'percentage', commissionAmount: 5, commissionBase: 'revenue', isDefault: true }
  ])
  const pecasFixo = await plan('Peças fixo', [{ commissionType: 'fixed_amount', commissionAmount: 20, isDefault: false, categoryIds: [pecas] }])
  // Elisa: 8 % há dois meses, 12 % no mês atual (a versão é escolhida pelo mês da OS).
  const escalonado = await plan('Escalonado', [{ commissionType: 'percentage', commissionAmount: 8, commissionBase: 'revenue', isDefault: true }], monthStart(-2))
  await ok(await api.post(`/api/commissions/${escalonado}/versions`, {
    effectiveFrom: monthStart(0), rules: [{ commissionType: 'percentage', commissionAmount: 12, commissionBase: 'revenue', isDefault: true }]
  }), 'versão atual do plano Escalonado')

  await assign(geral, ana.id)
  await assign(retifica, bruno.id)
  await assign(pecasFixo, carla.id)
  await assign(escalonado, elisa.id)
  await assign(geral, fabio.id)
  await assign(pecasFixo, fabio.id)
  // Diego fica sem plano de propósito.

  return {
    categories: { servicos, usinagem, pecas },
    products: { S1, S2, S3, S4, S5, P1, P2, P3, K1 },
    manual: { name: 'Mão de obra avulsa', sale: 100, cost: 0 },
    clients: { c1, c2, c3 },
    vehicles: { v1, v2, v3 },
    employees: { ana, bruno, carla, diego, elisa, fabio }
  }
}
