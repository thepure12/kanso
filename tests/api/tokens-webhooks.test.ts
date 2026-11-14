// HTTP API tests for personal access tokens, board webhooks and Web Push. Builds and
// starts the app like boards.test.ts; webhooks and push may reach a local receiver here
// (NUXT_WEBHOOK_ALLOW_PRIVATE).
import { createDecipheriv, createECDH, createHmac, hkdfSync, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { url } from '@nuxt/test-utils/e2e'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiToken, PushSettings } from '#shared/types/account'
import type { BoardDetail, Card } from '#shared/types/board'
import type { InstanceSettings } from '#shared/types/admin'
import type { BoardWebhook, WebhookTestResult } from '#shared/types/webhooks'
import { signEmailToken } from '../../server/utils/emailToken'
import { setupApi } from './server'

const adminEmail = `admin-${randomUUID()}@api.test`
await setupApi({
  NUXT_ADMIN_EMAIL: adminEmail, NUXT_MAIL_SMTP_URL: '', NUXT_MAIL_LOG_LINKS: 'true',
  NUXT_WEBHOOK_ALLOW_PRIVATE: 'true', NUXT_PUBLIC_SITE_URL: 'https://kanso.example',
})

let base = ''
beforeAll(() => { base = url('/').replace(/\/$/, '') })
const authDb = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })
const ownerDb = postgres(process.env.MIGRATION_DATABASE_URL!, { onnotice: () => {} })

const randomIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250)).join('.')}`

interface Res<T> { status: number, data: T, headers: Headers }

/** A request with optional cookie or bearer token, from `ip`. */
async function call<T = any>(path: string, init: { method?: string, body?: unknown, cookie?: string, token?: string, ip?: string } = {}): Promise<Res<T>> {
  const res = await globalThis.fetch(base + path, {
    method: init.method ?? 'GET',
    redirect: 'manual',
    headers: {
      'x-forwarded-for': init.ip ?? randomIp(),
      ...(init.cookie && { cookie: init.cookie }),
      ...(init.token !== undefined && { authorization: `Bearer ${init.token}` }),
      ...(init.body !== undefined && { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : await res.text()
  return { status: res.status, data: data as T, headers: res.headers }
}

/** A signed-in user (cookie session). */
async function signUp(name: string, email = `${name.toLowerCase()}-${randomUUID()}@api.test`) {
  const ip = randomIp()
  expect((await call('/api/auth/register', { method: 'POST', body: { name, email, password: 'password123' }, ip })).status).toBe(200)
  const [u] = await authDb`select id from users where email = ${email}`
  const verify = await globalThis.fetch(`${base}/auth/verify?token=${signEmailToken(u!.id, email, process.env.NUXT_SESSION_PASSWORD!)}`, { redirect: 'manual', headers: { 'x-forwarded-for': ip } })
  const cookie = verify.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const req = <T = any>(path: string, init: { method?: string, body?: unknown } = {}) => call<T>(path, { ...init, cookie, ip })
  return { req, email, id: u!.id as string, cookie }
}

let admin: Awaited<ReturnType<typeof signUp>>
let savedSettings: InstanceSettings
let alice: Awaited<ReturnType<typeof signUp>>
let bob: Awaited<ReturnType<typeof signUp>>
let board: BoardDetail
const boards: string[] = []

beforeAll(async () => {
  admin = await signUp('Admin', adminEmail)
  savedSettings = (await admin.req<InstanceSettings>('/api/admin/settings')).data
  expect((await admin.req('/api/admin/settings', { method: 'PUT', body: { ...savedSettings, signupMode: 'open' } })).status).toBe(200)
  ;[alice, bob] = await Promise.all([signUp('Alice'), signUp('Bob')])
  const created = await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Token board', template: 'basic' } })
  boards.push(created.data.id)
  expect((await alice.req(`/api/boards/${created.data.id}/members`, { method: 'POST', body: { email: bob.email, role: 'editor' } })).status).toBe(200)
  board = (await alice.req<BoardDetail>(`/api/boards/${created.data.id}`)).data
})

afterAll(async () => {
  for (const id of boards) await alice?.req(`/api/boards/${id}`, { method: 'DELETE' })
  await admin?.req('/api/admin/settings', { method: 'PUT', body: savedSettings })
  await ownerDb`delete from admin_audit_log where data->>'actor_email' like '%@api.test' or data->>'target_email' like '%@api.test'`
  await ownerDb`delete from users where email = ${adminEmail}`
  await Promise.all([authDb.end(), ownerDb.end()])
})

const newToken = async (scopes: string[], name = 'script') => {
  const res = await alice.req<ApiToken & { token: string }>('/api/account/tokens', { method: 'POST', body: { name, scopes } })
  expect(res.status).toBe(200)
  return res.data
}

describe('api tokens', () => {
  it('are created once, listed without the secret and work without a cookie', async () => {
    const t = await newToken(['read'])
    expect(t.token).toMatch(/^kb_/)
    expect(t.prefix).toBe(t.token.slice(0, 10))
    const list = (await alice.req<ApiToken[]>('/api/account/tokens')).data
    expect(list.find(x => x.id === t.id)).toMatchObject({ name: 'script', scopes: ['read'], revokedAt: null })
    expect(JSON.stringify(list)).not.toContain(t.token)
    // Bob does not see Alice's tokens.
    expect((await bob.req<ApiToken[]>('/api/account/tokens')).data.some(x => x.id === t.id)).toBe(false)

    const res = await call<BoardDetail>(`/api/boards/${board.id}`, { token: t.token })
    expect(res.status).toBe(200)
    expect(res.data.name).toBe('Token board')
    expect(res.headers.getSetCookie()).toEqual([])
    expect((await call('/api/search?q=Token', { token: t.token })).status).toBe(200)
    expect((await call('/api/my-work', { token: t.token })).status).toBe(200)
  })

  it('read scope allows only GET; write scope allows changes', async () => {
    const read = await newToken(['read'])
    const write = await newToken(['read', 'write'])
    const column = board.columns[0]!.id
    const denied = await call(`/api/boards/${board.id}/cards`, { method: 'POST', body: { columnId: column, title: 'Nope' }, token: read.token })
    expect(denied.status).toBe(403)
    const card = await call<Card>(`/api/boards/${board.id}/cards`, { method: 'POST', body: { columnId: column, title: 'Via token' }, token: write.token })
    expect(card.status).toBe(200)
    expect((await call(`/api/cards/${card.data.id}`, { method: 'PATCH', body: { title: 'Renamed via token' }, token: write.token })).status).toBe(200)
    // RLS still applies: the token is Alice, and Alice cannot see someone else's board.
    const bobsBoard = await bob.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Bob only' } })
    expect((await call(`/api/boards/${bobsBoard.data.id}`, { token: write.token })).status).toBe(404)
    await bob.req(`/api/boards/${bobsBoard.data.id}`, { method: 'DELETE' })
  })

  it('are refused on account, auth, admin and webhook routes', async () => {
    const write = await newToken(['read', 'write'])
    for (const [method, path] of [
      ['GET', '/api/account/tokens'], ['POST', '/api/account/tokens'], ['DELETE', `/api/account/tokens/${write.id}`],
      ['GET', '/api/account/sessions'], ['POST', '/api/account/sessions/revoke-others'], ['PATCH', '/api/account'],
      ['DELETE', '/api/account'], ['GET', '/api/admin/users'], ['GET', '/api/admin/settings'],
      ['GET', `/api/boards/${board.id}/webhooks`], ['POST', `/api/boards/${board.id}/webhooks`],
    ] as const) {
      const res = await call(path, { method, token: write.token, body: method === 'GET' ? undefined : { name: 'x', scopes: ['read'] } })
      expect(res.status, `${method} ${path}`).toBe(403)
    }
    // Routes outside defineUserHandler only know cookies.
    for (const [method, path] of [['GET', '/api/account'], ['POST', '/api/account/password'], ['POST', '/api/account/two-factor/setup']] as const) {
      const res = await call(path, { method, token: write.token, body: method === 'GET' ? undefined : {} })
      expect(res.status, `${method} ${path}`).toBe(401)
    }
    // The token still exists and works.
    expect((await alice.req<ApiToken[]>('/api/account/tokens')).data.find(x => x.id === write.id)?.revokedAt).toBeNull()
  })

  it('revoked, unknown and expired tokens get 401; failures are rate limited per IP', async () => {
    const t = await newToken(['read'])
    expect((await alice.req(`/api/account/tokens/${t.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await call('/api/boards', { token: t.token })).status).toBe(401)
    expect((await alice.req(`/api/account/tokens/${t.id}`, { method: 'DELETE' })).status).toBe(404)

    const expiring = await newToken(['read'])
    await ownerDb`update api_tokens set expires_at = now() - interval '1 second' where id = ${expiring.id}`
    expect((await call('/api/boards', { token: expiring.token })).status).toBe(401)

    const ip = randomIp()
    const statuses: number[] = []
    for (let i = 0; i < 21; i++) statuses.push((await call('/api/boards', { token: `kb_${randomUUID()}`, ip })).status)
    expect(statuses.slice(0, 20).every(s => s === 401)).toBe(true)
    expect(statuses[20]).toBe(429)
    // A cookie session on the same request is ignored once a Bearer header is there.
    expect((await call('/api/boards', { token: 'kb_bad', cookie: alice.cookie })).status).toBe(401)
    expect((await alice.req('/api/boards')).status).toBe(200)
  })

  it('can be limited to some boards', async () => {
    const other = await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Other token board' } })
    boards.push(other.data.id)
    const res = await alice.req<ApiToken & { token: string }>('/api/account/tokens', {
      method: 'POST', body: { name: 'limited', scopes: ['read', 'write'], boardIds: [board.id, board.id] },
    })
    expect(res.status).toBe(200)
    expect(res.data.boards).toEqual([{ id: board.id, name: 'Token board' }])
    expect((await alice.req<ApiToken[]>('/api/account/tokens')).data.find(x => x.id === res.data.id)?.boards).toEqual([{ id: board.id, name: 'Token board' }])
    expect((await newToken(['read'])).boards).toBeNull()

    const token = res.data.token
    expect((await call<{ id: string }[]>('/api/boards', { token })).data.map(b => b.id)).toEqual([board.id])
    expect((await call(`/api/boards/${board.id}`, { token })).status).toBe(200)
    expect((await call(`/api/boards/${other.data.id}`, { token })).status).toBe(404)
    expect((await call(`/api/boards/${other.data.id}`, { method: 'PATCH', body: { name: 'x' }, token })).status).toBe(404)
    expect((await call('/api/boards', { method: 'POST', body: { name: 'New' }, token })).status).toBe(403)
    expect((await call('/api/teams', { method: 'POST', body: { name: 'New' }, token })).status).toBe(403)

    // Only boards the user can see, and at least one.
    const bobsBoard = await bob.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Bob only' } })
    expect((await alice.req('/api/account/tokens', { method: 'POST', body: { name: 'x', scopes: ['read'], boardIds: [bobsBoard.data.id] } })).status).toBe(403)
    expect((await alice.req('/api/account/tokens', { method: 'POST', body: { name: 'x', scopes: ['read'], boardIds: [] } })).status).toBe(400)
    await bob.req(`/api/boards/${bobsBoard.data.id}`, { method: 'DELETE' })
  })

  it('a password reset revokes every token', async () => {
    const carol = await signUp('Carol')
    const res = await carol.req<ApiToken & { token: string }>('/api/account/tokens', { method: 'POST', body: { name: 'ci', scopes: ['read'], expiresInDays: 30 } })
    expect(res.data.expiresAt).not.toBeNull()
    expect((await call('/api/boards', { token: res.data.token })).status).toBe(200)
    const [u] = await authDb`select id, session_version from users where email = ${carol.email}`
    const link = signEmailToken(u!.id, carol.email, process.env.NUXT_SESSION_PASSWORD!, 60_000, 'password-reset', u!.session_version)
    expect((await call('/api/auth/reset-password', { method: 'POST', body: { token: link, password: 'password456' } })).status).toBe(200)
    expect((await call('/api/boards', { token: res.data.token })).status).toBe(401)
  })
})

