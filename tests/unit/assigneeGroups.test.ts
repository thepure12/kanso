import { describe, expect, it } from 'vitest'
import { assigneeGroupId, assigneeGroupKey, expandAssigneeGroups, sortAssigneeGroups } from '../../app/utils/assigneeGroups'

describe('assignee groups', () => {
  it('keys round-trip; user ids are not group keys', () => {
    expect(assigneeGroupId(assigneeGroupKey('g1'))).toBe('g1')
    expect(assigneeGroupId('u1')).toBeNull()
  })

  it('expands group keys into members without duplicates, dropping unknown groups', () => {
    const groups = [{ id: 'g1', userIds: ['u2', 'u3'] }]
    expect(expandAssigneeGroups(['u1', 'group:g1', 'u2', 'group:gone'], groups)).toEqual(['u1', 'u2', 'u3'])
    expect(expandAssigneeGroups([], groups)).toEqual([])
  })

  it('sorts by name regardless of case', () => {
    expect(sortAssigneeGroups([{ name: 'beta' }, { name: 'Alpha' }]).map(g => g.name)).toEqual(['Alpha', 'beta'])
  })
})
