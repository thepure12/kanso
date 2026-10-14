import { describe, expect, it } from 'vitest'
import { bearerToken, generateApiToken, hashApiToken, tokenMethodAllowed, tokenRouteAllowed } from '../../server/utils/apiTokens'

describe('api tokens', () => {
  it('generates kb_ tokens with 32 random bytes and stores only the sha256', () => {
    const a = generateApiToken()
    expect(a.token).toMatch(/^kb_[\w-]{43}$/)
    expect(a.hash).toBe(hashApiToken(a.token))
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.prefix).toBe(a.token.slice(0, 10))
    expect(generateApiToken().token).not.toBe(a.token)
  })

  it('reads Bearer headers only', () => {
    expect(bearerToken('Bearer kb_abc')).toBe('kb_abc')
    expect(bearerToken('bearer  kb_abc ')).toBe('kb_abc')
    expect(bearerToken('Bearer ')).toBe('')
    expect(bearerToken('Basic dXNlcjpwYXNz')).toBeUndefined()
    expect(bearerToken(undefined)).toBeUndefined()
  })

  it('allows board routes and refuses account, auth, admin and webhook routes', () => {
    for (const r of ['/api/boards', '/api/boards/:id', '/api/cards/:id/move', '/api/search', '/api/me', '/api/my-work', '/api/notifications', '/api/teams/:id/members']) {
      expect(tokenRouteAllowed(r), r).toBe(true)
    }
    for (const r of [
      undefined, '', '/api/account', '/api/account/tokens', '/api/account/tokens/:id', '/api/account/sessions', '/api/account/two-factor/disable',
      '/api/auth/login', '/api/_auth/session', '/api/admin/users', '/api/boards/:id/webhooks', '/api/webhooks/:id', '/api/webhooks/:id/test',
      '/api/boardsx', '/auth/verify', '/api/me/x/../../account',
    ]) {
      expect(tokenRouteAllowed(r), String(r)).toBe(false)
    }
  })

  it('read scope allows only GET and HEAD', () => {
    expect(tokenMethodAllowed(['read'], 'GET')).toBe(true)
    expect(tokenMethodAllowed(['read'], 'HEAD')).toBe(true)
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) expect(tokenMethodAllowed(['read'], m)).toBe(false)
    expect(tokenMethodAllowed(['read', 'write'], 'DELETE')).toBe(true)
    expect(tokenMethodAllowed(['write'], 'POST')).toBe(true)
    expect(tokenMethodAllowed([], 'GET')).toBe(false)
  })
})
