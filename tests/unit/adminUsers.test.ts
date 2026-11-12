import { describe, expect, it } from 'vitest'
import { adminTabFrom, filterAdminUsers } from '../../app/utils/adminUsers'

const users = [
  { name: 'Anna Berg', email: 'anna@example.org' },
  { name: 'Ben Cole', email: 'ben@other.net' },
  { name: 'Cleo', email: 'cleo.berg@example.org' },
]

describe('filterAdminUsers', () => {
  it('returns everyone for an empty query', () => {
    expect(filterAdminUsers(users, '  ')).toBe(users)
  })

  it('matches name or email, ignoring case', () => {
    expect(filterAdminUsers(users, 'BERG').map(u => u.name)).toEqual(['Anna Berg', 'Cleo'])
    expect(filterAdminUsers(users, 'other.net').map(u => u.name)).toEqual(['Ben Cole'])
  })

  it('needs every word to match', () => {
    expect(filterAdminUsers(users, 'berg example cleo').map(u => u.name)).toEqual(['Cleo'])
    expect(filterAdminUsers(users, 'anna ben')).toEqual([])
  })
})

describe('adminTabFrom', () => {
  it('accepts known tabs and falls back to users', () => {
    expect(adminTabFrom('audit')).toBe('audit')
    expect(adminTabFrom('signup')).toBe('signup')
    expect(adminTabFrom('nope')).toBe('users')
    expect(adminTabFrom(undefined)).toBe('users')
    expect(adminTabFrom(['audit'])).toBe('users')
  })
})