describe('webhooks', () => {
  const received: { path: string, headers: IncomingHttpHeaders, body: string, raw: Buffer }[] = []
  let receiver: ReturnType<typeof createServer>
  let hookUrl = ''

  beforeAll(async () => {
    receiver = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => { chunks.push(c) })
      req.on('end', () => {
        const raw = Buffer.concat(chunks)
        received.push({ path: req.url!, headers: req.headers, body: raw.toString(), raw })
        res.writeHead(req.url === '/fail' ? 500 : req.url!.includes('/gone') ? 410 : 200).end('ok')
      })
    })
    await new Promise<void>(r => receiver.listen(0, '127.0.0.1', r))
    hookUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`
  })
  afterAll(() => {
    receiver.closeAllConnections()
    receiver.close()
  })

  async function waitFor<T>(fn: () => T | undefined, ms = 10_000): Promise<T> {
    const end = Date.now() + ms
    for (;;) {
      const v = fn()
      if (v !== undefined) return v
      if (Date.now() > end) throw new Error('timed out waiting')
      await new Promise(r => setTimeout(r, 100))
    }
  }

  it('owners add, list and test webhooks; others cannot', async () => {
    const created = await alice.req<BoardWebhook & { secret: string }>(`/api/boards/${board.id}/webhooks`, { method: 'POST', body: { url: `${hookUrl}/ping`, format: 'json' } })
    expect(created.status).toBe(200)
    expect(created.data.secret).toMatch(/^[0-9a-f]{64}$/)
    const list = (await alice.req<BoardWebhook[]>(`/api/boards/${board.id}/webhooks`)).data
    expect(list).toHaveLength(1)
    expect(JSON.stringify(list)).not.toContain(created.data.secret)

    // Bob is an editor: he sees no webhooks and cannot add, change, test or delete them.
    expect((await bob.req<BoardWebhook[]>(`/api/boards/${board.id}/webhooks`)).data).toEqual([])
    expect((await bob.req(`/api/boards/${board.id}/webhooks`, { method: 'POST', body: { url: `${hookUrl}/x` } })).status).toBe(403)
    expect((await bob.req(`/api/webhooks/${created.data.id}`, { method: 'PATCH', body: { active: false } })).status).toBe(404)
    expect((await bob.req(`/api/webhooks/${created.data.id}/test`, { method: 'POST' })).status).toBe(404)
    expect((await bob.req(`/api/webhooks/${created.data.id}`, { method: 'DELETE' })).status).toBe(404)

    const test = await alice.req<WebhookTestResult>(`/api/webhooks/${created.data.id}/test`, { method: 'POST' })
    expect(test.data).toEqual({ ok: true, status: 200, error: null })
    const ping = received.find(r => r.path === '/ping')!
    expect(ping.headers['x-kanban-event']).toBe('ping')
    const ts = ping.headers['x-kanban-timestamp'] as string
    expect(ping.headers['x-kanban-signature']).toBe(`sha256=${createHmac('sha256', created.data.secret).update(`${ts}.${ping.body}`).digest('hex')}`)
    expect(JSON.parse(ping.body)).toMatchObject({ event: 'ping', board: { id: board.id, url: `https://kanso.example/boards/${board.id}` } })
    const after = (await alice.req<BoardWebhook[]>(`/api/boards/${board.id}/webhooks`)).data[0]!
    expect(after).toMatchObject({ lastStatus: 200, lastError: null, failureCount: 0 })
    expect((await alice.req(`/api/webhooks/${created.data.id}`, { method: 'DELETE' })).status).toBe(200)
  })

  it('validates URLs, formats and events', async () => {
    for (const body of [
      { url: 'ftp://example.com/x' }, { url: 'not a url' }, { url: 'https://u:p@example.com/' },
      { url: `${hookUrl}/x`, format: 'xml' }, { url: `${hookUrl}/x`, events: ['nope'] },
    ]) {
      expect((await alice.req(`/api/boards/${board.id}/webhooks`, { method: 'POST', body })).status, JSON.stringify(body)).toBe(400)
    }
  })

  it('delivers card activity as json, slack and discord, filtered by event', async () => {
    const json = (await alice.req<BoardWebhook & { secret: string }>(`/api/boards/${board.id}/webhooks`, { method: 'POST', body: { url: `${hookUrl}/json`, format: 'json', events: ['created'] } })).data
    await alice.req(`/api/boards/${board.id}/webhooks`, { method: 'POST', body: { url: `${hookUrl}/slack`, format: 'slack', events: ['created'] } })
    await alice.req(`/api/boards/${board.id}/webhooks`, { method: 'POST', body: { url: `${hookUrl}/discord`, format: 'discord', events: ['renamed'] } })

    const card = (await bob.req<Card>(`/api/boards/${board.id}/cards`, { method: 'POST', body: { columnId: board.columns[0]!.id, title: 'Hook me' } })).data
    await bob.req(`/api/cards/${card.id}`, { method: 'PATCH', body: { title: 'Hooked' } })

    const got = await waitFor(() => received.find(r => r.path === '/json'))
    const payload = JSON.parse(got.body)
    expect(payload).toMatchObject({
      event: 'created',
      text: `Bob created this card in ${board.columns[0]!.title}`,
      card: { id: card.id, title: 'Hook me', url: `https://kanso.example/boards/${board.id}?card=${card.id}` },
      board: { id: board.id, name: 'Token board' },
      actor: { id: bob.id, name: 'Bob' },
    })
    expect(got.headers['x-kanban-signature']).toBe(`sha256=${createHmac('sha256', json.secret).update(`${got.headers['x-kanban-timestamp']}.${got.body}`).digest('hex')}`)

    const slack = await waitFor(() => received.find(r => r.path === '/slack'))
    expect(JSON.parse(slack.body).text).toContain(`<https://kanso.example/boards/${board.id}?card=${card.id}|Hook me>`)
    const discord = await waitFor(() => received.find(r => r.path === '/discord'))
    expect(JSON.parse(discord.body)).toMatchObject({ content: expect.stringContaining('Bob renamed this card from "Hook me"'), allowed_mentions: { parse: [] } })

    await new Promise(r => setTimeout(r, 300))
    expect(received.filter(r => r.path === '/json')).toHaveLength(1)
    expect(received.filter(r => r.path === '/discord')).toHaveLength(1)
    const hooks = (await alice.req<BoardWebhook[]>(`/api/boards/${board.id}/webhooks`)).data
    expect(hooks.find(h => h.id === json.id)).toMatchObject({ lastStatus: 200, failureCount: 0 })
    for (const h of hooks) await alice.req(`/api/webhooks/${h.id}`, { method: 'DELETE' })
  })

  it('records failures and turns webhooks on and off', async () => {
    const hook = (await alice.req<BoardWebhook>(`/api/boards/${board.id}/webhooks`, { method: 'POST', body: { url: `${hookUrl}/fail`, format: 'slack' } })).data
    const test = await alice.req<WebhookTestResult>(`/api/webhooks/${hook.id}/test`, { method: 'POST' })
    expect(test.data).toEqual({ ok: false, status: 500, error: 'HTTP 500' })
    await bob.req<Card>(`/api/boards/${board.id}/cards`, { method: 'POST', body: { columnId: board.columns[0]!.id, title: 'Fails' } })
    let h: BoardWebhook | undefined
    const end = Date.now() + 10_000
    while (Date.now() < end) {
      h = (await alice.req<BoardWebhook[]>(`/api/boards/${board.id}/webhooks`)).data.find(x => x.id === hook.id)
      if (h?.failureCount) break
      await new Promise(r => setTimeout(r, 100))
    }
    expect(h).toMatchObject({ failureCount: 1, lastStatus: 500, lastError: 'HTTP 500', active: true })
    const off = await alice.req<BoardWebhook>(`/api/webhooks/${hook.id}`, { method: 'PATCH', body: { active: false } })
    expect(off.data.active).toBe(false)
    const on = await alice.req<BoardWebhook>(`/api/webhooks/${hook.id}`, { method: 'PATCH', body: { active: true, events: ['moved'] } })
    expect(on.data).toMatchObject({ active: true, failureCount: 0, events: ['moved'] })
    await alice.req(`/api/webhooks/${hook.id}`, { method: 'DELETE' })
  })

  // Web Push shares the receiver: a fake push service that records the request,
  // which the test decrypts like a browser would (RFC 8291 aes128gcm).
  describe('web push', () => {
    function browserKeys() {
      const ecdh = createECDH('prime256v1')
      ecdh.generateKeys()
      return { ecdh, p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16) }
    }

    function decrypt(body: Buffer, keys: ReturnType<typeof browserKeys>): unknown {
      const salt = body.subarray(0, 16)
      const idLen = body[20]!
      const serverPublic = body.subarray(21, 21 + idLen)
      const shared = keys.ecdh.computeSecret(serverPublic)
      const info = Buffer.concat([Buffer.from('WebPush: info\0'), keys.ecdh.getPublicKey(), serverPublic])
      const ikm = Buffer.from(hkdfSync('sha256', shared, keys.auth, info, 32))
      const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
      const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
      const ct = body.subarray(21 + idLen)
      const d = createDecipheriv('aes-128-gcm', cek, nonce)
      d.setAuthTag(ct.subarray(ct.length - 16))
      const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()])
      return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString())
    }

    it('saves a subscription for the session, sends encrypted, VAPID-signed messages and drops dead ones', async () => {
      const settings = (await alice.req<PushSettings>('/api/account/push')).data
      expect(Buffer.from(settings.publicKey, 'base64url')).toHaveLength(65)
      const keys = browserKeys()
      const endpoint = `${hookUrl}/push/alice`
      for (const body of [
        { endpoint, keys: { p256dh: 'short', auth: keys.auth.toString('base64url') } },
        { endpoint: 'ftp://example.com/x', keys: { p256dh: keys.p256dh, auth: keys.auth.toString('base64url') } },
      ]) {
        expect((await alice.req('/api/account/push', { method: 'POST', body })).status, JSON.stringify(body)).toBe(400)
      }
      expect((await alice.req('/api/account/push', { method: 'POST', body: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth.toString('base64url') } } })).status).toBe(200)
      expect((await alice.req<PushSettings>('/api/account/push')).data.devices.map(d => d.endpoint)).toEqual([endpoint])
      expect((await bob.req<PushSettings>('/api/account/push')).data.devices).toEqual([])
      // Not for API tokens.
      const token = await newToken(['read', 'write'])
      expect((await call('/api/account/push', { token: token.token })).status).toBe(403)

      // Test message.
      expect((await alice.req('/api/account/push/test', { method: 'POST', body: { endpoint } })).data).toEqual({ sent: 1, total: 1 })
      const test = await waitFor(() => received.find(r => r.path === '/push/alice'))
      expect(test.headers['content-encoding']).toBe('aes128gcm')
      expect(test.headers.authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${settings.publicKey}$`))
      expect(Number(test.headers.ttl)).toBeGreaterThan(0)
      expect(decrypt(test.raw, keys)).toMatchObject({ title: 'Test notification', force: true })

      // A notification: Bob assigns Alice.
      const card = (await bob.req<Card>(`/api/boards/${board.id}/cards`, { method: 'POST', body: { columnId: board.columns[0]!.id, title: 'Push me' } })).data
      expect((await bob.req(`/api/cards/${card.id}`, { method: 'PATCH', body: { assigneeIds: [alice.id] } })).status).toBe(200)
      const pushed = await waitFor(() => received.filter(r => r.path === '/push/alice')[1])
      const msg = decrypt(pushed.raw, keys) as { title: string, body: string, url: string, readUrl: string, tag: string }
      expect(msg).toMatchObject({ title: 'Push me', url: `/boards/${board.id}?card=${card.id}` })
      expect(msg.body).toMatch(/^Bob .+\nToken board$/)
      expect(msg.readUrl).toMatch(/^\/api\/notifications\/[0-9a-f-]{36}$/)
      expect(msg.tag).toBe(`kanso-notification-${msg.readUrl.split('/').pop()}`)

      // The push service says the endpoint is gone: the subscription is dropped.
      const gone = `${hookUrl}/push/gone`
      expect((await bob.req('/api/account/push', { method: 'POST', body: { endpoint: gone, keys: { p256dh: browserKeys().p256dh, auth: randomBytes(16).toString('base64url') } } })).status).toBe(200)
      expect((await bob.req('/api/account/push/test', { method: 'POST', body: {} })).data).toEqual({ sent: 0, total: 1 })
      expect((await bob.req<PushSettings>('/api/account/push')).data.devices).toEqual([])
      expect((await bob.req('/api/account/push/test', { method: 'POST', body: {} })).status).toBe(404)

      // Turning it off on the device.
      expect((await alice.req('/api/account/push', { method: 'DELETE', body: { endpoint } })).status).toBe(204)
      expect((await alice.req<PushSettings>('/api/account/push')).data.devices).toEqual([])
    })
  })
})
