// HTTP API tests for connecting a board to a Matrix room. A local fake
// homeserver stands in for Matrix (NUXT_WEBHOOK_ALLOW_PRIVATE lets the server
// reach it). Builds and starts the app like boards.test.ts (from the shared build).
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { url } from '@nuxt/test-utils/e2e'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { BoardDetail, Card, CardDetail } from '#shared/types/board'
import type { InstanceSettings } from '#shared/types/admin'
import type { BoardMatrixRoom, CardMatrixThread, MatrixThreadView } from '#shared/types/matrix'
import { signEmailToken } from '../../server/utils/emailToken'
import { setupApi } from './server'

const adminEmail = `admin-${randomUUID()}@matrix.test`
await setupApi({ NUXT_ADMIN_EMAIL: adminEmail, NUXT_MAIL_SMTP_URL: '', NUXT_MAIL_LOG_LINKS: 'true', NUXT_WEBHOOK_ALLOW_PRIVATE: 'true', NUXT_PUBLIC_SITE_URL: 'https://kanso.example' })

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
  /** Events by id: room and content. */
  events: new Map<string, { room: string, type: string, content: Record<string, any>, sender?: string, ts?: number, unsigned?: Record<string, any> }>(),
  members: new Map([['@kanso-bot:matrix.test', 'Kanso'], ['@dana:matrix.test', 'Dana']]),
  /** Transaction ids already used, with their event id. */
  txns: new Map<string, string>(),
}

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage) {
  let text = ''
  for await (const chunk of req) text += chunk
  return text ? JSON.parse(text) : null
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const [rawPath, query = ''] = req.url!.replace(/^\/_matrix\/client\/v[13]/, '').split('?')
  const path = decodeURIComponent(rawPath!)
  const params = new URLSearchParams(query)
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
  if (req.method === 'PUT' && (m = /^\/rooms\/([^/]+)\/send\/m\.room\.message\/([^/]+)$/.exec(path))) {
    const [, room, txn] = m
    const content = await readBody(req)
    if (!fake.joined.has(room!)) return reply(res, 403, { errcode: 'M_FORBIDDEN', error: 'User not in room' })
    let id = fake.txns.get(txn!)
    if (!id) {
      id = `$ev${fake.events.size + 1}`
      fake.txns.set(txn!, id)
      fake.events.set(id, { room: room!, type: 'm.room.message', content, sender: '@kanso-bot:matrix.test' })
    }
    return reply(res, 200, { event_id: id })
  }
  if ((m = /^\/rooms\/([^/]+)\/relations\/([^/]+)\/m\.thread$/.exec(path))) {
    // Newest first, pages of `limit`; `from` is the index to continue at.
    const all = [...fake.events].filter(([, e]) => e.room === m![1] && e.content['m.relates_to']?.rel_type === 'm.thread' && e.content['m.relates_to'].event_id === m![2]).reverse()
    const start = Number(params.get('from') ?? 0)
    const limit = Number(params.get('limit') ?? 5)
    const chunk = all.slice(start, start + limit).map(([id, e]) => ({ event_id: id, type: e.type, sender: e.sender ?? '@kanso-bot:matrix.test', origin_server_ts: e.ts ?? 1, content: e.content, unsigned: e.unsigned }))
    return reply(res, 200, { chunk, ...(start + limit < all.length && { next_batch: String(start + limit) }) })
  }
  if ((m = /^\/rooms\/([^/]+)\/state\/m\.room\.member\/(.+)$/.exec(path))) {
    const name = fake.members.get(m[2]!)
    return name ? reply(res, 200, { membership: 'join', displayname: name }) : reply(res, 404, { errcode: 'M_NOT_FOUND', error: 'Event not found.' })
  }
  if ((m = /^\/rooms\/([^/]+)\/event\/([^/]+)$/.exec(path))) {
    const e = fake.events.get(m[2]!)
    if (!e || e.room !== m[1]) return reply(res, 404, { errcode: 'M_NOT_FOUND', error: 'Event not found.' })
    return reply(res, 200, { event_id: m[2], type: e.type, sender: e.sender ?? '@someone:matrix.test', origin_server_ts: e.ts ?? 1, content: e.content, unsigned: e.unsigned })
  }
  if ((m = /^\/rooms\/([^/]+)\/state\/([^/]+)\/$/.exec(path))) {
    const [, room, type] = m
    if (type === 'm.room.encryption' && fake.encrypted.has(room!)) return reply(res, 200, { algorithm: 'm.megolm.v1.aes-sha2' })
    if (type === 'm.room.name' && fake.names.has(room!)) return reply(res, 200, { name: fake.names.get(room!) })
    return reply(res, 404, { errcode: 'M_NOT_FOUND', error: 'Event not found.' })
  }
  reply(res, 404, { errcode: 'M_UNRECOGNIZED', error: 'Unrecognized request' })
}

