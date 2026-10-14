import { describe, expect, it } from 'vitest'
import { signEmailToken, verifyEmailToken } from '../../server/utils/emailToken'

const secret = 'a-secret-that-is-at-least-32-characters'
const userId = '0b5b6c1e-6f43-4d0e-9a51-7d1f1c3c2a10'

describe('email tokens', () => {
  it('round-trips the user id and lower-cased email', () => {
    expect(verifyEmailToken(signEmailToken(userId, 'Ann@DM.org', secret), secret)).toEqual({ userId, email: 'ann@dm.org' })
  })

  it('rejects a token signed with another secret', () => {
    expect(verifyEmailToken(signEmailToken(userId, 'ann@dm.org', secret), `${secret}x`)).toBeNull()
  })

  it('rejects a tampered payload', () => {
    const [, sig] = signEmailToken(userId, 'ann@dm.org', secret).split('.')
    const forged = Buffer.from(JSON.stringify({ u: userId, e: 'boss@dm.org', x: Date.now() + 60_000 })).toString('base64url')
    expect(verifyEmailToken(`${forged}.${sig}`, secret)).toBeNull()
  })

  it('rejects an expired token', () => {
    expect(verifyEmailToken(signEmailToken(userId, 'ann@dm.org', secret, -1), secret)).toBeNull()
  })

  it('rejects malformed input', () => {
    for (const t of ['', 'abc', 'a.b.c', '.', `${signEmailToken(userId, 'ann@dm.org', secret)}.extra`]) {
      expect(verifyEmailToken(t, secret)).toBeNull()
    }
  })

  it('binds the purpose and carries the session version', () => {
    const reset = signEmailToken(userId, 'ann@dm.org', secret, 60_000, 'password-reset', 3)
    expect(verifyEmailToken(reset, secret, 'password-reset')).toEqual({ userId, email: 'ann@dm.org', version: 3 })
    expect(verifyEmailToken(reset, secret)).toBeNull()
    expect(verifyEmailToken(reset, secret, 'email-change')).toBeNull()
    expect(verifyEmailToken(signEmailToken(userId, 'ann@dm.org', secret), secret, 'password-reset')).toBeNull()
  })
})
