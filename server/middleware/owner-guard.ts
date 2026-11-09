import { requireOwner } from '../utils/require-owner'

/**
 * Defesa em profundidade: todo `/api/admin/**` exige o owner da plataforma ANTES de chegar ao handler,
 * mesmo que um handler novo esqueça de chamar `requireOwner`. Fora de /api/admin o custo é zero.
 */
export default defineEventHandler(async (event) => {
  const path = (event.path || '').split('?')[0] ?? ''
  if (path === '/api/admin' || path.startsWith('/api/admin/')) {
    await requireOwner(event)
  }
})
