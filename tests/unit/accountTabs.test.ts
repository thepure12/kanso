import { describe, expect, it } from 'vitest'
import { accountTabFrom } from '../../app/utils/accountTabs'

describe('accountTabFrom', () => {
  it('keeps known tabs', () => {
    expect(accountTabFrom('security')).toBe('security')
    expect(accountTabFrom('notifications')).toBe('notifications')
    expect(accountTabFrom('tokens')).toBe('tokens')
  })

  it('falls back to profile', () => {
    expect(accountTabFrom(undefined)).toBe('profile')
    expect(accountTabFrom('nope')).toBe('profile')
    expect(accountTabFrom(['security'])).toBe('profile')
  })
})
