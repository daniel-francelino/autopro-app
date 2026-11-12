// Handler de POST /api/employees/:id/export-commissions contra o fake em memória.
// Cenários: docs/testing/endpoint-scenarios-g1.md, seção 4 (EMP-17, 18, 06l, 06m).
//  - 401 sem sessão já é provado por guard-matrix.test.ts; não se repete aqui.
//  - O motor de CSV/PDF (csvEscape, tabela) é de reports.test.ts; aqui prova-se o conteúdo deste export e a paridade do total com commissions.get.
//  - KF-04 (injeção de fórmula no CSV) está corrigido no código (csvEscape prefixa `'`): os testes de = + - @ são de comportamento normal, não it.fails.
//  - it.fails = comportamento correto ainda não implementado (docs/testing/known-failures.md, KF-52; faceta do KF-09).
//    Ao corrigir o handler o Vitest acusa "unexpected pass": troque it.fails por it.
//  - Limitações: o PDF é binário comprimido; só se prova tipo, nome e assinatura "%PDF-", não o texto nem o total dentro dele.
//    `or()` é no-op e `range()` só limita no fake.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { employeesSeed, USERS, type Persona } from './employees-seed'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const EXPORT = 'server/api/employees/[id]/export-commissions.post.ts'
const COMMISSIONS = 'server/api/employees/[id]/commissions.get.ts'

