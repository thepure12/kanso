// HTTP API tests for connecting a board to a Matrix room. A local fake
// homeserver stands in for Matrix (NUXT_WEBHOOK_ALLOW_PRIVATE lets the server
// reach it). Builds and starts the app like boards.test.ts (from the shared build).
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { url } from '@nuxt/test-utils/e2e'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { BoardDetail } from '#shared/types/board'
import type { InstanceSettings } from '#shared/types/admin'
import type { BoardMatrixRoom } from '#shared/types/matrix'
import { signEmailToken } from '../../server/utils/emailToken'
import { setupApi } from './server'

const adminEmail = `admin-${randomUUID()}@matrix.test`
await setupApi({ NUXT_ADMIN_EMAIL: adminEmail, NUXT_MAIL_SMTP_URL: '', NUXT_MAIL_LOG_LINKS: 'true', NUXT_WEBHOOK_ALLOW_PRIVATE: 'true' })

let base = ''
beforeAll(() => { base = url('/').replace(/\/$/, '') })
const authDb = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })
const ownerDb = postgres(process.env.MIGRATION_DATABASE_URL!, { onnotice: () => {} })

const randomIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250)).join('.')}`

async function call<T = any>(path: string, init: { method?: string, body?: unknown, cookie?: string, ip?: string } = {}) {
  const res = await globalThis.fetch(base + path, {
    method: init.method ?? 'GET',
    redirect: 'manual',
    headers: {
      'x-forwarded-for': init.ip ?? randomIp(),
      ...(init.cookie && { cookie: init.cookie }),
      ...(init.body !== undefined && { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : await res.text()
  return { status: res.status, data: data as T }
}

async function signUp(name: string, email = `${name.toLowerCase()}-${randomUUID()}@matrix.test`) {
  const ip = randomIp()
  expect((await call('/api/auth/register', { method: 'POST', body: { name, email, password: 'password123' }, ip })).status).toBe(200)
  const [u] = await authDb`select id from users where email = ${email}`
  const verify = await globalThis.fetch(`${base}/auth/verify?token=${signEmailToken(u!.id, email, process.env.NUXT_SESSION_PASSWORD!)}`, { redirect: 'manual', headers: { 'x-forwarded-for': ip } })
  const cookie = verify.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const req = <T = any>(path: string, init: { method?: string, body?: unknown } = {}) => call<T>(path, { ...init, cookie, ip })
  return { req, email, id: u!.id as string }
}

// ---------------------------------------------------------------- fake homeserver

const TOKEN = 'syt_good_token'
const fake = {
  /** Rooms the bot has joined. */
  joined: new Set<string>(),
  /** Rooms the bot may join (invited or public). */
  joinable: new Set(['!team:matrix.test', '!secret:matrix.test']),
  encrypted: new Set(['!secret:matrix.test']),
  names: new Map([['!team:matrix.test', 'Team room']]),
  aliases: new Map([['#team:matrix.test', '!team:matrix.test'], ['#secret:matrix.test', '!secret:matrix.test']]),
  requests: [] as { method: string, path: string, auth: string | undefined }[],
}

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function handle(req: IncomingMessage, res: ServerResponse) {
  const path = decodeURIComponent(req.url!.replace(/^\/_matrix\/client\/v3/, ''))
  fake.requests.push({ method: req.method!, path, auth: req.headers.authorization })
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(res, 401, { errcode: 'M_UNKNOWN_TOKEN', error: 'Invalid access token passed.' })
  let m: RegExpExecArray | null
  if (path === '/account/whoami') return reply(res, 200, { user_id: '@kanso-bot:matrix.test' })
  if (path === '/joined_rooms') return reply(res, 200, { joined_rooms: [...fake.joined] })
  if ((m = /^\/directory\/room\/(.+)$/.exec(path))) {
    const id = fake.aliases.get(m[1]!)
    return id ? reply(res, 200, { room_id: id }) : reply(res, 404, { errcode: 'M_NOT_FOUND', error: 'Room alias not found' })
  }
  if (req.method === 'POST' && (m = /^\/join\/(.+)$/.exec(path))) {
    if (!fake.joinable.has(m[1]!)) return reply(res, 403, { errcode: 'M_FORBIDDEN', error: 'You are not invited to this room.' })
    fake.joined.add(m[1]!)
    return reply(res, 200, { room_id: m[1] })
  }
  if ((m = /^\/rooms\/([^/]+)\/state\/([^/]+)\/$/.exec(path))) {
    const [, room, type] = m
    if (type === 'm.room.encryption' && fake.encrypted.has(room!)) return reply(res, 200, { algorithm: 'm.megolm.v1.aes-sha2' })
    if (type === 'm.room.name' && fake.names.has(room!)) return reply(res, 200, { name: fake.names.get(room!) })
    return reply(res, 404, { errcode: 'M_NOT_FOUND', error: 'Event not found.' })
  }
  reply(res, 404, { errcode: 'M_UNRECOGNIZED', error: 'Unrecognized request' })
}

const homeserver = createServer(handle)
let homeserverUrl = ''

// ---------------------------------------------------------------- setup

let admin: Awaited<ReturnType<typeof signUp>>
let savedSettings: InstanceSettings
let alice: Awaited<ReturnType<typeof signUp>>
let bob: Awaited<ReturnType<typeof signUp>>
let boardId = ''

beforeAll(async () => {
  await new Promise<void>(r => homeserver.listen(0, '127.0.0.1', r))
  homeserverUrl = `http://127.0.0.1:${(homeserver.address() as AddressInfo).port}`
  admin = await signUp('Admin', adminEmail)
  savedSettings = (await admin.req<InstanceSettings>('/api/admin/settings')).data
  expect((await admin.req('/api/admin/settings', { method: 'PUT', body: { ...savedSettings, signupMode: 'open' } })).status).toBe(200)
  ;[alice, bob] = await Promise.all([signUp('Alice'), signUp('Bob')])
  boardId = (await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Matrix board', template: 'basic' } })).data.id
  expect((await alice.req(`/api/boards/${boardId}/members`, { method: 'POST', body: { email: bob.email, role: 'editor' } })).status).toBe(200)
})

