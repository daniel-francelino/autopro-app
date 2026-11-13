import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ResourceType, useRoleResources } from '../../../app/composables/useRoleResources'

const fixture = JSON.parse(
  readFileSync(
    new URL('../../static/fixtures/actions-prod-103.json', import.meta.url),
    'utf8'
  )
) as { resource: string }[]

const { formatResourceLabel, getResourceIcon } = useRoleResources()

describe('useRoleResources', () => {
  it('mapeia os 5 resources antes sem rotulo', () => {
    expect(formatResourceLabel(ResourceType.MEMBERS)).toBe('Membros')
    expect(formatResourceLabel(ResourceType.ORGANIZATION)).toBe('Organização')
    expect(formatResourceLabel(ResourceType.PAYMENT_MACHINES)).toBe('Maquininhas')
    expect(formatResourceLabel(ResourceType.RETURNS)).toBe('Devoluções')
    expect(formatResourceLabel(ResourceType.SUBSCRIPTION)).toBe('Assinatura')
    for (const r of [ResourceType.MEMBERS, ResourceType.ORGANIZATION, ResourceType.PAYMENT_MACHINES, ResourceType.RETURNS, ResourceType.SUBSCRIPTION])
      expect(getResourceIcon(r)).not.toBe('i-lucide-folder')
  })

  it('fallback mostra o valor bruto', () => {
    expect(formatResourceLabel('xpto_novo')).toBe('Outros (xpto_novo)')
  })

  it('nenhum resource do catalogo cai em Outros', () => {
    const resources = [...new Set(fixture.map(a => a.resource))]
    expect(resources.length).toBeGreaterThan(20)
    for (const r of resources)
      expect(formatResourceLabel(r), r).not.toMatch(/^Outros/)
  })
})