function loginAs(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

beforeEach(() => {
  fake = createFakeSupabase(employeesSeed())
  loginAs('owner')
  auth.refreshSession.mockReset()
})

type Download = { fileName: string, contentType: string, base64: string }
const exportFile = (id: string, body?: unknown) => callHandler(EXPORT, fakeEvent({ method: 'POST', cookies, params: { id }, body }))
const commissions = (id: string, query: Record<string, unknown> = {}) => callHandler(COMMISSIONS, fakeEvent({ cookies, params: { id }, query }))
const fileOf = (res: { body?: unknown }) => (res.body as { success: boolean, data: Download }).data
const decode = (file: Download) => Buffer.from(file.base64, 'base64').toString('utf8')
const MARCH = { dateFrom: '2026-03-01', dateTo: '2026-03-31' }
const money = async (value: number) => (await import('../../../server/utils/report-helpers')).formatCurrency(value)
const footer = (csv: string, label: string) => csv.split('\n').find(line => line.startsWith(`"${label}",`))

describe('EMP-17: export CSV', () => {
  it('março: 200, headers do arquivo (nome, tipo), cabeçalho e linhas na ordem (data desc) com os valores do seed', async () => {
    const res = await exportFile('e-a1', { format: 'csv', ...MARCH })
    expect(res.status).toBe(200)
    expect((res.body as { success: boolean }).success).toBe(true)
    const file = fileOf(res)
    expect(file.contentType).toBe('text/csv;charset=utf-8;')
    expect(file.fileName).toMatch(/^funcionario_ana_ativa_comissoes_\d{4}-\d{2}-\d{2}\.csv$/)

    const lines = decode(file).split('\n')
    expect(lines[0]).toBe('"OS","REF.","ITEM","CLIENTE","BASE","REGRA","COMISSAO","STATUS"')
    expect(lines[1]).toBe(['"#102"', '"20/03/2026"', '"Alinhamento"', '"Cliente Alfa"', `"${await money(300)}"`, '"16.83% sobre receita"', `"${await money(50.5)}"`, '"Pendente"'].join(','))
    expect(lines[2]).toBe(['"#101"', '"10/03/2026"', '"Troca de óleo"', '"Cliente Alfa"', `"${await money(400)}"`, '"25% sobre receita"', `"${await money(100)}"`, '"Pago"'].join(','))
    // 2 linhas de dados (fr-3 é de maio; bônus fr-4 e outro funcionário fr-5 nunca entram)
    expect(lines[3]).toBe('')
    expect(decode(file)).not.toContain('Balanceamento')
    expect(decode(file)).not.toContain('Bônus')
    expect(decode(file)).not.toContain('Outro')
  })

  it('rodapé: total, pago, pendente, itens e OS; nome da organização de A', async () => {
    const csv = decode(fileOf(await exportFile('e-a1', { format: 'csv', ...MARCH })))
    expect(footer(csv, 'Total de comissões')).toBe(`"Total de comissões","${await money(150.5)}"`)
    expect(footer(csv, 'Total pago')).toBe(`"Total pago","${await money(100)}"`)
    expect(footer(csv, 'Total pendente')).toBe(`"Total pendente","${await money(50.5)}"`)
    expect(footer(csv, 'Itens com comissão')).toBe('"Itens com comissão","2"')
    expect(footer(csv, 'OS com comissão')).toBe('"OS com comissão","2"')
    expect(csv).toContain('"Oficina A"')
    expect(csv).not.toContain('Oficina B')
  })

  it('total do arquivo == total de commissions.get no mesmo período (com e sem período)', async () => {
    for (const period of [MARCH, {}] as Array<Record<string, string>>) {
      const csv = decode(fileOf(await exportFile('e-a1', { format: 'csv', ...period })))
      const mine = ((await commissions('e-a1', period)).body as { data: { summary: { totalCommissions: number, totalPaid: number, totalPending: number } } }).data.summary
      expect(footer(csv, 'Total de comissões')).toBe(`"Total de comissões","${await money(mine.totalCommissions)}"`)
      expect(footer(csv, 'Total pago')).toBe(`"Total pago","${await money(mine.totalPaid)}"`)
      expect(footer(csv, 'Total pendente')).toBe(`"Total pendente","${await money(mine.totalPending)}"`)
    }
    // âncora do seed sem período: 100 + 50,5 + 30
    expect(footer(decode(fileOf(await exportFile('e-a1', { format: 'csv' }))), 'Total de comissões')).toBe(`"Total de comissões","${await money(180.5)}"`)
  })

  it('dateFrom filtra o conteúdo: só a comissão de 20/03 e o total dela', async () => {
    const csv = decode(fileOf(await exportFile('e-a1', { format: 'csv', dateFrom: '2026-03-15', dateTo: '2026-03-31' })))
    expect(csv).toContain('Alinhamento')
    expect(csv).not.toContain('Troca de óleo')
    expect(footer(csv, 'Total de comissões')).toBe(`"Total de comissões","${await money(50.5)}"`)
  })

  for (const [label, body] of [['formato inválido ("xlsx")', { format: 'xlsx' }], ['sem format', {}], ['sem corpo', undefined], ['"PDF" em maiúsculas', { format: 'PDF' }]] as const) {
    it(`${label} cai em CSV`, async () => {
      const file = fileOf(await exportFile('e-a1', body))
      expect(file.contentType).toBe('text/csv;charset=utf-8;')
      expect(file.fileName).toMatch(/\.csv$/)
    })
  }

  it('não grava nada', async () => {
    await exportFile('e-a1', { format: 'csv' })
    expect(fake.writes).toHaveLength(0)
  })
})

describe('EMP-17: export PDF', () => {
  it('format "pdf": 200, tipo application/pdf, nome .pdf e conteúdo começa com a assinatura %PDF-', async () => {
    const res = await exportFile('e-a1', { format: 'pdf', ...MARCH })
    expect(res.status).toBe(200)
    const file = fileOf(res)
    expect(file.contentType).toBe('application/pdf')
    expect(file.fileName).toMatch(/^funcionario_ana_ativa_comissoes_\d{4}-\d{2}-\d{2}\.pdf$/)
    expect(Buffer.from(file.base64, 'base64').subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(Buffer.from(file.base64, 'base64').length).toBeGreaterThan(500)
  })
})

describe('EMP-17: células com = + - @ são prefixadas com apóstrofo (KF-04, corrigido)', () => {
  beforeEach(() => {
    fake.tables.clients!.push({ id: 'c-evil', organization_id: 'org-a', name: '@Cliente Evil', deleted_at: null })
    fake.tables.service_orders!.push({ id: 'so-evil', organization_id: 'org-a', number: 150, status: 'completed', payment_status: 'paid', entry_date: '2026-03-22', client_id: 'c-evil', deleted_at: null })
    const base = { organization_id: 'org-a', employee_id: 'e-a1', service_order_id: 'so-evil', record_type: 'commission', status: 'pending', amount: 1, reference_date: '2026-03-22', payment_date: null, item_amount: 10, item_cost: 0, deleted_at: null }
    fake.tables.employee_financial_records!.push(
      { ...base, id: 'fr-i1', item_name: '=HYPERLINK("http://x","y")' },
      { ...base, id: 'fr-i2', item_name: '+cmd|calc' },
      { ...base, id: 'fr-i3', item_name: '-2+3' },
      { ...base, id: 'fr-i4', item_name: '@SUM(A1)' }
    )
  })

  it('item e cliente que começam com = + - @ saem com apóstrofo; aspas internas são duplicadas', async () => {
    const csv = decode(fileOf(await exportFile('e-a1', { format: 'csv', ...MARCH })))
    expect(csv).toContain('"\'=HYPERLINK(""http://x"",""y"")"')
    expect(csv).toContain('"\'+cmd|calc"')
    expect(csv).toContain('"\'-2+3"')
    expect(csv).toContain('"\'@SUM(A1)"')
    expect(csv).toContain('"\'@Cliente Evil"')
  })

  it('nenhuma célula do arquivo começa com = + - @ sem o apóstrofo', async () => {
    const csv = decode(fileOf(await exportFile('e-a1', { format: 'csv', ...MARCH })))
    expect(csv).not.toMatch(/(^|,)"[=+\-@]/m)
  })

  it('o total continua batendo com commissions.get (os 4 itens somam 4 a mais: 154,5)', async () => {
    const csv = decode(fileOf(await exportFile('e-a1', { format: 'csv', ...MARCH })))
    const mine = ((await commissions('e-a1', MARCH)).body as { data: { summary: { totalCommissions: number } } }).data.summary
    expect(mine.totalCommissions).toBe(154.5)
    expect(footer(csv, 'Total de comissões')).toBe(`"Total de comissões","${await money(154.5)}"`)
  })
})

describe('EMP-18 / EMP-06l: funcionário inexistente ou de outra org', () => {
  for (const [label, id] of [['EMP-18: id inexistente', 'nope'], ['EMP-18: funcionário excluído', 'e-a-del'], ['EMP-06l: funcionário de B logado em A', 'e-b1']] as const) {
    it(`${label} -> 404 "Funcionário não encontrado", sem arquivo`, async () => {
      const res = await exportFile(id, { format: 'csv', ...MARCH })
      expect(res.status).toBe(404)
      expect(res.error?.statusMessage).toBe('Funcionário não encontrado')
      expect(res.body).toBeUndefined()
      expect(JSON.stringify(res)).not.toContain('Item B')
      expect(fake.writes).toHaveLength(0)
    })
  }

  it('EMP-06l: formato pdf e ?organization_id=org-b também dão 404 (a org vem da sessão)', async () => {
    const res = await callHandler(EXPORT, fakeEvent({ method: 'POST', cookies, params: { id: 'e-b1' }, query: { organization_id: 'org-b' }, body: { format: 'pdf', organization_id: 'org-b' } }))
    expect(res.status).toBe(404)
    expect(res.body).toBeUndefined()
  })
})

describe('EMP-06m: emp-sem não deveria exportar (KF-09, KF-52)', () => {
  beforeEach(() => loginAs('emp-sem'))
  it('controle [caracteriza comportamento atual; decisão em G1-OQ-01 e KF-09]: emp-sem POST -> 200 e arquivo com as comissões de A', async () => {
    const res = await exportFile('e-a1', { format: 'csv', ...MARCH })
    expect(res.status).toBe(200)
    expect(decode(fileOf(res))).toContain('Alinhamento')
  })
  it.fails('EMP-06m: POST como emp-sem -> 403 e nenhum arquivo [KF-52]', async () => {
    const res = await exportFile('e-a1', { format: 'csv', ...MARCH })
    expect(res.status).toBe(403)
    expect(res.body).toBeUndefined()
  })
})

describe('Decisões de produto pendentes (it.todo)', () => {
  it.todo('EMP-06m emp-com: POST 200 com a permissão de exportar. Sem chave equivalente em action-codes.ts: não há employees.export; reports.employees pertence a /api/reports/export-employees (outra rota) e a página do funcionário não gateia esta rota. Aguarda G1-OQ-01')
})
