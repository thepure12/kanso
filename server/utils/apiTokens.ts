import { createHash, randomBytes } from 'node:crypto'

/** A new personal access token: `kb_` + 32 random bytes (base64url), its sha256 and its display prefix. */
export function generateApiToken() {
  const token = `kb_${randomBytes(32).toString('base64url')}`
  return { token, hash: hashApiToken(token), prefix: token.slice(0, 10) }
}

/** What api_tokens stores: hex sha256. The token has 256 random bits, so no salt or slow hash is needed. */
export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** The token of an `Authorization: Bearer ...` header, if the request has one (any other scheme: undefined). */
export function bearerToken(header: string | undefined): string | undefined {
  const m = header?.match(/^Bearer[ \t]+(\S*)\s*$/i)
  return m ? m[1] : undefined
}

/**
 * Route prefixes (h3 route patterns, segment-wise) a token may call. Anything
 * else (account, auth, two-factor, sessions, token management, admin, and
 * routes added later) refuses tokens, so a leaked token cannot take over the
 * account. Webhooks hold secrets and send board data elsewhere: cookie only.
 */
const tokenRoutes = [
  '/api/boards', '/api/cards', '/api/columns', '/api/tags', '/api/comments', '/api/checklist-items', '/api/column-rules',
  '/api/attachments', '/api/card-links', '/api/fields', '/api/time-entries', '/api/teams', '/api/notifications',
  '/api/search', '/api/me',
]
const tokenDenied = /\/webhooks(\/|$)/

/** Whether a token may call the route with this pattern (event.context.matchedRoute.path, e.g. /api/cards/:id). */
export function tokenRouteAllowed(pattern: string | undefined): boolean {
  if (!pattern || tokenDenied.test(pattern) || pattern.split('/').some(s => s === '.' || s === '..')) return false
  return tokenRoutes.some(p => pattern === p || pattern.startsWith(`${p}/`))
}

/** `read` allows GET and HEAD; `write` allows every method. */
export function tokenMethodAllowed(scopes: readonly string[], method: string): boolean {
  if (scopes.includes('write')) return true
  return scopes.includes('read') && (method === 'GET' || method === 'HEAD')
}
