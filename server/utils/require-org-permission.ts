import { createError } from 'h3'
import { getSupabaseAdminClient } from './supabase'
import { resolveOrgLicense } from './license'
import { setAuditContext } from './audit/context'
import type { H3Event } from 'h3'

// Mirrors ACTION_PLAN_REQUIREMENTS in app/composables/usePlans.ts — keep in sync.
const ACTION_PLAN_REQUIREMENTS: Record<string, string> = {
  'reports.customers': 'pro',
  'reports.costs': 'pro',
  'reports.debtors': 'pro',
  'service_invoice.read': 'fiscal',
  'service_invoice.create': 'fiscal',
  'service_invoice.update': 'fiscal',
  'service_invoice.delete': 'fiscal',
  'product_invoice.read': 'fiscal',
  'product_invoice.create': 'fiscal',
  'product_invoice.update': 'fiscal',
  'product_invoice.delete': 'fiscal',
  'fiscal.manage': 'fiscal'
}

const PLAN_ORDER = ['starter', 'pro', 'fiscal']

function hasPlanAccess(current: string | null, required: string): boolean {
  if (!current) return false
  return PLAN_ORDER.indexOf(current) >= PLAN_ORDER.indexOf(required)
}

/**
 * Enforces org-level plan gate + user role permission gate for the given action code.
 *
 * Throws 403 if:
 *   - The org plan does not meet the minimum tier required for the action, OR
 *   - The user's role does not have the action granted (unless the user is an admin/owner)
 *
 * @param userId  - auth user ID (from requireAuthUser)
 * @param actionCode - e.g. 'service_invoice.create'
 * @param event - opcional; quando vier, grava organização e papel no contexto de auditoria
 */
export async function requireOrgPermission(userId: string, actionCode: string, event?: H3Event): Promise<void> {
  const supabase = getSupabaseAdminClient()

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('organization_id, role_id, is_owner, is_active')
    .eq('user_id', userId)
    .maybeSingle()

  if (profileError || !profile) {
    throw createError({ statusCode: 403, statusMessage: 'Perfil de usuário não encontrado.' })
  }

  if (profile.is_active === false) {
    throw createError({ statusCode: 403, statusMessage: 'Usuário sem acesso ativo.' })
  }

  const organizationId = profile.organization_id as string | null
  if (!organizationId) {
    throw createError({ statusCode: 403, statusMessage: 'Usuário não vinculado a uma organização.' })
  }

  setAuditContext(event, { organizationId })

  // ── 1. Plan gate (org-level, no bypass) ──────────────────────────────────
  const requiredPlan = ACTION_PLAN_REQUIREMENTS[actionCode]
  if (requiredPlan) {
    const { planKey } = await resolveOrgLicense(organizationId)
    if (!hasPlanAccess(planKey, requiredPlan)) {
      const tierName = requiredPlan.charAt(0).toUpperCase() + requiredPlan.slice(1)
      throw createError({
        statusCode: 403,
        statusMessage: `Esta funcionalidade requer o plano ${tierName} ou superior.`
      })
    }
  }

  // ── 2. Role gate (admins/owners bypass) ──────────────────────────────────
  const isOwner = profile.is_owner === true

  if (isOwner) {
    setAuditContext(event, { role: 'owner' })
    return
  }

  const roleId = profile.role_id as string | null
  if (!roleId) {
    throw createError({ statusCode: 403, statusMessage: 'Usuário sem papel atribuído.' })
  }

  // Check if the user has the admin system role
  const { data: role } = await supabase
    .from('roles')
    .select('name, is_system_role')
    .eq('id', roleId)
    .maybeSingle()

  setAuditContext(event, { role: (role?.name as string | undefined) ?? undefined })

  const isAdmin = role?.name === 'admin' && role?.is_system_role === true
  if (isAdmin) return

  // Check if the role grants this action
  const { data: action } = await supabase
    .from('actions')
    .select('id')
    .eq('code', actionCode)
    .is('deleted_at', null)
    .maybeSingle()

  if (!action) {
    throw createError({ statusCode: 403, statusMessage: 'Permissão não reconhecida.' })
  }

  const { data: grant } = await supabase
    .from('role_actions')
    .select('is_granted')
    .eq('role_id', roleId)
    .eq('action_id', action.id)
    .maybeSingle()

  if (!grant?.is_granted) {
    throw createError({ statusCode: 403, statusMessage: 'Acesso negado. Você não tem permissão para realizar esta ação.' })
  }
}
