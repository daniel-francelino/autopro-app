import { describe, expect, it } from 'vitest'
import { computeRoleCounts } from '../../../server/utils/role-counts'

describe('computeRoleCounts', () => {
  it('conta por papel, filtra plano, nao liberadas e duplicatas', () => {
    const counts = computeRoleCounts(
      ['r1', 'r2'],
      new Set(['a1', 'a2']),
      [
        { role_id: 'r1', action_id: 'a1', is_granted: true },
        { role_id: 'r1', action_id: 'a1', is_granted: true },
        { role_id: 'r1', action_id: 'a2', is_granted: false },
        { role_id: 'r1', action_id: 'a3', is_granted: true },
        { role_id: 'r2', action_id: 'a2', is_granted: true },
        { role_id: 'outro', action_id: 'a1', is_granted: true }
      ],
      ['r1', 'r1', 'r2', null, 'outro']
    )
    expect(counts).toEqual({
      r1: { assigned_users_count: 2, granted_actions_count: 1 },
      r2: { assigned_users_count: 1, granted_actions_count: 1 }
    })
  })

  it('papeis sem dados ficam com zero', () => {
    expect(computeRoleCounts(['r1'], new Set(), [], [])).toEqual({
      r1: { assigned_users_count: 0, granted_actions_count: 0 }
    })
  })
})
