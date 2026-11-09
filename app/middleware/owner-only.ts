/**
 * Páginas de /admin: só o owner da plataforma (`is_owner`). Substitui `workshop-admin`, que checava
 * `isAdmin` (owner OU admin de oficina). O `auth.global.ts` continua sendo a primeira barreira.
 */
export default defineNuxtRouteMiddleware(() => {
  const workshop = useWorkshopBootstrap()

  if (workshop.isOwner.value)
    return

  return navigateTo('/app/forbidden')
})
