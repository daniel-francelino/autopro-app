// Linhas da tabela `organizations` para os fakes. Criacao de OS e process-payment leem
// organizations.commission_release_mode (NOT NULL + CHECK no banco): nunca seedar `null`.
export type CommissionReleaseMode = 'proportional' | 'full'

export function seedOrganizations(
  mode: CommissionReleaseMode = 'full',
  ids: string[] = ['org-a', 'org-b']
): Array<{ id: string, commission_release_mode: CommissionReleaseMode }> {
  return ids.map(id => ({ id, commission_release_mode: mode }))
}