const homeserver = createServer((req, res) => { void handle(req, res) })
let homeserverUrl = ''

// ---------------------------------------------------------------- setup

let admin: Awaited<ReturnType<typeof signUp>>
let savedSettings: InstanceSettings
let alice: Awaited<ReturnType<typeof signUp>>
let bob: Awaited<ReturnType<typeof signUp>>
let carol: Awaited<ReturnType<typeof signUp>>
let boardId = ''

beforeAll(async () => {
  await new Promise<void>(r => homeserver.listen(0, '127.0.0.1', r))
  homeserverUrl = `http://127.0.0.1:${(homeserver.address() as AddressInfo).port}`
  admin = await signUp('Admin', adminEmail)
  savedSettings = (await admin.req<InstanceSettings>('/api/admin/settings')).data
  expect((await admin.req('/api/admin/settings', { method: 'PUT', body: { ...savedSettings, signupMode: 'open' } })).status).toBe(200)
  ;[alice, bob, carol] = await Promise.all([signUp('Alice'), signUp('Bob'), signUp('Carol')])
  boardId = (await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Matrix board', template: 'basic' } })).data.id
  expect((await alice.req(`/api/boards/${boardId}/members`, { method: 'POST', body: { email: bob.email, role: 'editor' } })).status).toBe(200)
  expect((await alice.req(`/api/boards/${boardId}/members`, { method: 'POST', body: { email: carol.email, role: 'viewer' } })).status).toBe(200)
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

describe('card threads', () => {
  let card: Card
  const thread = (who: typeof alice, body: Record<string, unknown> = {}, id = card.id) =>
    who.req<CardMatrixThread>(`/api/cards/${id}/matrix-thread`, { method: 'POST', body })
  const unlink = (who: typeof alice, id = card.id) => who.req(`/api/cards/${id}/matrix-thread`, { method: 'DELETE' })
  const detail = async (who: typeof alice) => (await who.req<CardDetail>(`/api/cards/${card.id}`)).data.matrixThread

  beforeAll(async () => {
    const b = (await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data
    card = (await alice.req<Card>(`/api/boards/${boardId}/cards`, { method: 'POST', body: { columnId: b.columns[0]!.id, title: 'Fix <the> login' } })).data
  })

  it('needs a connected room', async () => {
    const res = await thread(bob)
    expect(res.status).toBe(400)
    expect(res.data.statusMessage).toBe('This board has no Matrix room')
    expect(await detail(bob)).toBeNull()
  })

  it('editors start a thread: the bot posts the card as its root', async () => {
    expect((await put(alice, { room: '#team:matrix.test', accessToken: TOKEN })).status).toBe(200)
    fake.requests.length = 0
    expect((await thread(carol)).status).toBe(403)
    expect(fake.requests).toEqual([])

    const res = await thread(bob)
    expect(res.status).toBe(200)
    expect(res.data.roomId).toBe('!team:matrix.test')
    const root = fake.events.get(res.data.eventId)!
    expect(root.room).toBe('!team:matrix.test')
    const url = `https://kanso.example/boards/${boardId}?card=${card.id}`
    expect(root.content.body).toBe(`Fix <the> login · Matrix board\n${url}`)
    expect(root.content.formatted_body).toBe(`<a href="${url}"><strong>Fix &lt;the&gt; login</strong></a> · Matrix board`)
    expect(await detail(carol)).toEqual(res.data)
    expect((await thread(bob)).status).toBe(409)
  })

  it('editors unlink; viewers cannot', async () => {
    expect((await unlink(carol)).status).toBe(404)
    expect((await unlink(bob)).status).toBe(200)
    expect(await detail(bob)).toBeNull()
    expect((await unlink(bob)).status).toBe(404)
  })

  it('links an existing message, or the root of the thread a reply is in', async () => {
    fake.events.set('$topic', { room: '!team:matrix.test', type: 'm.room.message', content: { msgtype: 'm.text', body: 'Login is broken' } })
    fake.events.set('$reply', { room: '!team:matrix.test', type: 'm.room.message', content: { msgtype: 'm.text', body: 'Same here', 'm.relates_to': { rel_type: 'm.thread', event_id: '$topic' } } })
    const res = await thread(bob, { link: 'https://matrix.to/#/%23team%3Amatrix.test/%24reply?via=matrix.test' })
    expect(res.status).toBe(200)
    expect(res.data).toEqual({ roomId: '!team:matrix.test', eventId: '$topic' })
    expect((await unlink(bob)).status).toBe(200)
    expect((await thread(bob, { link: '$topic' })).data.eventId).toBe('$topic')
    expect((await unlink(bob)).status).toBe(200)
  })

  it('refuses messages from other rooms, unknown events and bad links', async () => {
    const other = await thread(bob, { link: 'https://matrix.to/#/!elsewhere:matrix.test/$topic' })
    expect(other.status).toBe(400)
    expect(other.data.statusMessage).toContain('not in the board')
    const missing = await thread(bob, { link: '$nope' })
    expect(missing.status).toBe(400)
    expect(missing.data.statusMessage).toContain('M_NOT_FOUND')
    expect((await thread(bob, { link: 'hello' })).status).toBe(400)
    expect(await detail(bob)).toBeNull()
  })
})

describe('reading a card thread', () => {
  let cardId = ''
  const read = (who: typeof alice) => who.req<MatrixThreadView>(`/api/cards/${cardId}/matrix-thread`)
  const reply = (id: string, body: Record<string, any>, extra: Record<string, any> = {}) => fake.events.set(id, {
    room: '!team:matrix.test', type: 'm.room.message', sender: '@dana:matrix.test', ts: Date.UTC(2026, 10, 14, 12, fake.events.size),
    content: { msgtype: 'm.text', ...body, 'm.relates_to': { rel_type: 'm.thread', event_id: '$root3', ...body['m.relates_to'] } }, ...extra,
  })

  beforeAll(async () => {
    const b = (await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data
    cardId = (await alice.req<Card>(`/api/boards/${boardId}/cards`, { method: 'POST', body: { columnId: b.columns[0]!.id, title: 'Read me' } })).data.id
    fake.events.set('$root3', { room: '!team:matrix.test', type: 'm.room.message', sender: '@dana:matrix.test', content: { msgtype: 'm.text', body: 'Printer is down' } })
    reply('$r1', { body: 'Have you tried turning it off', format: 'org.matrix.custom.html', formatted_body: 'Have you tried <em>turning it off</em>' }, { sender: '@stranger:matrix.test' })
    reply('$r2', { body: 'typo' }, { unsigned: { 'm.relations': { 'm.replace': { content: { 'm.new_content': { msgtype: 'm.text', body: 'fixed text' } } } } } })
    reply('$r3', { body: 'secret' }, { unsigned: { redacted_because: { type: 'm.room.redaction' } } })
    reply('$r4', { body: '> <@x:matrix.test> quoted\n\nanswer', format: 'org.matrix.custom.html', formatted_body: '<mx-reply><blockquote>quoted</blockquote></mx-reply>answer', 'm.relates_to': { 'm.in_reply_to': { event_id: '$r1' } } })
    reply('$r5', { msgtype: 'm.image', body: 'photo.png', url: 'mxc://matrix.test/abc' })
    for (let i = 0; i < 6; i++) reply(`$bulk${i}`, { body: `bulk ${i}` })
  })

  it('404 without a thread', async () => {
    expect((await read(carol)).status).toBe(404)
  })

  it('shows root and replies oldest first, for viewers too, with names, edits and no redacted messages', async () => {
    expect((await bob.req(`/api/cards/${cardId}/matrix-thread`, { method: 'POST', body: { link: '$root3' } })).status).toBe(200)
    const res = await read(carol)
    expect(res.status).toBe(200)
    expect(res.data.more).toBe(false)
    const msgs = res.data.messages
    expect(msgs.map(m => m.id)).toEqual(['$root3', '$r1', '$r2', '$r4', '$r5', '$bulk0', '$bulk1', '$bulk2', '$bulk3', '$bulk4', '$bulk5'])
    expect(msgs[0]).toMatchObject({ senderName: 'Dana', body: 'Printer is down', html: null, fromBot: false, edited: false })
    expect(msgs[1]).toMatchObject({ sender: '@stranger:matrix.test', senderName: '@stranger:matrix.test', html: 'Have you tried <em>turning it off</em>' })
    expect(msgs[2]).toMatchObject({ body: 'fixed text', edited: true })
    expect(msgs[3]).toMatchObject({ body: 'answer', html: 'answer' })
    expect(msgs[4]).toMatchObject({ body: '[photo.png]', html: null })
  })

  it('reports Matrix errors as 400', async () => {
    fake.events.delete('$root3')
    const res = await read(bob)
    expect(res.status).toBe(400)
    expect(res.data.statusMessage).toContain('M_NOT_FOUND')
  })
})
