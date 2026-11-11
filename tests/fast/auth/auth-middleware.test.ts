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

describe('resolveAuthenticatedDestination (post-login destination)', () => {
  it('platform owner → /admin, even with organization', () => {
    expect(resolveAuthenticatedDestination(state({ isOwner: true, organizationId: 'o', isOnboardingComplete: true }))).toBe('/admin')
  })
  it('with organization and onboarding completed → /app', () => {
    expect(resolveAuthenticatedDestination(state({ organizationId: 'o', isOnboardingComplete: true }))).toBe('/app')
  })
  it('with organization and incomplete onboarding → /onboarding', () => {
    expect(resolveAuthenticatedDestination(state({ organizationId: 'o' }))).toBe('/onboarding')
  })
  it('no organization → /subscription', () => {
    expect(resolveAuthenticatedDestination(state({}))).toBe('/subscription')
  })
})
