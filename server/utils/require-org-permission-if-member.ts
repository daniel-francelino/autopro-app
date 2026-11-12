import { createError } from 'h3'
import { getSupabaseAdminClient } from './supabase'
import { requireOrgPermission } from './require-org-permission'
import type { H3Event } from 'h3'

/**
 * Como requireOrgPermission, mas só aplica o guard quando o usuário já pertence a uma organização.
 *
 * Usado na cobrança: quem ainda não tem organização está na primeira assinatura (a organização é
 * criada pelo webhook do Stripe depois do pagamento) e precisa chegar ao checkout.
 * Quem já tem organização passa pelo guard normal (plano, suspensão, admin/owner, role_actions).
 */
export async function requireOrgPermissionIfMember(userId: string, actionCode: string, event?: H3Event): Promise<void> {
  const supabase = getSupabaseAdminClient()

  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('user_id', userId)
    .maybeSingle()

  // Erro transitório não pode liberar o acesso: só "sem perfil / sem organização" SEM erro passa.
  if (error) {
    throw createError({ statusCode: 503, statusMessage: 'Não foi possível verificar o acesso. Tente novamente.' })
  }

  if (!profile?.organization_id) return

  await requireOrgPermission(userId, actionCode, event)
}
