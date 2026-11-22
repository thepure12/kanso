/** How often a request re-issues the session cookie, extending its expiry (session.maxAge). */
export const SESSION_RENEW_MS = 24 * 60 * 60_000

/**
 * Whether the session cookie is due for re-issuing: it was issued (renewedAt,
 * else loggedInAt for cookies from before renewal existed) a day or more ago.
 */
export function sessionNeedsRenewal(s: { renewedAt?: unknown, loggedInAt?: unknown }, now = Date.now()): boolean {
  const issued = typeof s.renewedAt === 'number' ? s.renewedAt : typeof s.loggedInAt === 'number' ? s.loggedInAt : 0
  return now - issued >= SESSION_RENEW_MS
}
