import type { SupabaseClient } from '@supabase/supabase-js'

export const DEFAULT_USER_PREFERENCES = {
  primary_color: 'purple',
  neutral_color: 'slate',
  color_mode: 'light',
  timezone: 'UTC'
}

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  channel_in_app: true,
  channel_email: true,
  channel_web_push: false,
  channel_mobile_push: false,
  weekly_digest: false,
  product_updates: true,
  important_updates: true,
  web_push_permission: 'default',
  mobile_push_permission: 'default'
}

type EnsureUserProvisioningInput = {
  userId: string
  email?: string | null
  displayName?: string | null
  organizationId?: string | null
  roleId?: string | null
  employeeId?: string | null
  isActive?: boolean
  createdBy?: string | null
  updatedBy?: string | null
}

export async function ensureUserProvisioned(
  supabase: SupabaseClient,
  input: EnsureUserProvisioningInput
) {
  const normalizedEmail = input.email?.trim().toLowerCase() || null
  const normalizedName = input.displayName?.trim() || null

  // Atribuir uma role não pode sobrescrever o acesso que o usuário já tem: perfil existente com
  // outra role, ou admin/owner, é recusado (o upsert abaixo trocaria o role_id em silêncio).
  if (input.roleId) {
    const checkFailed = () => createError({
      statusCode: 503,
      statusMessage: 'Não foi possível verificar o acesso atual do usuário. Nada foi alterado.'
    })

    const { data: existing, error: existingError } = await supabase
      .from('user_profiles')
      .select('role_id, is_owner')
      .eq('user_id', input.userId)
      .maybeSingle()

    if (existingError) throw checkFailed()

    if (existing) {
      let isAdminRole = false
      if (existing.role_id) {
        const { data: existingRole, error: roleError } = await supabase
          .from('roles')
          .select('name, is_system_role')
          .eq('id', existing.role_id)
          .maybeSingle()
        if (roleError) throw checkFailed()
        isAdminRole = existingRole?.name === 'admin' && existingRole?.is_system_role === true
      }

      if (existing.is_owner === true || isAdminRole || (existing.role_id && existing.role_id !== input.roleId)) {
        throw createError({
          statusCode: 409,
          statusMessage: 'Este usuário já possui outro papel ou é administrador da organização. O acesso não foi alterado.'
        })
      }
    }
  }

  const profilePayload = {
    user_id: input.userId,
    email: normalizedEmail,
    display_name: normalizedName,
    organization_id: input.organizationId ?? null,
    role_id: input.roleId ?? null,
    employee_id: input.employeeId ?? null,
    is_active: input.isActive ?? true,
    ...(input.createdBy ? { created_by: input.createdBy } : {}),
    ...(input.updatedBy ? { updated_by: input.updatedBy } : {})
  }

  const [profileResult, userPreferencesResult, notificationPreferencesResult] = await Promise.all([
    supabase
      .from('user_profiles')
      .upsert(profilePayload, { onConflict: 'user_id' }),
    supabase
      .from('user_preferences')
      .upsert({
        user_id: input.userId,
        ...DEFAULT_USER_PREFERENCES
      }, { onConflict: 'user_id' }),
    supabase
      .from('notification_preferences')
      .upsert({
        user_id: input.userId,
        ...DEFAULT_NOTIFICATION_PREFERENCES
      }, { onConflict: 'user_id' })
  ])

  if (profileResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: `user_profiles: ${profileResult.error.message}`
    })
  }

  if (userPreferencesResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: `user_preferences: ${userPreferencesResult.error.message}`
    })
  }

  if (notificationPreferencesResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: `notification_preferences: ${notificationPreferencesResult.error.message}`
    })
  }
}