afterAll(async () => {
  if (boardId) await alice?.req(`/api/boards/${boardId}`, { method: 'DELETE' })
  await admin?.req('/api/admin/settings', { method: 'PUT', body: savedSettings })
  await new Promise(r => homeserver.close(r))
  await Promise.all([authDb.end(), ownerDb.end()])
})

beforeEach(() => { fake.requests.length = 0 })

const put = (who: typeof alice, body: Record<string, unknown>) =>
  who.req<BoardMatrixRoom>(`/api/boards/${boardId}/matrix`, { method: 'PUT', body: { homeserver: homeserverUrl, ...body } })
const boardMatrix = async (who: typeof alice) => (await who.req<BoardDetail>(`/api/boards/${boardId}`)).data.matrix

describe('connecting a board to a Matrix room', () => {
  it('refuses editors before contacting the homeserver', async () => {
    const res = await put(bob, { room: '#team:matrix.test', accessToken: TOKEN })
    expect(res.status).toBe(403)
    expect(fake.requests).toEqual([])
  })

  it('needs a token, a valid room reference and a token the homeserver accepts', async () => {
    expect((await put(alice, { room: '#team:matrix.test' })).status).toBe(400)
    const bad = await put(alice, { room: 'team', accessToken: TOKEN })
    expect(bad.status).toBe(400)
    expect(bad.data.statusMessage).toMatch(/^room:/)
    const wrong = await put(alice, { room: '#team:matrix.test', accessToken: 'nope' })
    expect(wrong.status).toBe(400)
    expect(wrong.data.statusMessage).toBe('Matrix: M_UNKNOWN_TOKEN: Invalid access token passed.')
    expect(await boardMatrix(alice)).toBeNull()
  })

  it('reports a room the bot cannot join', async () => {
    fake.aliases.set('#closed:matrix.test', '!closed:matrix.test')
    const res = await put(alice, { room: '#closed:matrix.test', accessToken: TOKEN })
    expect(res.status).toBe(400)
    expect(res.data.statusMessage).toContain('Invite it first')
    expect(await boardMatrix(alice)).toBeNull()
  })

  it('resolves an alias (also in a matrix.to link), joins the room and stores the token sealed', async () => {
    const res = await put(alice, { room: 'https://matrix.to/#/%23team%3Amatrix.test', accessToken: TOKEN })
    expect(res.status).toBe(200)
    const room = { homeserverUrl, roomId: '!team:matrix.test', roomName: 'Team room', botUserId: '@kanso-bot:matrix.test' }
    expect(res.data).toEqual(room)
    expect(fake.joined.has('!team:matrix.test')).toBe(true)
    expect(await boardMatrix(bob)).toEqual(room)
    const [row] = await ownerDb`select access_token from board_matrix_rooms where board_id = ${boardId}`
    expect(row!.access_token).toMatch(/^v1\./)
    expect(row!.access_token).not.toContain(TOKEN)
  })

  it('refuses an encrypted room and keeps the old connection', async () => {
    const res = await put(alice, { room: '#secret:matrix.test' })
    expect(res.status).toBe(400)
    expect(res.data.statusMessage).toContain('end-to-end encrypted')
    // The stored token was used, since none was sent.
    expect(fake.requests.every(r => r.auth === `Bearer ${TOKEN}`)).toBe(true)
    expect((await boardMatrix(alice))?.roomId).toBe('!team:matrix.test')
  })

  it('tests the stored connection (owners only)', async () => {
    fake.names.set('!team:matrix.test', 'Renamed room')
    const res = await alice.req<BoardMatrixRoom>(`/api/boards/${boardId}/matrix/test`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(res.data.roomName).toBe('Renamed room')
    expect((await boardMatrix(alice))?.roomName).toBe('Renamed room')
    expect((await bob.req(`/api/boards/${boardId}/matrix/test`, { method: 'POST' })).status).toBe(404)

    fake.joined.clear()
    fake.joinable.delete('!team:matrix.test')
    const kicked = await alice.req(`/api/boards/${boardId}/matrix/test`, { method: 'POST' })
    expect(kicked.status).toBe(400)
    expect(kicked.data.statusMessage).toContain('Invite it first')
    fake.joinable.add('!team:matrix.test')
  })

  it('disconnects (owners only)', async () => {
    expect((await bob.req(`/api/boards/${boardId}/matrix`, { method: 'DELETE' })).status).toBe(404)
    expect((await alice.req(`/api/boards/${boardId}/matrix`, { method: 'DELETE' })).status).toBe(200)
    expect(await boardMatrix(alice)).toBeNull()
    expect((await alice.req(`/api/boards/${boardId}/matrix`, { method: 'DELETE' })).status).toBe(404)
  })
})
