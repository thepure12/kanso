import { createHmac, timingSafeEqual } from 'node:crypto'

/** What a token is for. Part of the signature, so a token for one purpose fails as another. */
export type EmailTokenPurpose = 'email-verify' | 'password-reset' | 'email-change'

export interface EmailTokenClaims {
  userId: string
  email: string
  /** The account's `session_version` when the token was issued, if bound to it. */
  version?: number
}

/**
 * Stateless email token: base64url JSON `{ u, e, x, v? }` (user id, email,
 * expiry in ms, optional session version) plus an HMAC-SHA256 signature over
 * the purpose and payload. Callers check the email (and version) against the
 * account, so the token stops working once those change.
 */
export function signEmailToken(userId: string, email: string, secret: string, ttlMs = 24 * 60 * 60_000, purpose: EmailTokenPurpose = 'email-verify', version?: number): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: email.toLowerCase(), x: Date.now() + ttlMs, v: version })).toString('base64url')
  return `${payload}.${sign(purpose, payload, secret)}`
}

/** Returns the token's claims, or null when it is malformed, forged, expired or for another purpose. */
export function verifyEmailToken(token: string, secret: string, purpose: EmailTokenPurpose = 'email-verify'): EmailTokenClaims | null {
  const [payload, sig, extra] = token.split('.')
  if (!payload || !sig || extra !== undefined) return null
  const expected = Buffer.from(sign(purpose, payload, secret))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const { u, e, x, v } = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (typeof u !== 'string' || typeof e !== 'string' || typeof x !== 'number' || x < Date.now()) return null
    if (v !== undefined && typeof v !== 'number') return null
    return v === undefined ? { userId: u, email: e } : { userId: u, email: e, version: v }
  }
  catch { return null }
}

function sign(purpose: EmailTokenPurpose, payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`${purpose}:${payload}`).digest('base64url')
}
