import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'settings.update', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const parts = await readMultipartFormData(event)
  const filePart = parts?.find(p => p.name === 'file')

  if (!filePart?.data || !filePart.filename)
    throw createError({ statusCode: 400, statusMessage: 'Arquivo não fornecido' })

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
  const contentType = filePart.type || ''
  if (!allowedTypes.includes(contentType))
    throw createError({ statusCode: 400, statusMessage: 'Formato não permitido. Use JPEG, PNG ou WebP.' })

  const maxSize = 5 * 1024 * 1024
  if (filePart.data.length > maxSize)
    throw createError({ statusCode: 400, statusMessage: 'Arquivo muito grande. Máximo 5MB.' })

  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  }
  const ext = extMap[contentType] ?? 'jpg'
  const storagePath = `${organizationId}/logo.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('org-logos')
    .upload(storagePath, filePart.data, { contentType, upsert: true })

  if (uploadError)
    throw createError({ statusCode: 500, statusMessage: uploadError.message })

  const { data: publicUrlData } = supabase.storage
    .from('org-logos')
    .getPublicUrl(storagePath)

  const logoUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`

  const { error: updateError } = await supabase
    .from('organizations')
    .update({ logo_url: logoUrl, updated_by: authUser.email })
    .eq('id', organizationId)

  if (updateError)
    throw createError({ statusCode: 500, statusMessage: updateError.message })

  return { logo_url: logoUrl }
})
