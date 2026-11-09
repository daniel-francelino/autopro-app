import { describe, expect, it, vi } from 'vitest'

vi.mock('~/composables/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('~/composables/useWorkshopBootstrap', () => ({ useWorkshopBootstrap: vi.fn() }))
;(globalThis as Record<string, unknown>).defineNuxtRouteMiddleware = (fn: unknown) => fn

const { resolveAuthenticatedDestination } = await import('../../../app/middleware/auth.global')

const state = (o: { isOwner?: boolean, organizationId?: string | null, isOnboardingComplete?: boolean }) =>
  ({
    isOwner: { value: o.isOwner ?? false },
    organizationId: { value: o.organizationId ?? null },
    isOnboardingComplete: { value: o.isOnboardingComplete ?? false }
  }) as never

describe('resolveAuthenticatedDestination (destino pós-login)', () => {
  it('owner da plataforma → /admin, mesmo com organização', () => {
    expect(resolveAuthenticatedDestination(state({ isOwner: true, organizationId: 'o', isOnboardingComplete: true }))).toBe('/admin')
  })
  it('com organização e onboarding concluído → /app', () => {
    expect(resolveAuthenticatedDestination(state({ organizationId: 'o', isOnboardingComplete: true }))).toBe('/app')
  })
  it('com organização e onboarding incompleto → /onboarding', () => {
    expect(resolveAuthenticatedDestination(state({ organizationId: 'o' }))).toBe('/onboarding')
  })
  it('sem organização → /subscription', () => {
    expect(resolveAuthenticatedDestination(state({}))).toBe('/subscription')
  })
})
