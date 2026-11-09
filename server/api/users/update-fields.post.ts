import { readBody } from 'h3'
import { requireAuthUser } from '../../utils/require-auth'
import { changeUserRole } from '../../utils/user-role'

/**
 * POST /api/users/update-fields
 * Aceita SOMENTE `role_id` (a tela de perfis só usa isso). `organization_id`, `employee_id` e `email`
 * vindos do corpo são ignorados: permitir isso deixava qualquer usuário entrar em outra oficina como admin.
 * Mesma regra de `users/update-role`: mesma oficina e `roles.manage_members`.
 */
export default eventHandler(async (event) => {
  const authUser = await requireAuthUser(event)

  const body = await readBody(event)
  const { user_id, role_id } = body || {}

  if (!user_id) {
    throw createError({ statusCode: 400, statusMessage: 'user_id é obrigatório' })
  }
  if (role_id === undefined) {
    return { success: true, message: 'Nada a atualizar' }
  }
  if (!role_id || typeof role_id !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'role_id inválido' })
  }

  await changeUserRole(event, authUser, String(user_id), role_id)
  return { success: true }
})
