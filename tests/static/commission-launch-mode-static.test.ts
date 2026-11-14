// ST-1/ST-2/UI-1/UI-2: contrato estatico do modo de comissao da organizacao.
// Limitacao (FV-6): scan de fonte prova presenca de texto, nao renderizacao nem `disabled` efetivo. Nao e teste de UI.
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { read, walk, rel, ROOT } from '../support/source-scan'

const serverFiles = () => walk(join(ROOT, 'server')).map(rel).filter(f => f.endsWith('.ts'))
const appFiles = () => walk(join(ROOT, 'app')).map(rel).filter(f => /\.(ts|vue)$/.test(f))

describe('ST-1: quem le organizations.commission_release_mode', () => {
  it('apenas PUT da org, criacao de OS e process-payment; o motor de comissao nao toca organizations', () => {
    const readers = serverFiles().filter(f => /commission_release_mode/.test(read(f)) && /from\(\s*'organizations'\s*\)/.test(read(f))).sort()
    expect(readers).toEqual([
      'server/api/organizations/index.put.ts',
      'server/api/service-orders/[id]/process-payment.post.ts',
      'server/api/service-orders/index.post.ts'
    ])
    expect(read('server/utils/service-order-commissions.ts')).not.toMatch(/organizations/)
  })
})

describe('ST-2: releaseCommissionsInFull removido', () => {
  it('nao aparece em server/ nem app/', () => {
    const offenders = [...serverFiles(), ...appFiles()].filter(f => read(f).includes('releaseCommissionsInFull'))
    expect(offenders).toEqual([])
  })
})

describe('UI-1/UI-2 (cobertura limitada, so texto de fonte)', () => {
  it('UI-1: company.vue tem o select do modo com rotulos, enum, fallback full, desabilitado sem permissao e enviado no PUT', () => {
    const src = read('app/pages/app/settings/company.vue')
    expect(src).toContain("'Conforme o recebimento'")
    expect(src).toContain("'Integral ao gerar o pagamento'")
    expect(src).toContain("z.enum(['proportional', 'full'])")
    expect(src).toContain("=== 'proportional' ? 'proportional' : 'full'")
    expect(src).toMatch(/<USelect[^>]*v-model="form\.commission_release_mode"[\s\S]*?:disabled="!canUpdate"[\s\S]*?\/>/)
    expect(src).toMatch(/method: 'PUT',\s*body: form/)
  })
  it('UI-2: PaymentModal sem override (switch/flag) e com o texto do modo; saldo quitado envia corpo vazio', () => {
    const src = read('app/components/service-orders/PaymentModal.vue')
    expect(src).not.toContain('releaseCommissionsInFull')
    expect(src).not.toContain('Liberar 100% da comissão')
    expect(src).toContain('Comissão: {{ commissionModeLabel }}')
    expect(src).toMatch(/balanceDueIsSettled\.value\s*\?\s*\{\}/)
  })
  it('UI-3: mapa de rotulos do modal igual ao de company.vue', () => {
    const modal = read('app/components/service-orders/PaymentModal.vue')
    const company = read('app/pages/app/settings/company.vue')
    for (const label of ['Conforme o recebimento', 'Integral ao gerar o pagamento']) {
      expect(modal).toContain(label)
      expect(company).toContain(label)
    }
  })
})
