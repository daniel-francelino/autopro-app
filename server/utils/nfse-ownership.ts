import type { H3Event } from 'h3'
import { getSupabaseAdminClient } from './supabase'
import { resolveOrganizationId } from './organization'

/**
 * Garante que a NFS-e (referência na Focus NFe) pertence à oficina de quem chama.
 * Sem isto, qualquer oficina com plano fiscal opera notas de outra pela referência.
 * Devolve 404 (não 403) para não revelar que a referência existe.
 */
export async function assertNfseBelongsToOrg(event: H3Event, userId: string, reference: string): Promise<string> {
  const organizationId = await resolveOrganizationId(event, userId)
  const { data } = await getSupabaseAdminClient()
    .from('service_order_nfse')
    .select('id')
    .eq('provider_reference', reference)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'NFS-e não encontrada' })
  }
  return organizationId
}
