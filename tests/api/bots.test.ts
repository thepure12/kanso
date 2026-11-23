// HTTP API tests for board bots (server/api/boards/[id]/bots.*, server/api/bots/**):
// owners manage bots and their tokens through cookies only, everyone on the
// board sees the bots, and a bot's token acts as the bot on its board only.
import { randomUUID } from 'node:crypto'
import { url } from '@nuxt/test-utils/e2e'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiToken, Me } from '#shared/types/account'
import type { BoardDetail, Card, Person, TeamDetail } from '#shared/types/board'
import type { AccountBot, BoardBot, BotToken } from '#shared/types/bots'
import type { InstanceSettings } from '#shared/types/admin'
import { signEmailToken } from '../../server/utils/emailToken'
import { setupApi } from './server'

const adminEmail = `admin-${randomUUID()}@bots.test`
await setupApi({ NUXT_ADMIN_EMAIL: adminEmail, NUXT_MAIL_SMTP_URL: '', NUXT_MAIL_LOG_LINKS: 'true' })

let base = ''
beforeAll(() => { base = url('/').replace(/\/$/, '') })
const authDb = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })
const ownerDb = postgres(process.env.MIGRATION_DATABASE_URL!, { onnotice: () => {} })

const randomIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250)).join('.')}`

async function call<T = any>(path: string, init: { method?: string, body?: unknown, cookie?: string, token?: string, ip?: string } = {}) {
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
  return { status: res.status, data: data as T }
}

async function signUp(name: string, email = `${name.toLowerCase()}-${randomUUID()}@bots.test`) {
  const ip = randomIp()
  expect((await call('/api/auth/register', { method: 'POST', body: { name, email, password: 'password123' }, ip })).status).toBe(200)
  const [u] = await authDb`select id from users where email = ${email}`
  const verify = await globalThis.fetch(`${base}/auth/verify?token=${signEmailToken(u!.id, email, process.env.NUXT_SESSION_PASSWORD!)}`, { redirect: 'manual', headers: { 'x-forwarded-for': ip } })
  const cookie = verify.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const req = <T = any>(path: string, init: { method?: string, body?: unknown } = {}) => call<T>(path, { ...init, cookie, ip })
  return { req, email, id: u!.id as string, cookie }
}

/** A request as a token (bot or personal). */
const as = (token: string) => <T = any>(path: string, init: { method?: string, body?: unknown } = {}) => call<T>(path, { ...init, token })

let admin: Awaited<ReturnType<typeof signUp>>
let savedSettings: InstanceSettings
let alice: Awaited<ReturnType<typeof signUp>>
let bob: Awaited<ReturnType<typeof signUp>>
let carol: Awaited<ReturnType<typeof signUp>>
let board: BoardDetail
let other: BoardDetail

beforeAll(async () => {
  admin = await signUp('Admin', adminEmail)
  savedSettings = (await admin.req<InstanceSettings>('/api/admin/settings')).data
  expect((await admin.req('/api/admin/settings', { method: 'PUT', body: { ...savedSettings, signupMode: 'open' } })).status).toBe(200)
  ;[alice, bob, carol] = await Promise.all([signUp('Alice'), signUp('Bob'), signUp('Carol')])
  const [a, b] = await Promise.all([
    alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Bot board', template: 'basic' } }),
    alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Other board', template: 'basic' } }),
  ])
  expect((await alice.req(`/api/boards/${a.data.id}/members`, { method: 'POST', body: { email: bob.email, role: 'editor' } })).status).toBe(200)
  board = (await alice.req<BoardDetail>(`/api/boards/${a.data.id}`)).data
  other = (await alice.req<BoardDetail>(`/api/boards/${b.data.id}`)).data
})

afterAll(async () => {
  if (board) await alice?.req(`/api/boards/${board.id}`, { method: 'DELETE' })
  if (other) await alice?.req(`/api/boards/${other.id}`, { method: 'DELETE' })
  await admin?.req('/api/admin/settings', { method: 'PUT', body: savedSettings })
  await ownerDb`delete from users where bot_owner_id = any(${[alice?.id, bob?.id, carol?.id].filter(Boolean) as string[]})`
  await ownerDb`delete from admin_audit_log where data->>'actor_email' like '%@bots.test' or data->>'target_email' like '%@bots.test'`
  await ownerDb`delete from users where email = ${adminEmail}`
  await Promise.all([authDb.end(), ownerDb.end()])
})

async function newBot(name = 'Agent', role = 'editor') {
  const res = await alice.req<BoardBot>(`/api/boards/${board.id}/bots`, { method: 'POST', body: { name, role } })
  expect(res.status).toBe(200)
  return res.data
}

async function newToken(botId: string, scopes = ['read', 'write'], expiresInDays: number | null = null) {
  const res = await alice.req<BotToken & { token: string }>(`/api/bots/${botId}/tokens`, { method: 'POST', body: { name: 'ci', scopes, expiresInDays } })
  expect(res.status).toBe(200)
  return res.data
}

describe('board bots', () => {
  it('owners add, rename, re-role and delete bots; the board lists them as members', async () => {
    const bot = await newBot('  Agent  ', 'commenter')
    expect(bot).toMatchObject({ name: 'Agent', role: 'commenter', tokens: [] })

    const detail = (await alice.req<BoardDetail>(`/api/boards/${board.id}`)).data
    expect(detail.members.find(m => m.userId === bot.id)).toMatchObject({ isBot: true, role: 'commenter' })
    expect(detail.members.find(m => m.userId === alice.id)).toMatchObject({ isBot: false })
    expect(detail.bots).toEqual([bot])

    const renamed = await alice.req<BoardBot>(`/api/bots/${bot.id}`, { method: 'PATCH', body: { name: 'Builder' } })
    expect(renamed.data).toMatchObject({ id: bot.id, name: 'Builder', role: 'commenter' })
    const promoted = await alice.req<BoardBot>(`/api/bots/${bot.id}`, { method: 'PATCH', body: { role: 'viewer' } })
    expect(promoted.data).toMatchObject({ name: 'Builder', role: 'viewer' })

    expect((await alice.req(`/api/boards/${board.id}/bots`, { method: 'POST', body: { name: 'Boss', role: 'owner' } })).status).toBe(400)
    expect((await alice.req(`/api/boards/${board.id}/bots`, { method: 'POST', body: { name: ' ' } })).status).toBe(400)
    expect((await alice.req(`/api/bots/${bot.id}`, { method: 'PATCH', body: { role: 'owner' } })).status).toBe(400)
    // A bot is not removed as a member; it is deleted.
    expect((await alice.req(`/api/boards/${board.id}/members/${bot.id}`, { method: 'DELETE' })).status).toBe(403)

    expect((await alice.req(`/api/bots/${bot.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await alice.req<BoardBot[]>(`/api/boards/${board.id}/bots`)).data.map(b => b.id)).not.toContain(bot.id)
    expect((await alice.req(`/api/bots/${bot.id}`, { method: 'DELETE' })).status).toBe(404)
    // Not a bot: 404 too.
    expect((await alice.req(`/api/bots/${bob.id}`, { method: 'PATCH', body: { name: 'x' } })).status).toBe(404)
  })

  it('members see bots without tokens; only owners manage them; outsiders get 404', async () => {
    const bot = await newBot('Helper')
    const token = await newToken(bot.id)

    const seen = await bob.req<BoardBot[]>(`/api/boards/${board.id}/bots`)
    expect(seen.status).toBe(200)
    expect(seen.data.find(b => b.id === bot.id)).toMatchObject({ name: 'Helper', tokens: null })
    expect((await bob.req<BoardDetail>(`/api/boards/${board.id}`)).data.bots.find(b => b.id === bot.id)?.tokens).toBeNull()

    expect((await bob.req(`/api/boards/${board.id}/bots`, { method: 'POST', body: { name: 'Mine' } })).status).toBe(403)
    expect((await bob.req(`/api/bots/${bot.id}`, { method: 'PATCH', body: { name: 'Mine' } })).status).toBe(403)
    expect((await bob.req(`/api/bots/${bot.id}`, { method: 'DELETE' })).status).toBe(403)
    expect((await bob.req(`/api/bots/${bot.id}/tokens`, { method: 'POST', body: { name: 'x', scopes: ['read'] } })).status).toBe(403)
    expect((await bob.req(`/api/bots/${bot.id}/tokens/${token.id}`, { method: 'DELETE' })).status).toBe(403)

    expect((await carol.req(`/api/boards/${board.id}/bots`)).status).toBe(404)
    expect((await carol.req(`/api/boards/${board.id}/bots`, { method: 'POST', body: { name: 'Spy' } })).status).toBe(404)
    expect((await carol.req(`/api/bots/${bot.id}`, { method: 'PATCH', body: { name: 'Spy' } })).status).toBe(404)
    expect((await carol.req(`/api/bots/${bot.id}/tokens`, { method: 'POST', body: { name: 'x', scopes: ['read'] } })).status).toBe(404)

    // People suggestions never offer bots.
    const people = await alice.req<{ userId: string }[]>(`/api/people?q=Helper`)
    expect(people.data.map(p => p.userId)).not.toContain(bot.id)
  })

  it('owners upload and remove a bot picture; others cannot', async () => {
    const bot = await newBot('Pictured')
    const png = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex')
    const upload = async (user: typeof alice, data: Buffer, botId = bot.id) => {
      const form = new FormData()
      form.append('file', new Blob([data]), 'avatar')
      const res = await globalThis.fetch(`${base}/api/bots/${botId}/avatar`, { method: 'POST', body: form, headers: { cookie: user.cookie, 'x-forwarded-for': randomIp() } })
      return { status: res.status, data: await res.json() }
    }

    const set = await upload(alice, png)
    expect(set.status).toBe(200)
    expect(set.data.avatarUrl).toMatch(new RegExp(`/api/users/${bot.id}/avatar\\?v=[0-9a-f]+$`))
    const image = await bob.req(set.data.avatarUrl.replace(/^.*(\/api\/users\/)/, '$1'))
    expect(image.status).toBe(200)
    expect((await bob.req<BoardDetail>(`/api/boards/${board.id}`)).data.members.find(m => m.userId === bot.id)?.avatarUrl).toBe(set.data.avatarUrl)

    expect((await upload(alice, Buffer.from('not an image'))).status).toBe(400)
    expect((await upload(bob, png)).status).toBe(403)
    expect((await upload(carol, png)).status).toBe(404)
    expect((await upload(alice, png, bob.id)).status).toBe(404)
    expect((await bob.req(`/api/bots/${bot.id}/avatar`, { method: 'DELETE' })).status).toBe(403)

    const cleared = await alice.req<BoardBot>(`/api/bots/${bot.id}/avatar`, { method: 'DELETE' })
    expect(cleared.status).toBe(200)
    expect(cleared.data.avatarUrl).toBeNull()
    expect((await bob.req(`/api/users/${bot.id}/avatar`)).status).toBe(404)
  })

  it('shows a token once; owners list its metadata and revoke it', async () => {
    const bot = await newBot('Lister')
    const created = await newToken(bot.id, ['read'], 30)
    expect(created.token).toMatch(/^kb_[\w-]{43}$/)
    expect(created).toMatchObject({ name: 'ci', scopes: ['read'], prefix: created.token.slice(0, 10), revokedAt: null, lastUsedAt: null })
    expect(new Date(created.expiresAt!).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000)

    const listed = (await alice.req<BoardBot[]>(`/api/boards/${board.id}/bots`)).data.find(b => b.id === bot.id)!
    expect(listed.tokens).toHaveLength(1)
    expect(listed.tokens![0]).not.toHaveProperty('token')
    expect(listed.tokens![0]!.id).toBe(created.id)

    expect((await as(created.token)(`/api/boards/${board.id}`)).status).toBe(200)
    // A token of another bot, or an unknown one: 404.
    const second = await newBot('Second')
    expect((await alice.req(`/api/bots/${second.id}/tokens/${created.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await alice.req(`/api/bots/${bot.id}/tokens/${randomUUID()}`, { method: 'DELETE' })).status).toBe(404)
    expect((await alice.req(`/api/bots/${bot.id}/tokens/${created.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await alice.req(`/api/bots/${bot.id}/tokens/${created.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await as(created.token)(`/api/boards/${board.id}`)).status).toBe(401)
    const after = (await alice.req<BoardBot[]>(`/api/boards/${board.id}/bots`)).data.find(b => b.id === bot.id)!
    expect(after.tokens![0]!.revokedAt).not.toBeNull()

    expect((await alice.req(`/api/bots/${bot.id}/tokens`, { method: 'POST', body: { name: 'x', scopes: [] } })).status).toBe(400)
    expect((await alice.req(`/api/bots/${bot.id}/tokens`, { method: 'POST', body: { name: 'x', scopes: ['admin'] } })).status).toBe(400)
  })

  it('a bot token acts as the bot on its board only', async () => {
    const bot = await newBot('Worker', 'editor')
    const { token } = await newToken(bot.id)
    const api = as(token)

    const me = await api<Me>('/api/me')
    expect(me.status).toBe(200)
    expect(me.data).toMatchObject({ id: bot.id, name: 'Worker', isBot: true, isAdmin: false })

    const boards = await api<{ id: string }[]>('/api/boards')
    expect(boards.data.map(b => b.id)).toEqual([board.id])
    const view = await api<BoardDetail>(`/api/boards/${board.id}`)
    expect(view.data.role).toBe('editor')
    expect(view.data.bots.every(b => b.tokens === null)).toBe(true)
    expect((await api(`/api/boards/${other.id}`)).status).toBe(404)

    const card = await api<Card>(`/api/boards/${board.id}/cards`, { method: 'POST', body: { columnId: board.columns[0]!.id, title: 'Made by a bot' } })
    expect(card.status).toBe(200)
    expect((await api(`/api/cards/${card.data.id}`, { method: 'PATCH', body: { assigneeIds: [bot.id, alice.id] } })).status).toBe(200)
    expect((await api(`/api/cards/${card.data.id}/comments`, { method: 'POST', body: { body: `Hi @[Alice](user:${alice.id})` } })).status).toBe(200)
    const [created] = await ownerDb`select actor_id from card_activity where card_id = ${card.data.id} and kind = 'created'`
    expect(created!.actor_id).toBe(bot.id)
    expect((await api(`/api/boards/${other.id}/cards`, { method: 'POST', body: { columnId: other.columns[0]!.id, title: 'Nope' } })).status).toBe(403)

    // Bots cannot reach token routes that are cookie only, nor manage bots.
    expect((await api(`/api/boards/${board.id}/bots`)).status).toBe(403)
    expect((await api(`/api/bots/${bot.id}/tokens`, { method: 'POST', body: { name: 'more', scopes: ['read'] } })).status).toBe(403)
    expect((await api('/api/account/tokens')).status).toBe(403)
    // Neither can the owner's own token.
    const personal = (await alice.req<ApiToken & { token: string }>('/api/account/tokens', { method: 'POST', body: { name: 'mine', scopes: ['read', 'write'] } })).data.token
    expect((await as(personal)(`/api/boards/${board.id}/bots`, { method: 'POST', body: { name: 'Sneaky' } })).status).toBe(403)
    expect((await as(personal)(`/api/bots/${bot.id}/tokens`, { method: 'POST', body: { name: 'more', scopes: ['read'] } })).status).toBe(403)
  })

  it('a read-only bot token cannot write, and a viewer bot cannot either', async () => {
    const bot = await newBot('Reader', 'editor')
    const read = as((await newToken(bot.id, ['read'])).token)
    expect((await read(`/api/boards/${board.id}`)).status).toBe(200)
    expect((await read(`/api/boards/${board.id}/cards`, { method: 'POST', body: { columnId: board.columns[0]!.id, title: 'x' } })).status).toBe(403)

    const viewer = await newBot('Viewer', 'viewer')
    const write = as((await newToken(viewer.id)).token)
    expect((await write(`/api/boards/${board.id}/cards`, { method: 'POST', body: { columnId: board.columns[0]!.id, title: 'x' } })).status).toBe(403)
  })

  it('a deleted bot\'s token gets 401', async () => {
    const bot = await newBot('Temp')
    const { token } = await newToken(bot.id)
    expect((await as(token)(`/api/boards/${board.id}`)).status).toBe(200)
    expect((await alice.req(`/api/bots/${bot.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await as(token)(`/api/boards/${board.id}`)).status).toBe(401)
  })
})

// Team bots (0106_team_bots_rls.sql): team owners manage them on the team
// page; their tokens reach every board of the team (later ones too) and
// nothing else.
describe('team bots', () => {
  let teamId: string
  let teamBoard: BoardDetail

  beforeAll(async () => {
    teamId = (await alice.req<{ id: string }>('/api/teams', { method: 'POST', body: { name: 'Bot team' } })).data.id
    expect((await alice.req(`/api/teams/${teamId}/members`, { method: 'POST', body: { email: bob.email, role: 'editor' } })).status).toBe(200)
    const b = await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Team board', template: 'basic', teamId } })
    teamBoard = (await alice.req<BoardDetail>(`/api/boards/${b.data.id}`)).data
  })

  afterAll(async () => {
    if (teamId) await alice?.req(`/api/teams/${teamId}`, { method: 'DELETE' })
  })

  it('team owners add, rename, re-role and delete team bots; members see them without tokens', async () => {
    const res = await alice.req<BoardBot>(`/api/teams/${teamId}/bots`, { method: 'POST', body: { name: 'Team agent', role: 'commenter' } })
    expect(res.status).toBe(200)
    const bot = res.data
    expect(bot).toMatchObject({ name: 'Team agent', role: 'commenter', tokens: [] })

    const team = (await alice.req<TeamDetail>(`/api/teams/${teamId}`)).data
    expect(team.members.find(m => m.userId === bot.id)).toMatchObject({ isBot: true, role: 'commenter' })
    expect(team.bots).toEqual([bot])
    // On the team's boards it is a member through the team; not a board bot.
    const detail = (await alice.req<BoardDetail>(`/api/boards/${teamBoard.id}`)).data
    expect(detail.members.find(m => m.userId === bot.id)).toMatchObject({ isBot: true, role: 'commenter', boardRole: null, teamRole: 'commenter' })
    expect(detail.bots).toEqual([])

    expect((await bob.req<TeamDetail>(`/api/teams/${teamId}`)).data.bots.map(b => b.tokens)).toEqual([null])
    expect((await bob.req(`/api/teams/${teamId}/bots`, { method: 'POST', body: { name: 'Mine' } })).status).toBe(403)
    expect((await bob.req(`/api/bots/${bot.id}`, { method: 'PATCH', body: { name: 'Mine' } })).status).toBe(403)
    expect((await bob.req(`/api/bots/${bot.id}/tokens`, { method: 'POST', body: { name: 'x', scopes: ['read'] } })).status).toBe(403)
    expect((await carol.req(`/api/teams/${teamId}/bots`)).status).toBe(404)
    expect((await carol.req(`/api/bots/${bot.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await alice.req(`/api/teams/${teamId}/bots`, { method: 'POST', body: { name: 'Boss', role: 'owner' } })).status).toBe(400)

    const changed = await alice.req<BoardBot>(`/api/bots/${bot.id}`, { method: 'PATCH', body: { name: 'Renamed', role: 'editor' } })
    expect(changed.data).toMatchObject({ id: bot.id, name: 'Renamed', role: 'editor' })
    // A bot is not removed as a member; it is deleted.
    expect((await alice.req(`/api/teams/${teamId}/members/${bot.id}`, { method: 'DELETE' })).status).toBe(403)
    expect((await alice.req(`/api/bots/${bot.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await alice.req<BoardBot[]>(`/api/teams/${teamId}/bots`)).data).toEqual([])
  })

  it('a team bot token acts on the team boards with the team role, later boards too, and nothing else', async () => {
    const bot = (await alice.req<BoardBot>(`/api/teams/${teamId}/bots`, { method: 'POST', body: { name: 'Team worker' } })).data
    const created = await alice.req<BotToken & { token: string }>(`/api/bots/${bot.id}/tokens`, { method: 'POST', body: { name: 'ci', scopes: ['read', 'write'] } })
    expect(created.status).toBe(200)
    expect((await alice.req<TeamDetail>(`/api/teams/${teamId}`)).data.bots[0]!.tokens!.map(t => t.id)).toEqual([created.data.id])
    const api = as(created.data.token)

    expect((await api<{ id: string }[]>('/api/boards')).data.map(b => b.id)).toEqual([teamBoard.id])
    expect((await api<BoardDetail>(`/api/boards/${teamBoard.id}`)).data.role).toBe('editor')
    expect((await api(`/api/boards/${board.id}`)).status).toBe(404)
    const card = await api<Card>(`/api/boards/${teamBoard.id}/cards`, { method: 'POST', body: { columnId: teamBoard.columns[0]!.id, title: 'By the team bot' } })
    expect(card.status).toBe(200)
    // No new boards or teams, no managing bots.
    expect((await api('/api/boards', { method: 'POST', body: { name: 'Nope', template: 'basic', teamId } })).status).toBe(403)
    expect((await api('/api/teams', { method: 'POST', body: { name: 'Nope' } })).status).toBe(403)
    expect((await api(`/api/teams/${teamId}/bots`)).status).toBe(403)

    const later = await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Later', template: 'basic', teamId } })
    expect((await api<BoardDetail>(`/api/boards/${later.data.id}`)).status).toBe(200)

    expect((await alice.req(`/api/bots/${bot.id}/tokens/${created.data.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await api(`/api/boards/${teamBoard.id}`)).status).toBe(401)
  })
})

describe('account bots', () => {
  it('people make, rename and delete their own bots; others cannot touch them', async () => {
    const made = await carol.req<AccountBot>('/api/account/bots', { method: 'POST', body: { name: 'Helper' } })
    expect(made.status).toBe(200)
    expect(made.data).toMatchObject({ name: 'Helper', boards: [], tokens: [] })
    const id = made.data.id
    expect((await carol.req<AccountBot[]>('/api/account/bots')).data.map(b => b.id)).toEqual([id])
    expect((await bob.req<AccountBot[]>('/api/account/bots')).data).toEqual([])

    expect((await carol.req<AccountBot>(`/api/bots/${id}`, { method: 'PATCH', body: { name: 'Renamed' } })).data.name).toBe('Renamed')
    // The role is per board.
    expect((await carol.req(`/api/bots/${id}`, { method: 'PATCH', body: { role: 'viewer' } })).status).toBe(400)
    // Others do not even see it.
    expect((await bob.req(`/api/bots/${id}`, { method: 'PATCH', body: { name: 'Mine' } })).status).toBe(404)
    expect((await bob.req(`/api/bots/${id}`, { method: 'DELETE' })).status).toBe(404)

    expect((await carol.req(`/api/bots/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await carol.req<AccountBot[]>('/api/account/bots')).data).toEqual([])
  })

  it('the owner adds the bot to boards they own; board owners change its role and remove it', async () => {
    const bot = (await alice.req<AccountBot>('/api/account/bots', { method: 'POST', body: { name: 'Roamer' } })).data
    // The people suggestions offer one's own bots (not others').
    expect((await alice.req<Person[]>('/api/people?q=Roamer')).data).toEqual([expect.objectContaining({ userId: bot.id, isBot: true })])
    expect((await bob.req<Person[]>('/api/people?q=Roamer')).data).toEqual([])

    // Through the account page, or through the members form with the bot's address.
    const put = await alice.req<AccountBot>(`/api/account/bots/${bot.id}/boards/${board.id}`, { method: 'PUT', body: { role: 'commenter' } })
    expect(put.status).toBe(200)
    expect(put.data.boards).toEqual([{ id: board.id, name: board.name, role: 'commenter', owner: true }])
    const [{ email }] = await ownerDb`select email from users where id = ${bot.id}`
    expect((await alice.req(`/api/boards/${other.id}/members`, { method: 'POST', body: { email, role: 'owner' } })).status).toBe(403)
    expect((await alice.req(`/api/boards/${other.id}/members`, { method: 'POST', body: { email, role: 'viewer' } })).status).toBe(200)

    const detail = (await alice.req<BoardDetail>(`/api/boards/${board.id}`)).data
    expect(detail.members.find(m => m.userId === bot.id)).toMatchObject({ isBot: true, accountBot: true, role: 'commenter' })
    expect(detail.bots.map(b => b.id)).not.toContain(bot.id)

    // Bob's board: Alice is no owner there, so the bot cannot join.
    const bobs = (await bob.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Bob board', template: 'basic' } })).data
    expect((await alice.req(`/api/account/bots/${bot.id}/boards/${bobs.id}`, { method: 'PUT', body: { role: 'editor' } })).status).toBe(403)
    // Bob owns a board with Alice's bot on it but does not manage the bot.
    expect((await bob.req(`/api/account/bots/${bot.id}/boards/${board.id}`, { method: 'PUT', body: { role: 'editor' } })).status).toBe(403)
    await bob.req(`/api/boards/${bobs.id}`, { method: 'DELETE' })

    // Board owners re-role (never owner) and remove it like a member.
    expect((await alice.req(`/api/boards/${board.id}/members/${bot.id}`, { method: 'PATCH', body: { role: 'owner' } })).status).toBe(403)
    expect((await alice.req(`/api/boards/${board.id}/members/${bot.id}`, { method: 'PATCH', body: { role: 'viewer' } })).status).toBe(200)
    expect((await alice.req(`/api/boards/${other.id}/members/${bot.id}`, { method: 'DELETE' })).status).toBe(200)

    // The owner takes it off a board from the account page.
    const left = await alice.req<AccountBot>(`/api/account/bots/${bot.id}/boards/${board.id}`, { method: 'DELETE' })
    expect(left.data.boards).toEqual([])
    await alice.req(`/api/bots/${bot.id}`, { method: 'DELETE' })
  })

  it('an account bot token follows the bot\'s boards and cannot make boards or bots', async () => {
    const bot = (await alice.req<AccountBot>('/api/account/bots', { method: 'POST', body: { name: 'Worker' } })).data
    const created = await alice.req<BotToken & { token: string }>(`/api/bots/${bot.id}/tokens`, { method: 'POST', body: { name: 'ci', scopes: ['read', 'write'], expiresInDays: null } })
    expect(created.status).toBe(200)
    expect((await alice.req<AccountBot[]>('/api/account/bots')).data[0]!.tokens.map(t => t.id)).toEqual([created.data.id])
    const api = as(created.data.token)

    expect((await api<unknown[]>('/api/boards')).data).toEqual([])
    expect((await api(`/api/boards/${board.id}`)).status).toBe(404)
    await alice.req(`/api/account/bots/${bot.id}/boards/${board.id}`, { method: 'PUT', body: { role: 'editor' } })
    expect((await api<BoardDetail>(`/api/boards/${board.id}`)).data.role).toBe('editor')
    expect((await api(`/api/boards/${board.id}/cards`, { method: 'POST', body: { columnId: board.columns[0]!.id, title: 'By the account bot' } })).status).toBe(200)
    expect((await api(`/api/boards/${other.id}`)).status).toBe(404)

    expect((await api('/api/boards', { method: 'POST', body: { name: 'Nope', template: 'basic' } })).status).toBe(403)
    expect((await api('/api/teams', { method: 'POST', body: { name: 'Nope' } })).status).toBe(403)
    expect((await api('/api/account/bots', { method: 'POST', body: { name: 'Child' } })).status).toBe(403)

    expect((await alice.req(`/api/bots/${bot.id}/tokens/${created.data.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await api(`/api/boards/${board.id}`)).status).toBe(401)
    await alice.req(`/api/bots/${bot.id}`, { method: 'DELETE' })
  })
})
