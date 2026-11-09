import { readBody } from 'h3'
import { requireAuthUser } from '../../utils/require-auth'
import { changeUserRole } from '../../utils/user-role'

/**
 * POST /api/users/update-role
 * Troca o papel (role_id) de um usuário da mesma oficina. Exige `roles.manage_members`.
 */
export default eventHandler(async (event) => {
  const authUser = await requireAuthUser(event)

  const body = await readBody(event)
  const { user_id, role_id } = body || {}

  if (!user_id) {
    throw createError({ statusCode: 400, statusMessage: 'user_id é obrigatório' })
  }
  if (!role_id || typeof role_id !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'role_id é obrigatório' })
  }

  await changeUserRole(event, authUser, String(user_id), role_id)
  return { success: true }
})
