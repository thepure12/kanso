import { describe, expect, it } from 'vitest'
import { SESSION_RENEW_MS, sessionNeedsRenewal } from '../../server/utils/sessionRenewal'

describe('sessionNeedsRenewal', () => {
  const now = 1_800_000_000_000
  it('leaves a cookie issued within the last day alone', () => {
    expect(sessionNeedsRenewal({ renewedAt: now - 1000, loggedInAt: now - 10 * SESSION_RENEW_MS }, now)).toBe(false)
    expect(sessionNeedsRenewal({ loggedInAt: now - SESSION_RENEW_MS + 1 }, now)).toBe(false)
  })
  it('renews one issued a day or more ago', () => {
    expect(sessionNeedsRenewal({ renewedAt: now - SESSION_RENEW_MS }, now)).toBe(true)
    expect(sessionNeedsRenewal({ loggedInAt: now - 2 * SESSION_RENEW_MS }, now)).toBe(true)
  })
  it('renews cookies without any timestamp', () => {
    expect(sessionNeedsRenewal({}, now)).toBe(true)
    expect(sessionNeedsRenewal({ renewedAt: 'x' }, now)).toBe(true)
  })
})
