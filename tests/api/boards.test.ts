// HTTP API tests: builds the app, starts it, and talks to it as two signed-in
// users. Needs the migrated database, like the db tests.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setup, url } from '@nuxt/test-utils/e2e'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Attachment, BoardActivityPage, BoardAutomation, BoardDetail, BoardField, BoardSummary, Card, CardDetail, CardLink, CardRecurrence, Column, ColumnGroup, ColumnRule, Comment, Person, TeamDetail, TimeEntry, TrashedCard } from '#shared/types/board'
import type { Inbox } from '#shared/types/notifications'
import type { AdminUser, AuditLogPage, InstanceSettings } from '#shared/types/admin'
import type { Account, AccountSession } from '#shared/types/account'
import type { SearchResults } from '#shared/types/search'
import type { MyWork } from '#shared/types/myWork'
import { signEmailToken } from '../../server/utils/emailToken'
import { base32Decode, totpCode, totpStep } from '../../server/utils/totp'

// A fresh admin opens sign-up for the run (settings restored afterwards);
// confirmation links go to the log instead of SMTP.
const adminEmail = `admin-${randomUUID()}@api.test`
await setup({ server: true, browser: false, env: { NUXT_ADMIN_EMAIL: adminEmail, NUXT_MAIL_SMTP_URL: '', NUXT_MAIL_LOG_LINKS: 'true' } })

// test-utils sets its context per test only, so nested beforeAll hooks cannot use
// its fetch(); capture the server URL once and use the global fetch.
let base = ''
beforeAll(() => { base = url('/').replace(/\/$/, '') })
const fetch = (path: string, init?: RequestInit) => globalThis.fetch(base + path, init)
// Looks up user ids to mint confirmation tokens, as the kanban_auth role.
const authDb = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })
// Removes the run's admin afterwards, so it does not linger in the dev database.
const ownerDb = postgres(process.env.MIGRATION_DATABASE_URL!, { onnotice: () => {} })

interface Res<T> { status: number, data: T, headers: Headers }

/**
 * Cookie jar update: Set-Cookie values replace cookies of the same name and
 * keep the rest (page responses also set the i18n locale cookie).
 */
function mergeCookies(jar: string, set: string[]): string {
  const cookies = new Map(jar ? jar.split('; ').map(c => [c.slice(0, c.indexOf('=')), c] as const) : [])
  for (const c of set) {
    const pair = c.split(';')[0]!
    const name = pair.slice(0, pair.indexOf('='))
    if (pair.endsWith('=')) cookies.delete(name)
    else cookies.set(name, pair)
  }
  return [...cookies.values()].join('; ')
}

/** A signed-in user. Each gets its own forwarded IP so the login rate limit does not trip. */
async function signUp(name: string, email = `${name.toLowerCase()}-${randomUUID()}@api.test`) {
  const ip = `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250)).join('.')}`
  const clientId = `${name}-tab`
  let cookie = ''

  async function req<T = unknown>(path: string, init: { method?: string, body?: unknown, redirect?: RequestRedirect } = {}): Promise<Res<T>> {
    const isForm = init.body instanceof FormData
    const res = await fetch(path, {
      method: init.method ?? 'GET',
      redirect: init.redirect,
      headers: {
        'cookie': cookie,
        'x-forwarded-for': ip,
        'x-client-id': clientId,
        ...(init.body !== undefined && !isForm && { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : isForm ? init.body as FormData : JSON.stringify(init.body),
    })
    cookie = mergeCookies(cookie, res.headers.getSetCookie())
    const type = res.headers.get('content-type') ?? ''
    const data = type.includes('json') ? await res.json() : type.startsWith('text') ? await res.text() : Buffer.from(await res.arrayBuffer())
    return { status: res.status, data: data as T, headers: res.headers }
  }

  const reg = await req('/api/auth/register', { method: 'POST', body: { name, email, password: 'password123' } })
  expect(reg.status).toBe(200)
  expect(cookie).toBe('')
  // Open the confirmation link the server would have mailed.
  const verify = await req(`/auth/verify?token=${await tokenFor(email)}`, { redirect: 'manual' })
  expect(verify.headers.get('location')).toBe('/')
  return { req, email, clientId, cookie: () => cookie }
}

async function tokenFor(email: string) {
  const [u] = await authDb`select id from users where email = ${email}`
  return signEmailToken(u!.id, email, process.env.NUXT_SESSION_PASSWORD!)
}

/** The link the server would mail for a password reset or an email change (to `email`). */
async function linkToken(purpose: 'password-reset' | 'email-change', current: string, email = current) {
  const [u] = await authDb`select id, session_version from users where email = ${current}`
  return encodeURIComponent(signEmailToken(u!.id, email, process.env.NUXT_SESSION_PASSWORD!, 60_000, purpose, u!.session_version))
}

/** A plain HTTP client with its own forwarded IP and cookie jar, for auth flows. */
function anon() {
  const ip = `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250)).join('.')}`
  let cookie = ''
  return async <T = any>(path: string, body?: unknown) => {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'manual',
      headers: { 'cookie': cookie, 'x-forwarded-for': ip, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    cookie = mergeCookies(cookie, res.headers.getSetCookie())
    const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() as T : undefined
    return { status: res.status, location: res.headers.get('location'), cookie: () => cookie, data }
  }
}

/**
 * The TOTP code `offset` steps from now. Waits out the last second of a step,
 * so the server sees the same step. Each code works once per account, so
 * tests use increasing offsets (the server accepts -1..+1).
 */
async function totp(secret: string, offset = 0) {
  if (Date.now() % 30_000 > 28_500) await new Promise(r => setTimeout(r, 1_600))
  return totpCode(base32Decode(secret), totpStep() + offset)
}

/** Collects server-sent event names from an event stream. */
async function listen(path: string, cookie: string) {
  const events: string[] = []
  const ctl = new AbortController()
  const res = await fetch(path, { headers: { cookie }, signal: ctl.signal })
  expect(res.status).toBe(200)
  ;(async () => {
    const dec = new TextDecoder()
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        for (const m of dec.decode(chunk).matchAll(/event: (\w+)/g)) events.push(m[1]!)
      }
    }
    catch { /* aborted */ }
  })()
  return { events, stop: () => ctl.abort() }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

let admin: Awaited<ReturnType<typeof signUp>>
let savedSettings: InstanceSettings
let alice: Awaited<ReturnType<typeof signUp>>
let bob: Awaited<ReturnType<typeof signUp>>
let outsider: Awaited<ReturnType<typeof signUp>>
let boardId: string
let board: BoardDetail
const extraBoards: string[] = []

beforeAll(async () => {
  // The admin email passes the sign-up gate whatever the settings say.
  admin = await signUp('Admin', adminEmail)
  savedSettings = (await admin.req<InstanceSettings>('/api/admin/settings')).data
  expect((await admin.req('/api/admin/settings', { method: 'PUT', body: { ...savedSettings, signupMode: 'open' } })).status).toBe(200)
  ;[alice, bob, outsider] = await Promise.all([signUp('Alice'), signUp('Bob'), signUp('Eve')])
  const created = await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'API test', template: 'scrum' } })
  boardId = created.data.id
  expect((await alice.req(`/api/boards/${boardId}/members`, { method: 'POST', body: { email: bob.email, role: 'editor' } })).status).toBe(200)
  board = (await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data
})

afterAll(async () => {
  await alice?.req(`/api/boards/${boardId}`, { method: 'DELETE' })
  for (const id of extraBoards) await alice?.req(`/api/boards/${id}`, { method: 'DELETE' })
  await admin?.req('/api/admin/settings', { method: 'PUT', body: savedSettings })
  await ownerDb`delete from admin_audit_log where data->>'actor_email' like '%@api.test' or data->>'target_email' like '%@api.test'`
  await ownerDb`delete from users where email = ${adminEmail}`
  await Promise.all([authDb.end(), ownerDb.end()])
})

const col = (title: string) => board.columns.find(c => c.title === title)!
const userId = (name: string) => board.members.find(m => m.name === name)!.userId
const newCard = async (title: string, column = 'Backlog') =>
  (await alice.req<Card>(`/api/boards/${boardId}/cards`, { method: 'POST', body: { columnId: col(column).id, title } })).data

describe('boards', () => {
  it('creates a board from a template', () => {
    expect(board.columns.map(c => c.title)).toEqual(['Backlog', 'Sprint', 'In progress', 'Review', 'Done'])
    expect(col('In progress').wipLimit).toBe(5)
    expect(board.tags.map(t => t.name)).toEqual(['bug', 'chore', 'story'])
  })

  it('rejects an unknown template and hides boards from outsiders', async () => {
    expect((await alice.req('/api/boards', { method: 'POST', body: { name: 'x', template: 'nope' } })).status).toBe(400)
    expect((await outsider.req(`/api/boards/${boardId}`)).status).toBe(404)
  })

  it('invites unknown emails; they join on sign-up; owners revoke', async () => {
    const email = `invitee-${randomUUID()}@api.test`
    const add = await alice.req(`/api/boards/${boardId}/members`, { method: 'POST', body: { email, role: 'viewer' } })
    expect(add.data).toEqual({ invited: true, email, role: 'viewer' })
    const invites = (await bob.req<BoardDetail>(`/api/boards/${boardId}`)).data.invites
    expect(invites.map(i => [i.email, i.role])).toEqual([[email, 'viewer']])
    expect((await bob.req(`/api/boards/${boardId}/invites/${invites[0]!.id}`, { method: 'DELETE' })).status).toBe(404)

    const invitee = await signUp('Invitee', email)
    const seen = await invitee.req<BoardDetail>(`/api/boards/${boardId}`)
    expect(seen.data.role).toBe('viewer')
    expect(seen.data.invites).toEqual([])

    const other = `revoked-${randomUUID()}@api.test`
    await alice.req(`/api/boards/${boardId}/members`, { method: 'POST', body: { email: other, role: 'editor' } })
    const [inv] = (await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data.invites
    expect((await alice.req(`/api/boards/${boardId}/invites/${inv!.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data.invites).toEqual([])
  })

  it('signs up through an invite link without a confirmation mail', async () => {
    const email = `linked-${randomUUID()}@api.test`
    await alice.req(`/api/boards/${boardId}/members`, { method: 'POST', body: { email, role: 'editor' } })
    const secret = process.env.NUXT_SESSION_PASSWORD!
    const invite = signEmailToken('', email, secret, 60_000, 'invite')

    // A token for another address, another purpose or a forged one falls back to the confirmation mail.
    for (const bad of [signEmailToken('', `other-${email}`, secret, 60_000, 'invite'), signEmailToken('', email, secret), 'nope']) {
      const http = anon()
      const res = await http('/api/auth/register', { name: 'L', email, password: 'password123', invite: bad })
      expect(res.data).toEqual({ verificationSent: true })
      expect((await http('/api/boards')).status).toBe(401)
    }

    const http = anon()
    const res = await http('/api/auth/register', { name: 'Linked', email, password: 'password123', invite })
    expect(res.data).toEqual({ signedIn: true, twoFactor: false })
    expect((await http(`/api/boards/${boardId}`)).status).toBe(200)
    expect((await anon()('/api/auth/login', { email, password: 'password123' })).status).toBe(200)
    // The account is verified now, so the link cannot be used again.
    expect((await anon()('/api/auth/register', { name: 'X', email, password: 'password456', invite })).status).toBe(409)
  })

  it('sets and validates a WIP limit', async () => {
    const id = col('Sprint').id
    expect((await alice.req(`/api/columns/${id}`, { method: 'PATCH', body: { wipLimit: 2 } })).data).toMatchObject({ wipLimit: 2 })
    expect((await alice.req(`/api/columns/${id}`, { method: 'PATCH', body: { wipLimit: 1000 } })).status).toBe(400)
    expect((await alice.req(`/api/columns/${id}`, { method: 'PATCH', body: { wipLimit: null } })).data).toMatchObject({ wipLimit: null })
  })

  it('reorders a column\'s cards in one go', async () => {
    const column = (await alice.req<Column>(`/api/boards/${boardId}/columns`, { method: 'POST', body: { title: 'Sorted' } })).data
    const add = async (title: string) =>
      (await alice.req<Card>(`/api/boards/${boardId}/cards`, { method: 'POST', body: { columnId: column.id, title } })).data.id
    const [a, b, c] = [await add('a'), await add('b'), await add('c')]
    const order = async () => (await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data.cards
      .filter(card => card.columnId === column.id).map(card => card.id)
    const put = (who: typeof alice, cardIds: string[]) => who.req(`/api/columns/${column.id}/order`, { method: 'PUT', body: { cardIds } })

    expect((await put(alice, [c, a, b])).status).toBe(200)
    expect(await order()).toEqual([c, a, b])
    // Every shown card exactly once, else the client is stale.
    expect((await put(alice, [c, a])).status).toBe(409)
    expect((await put(alice, [c, a, a])).status).toBe(409)
    expect((await put(alice, [c, a, b, (await newCard('elsewhere')).id])).status).toBe(409)
    expect((await put(outsider, [a, b, c])).status).toBe(404)
    // Archived cards are not part of the order.
    await alice.req(`/api/cards/${b}`, { method: 'PATCH', body: { archived: true } })
    expect((await put(alice, [a, c])).status).toBe(200)
    expect(await order()).toEqual([a, c])
    await alice.req(`/api/columns/${column.id}`, { method: 'DELETE' })
  })
})

describe('cards', () => {
  it('updates due date, priority, tags and several assignees', async () => {
    const card = await newCard('Fields')
    const tag = board.tags[0]!.id
    const { data } = await alice.req<Card>(`/api/cards/${card.id}`, {
      method: 'PATCH',
      body: { dueDate: '2026-12-24', priority: 'urgent', tagIds: [tag], assigneeIds: [userId('Alice'), userId('Bob')] },
    })
    expect(data).toMatchObject({ dueDate: '2026-12-24', priority: 'urgent', tagIds: [tag] })
    expect([...data.assigneeIds].sort()).toEqual([userId('Alice'), userId('Bob')].sort())
    expect((await alice.req(`/api/cards/${card.id}`, { method: 'PATCH', body: { dueDate: '24.12.2026' } })).status).toBe(400)
    expect((await alice.req(`/api/cards/${card.id}`, { method: 'PATCH', body: { priority: 'meh' } })).status).toBe(400)
  })

  it('accepts titles up to 1000 characters and names the problem past that', async () => {
    const card = await newCard('Long')
    const ok = await alice.req<Card>(`/api/cards/${card.id}`, { method: 'PATCH', body: { title: 'x'.repeat(1000) } })
    expect(ok.data.title).toHaveLength(1000)
    const tooLong = await alice.req<{ statusMessage: string, data: { issues: { code: string, path: string[], maximum: number }[] } }>(
      `/api/cards/${card.id}`, { method: 'PATCH', body: { title: 'x'.repeat(1001) } })
    expect(tooLong.status).toBe(400)
    expect(tooLong.data.statusMessage).toMatch(/^title: .*1000/)
    expect(tooLong.data.data.issues[0]).toMatchObject({ code: 'too_big', path: ['title'], maximum: 1000 })
  })

  it('cannot assign someone without access', async () => {
    const card = await newCard('No outsiders')
    const eve = (await outsider.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Eve board' } })).data
    const eveId = (await outsider.req<BoardDetail>(`/api/boards/${eve.id}`)).data.members[0]!.userId
    expect((await alice.req(`/api/cards/${card.id}`, { method: 'PATCH', body: { assigneeIds: [eveId] } })).status).toBe(403)
    await outsider.req(`/api/boards/${eve.id}`, { method: 'DELETE' })
  })

  it('archives and restores', async () => {
    const card = await newCard('Archive me')
    await alice.req(`/api/cards/${card.id}`, { method: 'PATCH', body: { archived: true } })
    const after = (await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data
    expect(after.cards.some(c => c.id === card.id)).toBe(false)
    const archived = (await bob.req<{ id: string }[]>(`/api/boards/${boardId}/archived`)).data
    expect(archived.map(a => a.id)).toContain(card.id)
    await alice.req(`/api/cards/${card.id}`, { method: 'PATCH', body: { archived: false } })
    expect((await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data.cards.some(c => c.id === card.id)).toBe(true)
  })

  it('deletes to the trash, restores, and deletes for good', async () => {
    const [card, other] = [await newCard('Trash me'), await newCard('Purge me')]
    const onBoard = async (id: string) => (await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data.cards.some(c => c.id === id)
    expect((await outsider.req(`/api/cards/${card.id}`, { method: 'DELETE' })).status).toBe(404)
    for (const c of [card, other]) expect((await alice.req(`/api/cards/${c.id}`, { method: 'DELETE' })).status).toBe(200)
    expect(await onBoard(card.id)).toBe(false)
    expect((await alice.req(`/api/cards/${card.id}`)).status).toBe(404)
    expect((await alice.req(`/api/cards/${card.id}`, { method: 'DELETE' })).status).toBe(404)

    const trash = await alice.req<TrashedCard[]>(`/api/boards/${boardId}/trash`)
    expect(trash.data.find(c => c.id === card.id)).toMatchObject({ title: 'Trash me', isTemplate: false, deletedBy: 'Alice' })
    expect((await outsider.req(`/api/boards/${boardId}/trash`)).status).toBe(404)

    expect((await alice.req(`/api/cards/${card.id}/restore`, { method: 'POST' })).status).toBe(200)
    expect(await onBoard(card.id)).toBe(true)
    expect((await alice.req(`/api/cards/${card.id}/restore`, { method: 'POST' })).status).toBe(404)

    expect((await alice.req(`/api/boards/${boardId}/trash/${card.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await alice.req(`/api/boards/${boardId}/trash/${other.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await alice.req<TrashedCard[]>(`/api/boards/${boardId}/trash`)).data.some(c => c.id === other.id)).toBe(false)
    await alice.req(`/api/cards/${card.id}`, { method: 'DELETE' })
    expect((await alice.req<{ deleted: number }>(`/api/boards/${boardId}/trash`, { method: 'DELETE' })).data.deleted).toBeGreaterThanOrEqual(1)
    expect((await alice.req<TrashedCard[]>(`/api/boards/${boardId}/trash`)).data).toEqual([])
  })
})

describe('bulk card actions', () => {
  let bulkBoard: BoardDetail
  const bulk = (who: typeof alice, body: object) =>
    who.req<{ cards: Card[] }>(`/api/boards/${bulkBoard.id}/cards/bulk`, { method: 'POST', body })
  const add = async (title: string, column = 0) =>
    (await alice.req<Card>(`/api/boards/${bulkBoard.id}/cards`, { method: 'POST', body: { columnId: bulkBoard.columns[column]!.id, title } })).data

  beforeAll(async () => {
    const id = (await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Bulk' } })).data.id
    extraBoards.push(id)
    await alice.req(`/api/boards/${id}/members`, { method: 'POST', body: { email: bob.email, role: 'editor' } })
    await alice.req(`/api/boards/${id}/members`, { method: 'POST', body: { email: outsider.email, role: 'viewer' } })
    await alice.req(`/api/boards/${id}/tags`, { method: 'POST', body: { name: 'one', color: '#ff0000' } })
    await alice.req(`/api/boards/${id}/tags`, { method: 'POST', body: { name: 'two', color: '#00ff00' } })
    bulkBoard = (await alice.req<BoardDetail>(`/api/boards/${id}`)).data
  })

  // Eve is a viewer here; later tests expect her to share no board with Alice or Bob.
  afterAll(async () => {
    await alice.req(`/api/boards/${bulkBoard.id}`, { method: 'DELETE' })
  })

  it('moves cards to the end of a column in board order', async () => {
    const [a, b, c] = [await add('A'), await add('B'), await add('C', 1)]
    const target = bulkBoard.columns.at(-1)!.id
    const { status, data } = await bulk(bob, { cardIds: [c.id, b.id, a.id], columnId: target })
    expect(status).toBe(200)
    expect(data.cards.every(card => card.columnId === target)).toBe(true)
    const after = (await alice.req<BoardDetail>(`/api/boards/${bulkBoard.id}`)).data
    expect(after.cards.filter(card => card.columnId === target).map(card => card.title)).toEqual(['A', 'B', 'C'])
  })

  it('adds and removes tags and assignees, sets priority and due date', async () => {
    const [one, two] = ['one', 'two'].map(name => bulkBoard.tags.find(t => t.name === name))
    const bobId = bulkBoard.members.find(m => m.name === 'Bob')!.userId
    const x = await add('X')
    const y = await add('Y')
    await alice.req(`/api/cards/${y.id}`, { method: 'PATCH', body: { tagIds: [two!.id] } })
    const { data } = await bulk(alice, {
      cardIds: [x.id, y.id], addTagIds: [one!.id], removeTagIds: [two!.id], addAssigneeIds: [bobId], priority: 'high', dueDate: '2026-11-30',
    })
    expect(data.cards.map(card => [card.tagIds, card.assigneeIds, card.priority, card.dueDate])).toEqual([
      [[one!.id], [bobId], 'high', '2026-11-30'],
      [[one!.id], [bobId], 'high', '2026-11-30'],
    ])
    const cleared = await bulk(alice, { cardIds: [x.id, y.id], removeAssigneeIds: [bobId], priority: null, dueDate: null })
    expect(cleared.data.cards.map(card => [card.assigneeIds, card.priority, card.dueDate])).toEqual([[[], null, null], [[], null, null]])
  })

  it('archives and restores together', async () => {
    const [p, q] = [await add('P'), await add('Q')]
    expect((await bulk(alice, { cardIds: [p.id, q.id], archived: true })).data.cards).toEqual([])
    const archived = (await alice.req<{ id: string }[]>(`/api/boards/${bulkBoard.id}/archived`)).data.map(a => a.id)
    expect(archived).toEqual(expect.arrayContaining([p.id, q.id]))
    expect((await bulk(alice, { cardIds: [p.id, q.id], archived: false })).data.cards.map(card => card.id).sort()).toEqual([p.id, q.id].sort())
  })

  it('changes all cards or none', async () => {
    const card = await add('Mine')
    const foreign = await newCard('Other board')
    expect((await bulk(alice, { cardIds: [card.id, foreign.id], priority: 'low' })).status).toBe(404)
    expect((await bulk(outsider, { cardIds: [card.id], priority: 'low' })).status).toBe(404)
    expect((await bulk(alice, { cardIds: [card.id] })).status).toBe(400)
    expect((await bulk(alice, { cardIds: [card.id], addTagIds: [] })).status).toBe(400)
    // A tag from another board fails the whole request.
    expect((await bulk(alice, { cardIds: [card.id], priority: 'low', addTagIds: [board.tags[0]!.id] })).status).toBe(400)
    expect((await alice.req<BoardDetail>(`/api/boards/${bulkBoard.id}`)).data.cards.find(c => c.id === card.id)!.priority).toBeNull()
  })
})

describe('column rules', () => {
  it('assign_to (several), set_due and remove_tag run on move', async () => {
    const review = col('Review').id
    const story = board.tags.find(t => t.name === 'story')!.id
    for (const body of [
      { kind: 'assign_to', userId: userId('Bob') },
      { kind: 'assign_to', userId: userId('Alice') },
      { kind: 'set_due', dueDays: 0 },
      { kind: 'remove_tag', tagId: story },
    ]) {
      const { status, data } = await alice.req<ColumnRule>(`/api/columns/${review}/rules`, { method: 'POST', body })
      expect(status).toBe(200)
      expect(data.kind).toBe(body.kind)
    }
    expect((await alice.req(`/api/columns/${review}/rules`, { method: 'POST', body: { kind: 'set_due', dueDays: 9 } })).status).toBe(409)
    expect((await alice.req(`/api/columns/${review}/rules`, { method: 'POST', body: { kind: 'set_due', dueDays: -1 } })).status).toBe(400)

    const card = await newCard('Rules')
    await alice.req(`/api/cards/${card.id}`, { method: 'PATCH', body: { tagIds: [story] } })
    const { data: moved } = await alice.req<Card>(`/api/cards/${card.id}/move`, { method: 'POST', body: { columnId: review, aboveId: null, belowId: null } })
    expect(moved.tagIds).toEqual([])
    expect(moved.assigneeIds).toHaveLength(2)
    expect(moved.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('a new tag or assignee rule applies to cards already in the column, set_due does not', async () => {
    const { data: column } = await alice.req<{ id: string }>(`/api/boards/${board.id}/columns`, { method: 'POST', body: { title: 'Existing rules' } })
    const story = board.tags.find(t => t.name === 'story')!.id
    const bug = board.tags.find(t => t.name !== 'story')!.id
    const card = await newCard('Already here')
    await alice.req(`/api/cards/${card.id}`, { method: 'PATCH', body: { tagIds: [story] } })
    await alice.req(`/api/cards/${card.id}/move`, { method: 'POST', body: { columnId: column.id, aboveId: null, belowId: null } })

    for (const body of [
      { kind: 'apply_tag', tagId: bug },
      { kind: 'remove_tag', tagId: story },
      { kind: 'assign_to', userId: userId('Bob') },
      { kind: 'set_due', dueDays: 3 },
    ]) expect((await alice.req(`/api/columns/${column.id}/rules`, { method: 'POST', body })).status).toBe(200)

    const { data } = await alice.req<BoardDetail>(`/api/boards/${board.id}`)
    const after = data.cards.find(c => c.id === card.id)!
    expect(after.tagIds).toEqual([bug])
    expect(after.assigneeIds).toEqual([userId('Bob')])
    expect(after.dueDate).toBeNull()
  })

  it('applyToExisting: false leaves the cards already in the column alone', async () => {
    const { data: column } = await alice.req<{ id: string }>(`/api/boards/${board.id}/columns`, { method: 'POST', body: { title: 'Only new' } })
    const story = board.tags.find(t => t.name === 'story')!.id
    const card = await newCard('Left alone')
    await alice.req(`/api/cards/${card.id}/move`, { method: 'POST', body: { columnId: column.id, aboveId: null, belowId: null } })

    for (const body of [
      { kind: 'apply_tag', tagId: story, applyToExisting: false },
      { kind: 'assign_to', userId: userId('Bob'), applyToExisting: false },
    ]) {
      const { status, data } = await alice.req<ColumnRule>(`/api/columns/${column.id}/rules`, { method: 'POST', body })
      expect(status).toBe(200)
      expect(data).not.toHaveProperty('applyToExisting')
    }
    expect((await alice.req(`/api/columns/${column.id}/rules`, { method: 'POST', body: { kind: 'set_due', dueDays: 1, applyToExisting: 'no' } })).status).toBe(400)

    const { data } = await alice.req<BoardDetail>(`/api/boards/${board.id}`)
    const after = data.cards.find(c => c.id === card.id)!
    expect(after.tagIds).toEqual([])
    expect(after.assigneeIds).toEqual([])

    // The rules still run for cards moved in later.
    const later = await newCard('Moved in later')
    const { data: moved } = await alice.req<Card>(`/api/cards/${later.id}/move`, { method: 'POST', body: { columnId: column.id, aboveId: null, belowId: null } })
    expect(moved.tagIds).toEqual([story])
    expect(moved.assigneeIds).toEqual([userId('Bob')])
  })
})

describe('board automations', () => {
  it('editors add, pause and delete them; the board lists them; outsiders get 403/404', async () => {
    const story = board.tags.find(t => t.name === 'story')!.id
    const post = (who: typeof alice, body: unknown) => who.req<BoardAutomation>(`/api/boards/${board.id}/automations`, { method: 'POST', body })
    const { status, data: tagStale } = await post(bob, { kind: 'tag_stale', days: 14, tagId: story })
    expect(status).toBe(200)
    expect(tagStale).toMatchObject({ kind: 'tag_stale', days: 14, tagId: story, active: true, lastRunAt: null })
    expect((await post(alice, { kind: 'tag_stale', days: 3, tagId: story })).status).toBe(409)
    expect((await post(alice, { kind: 'archive_done', days: 0 })).status).toBe(400)
    expect((await post(alice, { kind: 'raise_priority', days: 2 })).status).toBe(400)
    expect((await post(outsider, { kind: 'archive_done', days: 7 })).status).toBe(403)
    const { data: raise } = await post(alice, { kind: 'raise_priority', days: 0, priority: 'urgent' })
    expect(raise).toMatchObject({ kind: 'raise_priority', days: 0, priority: 'urgent' })

    const paused = await bob.req<BoardAutomation>(`/api/automations/${tagStale.id}`, { method: 'PATCH', body: { active: false } })
    expect(paused.data.active).toBe(false)
    // days 0 only fits raise_priority (check constraint).
    expect((await bob.req(`/api/automations/${tagStale.id}`, { method: 'PATCH', body: { days: 0 } })).status).toBe(400)
    expect((await outsider.req(`/api/automations/${tagStale.id}`, { method: 'PATCH', body: { active: true } })).status).toBe(404)

    const { data } = await alice.req<BoardDetail>(`/api/boards/${board.id}`)
    expect(data.automations.map(a => a.id)).toEqual([tagStale.id, raise.id])
    for (const a of [tagStale, raise]) expect((await alice.req(`/api/automations/${a.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await alice.req(`/api/automations/${raise.id}`, { method: 'DELETE' })).status).toBe(404)
  })
})

describe('card details', () => {
  let cardId: string
  beforeAll(async () => { cardId = (await newCard('Details')).id })

  it('checklist: add, tick, reorder, delete', async () => {
    const add = (text: string) => alice.req<{ id: string }>(`/api/cards/${cardId}/checklist`, { method: 'POST', body: { text } })
    const a = (await add('one')).data
    const b = (await add('two')).data
    await alice.req(`/api/checklist-items/${a.id}`, { method: 'PATCH', body: { done: true } })
    await alice.req(`/api/checklist-items/${b.id}`, { method: 'PATCH', body: { aboveId: null, belowId: a.id } })
    expect((await bob.req(`/api/checklist-items/${a.id}`, { method: 'PATCH', body: {} })).status).toBe(400)

    const detail = (await bob.req<CardDetail>(`/api/cards/${cardId}`)).data
    expect(detail.checklist.map(i => [i.text, i.done])).toEqual([['two', false], ['one', true]])
    const summary = (await bob.req<BoardDetail>(`/api/boards/${boardId}`)).data.cards.find(c => c.id === cardId)!
    expect(summary.checklist).toEqual({ done: 1, total: 2 })

    expect((await outsider.req(`/api/checklist-items/${a.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await alice.req(`/api/checklist-items/${a.id}`, { method: 'DELETE' })).status).toBe(200)
  })

  it('comments: authors edit their own; owners delete any', async () => {
    const { data: c } = await bob.req<Comment>(`/api/cards/${cardId}/comments`, { method: 'POST', body: { body: 'Hi **all**' } })
    expect(c.authorName).toBe('Bob')
    expect((await alice.req(`/api/comments/${c.id}`, { method: 'PATCH', body: { body: 'edit' } })).status).toBe(404)
    expect((await bob.req(`/api/comments/${c.id}`, { method: 'PATCH', body: { body: 'edited' } })).status).toBe(200)
    expect((await bob.req(`/api/cards/${cardId}/comments`, { method: 'POST', body: { body: '   ' } })).status).toBe(400)
    expect((await outsider.req(`/api/cards/${cardId}/comments`, { method: 'POST', body: { body: 'x' } })).status).toBe(404)
    expect((await alice.req(`/api/comments/${c.id}`, { method: 'DELETE' })).status).toBe(200)
  })

  it('attachments: upload, safe download headers, size limit, delete', async () => {
    const form = new FormData()
    form.append('file', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'evil.html')
    form.append('file', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'pic.png')
    const { data: files } = await alice.req<Attachment[]>(`/api/cards/${cardId}/attachments`, { method: 'POST', body: form })
    expect(files.map(f => f.name)).toEqual(['evil.html', 'pic.png'])

    const html = await bob.req(`/api/attachments/${files[0]!.id}`)
    expect(html.headers.get('content-type')).toBe('application/octet-stream')
    expect(html.headers.get('content-disposition')).toMatch(/^attachment;/)
    expect(html.headers.get('x-content-type-options')).toBe('nosniff')
    const png = await bob.req(`/api/attachments/${files[1]!.id}`)
    expect(png.headers.get('content-type')).toBe('image/png')
    expect(png.headers.get('content-disposition')).toMatch(/^inline;/)
    expect((await bob.req(`/api/attachments/${files[1]!.id}?download`)).headers.get('content-disposition')).toMatch(/^attachment;/)
    expect((await outsider.req(`/api/attachments/${files[0]!.id}`)).status).toBe(404)

    const big = new FormData()
    big.append('file', new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]), 'big.bin')
    expect((await alice.req(`/api/cards/${cardId}/attachments`, { method: 'POST', body: big })).status).toBe(413)

    expect((await alice.req(`/api/attachments/${files[0]!.id}`, { method: 'DELETE' })).status).toBe(200)
  })

  it('activity lists what happened, newest first', async () => {
    const { data } = await bob.req<CardDetail>(`/api/cards/${cardId}`)
    expect(data.activity.map(a => a.kind).reverse()).toEqual(['created', 'commented', 'attached', 'attached', 'detached'])
    expect(data.activity.at(-1)!.actorName).toBe('Alice')
  })
})

describe('watchers and links', () => {
  it('watch and unwatch; creators and commenters watch automatically', async () => {
    const card = await newCard('Watched')
    expect(card.watching).toBe(true)
    const watch = (u: typeof bob, method: string) => u.req<{ watching: boolean }>(`/api/cards/${card.id}/watch`, { method })
    expect((await watch(bob, 'PUT')).data).toEqual({ watching: true })
    expect((await watch(bob, 'PUT')).status).toBe(200)
    expect((await watch(outsider, 'PUT')).status).toBe(404)

    let detail = (await alice.req<CardDetail>(`/api/cards/${card.id}`)).data
    expect(detail.watching).toBe(true)
    expect(detail.watchers.map(w => w.name)).toEqual(['Alice', 'Bob'])
    expect((await bob.req<BoardDetail>(`/api/boards/${boardId}`)).data.cards.find(c => c.id === card.id)!.watching).toBe(true)

    expect((await watch(bob, 'DELETE')).data).toEqual({ watching: false })
    detail = (await bob.req<CardDetail>(`/api/cards/${card.id}`)).data
    expect(detail.watching).toBe(false)
    expect(detail.watchers.map(w => w.name)).toEqual(['Alice'])

    await bob.req(`/api/cards/${card.id}/comments`, { method: 'POST', body: { body: 'following' } })
    expect((await bob.req<CardDetail>(`/api/cards/${card.id}`)).data.watching).toBe(true)
  })

  it('links cards of the same board; viewers read, editors add and remove', async () => {
    const [a, b, c] = [await newCard('Blocker'), await newCard('Blocked'), await newCard('Related')]
    const addLink = (u: typeof bob, from: string, toCardId: string, kind = 'blocks') =>
      u.req<CardLink>(`/api/cards/${from}/links`, { method: 'POST', body: { toCardId, kind } })

    const created = await addLink(bob, a.id, b.id)
    expect(created.status).toBe(200)
    expect(created.data).toMatchObject({ kind: 'blocks', direction: 'out', card: { id: b.id, title: 'Blocked', columnTitle: 'Backlog', archived: false } })
    expect((await addLink(bob, a.id, b.id)).status).toBe(409)
    expect((await addLink(bob, b.id, a.id)).status).toBe(409)
    expect((await addLink(bob, a.id, a.id)).status).toBe(400)
    expect((await addLink(bob, a.id, b.id, 'nope')).status).toBe(400)
    expect((await addLink(outsider, a.id, b.id, 'relates')).status).toBe(404)
    expect((await addLink(alice, c.id, a.id, 'relates')).status).toBe(200)

    const other = (await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Other', template: 'basic' } })).data.id
    extraBoards.push(other)
    const otherBoard = (await alice.req<BoardDetail>(`/api/boards/${other}`)).data
    const foreign = (await alice.req<Card>(`/api/boards/${other}/cards`, { method: 'POST', body: { columnId: otherBoard.columns[0]!.id, title: 'Foreign' } })).data
    expect((await addLink(alice, a.id, foreign.id)).status).toBe(400)

    const vic = await signUp('Vic')
    await alice.req(`/api/boards/${boardId}/members`, { method: 'POST', body: { email: vic.email, role: 'viewer' } })
    expect((await addLink(vic, c.id, b.id, 'relates')).status).toBe(403)
    const detail = (await vic.req<CardDetail>(`/api/cards/${a.id}`)).data
    expect(detail.links.map(l => [l.kind, l.direction, l.card.title])).toEqual([['blocks', 'out', 'Blocked'], ['relates', 'in', 'Related']])
    const onBoard = (await vic.req<BoardDetail>(`/api/boards/${boardId}`)).data.cards.find(x => x.id === b.id)!
    expect(onBoard.blockerIds).toEqual([a.id])
    expect((await vic.req(`/api/card-links/${created.data.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await bob.req(`/api/card-links/${created.data.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await alice.req<CardDetail>(`/api/cards/${b.id}`)).data.links).toEqual([])
    expect((await alice.req<CardDetail>(`/api/cards/${b.id}`)).data.activity.map(x => x.kind).slice(0, 2)).toEqual(['unlinked', 'linked'])
  })

  it('exports links by card index and imports them', async () => {
    const [a, b] = [await newCard('Export blocker'), await newCard('Export blocked')]
    await alice.req(`/api/cards/${a.id}/links`, { method: 'POST', body: { toCardId: b.id, kind: 'blocks' } })
    const exported = (await alice.req<string | Record<string, unknown>>(`/api/boards/${boardId}/export?format=json`)).data
    const data = typeof exported === 'string' ? JSON.parse(exported) : exported
    const titles = (data.cards as { title: string }[]).map(c => c.title)
    expect(data.links).toContainEqual({ from: titles.indexOf('Export blocker'), to: titles.indexOf('Export blocked'), kind: 'blocks' })

    // A reversed copy of the link would close a cycle and is skipped, as are bad indexes.
    const extra = [{ from: titles.indexOf('Export blocked'), to: titles.indexOf('Export blocker'), kind: 'blocks' }, { from: 0, to: 99999, kind: 'relates' }]
    const res = await alice.req<{ id: string, skipped: { links: number } }>('/api/boards/import', { method: 'POST', body: { name: 'Imported links', data: { ...data, links: [...data.links, ...extra] } } })
    expect(res.status).toBe(200)
    extraBoards.push(res.data.id)
    expect(res.data.skipped.links).toBe(2)
    const copy = (await alice.req<BoardDetail>(`/api/boards/${res.data.id}`)).data
    const blocker = copy.cards.find(c => c.title === 'Export blocker')!
    expect(copy.cards.find(c => c.title === 'Export blocked')!.blockerIds).toEqual([blocker.id])
  })
})

describe('custom fields', () => {
  it('editors define fields and set values; viewers read; values are validated', async () => {
    const { data: { id: fb } } = await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Fields', template: 'basic' } })
    extraBoards.push(fb)
    const val = await signUp('Val')
    await alice.req(`/api/boards/${fb}/members`, { method: 'POST', body: { email: val.email, role: 'viewer' } })
    await alice.req(`/api/boards/${fb}/members`, { method: 'POST', body: { email: bob.email, role: 'editor' } })
    const column = (await alice.req<BoardDetail>(`/api/boards/${fb}`)).data.columns[0]!
    const { data: card } = await alice.req<Card>(`/api/boards/${fb}/cards`, { method: 'POST', body: { columnId: column.id, title: 'Deal' } })
    expect(card.fields).toEqual({})

    const add = (who: typeof alice, body: unknown) => who.req<BoardField>(`/api/boards/${fb}/fields`, { method: 'POST', body })
    const size = (await add(alice, { name: 'Size', kind: 'select', options: [{ label: 'S', color: '#22C55E' }, { label: 'L', color: '#ef4444' }], showOnCard: true })).data
    expect(size.options.map(o => [o.label, o.color])).toEqual([['S', '#22c55e'], ['L', '#ef4444']])
    expect(size.options.every(o => o.id)).toBe(true)
    const amount = (await add(bob, { name: 'Amount', kind: 'number' })).data
    const site = (await add(bob, { name: 'Site', kind: 'url' })).data
    expect((await add(alice, { name: 'size', kind: 'text' })).status).toBe(409)
    expect((await add(alice, { name: 'Bad', kind: 'colour' })).status).toBe(400)
    expect((await add(val, { name: 'Nope', kind: 'text' })).status).toBe(403)

    const put = (who: typeof alice, field: BoardField, value: unknown) =>
      who.req<{ value: unknown }>(`/api/cards/${card.id}/fields/${field.id}`, { method: 'PUT', body: { value } })
    expect((await put(bob, size, size.options[1]!.id)).data).toEqual({ value: size.options[1]!.id })
    expect((await put(bob, amount, 1200.5)).status).toBe(200)
    expect((await put(bob, amount, 'lots')).status).toBe(400)
    expect((await put(bob, size, 'nope')).status).toBe(400)
    expect((await put(bob, site, 'javascript:alert(1)')).status).toBe(400)
    expect((await put(bob, site, { x: 1 })).status).toBe(400)
    expect((await put(val, amount, 3)).status).toBe(403)
    expect((await put(val, amount, null)).status).toBe(403)
    expect((await put(outsider, amount, 3)).status).toBe(404)

    const board = (await val.req<BoardDetail>(`/api/boards/${fb}`)).data
    expect(board.fields.map(f => f.name)).toEqual(['Size', 'Amount', 'Site'])
    expect(board.cards[0]!.fields).toEqual({ [size.id]: size.options[1]!.id, [amount.id]: 1200.5 })
    const detail = (await val.req<CardDetail>(`/api/cards/${card.id}`)).data
    expect(detail.fields).toEqual(board.cards[0]!.fields)
    expect(detail.activity.filter(a => a.kind === 'field').map(a => a.data)).toEqual([
      { field: 'Amount', kind: 'number', from: null, to: '1200.5' },
      { field: 'Size', kind: 'select', from: null, to: 'L' },
    ])

    // Reorder: Site first. Removing option L clears the card's Size.
    expect((await bob.req<BoardField>(`/api/fields/${site.id}`, { method: 'PATCH', body: { aboveId: null, belowId: size.id } })).status).toBe(200)
    expect((await val.req(`/api/fields/${site.id}`, { method: 'PATCH', body: { name: 'x' } })).status).toBe(404)
    const patched = await alice.req<BoardField>(`/api/fields/${size.id}`, { method: 'PATCH', body: { options: [size.options[0]], name: 'T-shirt' } })
    expect(patched.data).toMatchObject({ name: 'T-shirt', options: [size.options[0]] })
    expect((await alice.req(`/api/fields/${amount.id}`, { method: 'PATCH', body: { options: [{ label: 'x', color: '#000000' }] } })).status).toBe(400)
    const after = (await alice.req<BoardDetail>(`/api/boards/${fb}`)).data
    expect(after.fields.map(f => f.name)).toEqual(['Site', 'T-shirt', 'Amount'])
    expect(after.cards[0]!.fields).toEqual({ [amount.id]: 1200.5 })

    expect((await put(bob, amount, null)).data).toEqual({ value: null })
    expect((await put(bob, amount, 7)).status).toBe(200)
    expect((await val.req(`/api/fields/${amount.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await bob.req(`/api/fields/${amount.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await alice.req<BoardDetail>(`/api/boards/${fb}`)).data.cards[0]!.fields).toEqual({})
  })

  it('exports, imports and copies fields and values', async () => {
    const { data: { id: fb } } = await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Fields export', template: 'basic' } })
    extraBoards.push(fb)
    const column = (await alice.req<BoardDetail>(`/api/boards/${fb}`)).data.columns[0]!
    const { data: card } = await alice.req<Card>(`/api/boards/${fb}/cards`, { method: 'POST', body: { columnId: column.id, title: 'Valued' } })
    const size = (await alice.req<BoardField>(`/api/boards/${fb}/fields`, { method: 'POST', body: { name: 'Size', kind: 'select', options: [{ label: 'L', color: '#ef4444' }] } })).data
    const done = (await alice.req<BoardField>(`/api/boards/${fb}/fields`, { method: 'POST', body: { name: 'Done', kind: 'checkbox', showOnCard: true } })).data
    await alice.req(`/api/cards/${card.id}/fields/${size.id}`, { method: 'PUT', body: { value: size.options[0]!.id } })
    await alice.req(`/api/cards/${card.id}/fields/${done.id}`, { method: 'PUT', body: { value: true } })

    const exported = (await alice.req<string | Record<string, unknown>>(`/api/boards/${fb}/export?format=json`)).data
    const data = typeof exported === 'string' ? JSON.parse(exported) : exported
    expect(data.fields).toEqual([
      { name: 'Size', kind: 'select', options: [{ label: 'L', color: '#ef4444' }], showOnCard: false },
      { name: 'Done', kind: 'checkbox', options: [], showOnCard: true },
    ])
    expect(data.cards[0].fieldValues).toEqual({ Size: 'L', Done: true })
    const csv = (await alice.req<string>(`/api/boards/${fb}/export?format=csv`)).data
    expect(csv.split('\r\n')[0]).toMatch(/"Size","Done"$/)
    expect(csv.split('\r\n')[1]).toMatch(/"L","yes"$/)

    data.cards[0].fieldValues = { ...data.cards[0].fieldValues, Missing: 1, done: 'not a boolean' }
    const res = await alice.req<{ id: string, skipped: { fieldValues: number } }>('/api/boards/import', { method: 'POST', body: { name: 'Imported fields', data } })
    expect(res.status).toBe(200)
    extraBoards.push(res.data.id)
    expect(res.data.skipped.fieldValues).toBe(2)
    const imported = (await alice.req<BoardDetail>(`/api/boards/${res.data.id}`)).data
    const [iSize, iDone] = imported.fields
    expect(iSize).toMatchObject({ name: 'Size', kind: 'select', options: [{ label: 'L', color: '#ef4444' }] })
    expect(iSize!.id).not.toBe(size.id)
    expect(imported.cards[0]!.fields).toEqual({ [iSize!.id]: iSize!.options[0]!.id, [iDone!.id]: true })

    const { data: copy } = await alice.req<{ id: string }>(`/api/boards/${fb}/copy`, { method: 'POST', body: { name: 'Fields copy' } })
    extraBoards.push(copy.id)
    const copied = (await alice.req<BoardDetail>(`/api/boards/${copy.id}`)).data
    expect(copied.fields.map(f => f.name)).toEqual(['Size', 'Done'])
    expect(Object.values(copied.cards[0]!.fields)).toEqual(expect.arrayContaining([size.options[0]!.id, true]))
  })
})

describe('column groups', () => {
  it('editors manage groups; viewers read; export, import and copy keep them', async () => {
    const { data: { id: gb } } = await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Groups', template: 'basic' } })
    extraBoards.push(gb)
    const val = await signUp('Gita')
    await alice.req(`/api/boards/${gb}/members`, { method: 'POST', body: { email: val.email, role: 'viewer' } })
    const [todo, doing, done] = (await alice.req<BoardDetail>(`/api/boards/${gb}`)).data.columns
    const add = (who: typeof alice, body: unknown) => who.req<ColumnGroup>(`/api/boards/${gb}/column-groups`, { method: 'POST', body })

    const dev = (await add(alice, { name: 'Dev', color: '#3B82F6', columnIds: [doing!.id, todo!.id] })).data
    expect(dev).toMatchObject({ name: 'Dev', color: '#3b82f6', columnIds: [todo!.id, doing!.id] })
    const qa = (await add(alice, { name: 'QA', columnIds: [doing!.id, done!.id] })).data
    expect((await add(alice, { name: 'dev' })).status).toBe(409)
    expect((await add(val, { name: 'Nope' })).status).toBe(403)

    const otherBoard = (await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Other', template: 'basic' } })).data.id
    extraBoards.push(otherBoard)
    const foreign = (await alice.req<BoardDetail>(`/api/boards/${otherBoard}`)).data.columns[0]!
    expect((await alice.req(`/api/column-groups/${dev.id}`, { method: 'PATCH', body: { columnIds: [foreign.id] } })).status).toBe(400)

    const patched = await alice.req<ColumnGroup>(`/api/column-groups/${qa.id}`, { method: 'PATCH', body: { columnIds: [done!.id], aboveId: null, belowId: dev.id, name: 'Test' } })
    expect(patched.data).toMatchObject({ name: 'Test', columnIds: [done!.id] })
    expect((await val.req(`/api/column-groups/${qa.id}`, { method: 'PATCH', body: { name: 'x' } })).status).toBe(404)
    const { data: col } = await alice.req<{ id: string }>(`/api/boards/${gb}/columns`, { method: 'POST', body: { title: 'Review', groupId: dev.id } })

    const board = (await val.req<BoardDetail>(`/api/boards/${gb}`)).data
    expect(board.columnGroups.map(g => [g.name, g.columnIds])).toEqual([['Test', [done!.id]], ['Dev', [todo!.id, doing!.id, col.id]]])

    const exported = (await alice.req<string | Record<string, unknown>>(`/api/boards/${gb}/export?format=json`)).data
    const data = typeof exported === 'string' ? JSON.parse(exported) : exported
    expect(data.columnGroups).toEqual([
      { name: 'Test', color: null, columns: [done!.title] },
      { name: 'Dev', color: '#3b82f6', columns: [todo!.title, doing!.title, 'Review'] },
    ])
    data.columnGroups[0].columns.push('Missing')
    const res = await alice.req<{ id: string }>('/api/boards/import', { method: 'POST', body: { name: 'Imported groups', data } })
    expect(res.status).toBe(200)
    extraBoards.push(res.data.id)
    const imported = (await alice.req<BoardDetail>(`/api/boards/${res.data.id}`)).data
    const title = new Map(imported.columns.map(c => [c.id, c.title]))
    expect(imported.columnGroups.map(g => [g.name, g.columnIds.map(c => title.get(c))])).toEqual([['Test', [done!.title]], ['Dev', [todo!.title, doing!.title, 'Review']]])

    const { data: copy } = await alice.req<{ id: string }>(`/api/boards/${gb}/copy`, { method: 'POST', body: { name: 'Groups copy' } })
    extraBoards.push(copy.id)
    expect((await alice.req<BoardDetail>(`/api/boards/${copy.id}`)).data.columnGroups.map(g => g.columnIds.length)).toEqual([1, 3])

    expect((await val.req(`/api/column-groups/${dev.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await alice.req(`/api/column-groups/${dev.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await alice.req<BoardDetail>(`/api/boards/${gb}`)).data.columnGroups.map(g => g.name)).toEqual(['Test'])
  })
})

describe('scheduling, time and cover', () => {
  it('start date, estimate: saved, validated, shown on the board', async () => {
    const card = await newCard('Scheduled')
    const { data } = await alice.req<Card>(`/api/cards/${card.id}`, { method: 'PATCH', body: { startDate: '2026-11-01', dueDate: '2026-11-03', estimate: 2.5 } })
    expect(data).toMatchObject({ startDate: '2026-11-01', dueDate: '2026-11-03', estimate: 2.5 })
    const late = await alice.req<{ statusMessage?: string, message?: string }>(`/api/cards/${card.id}`, { method: 'PATCH', body: { startDate: '2026-11-04' } })
    expect(late.status).toBe(400)
    expect(JSON.stringify(late.data)).toContain('start date')
    expect((await alice.req(`/api/cards/${card.id}`, { method: 'PATCH', body: { estimate: -1 } })).status).toBe(400)
    const onBoard = (await bob.req<BoardDetail>(`/api/boards/${boardId}`)).data.cards.find(c => c.id === card.id)!
    expect(onBoard).toMatchObject({ startDate: '2026-11-01', estimate: 2.5, timeMinutes: 0, coverAttachmentId: null })
    const kinds = (await bob.req<CardDetail>(`/api/cards/${card.id}`)).data.activity.map(a => a.kind)
    expect(kinds).toEqual(expect.arrayContaining(['start', 'due', 'estimate']))
  })

  it('time entries: log, edit own, delete; totals on the card and board', async () => {
    const card = await newCard('Timed')
    const log = (who: typeof alice, body: unknown) => who.req<TimeEntry>(`/api/cards/${card.id}/time`, { method: 'POST', body })
    const { status, data: a } = await log(alice, { minutes: 90, spentOn: '2026-10-01', note: 'pairing' })
    expect(status).toBe(200)
    expect(a).toMatchObject({ minutes: 90, spentOn: '2026-10-01', note: 'pairing', userName: 'Alice' })
    const { data: b } = await log(bob, { minutes: 30 })
    expect(b.spentOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((await log(alice, { minutes: 0 })).status).toBe(400)
    expect((await log(outsider, { minutes: 5 })).status).toBe(404)

    expect((await alice.req(`/api/time-entries/${b.id}`, { method: 'PATCH', body: { minutes: 10 } })).status).toBe(404)
    const edited = await bob.req<TimeEntry>(`/api/time-entries/${b.id}`, { method: 'PATCH', body: { minutes: 45, note: 'review' } })
    expect(edited.data).toMatchObject({ minutes: 45, note: 'review', userName: 'Bob' })
    expect((await bob.req(`/api/time-entries/${b.id}`, { method: 'PATCH', body: {} })).status).toBe(400)

    const detail = (await bob.req<CardDetail>(`/api/cards/${card.id}`)).data
    expect(detail.timeTotal).toBe(135)
    expect(detail.timeEntries.map(e => e.minutes)).toEqual([45, 90])
    const onBoard = (await bob.req<BoardDetail>(`/api/boards/${boardId}`)).data.cards.find(c => c.id === card.id)!
    expect(onBoard.timeMinutes).toBe(135)

    // Bob cannot delete Alice's entry; Alice owns the board and can delete Bob's.
    expect((await bob.req(`/api/time-entries/${a.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await alice.req(`/api/time-entries/${b.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await bob.req<CardDetail>(`/api/cards/${card.id}`)).data.timeTotal).toBe(90)
  })

  it('cover: only an image of the same card; cleared when the image is deleted', async () => {
    const card = await newCard('Covered')
    const other = await newCard('Other')
    const upload = async (cardId: string, name: string, type: string) => {
      const form = new FormData()
      form.append('file', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type }), name)
      return (await alice.req<Attachment[]>(`/api/cards/${cardId}/attachments`, { method: 'POST', body: form })).data[0]!
    }
    const png = await upload(card.id, 'pic.png', 'image/png')
    const txt = await upload(card.id, 'notes.txt', 'text/plain')
    const elsewhere = await upload(other.id, 'other.png', 'image/png')
    const setCover = (id: string | null) => bob.req<Card>(`/api/cards/${card.id}`, { method: 'PATCH', body: { coverAttachmentId: id } })

    expect((await setCover(txt.id)).status).toBe(400)
    expect((await setCover(elsewhere.id)).status).toBe(400)
    expect((await setCover(png.id)).data.coverAttachmentId).toBe(png.id)
    expect((await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data.cards.find(c => c.id === card.id)!.coverAttachmentId).toBe(png.id)

    await alice.req(`/api/attachments/${png.id}`, { method: 'DELETE' })
    expect((await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data.cards.find(c => c.id === card.id)!.coverAttachmentId).toBeNull()
  })
})

describe('copy and export', () => {
  it('copies a board with cards into a new personal board', async () => {
    const { data } = await bob.req<{ id: string }>(`/api/boards/${boardId}/copy`, { method: 'POST', body: { name: 'Bob copy', withCards: true } })
    extraBoards.push(data.id)
    const copy = (await bob.req<BoardDetail>(`/api/boards/${data.id}`)).data
    expect(copy.role).toBe('owner')
    // Earlier tests add columns, so compare with the board as it is now.
    const source = (await bob.req<BoardDetail>(`/api/boards/${boardId}`)).data
    expect(copy.columns.map(c => c.title)).toEqual(source.columns.map(c => c.title))
    expect(copy.cards.length).toBeGreaterThan(0)
    // Alice has no access to Bob's copy, so she is dropped from assignees and rules.
    expect(copy.cards.flatMap(c => c.assigneeIds)).not.toContain(userId('Alice'))
    const assignRules = (b: BoardDetail) => b.columns.flatMap(c => c.rules).flatMap(r => r.kind === 'assign_to' ? [r.userId] : [])
    expect(assignRules(source)).toContain(userId('Alice'))
    expect(assignRules(copy)).toEqual(assignRules(source).filter(id => id !== userId('Alice')))
    await bob.req(`/api/boards/${data.id}/members`, { method: 'POST', body: { email: alice.email, role: 'owner' } })
  })

  it('outsiders cannot copy', async () => {
    expect((await outsider.req(`/api/boards/${boardId}/copy`, { method: 'POST', body: { name: 'Steal' } })).status).toBe(403)
  })

  it('exports JSON and CSV', async () => {
    const json = await bob.req<string>(`/api/boards/${boardId}/export?format=json`)
    expect(json.headers.get('content-disposition')).toContain('API-test.json')
    const parsed = typeof json.data === 'string' ? JSON.parse(json.data) : json.data
    expect(parsed.name).toBe('API test')
    expect(parsed.cards.find((c: { title: string }) => c.title === 'Details').checklist).toEqual([{ text: 'two', done: false }])

    await alice.req(`/api/boards/${boardId}/cards`, { method: 'POST', body: { columnId: col('Backlog').id, title: '=HYPERLINK("x")' } })
    const csv = await bob.req<string>(`/api/boards/${boardId}/export?format=csv`)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect(csv.data).toContain('"Column","Title"')
    // Formula injection is neutralised.
    expect(csv.data).toContain(`"'=HYPERLINK(""x"")"`)
    expect((await outsider.req(`/api/boards/${boardId}/export`)).status).toBe(404)
  })
})

describe('board background', () => {
  const upload = (who: typeof alice, bytes: Buffer, name = 'bg.png') => {
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: 'image/png' }), name)
    return who.req<{ background: BoardDetail['background'] }>(`/api/boards/${boardId}/background`, { method: 'POST', body: form })
  }
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

  it('owners set presets; unknown presets and editors are refused', async () => {
    const put = (who: typeof alice, body: unknown) => who.req(`/api/boards/${boardId}/background`, { method: 'PUT', body })
    expect((await put(alice, { kind: 'gradient', value: 'sunset' })).status).toBe(200)
    expect((await put(alice, { kind: 'gradient', value: 'nope' })).status).toBe(400)
    expect((await put(alice, { kind: 'upload', value: 'abc' })).status).toBe(400)
    expect((await put(bob, { kind: 'color', value: '#123456' })).status).toBe(404)
    expect((await bob.req<BoardDetail>(`/api/boards/${boardId}`)).data.background).toEqual({ kind: 'gradient', value: 'sunset' })
    const tiles = (await bob.req<BoardSummary[]>('/api/boards')).data
    expect(tiles.find(b => b.id === boardId)!.background).toEqual({ kind: 'gradient', value: 'sunset' })
  })

  it('uploads an image, serves it to members, and copies it', async () => {
    expect((await upload(alice, Buffer.from('<html><script>alert(1)</script>'), 'x.png')).status).toBe(400)
    expect((await upload(bob, png)).status).toBe(403)
    const { data } = await upload(alice, png)
    expect(data.background).toMatchObject({ kind: 'upload' })
    const image = await bob.req<Buffer>(`/api/boards/${boardId}/background`)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(image.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.compare(image.data, png)).toBe(0)
    expect((await outsider.req(`/api/boards/${boardId}/background`)).status).toBe(404)

    const copy = await alice.req<{ id: string }>(`/api/boards/${boardId}/copy`, { method: 'POST', body: { name: 'Background copy', withCards: false } })
    extraBoards.push(copy.data.id)
    expect((await alice.req<BoardDetail>(`/api/boards/${copy.data.id}`)).data.background).toEqual(data.background)
    expect((await alice.req(`/api/boards/${copy.data.id}/background`)).status).toBe(200)

    expect((await alice.req(`/api/boards/${boardId}/background`, { method: 'DELETE' })).status).toBe(200)
    expect((await bob.req(`/api/boards/${boardId}/background`)).status).toBe(404)
    expect((await bob.req<BoardDetail>(`/api/boards/${boardId}`)).data.background).toBeNull()
  })
})

describe('profile picture', () => {
  const upload = (who: typeof alice, bytes: Buffer) => {
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: 'image/png' }), 'me.png')
    return who.req<{ avatarUrl: string }>('/api/account/avatar', { method: 'POST', body: form })
  }
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

  it('uploads, shows it to people sharing a board, and removes it', async () => {
    expect((await upload(bob, Buffer.from('<svg/>'))).status).toBe(400)
    const { data } = await upload(bob, png)
    const members = (await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data.members
    const bobId = members.find(m => m.email === bob.email)!.userId
    expect(data.avatarUrl).toMatch(new RegExp(`^/api/users/${bobId}/avatar\\?v=[0-9a-f]{12}$`))
    expect(members.find(m => m.userId === bobId)!.avatarUrl).toBe(data.avatarUrl)
    expect((await bob.req<{ user: { avatarUrl: string } }>('/api/_auth/session')).data.user.avatarUrl).toBe(data.avatarUrl)

    const image = await alice.req<Buffer>(data.avatarUrl)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(image.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.compare(image.data, png)).toBe(0)
    expect((await outsider.req(data.avatarUrl)).status).toBe(404)

    expect((await bob.req('/api/account/avatar', { method: 'DELETE' })).status).toBe(200)
    expect((await alice.req(data.avatarUrl)).status).toBe(404)
    expect((await bob.req<{ avatarUrl: string | null }>('/api/account')).data.avatarUrl).toBeNull()
  })
})

describe('board accent', () => {
  it('owners set and clear it; members see it; copies keep it', async () => {
    const put = (who: typeof alice, accent: unknown) => who.req(`/api/boards/${boardId}/accent`, { method: 'PUT', body: { accent } })
    expect((await put(alice, 'teal')).status).toBe(200)
    expect((await put(alice, 'chartreuse')).status).toBe(400)
    expect((await put(bob, 'rose')).status).toBe(404)
    expect((await bob.req<BoardDetail>(`/api/boards/${boardId}`)).data.accent).toBe('teal')
    expect((await bob.req<BoardSummary[]>('/api/boards')).data.find(b => b.id === boardId)!.accent).toBe('teal')

    const copy = await alice.req<{ id: string }>(`/api/boards/${boardId}/copy`, { method: 'POST', body: { name: 'Accent copy', withCards: false } })
    extraBoards.push(copy.data.id)
    expect((await alice.req<BoardDetail>(`/api/boards/${copy.data.id}`)).data.accent).toBe('teal')

    expect((await put(alice, null)).status).toBe(200)
    expect((await bob.req<BoardDetail>(`/api/boards/${boardId}`)).data.accent).toBeNull()
  })
})

describe('column outline', () => {
  it('owners set and clear it; members see it; copies keep it', async () => {
    const put = (who: typeof alice, outline: unknown) => who.req(`/api/boards/${boardId}/column-outline`, { method: 'PUT', body: { outline } })
    const outline = { color: '#0ea5e9', width: 2, glow: 3 }
    expect((await put(alice, outline)).status).toBe(200)
    expect((await put(alice, { color: 'blue', width: 2, glow: 0 })).status).toBe(400)
    expect((await put(alice, { color: null, width: 5, glow: 0 })).status).toBe(400)
    expect((await put(bob, { color: null, width: 1, glow: 0 })).status).toBe(404)
    expect((await bob.req<BoardDetail>(`/api/boards/${boardId}`)).data.columnOutline).toEqual(outline)

    const copy = await alice.req<{ id: string }>(`/api/boards/${boardId}/copy`, { method: 'POST', body: { name: 'Outline copy', withCards: false } })
    extraBoards.push(copy.data.id)
    expect((await alice.req<BoardDetail>(`/api/boards/${copy.data.id}`)).data.columnOutline).toEqual(outline)

    expect((await put(alice, null)).status).toBe(200)
    expect((await bob.req<BoardDetail>(`/api/boards/${boardId}`)).data.columnOutline).toBeNull()
  })

  it('columns override it; exports and imports keep the override', async () => {
    const board = (await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data
    const col = board.columns[0]!
    const patch = (who: typeof alice, outline: unknown) => who.req(`/api/columns/${col.id}`, { method: 'PATCH', body: { outline } })
    const outline = { color: 'column', width: 4, glow: 2 }
    expect((await patch(bob, outline)).status).toBe(200)
    expect((await patch(bob, { color: 'column', width: 4 })).status).toBe(400)
    expect((await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data.columns[0]!.outline).toEqual(outline)

    const exported = (await alice.req<string | Record<string, unknown>>(`/api/boards/${boardId}/export?format=json`)).data
    const data = typeof exported === 'string' ? JSON.parse(exported) : exported
    expect(data.columns[0].outline).toEqual(outline)
    const res = await alice.req<{ id: string }>('/api/boards/import', { method: 'POST', body: { name: 'Imported outline', data } })
    expect(res.status).toBe(200)
    extraBoards.push(res.data.id)
    expect((await alice.req<BoardDetail>(`/api/boards/${res.data.id}`)).data.columns[0]!.outline).toEqual(outline)

    expect((await patch(bob, null)).status).toBe(200)
  })
})

describe('notifications', () => {
  it('notifies the assignee live, links to the card and marks read', async () => {
    const stream = await listen('/api/notifications/events', bob.cookie())
    await sleep(300)
    const card = await newCard('Notify me')
    await alice.req(`/api/cards/${card.id}`, { method: 'PATCH', body: { assigneeIds: [userId('Bob')] } })
    await alice.req(`/api/cards/${card.id}/comments`, { method: 'POST', body: { body: 'over to you' } })
    await sleep(800)
    stream.stop()
    expect(stream.events).toContain('change')

    const inbox = (await bob.req<Inbox>('/api/notifications')).data
    const mine = inbox.items.filter(n => n.cardId === card.id)
    expect(mine.map(n => n.activity.kind)).toEqual(['commented', 'assigned'])
    expect(mine[0]).toMatchObject({ boardId, cardTitle: 'Notify me', readAt: null, activity: { actorName: 'Alice' } })
    expect(inbox.unread).toBeGreaterThanOrEqual(2)
    expect((await alice.req<Inbox>('/api/notifications')).data.items.some(n => n.cardId === card.id)).toBe(false)

    expect((await alice.req(`/api/notifications/${mine[0]!.id}`, { method: 'PATCH', body: { read: true } })).status).toBe(404)
    expect((await bob.req(`/api/notifications/${mine[0]!.id}`, { method: 'PATCH', body: { read: true } })).status).toBe(200)
    expect((await bob.req('/api/notifications/read-all', { method: 'POST' })).status).toBe(200)
    expect((await bob.req<Inbox>('/api/notifications')).data.unread).toBe(0)
  })

  it('lists assigned cards due by tomorrow', async () => {
    const card = await newCard('Due soon')
    const today = new Date().toISOString().slice(0, 10)
    await alice.req(`/api/cards/${card.id}`, { method: 'PATCH', body: { dueDate: today, assigneeIds: [userId('Bob')] } })
    expect((await bob.req<Inbox>('/api/notifications')).data.dueSoon).toContainEqual(
      { boardId, boardName: 'API test', cardId: card.id, cardTitle: 'Due soon', dueDate: today })
  })

  it('needs a session', async () => {
    expect((await fetch('/api/notifications')).status).toBe(401)
    expect((await fetch('/api/notifications/events')).status).toBe(401)
  })
})

describe('realtime', () => {
  it('streams changes by others, skips the own tab, and ends when access is lost', async () => {
    const stream = await listen(`/api/boards/${boardId}/events?client=${bob.clientId}`, bob.cookie())
    await sleep(300)
    await newCard('Ping')
    await sleep(800)
    expect(stream.events).toContain('change')

    stream.events.length = 0
    await bob.req(`/api/boards/${boardId}/cards`, { method: 'POST', body: { columnId: col('Backlog').id, title: 'Own' } })
    await sleep(800)
    expect(stream.events).not.toContain('change')

    await alice.req(`/api/boards/${boardId}/members/${userId('Bob')}`, { method: 'DELETE' })
    await sleep(800)
    expect(stream.events).toContain('gone')
    stream.stop()
  })

  it('refuses the stream without access', async () => {
    expect((await fetch(`/api/boards/${boardId}/events`, { headers: { cookie: outsider.cookie() } })).status).toBe(404)
    expect((await fetch(`/api/boards/${boardId}/events`)).status).toBe(401)
  })
})

describe('email verification', () => {
  it('signs in only after the confirmation link is opened', async () => {
    const http = anon()
    const email = `verify-${randomUUID()}@api.test`
    expect((await http('/api/auth/register', { name: 'V', email, password: 'password123' })).status).toBe(200)
    expect((await http('/api/auth/login', { email, password: 'password123' })).status).toBe(403)
    expect((await http('/api/auth/resend-verification', { email })).status).toBe(204)
    expect((await http('/api/boards')).status).toBe(401)

    const verify = await http(`/auth/verify?token=${await tokenFor(email)}`)
    expect(verify.location).toBe('/')
    expect((await http('/api/boards')).status).toBe(200)
    expect((await http('/api/auth/login', { email, password: 'password123' })).status).toBe(200)
    // Verified accounts cannot be registered over.
    expect((await anon()('/api/auth/register', { name: 'X', email, password: 'password456' })).status).toBe(409)
  })

  it('registering over an unverified email replaces its password', async () => {
    const email = `squat-${randomUUID()}@api.test`
    await anon()('/api/auth/register', { name: 'Squatter', email, password: 'squatter123' })
    const owner = anon()
    expect((await owner('/api/auth/register', { name: 'Owner', email, password: 'owner12345' })).status).toBe(200)
    await owner(`/auth/verify?token=${await tokenFor(email)}`)
    expect((await anon()('/api/auth/login', { email, password: 'squatter123' })).status).toBe(401)
    expect((await anon()('/api/auth/login', { email, password: 'owner12345' })).status).toBe(200)
  })

  it('rejects a forged or expired link', async () => {
    const email = `forged-${randomUUID()}@api.test`
    const http = anon()
    await http('/api/auth/register', { name: 'F', email, password: 'password123' })
    const [u] = await authDb`select id from users where email = ${email}`
    for (const token of ['nope', signEmailToken(u!.id, email, 'wrong-secret'), signEmailToken(u!.id, email, process.env.NUXT_SESSION_PASSWORD!, -1)]) {
      const res = await http(`/auth/verify?token=${token}`)
      expect(res.location).toMatch(/^\/login\?error=/)
    }
    expect((await http('/api/boards')).status).toBe(401)
  })
})

describe('rate limit', () => {
  it('refuses the 11th login attempt per IP and email', async () => {
    const http = anon()
    const email = `nobody-${randomUUID()}@api.test`
    for (let i = 0; i < 10; i++) {
      expect((await http('/api/auth/login', { email, password: 'wrong-password' })).status).toBe(401)
    }
    expect((await http('/api/auth/login', { email, password: 'wrong-password' })).status).toBe(429)
    // Another IP is counted separately.
    expect((await anon()('/api/auth/login', { email, password: 'wrong-password' })).status).toBe(401)
  })
})

describe('admin', () => {
  it('the admin email becomes admin; others get 403', async () => {
    expect((await admin.req<{ isAdmin: boolean }>('/api/me')).data).toEqual({ isAdmin: true, locale: null })
    expect((await alice.req<{ isAdmin: boolean }>('/api/me')).data).toEqual({ isAdmin: false, locale: null })
    expect((await alice.req('/api/admin/settings')).status).toBe(403)
    expect((await alice.req('/api/admin/settings', { method: 'PUT', body: savedSettings })).status).toBe(403)
    expect((await alice.req('/api/admin/users')).status).toBe(403)
    expect((await alice.req(`/api/admin/users/${bob.email}`, { method: 'DELETE' })).status).toBe(400)
  })

  it('restricts sign-up and invites by domain', async () => {
    const domain = `${randomUUID().slice(0, 8)}.test`
    const put = (body: Partial<InstanceSettings>) => admin.req<InstanceSettings>('/api/admin/settings', {
      method: 'PUT',
      body: { signupMode: 'restricted', allowedDomains: [], allowedEmails: [], allowExternalInvites: false, ...body },
    })
    try {
      expect((await put({ allowedDomains: ['not a domain'] })).status).toBe(400)
      const saved = await put({ allowedDomains: [`@${domain.toUpperCase()}`] })
      expect(saved.data.allowedDomains).toEqual([domain])
      expect((await admin.req<{ mode: string }>('/api/auth/signup')).data).toEqual({ mode: 'restricted' })

      const http = anon()
      const register = (email: string) => http('/api/auth/register', { name: 'X', email, password: 'password123' })
      expect((await register(`a-${randomUUID()}@${domain}`)).status).toBe(200)
      expect((await register(`b-${randomUUID()}@elsewhere.test`)).status).toBe(403)

      // Owners cannot invite outside the domain until external invites are on.
      const invite = (email: string) => alice.req(`/api/boards/${boardId}/members`, { method: 'POST', body: { email, role: 'viewer' } })
      const outside = `c-${randomUUID()}@elsewhere.test`
      const denied = await invite(outside)
      expect(denied.status).toBe(403)
      expect((denied.data as { statusMessage: string }).statusMessage).toMatch(/allowed email/)
      expect((await put({ allowedDomains: [domain], allowExternalInvites: true })).status).toBe(200)
      expect((await invite(outside)).status).toBe(200)
      expect((await register(outside)).status).toBe(200)
    }
    finally {
      await put({ signupMode: 'open' })
    }
  })

  it('promotes, demotes and removes users; a removed session stops working', async () => {
    const carol = await signUp('Carol')
    const users = (await admin.req<AdminUser[]>('/api/admin/users')).data
    const carolId = users.find(u => u.email === carol.email)!.id
    expect(users.find(u => u.email === adminEmail)).toMatchObject({ isAdmin: true, verified: true })

    expect((await admin.req(`/api/admin/users/${carolId}`, { method: 'PATCH', body: { admin: true } })).status).toBe(200)
    expect((await carol.req<{ isAdmin: boolean }>('/api/me')).data.isAdmin).toBe(true)
    expect((await carol.req('/api/admin/settings')).status).toBe(200)
    expect((await admin.req(`/api/admin/users/${carolId}`, { method: 'PATCH', body: { admin: false } })).status).toBe(200)
    expect((await carol.req('/api/admin/settings')).status).toBe(403)

    const kept = await carol.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Carol board' } })
    expect((await carol.req(`/api/boards/${kept.data.id}/members`, { method: 'POST', body: { email: bob.email, role: 'viewer' } })).status).toBe(200)

    expect((await admin.req(`/api/admin/users/${carolId}`, { method: 'DELETE' })).status).toBe(200)
    expect((await carol.req('/api/boards')).status).toBe(401)
    // Bob inherits Carol's board as its only remaining member.
    const inherited = await bob.req<BoardDetail>(`/api/boards/${kept.data.id}`)
    expect(inherited.data.role).toBe('owner')
    await bob.req(`/api/boards/${kept.data.id}`, { method: 'DELETE' })
  })
})

describe('password reset', () => {
  it('resets once, signs out other sessions and rejects other token kinds', async () => {
    const user = await signUp('Resetter')
    const other = anon()
    expect((await other('/api/auth/login', { email: user.email, password: 'password123' })).status).toBe(200)
    expect((await other('/api/boards')).status).toBe(200)

    expect((await anon()('/api/auth/forgot-password', { email: user.email })).status).toBe(204)
    expect((await anon()('/api/auth/forgot-password', { email: `nobody-${randomUUID()}@api.test` })).status).toBe(204)

    const http = anon()
    const verifyToken = await tokenFor(user.email)
    expect((await http('/api/auth/reset-password', { token: verifyToken, password: 'newpass123' })).status).toBe(400)
    const token = decodeURIComponent(await linkToken('password-reset', user.email))
    expect((await http('/api/auth/reset-password', { token, password: 'newpass123' })).status).toBe(200)
    expect((await http('/api/boards')).status).toBe(200)
    // Single use, and the other session and the old password are gone.
    expect((await anon()('/api/auth/reset-password', { token, password: 'again12345' })).status).toBe(400)
    expect((await other('/api/boards')).status).toBe(401)
    expect((await user.req('/api/boards')).status).toBe(401)
    expect((await anon()('/api/auth/login', { email: user.email, password: 'password123' })).status).toBe(401)
    expect((await anon()('/api/auth/login', { email: user.email, password: 'newpass123' })).status).toBe(200)
  })
})

describe('account', () => {
  it('shows and edits the profile and digest setting', async () => {
    const user = await signUp('Profile')
    const acc = await user.req<Account>('/api/account')
    expect(acc.data).toEqual({ name: 'Profile', email: user.email, hasPassword: true, providers: [], digestEnabled: false, locale: null, twoFactorEnabled: false, recoveryCodesLeft: 0, avatarUrl: null })
    expect((await user.req('/api/account', { method: 'PATCH', body: { name: 'Renamed', digestEnabled: true } })).status).toBe(200)
    expect((await user.req<Account>('/api/account')).data).toMatchObject({ name: 'Renamed', digestEnabled: true })
    expect((await user.req('/api/account', { method: 'PATCH', body: {} })).status).toBe(400)
    // Off again: a dev server's scheduled digest would otherwise mail this address.
    await user.req('/api/account', { method: 'PATCH', body: { digestEnabled: false } })
  })

  it('saves the language, shown by /api/me', async () => {
    const user = await signUp('Sprache')
    expect((await user.req('/api/account', { method: 'PATCH', body: { locale: 'de' } })).status).toBe(200)
    expect((await user.req<{ locale: string | null }>('/api/me')).data.locale).toBe('de')
    expect((await user.req<Account>('/api/account')).data.locale).toBe('de')
    expect((await user.req('/api/account', { method: 'PATCH', body: { locale: 'fr' } })).status).toBe(400)
    expect((await user.req('/api/account', { method: 'PATCH', body: { locale: null } })).status).toBe(200)
    expect((await user.req<{ locale: string | null }>('/api/me')).data.locale).toBeNull()
  })

  it('changes the password with the current one and keeps this session', async () => {
    const user = await signUp('Passworder')
    const other = anon()
    await other('/api/auth/login', { email: user.email, password: 'password123' })
    const change = (body: unknown) => user.req('/api/account/password', { method: 'POST', body })
    expect((await change({ currentPassword: 'wrong', newPassword: 'newpass123' })).status).toBe(400)
    expect((await change({ newPassword: 'newpass123' })).status).toBe(400)
    expect((await change({ currentPassword: 'password123', newPassword: 'newpass123' })).status).toBe(200)
    expect((await user.req('/api/boards')).status).toBe(200)
    expect((await other('/api/boards')).status).toBe(401)
  })

  it('changes the email only once the link to the new address is opened', async () => {
    const user = await signUp('Mover')
    const newEmail = `moved-${randomUUID()}@api.test`
    expect((await user.req('/api/account/email', { method: 'POST', body: { email: newEmail } })).status).toBe(400)
    expect((await user.req('/api/account/email', { method: 'POST', body: { email: alice.email, password: 'password123' } })).status).toBe(409)
    expect((await user.req('/api/account/email', { method: 'POST', body: { email: newEmail, password: 'password123' } })).data).toEqual({ sentTo: newEmail })
    expect((await user.req<Account>('/api/account')).data.email).toBe(user.email)

    const token = await linkToken('email-change', user.email, newEmail)
    const confirm = await user.req(`/auth/confirm-email?token=${token}`, { redirect: 'manual' })
    expect(confirm.headers.get('location')).toBe('/account?emailChanged=1')
    expect((await user.req<Account>('/api/account')).data.email).toBe(newEmail)
    const again = await user.req(`/auth/confirm-email?token=${token}`, { redirect: 'manual' })
    expect(again.headers.get('location')).toMatch(/^\/account\?error=/)
    expect((await anon()('/api/auth/login', { email: newEmail, password: 'password123' })).status).toBe(200)
  })

  it('deletes the account after confirmation', async () => {
    const user = await signUp('Leaver')
    expect((await user.req('/api/account', { method: 'DELETE', body: { confirm: 'nope' } })).status).toBe(400)
    expect((await user.req('/api/account', { method: 'DELETE', body: { confirm: user.email.toUpperCase() } })).status).toBe(200)
    expect((await user.req('/api/boards')).status).toBe(401)
    expect((await anon()('/api/auth/login', { email: user.email, password: 'password123' })).status).toBe(401)
  })
})

describe('board import', () => {
  it('round-trips an export and skips people without access', async () => {
    const carol = await signUp('Carol')
    const added = await alice.req<{ userId: string }>(`/api/boards/${boardId}/members`, { method: 'POST', body: { email: carol.email, role: 'editor' } })
    expect(added.status).toBe(200)
    const members = (await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data.members
    const card = await newCard('Imported card')
    const patched = await alice.req(`/api/cards/${card.id}`, { method: 'PATCH', body: { assigneeIds: [members.find(m => m.email === carol.email)!.userId], priority: 'high', startDate: '2026-11-01', dueDate: '2026-11-02', estimate: 3 } })
    expect(patched.status).toBe(200)
    await alice.req(`/api/cards/${card.id}/checklist`, { method: 'POST', body: { text: 'Step one' } })
    const { data: said } = await carol.req<Comment>(`/api/cards/${card.id}/comments`, { method: 'POST', body: { body: 'Carol was here' } })
    const exported = (await alice.req<Record<string, unknown>>(`/api/boards/${boardId}/export?format=json`)).data
    const data = typeof exported === 'string' ? JSON.parse(exported) : exported
    expect(data.version).toBe(1)

    const res = await alice.req<{ id: string, skipped: { assignees: number, rules: number } }>('/api/boards/import', { method: 'POST', body: { name: 'Imported', data } })
    expect(res.status).toBe(200)
    extraBoards.push(res.data.id)
    // A personal board starts with only Alice: Carol's assignment is skipped.
    expect(res.data.skipped.assignees).toBeGreaterThan(0)

    const copy = (await alice.req<BoardDetail>(`/api/boards/${res.data.id}`)).data
    const original = (await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data
    expect(copy.columns.map(c => c.title)).toEqual(original.columns.map(c => c.title))
    expect(copy.tags.map(t => t.name).sort()).toEqual(original.tags.map(t => t.name).sort())
    expect(copy.cards.map(c => c.title).sort()).toEqual(original.cards.map(c => c.title).sort())
    const imported = copy.cards.find(c => c.title === 'Imported card')!
    expect(imported).toMatchObject({ priority: 'high', assigneeIds: [], checklist: { done: 0, total: 1 }, startDate: '2026-11-01', estimate: 3 })

    // Carol's comment comes over under her name and time, written by nobody:
    // no activity, nobody can edit it, the owner can delete it.
    const detail = (await alice.req<CardDetail>(`/api/cards/${imported.id}`)).data
    expect(detail.comments).toEqual([expect.objectContaining({
      authorId: null, authorName: null, importedAuthor: 'Carol', body: 'Carol was here', createdAt: said.createdAt, updatedAt: said.createdAt,
    })])
    expect(detail.activity.map(a => a.kind)).not.toContain('commented')
    const importedComment = detail.comments[0]!.id
    expect((await alice.req(`/api/comments/${importedComment}`, { method: 'PATCH', body: { body: 'mine now' } })).status).toBe(404)
    expect((await alice.req(`/api/comments/${importedComment}`, { method: 'DELETE' })).status).toBe(200)

    const bad = await alice.req('/api/boards/import', { method: 'POST', body: { name: 'Bad', data: { ...data, cards: [{ column: 'Nope', title: 'x' }] } } })
    expect(bad.status).toBe(400)
  })

  interface ImportResult { id: string | null, skipped: Record<string, number>, unmatched: string[], ignoredColumns: string[], counts: { columns: number, cards: number, tags: number } }
  const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')

  it('imports a Trello export, matching members by name, after a dry run that leaves nothing behind', async () => {
    const trello = JSON.parse(fixture('trello-board.json'))
    const before = (await alice.req<BoardSummary[]>('/api/boards')).data.length
    const preview = await alice.req<ImportResult>('/api/boards/import', { method: 'POST', body: { name: 'Trello', data: trello, dryRun: true } })
    expect(preview.status).toBe(200)
    expect(preview.data).toMatchObject({ id: null, counts: { columns: 3, cards: 3, tags: 3 }, unmatched: ['Zed Unknown'] })
    expect((await alice.req<BoardSummary[]>('/api/boards')).data.length).toBe(before)

    const res = await alice.req<ImportResult>('/api/boards/import', { method: 'POST', body: { name: 'Trello', format: 'trello', data: trello } })
    expect(res.status).toBe(200)
    extraBoards.push(res.data.id!)
    expect(res.data.skipped).toMatchObject({ assignees: 1, cards: 1, comments: 1, attachments: 3, fields: 1, invalidValues: 1 })

    const b = (await alice.req<BoardDetail>(`/api/boards/${res.data.id}`)).data
    expect(b.columns.map(c => c.title)).toEqual(['To Do', 'Doing', 'Done'])
    // The archived card is left out of the board.
    expect(b.cards.map(c => c.title)).toEqual(['Fix the login', 'Second task'])
    const card = b.cards[0]!
    const aliceId = b.members.find(m => m.email === alice.email)!.userId
    expect(card).toMatchObject({ assigneeIds: [aliceId], startDate: '2026-11-01', dueDate: '2026-11-20', checklist: { done: 1, total: 3 } })
    expect(card.tagIds.map(t => b.tags.find(x => x.id === t)!.name).sort()).toEqual(['Bug', 'Green dark'])
    const size = b.fields.find(f => f.name === 'Size')!
    expect(card.fields[size.id]).toBe(size.options.find(o => o.label === 'Large')!.id)
    expect(Object.keys(card.fields)).toHaveLength(5)
    const comments = (await alice.req<CardDetail>(`/api/cards/${card.id}`)).data.comments
    expect(comments.map(c => [c.importedAuthor, c.body, c.createdAt])).toEqual([
      ['Former Colleague', 'Seen this too', '2026-10-02T08:00:00.000Z'],
      ['Zed Unknown', 'Me too', '2026-10-03T08:00:00.000Z'],
    ])
    const archived = (await alice.req<Card[]>(`/api/boards/${res.data.id}/archived`)).data
    expect(archived.map(c => c.title)).toEqual(['Ship it'])
  })

  it('imports a Jira CSV with issue keys, and rejects files it cannot read', async () => {
    const csv = fixture('jira-issues.csv')
    const res = await alice.req<ImportResult>('/api/boards/import', { method: 'POST', body: { name: 'Jira', data: csv, issueKeys: true } })
    expect(res.status).toBe(200)
    extraBoards.push(res.data.id!)
    expect(res.data).toMatchObject({ skipped: { cards: 1, invalidValues: 3, assignees: 1 }, unmatched: ['Zed Unknown'], ignoredColumns: ['Issue id', 'Issue Type', 'Reporter', 'Created'] })
    const b = (await alice.req<BoardDetail>(`/api/boards/${res.data.id}`)).data
    expect(b.columns.map(c => c.title)).toEqual(['In Progress', 'To Do', 'Done'])
    expect(b.tags.map(t => t.name).sort()).toEqual(['backend', 'frontend', 'urgent'])
    const first = b.cards.find(c => c.title === 'KAN-1 Fix login timeout')!
    expect(first).toMatchObject({ priority: 'urgent', estimate: 5, dueDate: '2026-11-20', description: 'Users get logged out.\nSteps: "open", wait' })
    expect(first.assigneeIds).toEqual([b.members.find(m => m.email === alice.email)!.userId])
    expect(b.cards).toHaveLength(4)

    expect((await alice.req('/api/boards/import', { method: 'POST', body: { name: 'x', data: 'Status\nDone' } })).status).toBe(400)
    expect((await alice.req('/api/boards/import', { method: 'POST', body: { name: 'x', format: 'trello', data: { name: 'x' } } })).status).toBe(400)
  })

  it('round-trips our CSV export', async () => {
    const card = await newCard('CSV round trip')
    // Someone else on the board (Carol, added above), who has no access to the copy.
    const other = (await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data.members.find(m => m.email !== alice.email)!
    expect((await alice.req(`/api/cards/${card.id}`, { method: 'PATCH', body: { priority: 'low', dueDate: '2026-12-24', estimate: 2, assigneeIds: [other.userId] } })).status).toBe(200)
    const csv = (await alice.req<string>(`/api/boards/${boardId}/export?format=csv`)).data
    const res = await alice.req<ImportResult>('/api/boards/import', { method: 'POST', body: { name: 'CSV copy', teamId: null, data: csv } })
    expect(res.status).toBe(200)
    extraBoards.push(res.data.id!)
    const copy = (await alice.req<BoardDetail>(`/api/boards/${res.data.id}`)).data
    const original = (await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data
    // Only columns holding cards appear in a CSV, in board order.
    const titles = copy.columns.map(c => c.title)
    expect(original.columns.map(c => c.title).filter(t => titles.includes(t))).toEqual(titles)
    expect(copy.cards.map(c => c.title).sort()).toEqual(original.cards.map(c => c.title).sort())
    expect(copy.cards.find(c => c.title === 'CSV round trip')).toMatchObject({ priority: 'low', dueDate: '2026-12-24', estimate: 2, assigneeIds: [] })
    expect(res.data.unmatched).toContain(other.email)
  })
})

describe('search', () => {
  it('finds cards by prefix in title, description and comments, only on reachable boards', async () => {
    const word = `wombat${randomUUID().slice(0, 6)}`
    const titled = await newCard(`Feed the ${word}`)
    const described = await newCard('Described card')
    await alice.req(`/api/cards/${described.id}`, { method: 'PATCH', body: { description: `Notes about the ${word} habitat` } })
    const commented = await newCard('Commented card', 'Sprint')
    await alice.req(`/api/cards/${commented.id}/comments`, { method: 'POST', body: { body: `Ask the ${word} keeper` } })
    const archived = await newCard(`Old ${word}`)
    await alice.req(`/api/cards/${archived.id}`, { method: 'PATCH', body: { archived: true } })

    const res = await alice.req<SearchResults>(`/api/search?q=${word.slice(0, 8)}`)
    expect(res.status).toBe(200)
    expect(res.data.cards.map(c => c.id).sort()).toEqual([titled.id, described.id, commented.id].sort())
    // Title matches outrank description and comment matches.
    expect(res.data.cards[0]!.id).toBe(titled.id)
    expect(res.data.cards.find(c => c.id === described.id)).toMatchObject({
      boardId, boardName: 'API test', columnName: 'Backlog', inComment: false, archived: false, snippet: `Notes about the ${word} habitat`,
    })
    expect(res.data.cards.find(c => c.id === commented.id)).toMatchObject({ inComment: true, columnName: 'Sprint', snippet: `Ask the ${word} keeper` })

    const withArchived = await alice.req<SearchResults>(`/api/search?q=${word}&archived=1`)
    expect(withArchived.data.cards.find(c => c.id === archived.id)?.archived).toBe(true)

    expect((await outsider.req<SearchResults>(`/api/search?q=${word}`)).data.cards).toEqual([])
  })

  it('finds boards and columns, and ignores queries without words', async () => {
    const res = await alice.req<SearchResults>('/api/search?q=api%20tes')
    expect(res.data.boards.map(b => b.id)).toContain(boardId)
    const cols = await alice.req<SearchResults>('/api/search?q=in%20prog')
    expect(cols.data.columns.find(c => c.boardId === boardId)).toMatchObject({ title: 'In progress', boardName: 'API test' })
    expect((await outsider.req<SearchResults>('/api/search?q=api%20tes')).data.boards.map(b => b.id)).not.toContain(boardId)
    expect((await alice.req<SearchResults>('/api/search?q=%20%21%3F')).data).toEqual({ cards: [], boards: [], columns: [] })
    expect((await alice.req(`/api/search?q=${'x'.repeat(201)}`)).status).toBe(400)
  })
})

describe('stars, archive, activity and teams', () => {
  // The realtime tests removed Bob from the main board.
  beforeAll(async () => {
    expect((await alice.req(`/api/boards/${boardId}/members`, { method: 'POST', body: { email: bob.email, role: 'editor' } })).status).toBe(200)
  })

  it('suggests people the caller shares a board with, never the caller or strangers', async () => {
    const all = (await alice.req<Person[]>('/api/people')).data
    expect(all.map(p => p.email)).toContain(bob.email)
    expect(all.map(p => p.email)).not.toContain(alice.email)
    expect(all.map(p => p.email)).not.toContain(outsider.email)
    const byName = (await alice.req<Person[]>('/api/people?q=bo')).data
    expect(byName.find(p => p.email === bob.email)).toMatchObject({ name: 'Bob', avatarUrl: null })
    expect((await alice.req<Person[]>(`/api/people?q=${encodeURIComponent(outsider.email)}`)).data).toEqual([])
    // LIKE wildcards are matched literally.
    expect((await alice.req<Person[]>('/api/people?q=%25')).data).toEqual([])
    expect((await outsider.req<Person[]>(`/api/people?q=${encodeURIComponent(bob.email)}`)).data).toEqual([])
  })

  it('stars and unstars a board for the caller only', async () => {
    expect((await bob.req(`/api/boards/${boardId}/star`, { method: 'PUT' })).status).toBe(200)
    expect((await bob.req(`/api/boards/${boardId}/star`, { method: 'PUT' })).status).toBe(200)
    expect((await bob.req<BoardSummary[]>('/api/boards')).data.find(b => b.id === boardId)?.starred).toBe(true)
    expect((await bob.req<BoardDetail>(`/api/boards/${boardId}`)).data.starred).toBe(true)
    expect((await alice.req<BoardSummary[]>('/api/boards')).data.find(b => b.id === boardId)?.starred).toBe(false)
    expect((await outsider.req(`/api/boards/${boardId}/star`, { method: 'PUT' })).status).toBe(404)
    expect((await bob.req(`/api/boards/${boardId}/star`, { method: 'DELETE' })).status).toBe(200)
    expect((await bob.req<BoardSummary[]>('/api/boards')).data.find(b => b.id === boardId)?.starred).toBe(false)
  })

  it('archives a board read-only; only owners archive and unarchive', async () => {
    const { data: { id } } = await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'To archive', template: 'basic' } })
    extraBoards.push(id)
    await alice.req(`/api/boards/${id}/members`, { method: 'POST', body: { email: bob.email, role: 'editor' } })
    const columnId = (await alice.req<BoardDetail>(`/api/boards/${id}`)).data.columns[0]!.id

    expect((await bob.req(`/api/boards/${id}/archive`, { method: 'PUT' })).status).toBe(403)
    expect((await outsider.req(`/api/boards/${id}/archive`, { method: 'PUT' })).status).toBe(404)
    const archived = await alice.req<{ archivedAt: string }>(`/api/boards/${id}/archive`, { method: 'PUT' })
    expect(archived.status).toBe(200)
    expect(archived.data.archivedAt).toBeTruthy()
    expect((await bob.req<BoardDetail>(`/api/boards/${id}`)).data.archivedAt).toBe(archived.data.archivedAt)
    expect((await bob.req<BoardSummary[]>('/api/boards')).data.find(b => b.id === id)?.archivedAt).toBe(archived.data.archivedAt)

    for (const u of [alice, bob]) {
      expect((await u.req(`/api/boards/${id}/cards`, { method: 'POST', body: { columnId, title: 'Nope' } })).status).toBe(403)
    }
    expect((await alice.req(`/api/boards/${id}`, { method: 'PATCH', body: { name: 'Renamed' } })).status).toBe(404)

    expect((await bob.req(`/api/boards/${id}/archive`, { method: 'DELETE' })).status).toBe(403)
    expect((await alice.req(`/api/boards/${id}/archive`, { method: 'DELETE' })).data).toEqual({ archivedAt: null })
    expect((await bob.req(`/api/boards/${id}/cards`, { method: 'POST', body: { columnId, title: 'Yes' } })).status).toBe(200)
  })

  it('search leaves out cards of archived boards unless archived=1', async () => {
    const word = `okapi${randomUUID().slice(0, 8)}`
    const { data: { id } } = await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Archived search', template: 'basic' } })
    extraBoards.push(id)
    const columnId = (await alice.req<BoardDetail>(`/api/boards/${id}`)).data.columns[0]!.id
    const card = (await alice.req<Card>(`/api/boards/${id}/cards`, { method: 'POST', body: { columnId, title: `Find ${word}` } })).data
    await alice.req(`/api/boards/${id}/archive`, { method: 'PUT' })
    expect((await alice.req<SearchResults>(`/api/search?q=${word}`)).data.cards).toEqual([])
    const all = await alice.req<SearchResults>(`/api/search?q=${word}&archived=1`)
    expect(all.data.cards.find(c => c.id === card.id)?.archived).toBe(true)
  })

  it('pages through the board activity feed', async () => {
    const card = await newCard('Feed card')
    for (const title of ['Feed 1', 'Feed 2', 'Feed 3']) {
      await alice.req(`/api/cards/${card.id}`, { method: 'PATCH', body: { title } })
    }
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const res: Res<BoardActivityPage> = await bob.req<BoardActivityPage>(`/api/boards/${boardId}/activity?limit=2${cursor ? `&before=${cursor}` : ''}`)
      expect(res.status).toBe(200)
      expect(res.data.items.length).toBeLessThanOrEqual(2)
      seen.push(...res.data.items.map(a => a.id))
      if (pages === 0) {
        expect(res.data.items[0]).toMatchObject({ cardId: card.id, cardTitle: 'Feed 3', kind: 'renamed', actorName: 'Alice' })
      }
      cursor = res.data.nextCursor
      pages++
    } while (cursor && pages < 3)
    expect(pages).toBe(3)
    expect(new Set(seen).size).toBe(seen.length)
    // Same order as one big page.
    const all = (await bob.req<BoardActivityPage>(`/api/boards/${boardId}/activity?limit=6`)).data.items.map(a => a.id)
    expect(seen).toEqual(all)

    expect((await outsider.req(`/api/boards/${boardId}/activity`)).status).toBe(404)
    expect((await bob.req(`/api/boards/${boardId}/activity?before=nonsense`)).status).toBe(400)
  })

  it('gets a team with members and boards', async () => {
    const { data: team } = await alice.req<{ id: string }>('/api/teams', { method: 'POST', body: { name: 'Team page' } })
    await alice.req(`/api/teams/${team.id}/members`, { method: 'POST', body: { email: bob.email, role: 'viewer' } })
    const { data: b } = await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Team board', teamId: team.id } })

    const res = await bob.req<TeamDetail>(`/api/teams/${team.id}`)
    expect(res.status).toBe(200)
    expect(res.data).toMatchObject({ id: team.id, name: 'Team page', role: 'viewer', invites: [] })
    expect(res.data.members.map(m => [m.name, m.role])).toEqual([['Alice', 'owner'], ['Bob', 'viewer']])
    expect(res.data.boards).toMatchObject([{ id: b.id, name: 'Team board', role: 'viewer', starred: false, archivedAt: null }])

    expect((await outsider.req(`/api/teams/${team.id}`)).status).toBe(404)
    expect((await alice.req(`/api/teams/${team.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await bob.req(`/api/teams/${team.id}`)).status).toBe(404)
  })
})

describe('card templates and recurring cards', () => {
  it('saves a card as a template that stays off the board, search and due soon', async () => {
    const word = `tmpl${randomUUID().slice(0, 8)}`
    const card = await newCard(`Report ${word}`)
    const tag = board.tags[0]!.id
    await alice.req(`/api/cards/${card.id}`, { method: 'PATCH', body: { tagIds: [tag], assigneeIds: [userId('Bob')], estimate: 2 } })
    await alice.req(`/api/cards/${card.id}/checklist`, { method: 'POST', body: { text: 'Step' } })
    const { status, data: tpl } = await alice.req<Card>(`/api/cards/${card.id}/template`, { method: 'POST', body: { withAssignees: true } })
    expect(status).toBe(200)
    expect(tpl).toMatchObject({ title: `Report ${word}`, tagIds: [tag], assigneeIds: [userId('Bob')], estimate: 2, checklist: { done: 0, total: 1 } })
    // Without a body the assignees are left out.
    const bare = (await alice.req<Card>(`/api/cards/${card.id}/template`, { method: 'POST' })).data
    expect(bare.assigneeIds).toEqual([])

    const detail = (await bob.req<BoardDetail>(`/api/boards/${boardId}`)).data
    expect(detail.templates.map(t => t.id)).toEqual(expect.arrayContaining([tpl.id, bare.id]))
    expect(detail.cards.some(c => c.id === tpl.id)).toBe(false)
    const hits = (await alice.req<SearchResults>(`/api/search?q=${word}`)).data.cards.map(c => c.id)
    expect(hits).toEqual([card.id])

    // Templates are edited through the card routes; a due date on one is not "due soon".
    const today = new Date().toISOString().slice(0, 10)
    const patched = await alice.req<Card>(`/api/cards/${tpl.id}`, { method: 'PATCH', body: { title: 'Weekly report', dueDate: today } })
    expect(patched.data.title).toBe('Weekly report')
    const inbox = (await bob.req<Inbox>('/api/notifications')).data
    expect(inbox.dueSoon.some(d => d.cardId === tpl.id)).toBe(false)
    expect(inbox.items.some(n => n.cardId === tpl.id)).toBe(false)
    await alice.req(`/api/cards/${bare.id}`, { method: 'DELETE' })
  })

  it('creates cards from a template; only templates of the board', async () => {
    const src = await newCard('Checklist source')
    await alice.req(`/api/cards/${src.id}/checklist`, { method: 'POST', body: { text: 'One' } })
    const tpl = (await alice.req<Card>(`/api/cards/${src.id}/template`, { method: 'POST', body: {} })).data
    const target = board.columns[1]!
    const { status, data: card } = await bob.req<Card>(`/api/boards/${boardId}/cards`, { method: 'POST', body: { columnId: target.id, templateId: tpl.id } })
    expect(status).toBe(200)
    expect(card).toMatchObject({ title: 'Checklist source', columnId: target.id, checklist: { done: 0, total: 1 } })
    const named = await bob.req<Card>(`/api/boards/${boardId}/cards`, { method: 'POST', body: { columnId: target.id, templateId: tpl.id, title: 'Renamed' } })
    expect(named.data.title).toBe('Renamed')
    expect((await bob.req<BoardDetail>(`/api/boards/${boardId}`)).data.cards.map(c => c.id)).toEqual(expect.arrayContaining([card.id, named.data.id]))
    // Normal cards are not templates; outsiders cannot use them; a title or template is required.
    expect((await bob.req(`/api/boards/${boardId}/cards`, { method: 'POST', body: { columnId: target.id, templateId: src.id } })).status).toBe(400)
    expect((await outsider.req(`/api/boards/${boardId}/cards`, { method: 'POST', body: { columnId: target.id, templateId: tpl.id } })).status).toBe(404)
    expect((await bob.req(`/api/boards/${boardId}/cards`, { method: 'POST', body: { columnId: target.id } })).status).toBe(400)
  })

  it('schedules a template; editors manage, outsiders cannot', async () => {
    const tpl = (await alice.req<Card>(`/api/cards/${(await newCard('Standup notes')).id}/template`, { method: 'POST', body: {} })).data
    const target = board.columns[0]!
    const body = { columnId: target.id, rule: 'weekly', interval: 1, weekdays: [5, 1, 1], dueInDays: 1 }
    const { status, data: rec } = await bob.req<CardRecurrence>(`/api/cards/${tpl.id}/recurrence`, { method: 'PUT', body })
    expect(status).toBe(200)
    expect(rec).toMatchObject({ templateId: tpl.id, columnId: target.id, rule: 'weekly', weekdays: [1, 5], dayOfMonth: null, dueInDays: 1, active: true })
    expect(Date.parse(rec.nextRunAt)).toBeGreaterThan(Date.now() - 8 * 86_400_000)
    expect((await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data.recurrences.find(r => r.templateId === tpl.id)?.id).toBe(rec.id)

    // Replacing keeps one schedule per template.
    const monthly = await alice.req<CardRecurrence>(`/api/cards/${tpl.id}/recurrence`, { method: 'PUT', body: { columnId: target.id, rule: 'monthly', dayOfMonth: 31 } })
    expect(monthly.data).toMatchObject({ id: rec.id, rule: 'monthly', dayOfMonth: 31, weekdays: null })
    expect((await alice.req(`/api/cards/${tpl.id}/recurrence`, { method: 'PUT', body: { columnId: target.id, rule: 'weekly' } })).status).toBe(400)
    expect((await outsider.req(`/api/cards/${tpl.id}/recurrence`, { method: 'PUT', body })).status).toBe(404)
    // Normal cards cannot repeat.
    const plain = await newCard('Not a template')
    expect((await alice.req(`/api/cards/${plain.id}/recurrence`, { method: 'PUT', body })).status).toBe(400)

    expect((await bob.req(`/api/cards/${tpl.id}/recurrence`, { method: 'DELETE' })).status).toBe(200)
    expect((await bob.req(`/api/cards/${tpl.id}/recurrence`, { method: 'DELETE' })).status).toBe(404)
    expect((await alice.req(`/api/cards/${tpl.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data.templates.some(t => t.id === tpl.id)).toBe(false)
  })
})

describe('board views', () => {
  it('renders the board page in each view (server-side)', async () => {
    const card = await newCard('Viewed card')
    // Dated today, so the calendar's current month shows it.
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    await alice.req(`/api/cards/${card.id}`, { method: 'PATCH', body: { startDate: today, dueDate: today, priority: 'high' } })
    for (const view of ['board', 'list', 'calendar', 'timeline']) {
      const { status, data } = await bob.req<string>(`/boards/${boardId}?view=${view}`)
      expect(status, view).toBe(200)
      expect(data, view).toContain('Viewed card')
    }
  })
})

describe('two-factor authentication', () => {
  async function enable(user: Awaited<ReturnType<typeof signUp>>) {
    const setup = await user.req<{ secret: string, qr: string, uri: string }>('/api/account/two-factor/setup', { method: 'POST' })
    expect(setup.status).toBe(200)
    expect(setup.data.qr).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(setup.data.uri).toContain(`secret=${setup.data.secret}`)
    // Nothing is on until a code confirms it.
    expect((await user.req<Account>('/api/account')).data.twoFactorEnabled).toBe(false)
    return setup.data.secret
  }

  it('asks for a code after the password; codes and recovery codes work once; reset and links do not skip it', async () => {
    const user = await signUp('Twofa')
    const other = anon()
    expect((await other('/api/auth/login', { email: user.email, password: 'password123' })).status).toBe(200)
    const secret = await enable(user)
    const on = await user.req<{ recoveryCodes: string[] }>('/api/account/two-factor/enable', { method: 'POST', body: { code: await totp(secret, -1) } })
    expect(on.status).toBe(200)
    const codes = on.data.recoveryCodes
    expect(codes).toHaveLength(10)
    // This session is renewed; the other one, which never passed two-factor, is signed out.
    expect((await user.req('/api/boards')).status).toBe(200)
    expect((await other('/api/boards')).status).toBe(401)
    expect((await user.req<Account>('/api/account')).data).toMatchObject({ twoFactorEnabled: true, recoveryCodesLeft: 10 })
    expect((await user.req('/api/account/two-factor/setup', { method: 'POST' })).status).toBe(409)

    const http = anon()
    const login = await http('/api/auth/login', { email: user.email, password: 'password123' })
    expect(login.data).toEqual({ twoFactor: true })
    expect((await http('/api/boards')).status).toBe(401)
    expect((await http('/api/auth/two-factor')).data).toEqual({ pending: true })
    expect((await http('/api/auth/two-factor', { code: 'nope' })).status).toBe(400)
    const code = await totp(secret)
    const done = await http('/api/auth/two-factor', { code })
    expect(done.status).toBe(200)
    expect(done.data.user.email).toBe(user.email)
    expect((await http('/api/boards')).status).toBe(200)

    // The same code is refused in another sign-in; a recovery code works, once.
    const second = anon()
    await second('/api/auth/login', { email: user.email, password: 'password123' })
    expect((await second('/api/auth/two-factor', { code })).status).toBe(400)
    const recovered = await second('/api/auth/two-factor', { code: codes[0]!.toUpperCase() })
    expect(recovered.status).toBe(200)
    expect(recovered.data.recoveryCodesLeft).toBe(9)
    const third = anon()
    await third('/api/auth/login', { email: user.email, password: 'password123' })
    expect((await third('/api/auth/two-factor', { code: codes[0] })).status).toBe(400)
    // Without a pending sign-in there is nothing to finish.
    const fresh = anon()
    expect((await fresh('/api/auth/two-factor')).data).toEqual({ pending: false })
    expect((await fresh('/api/auth/two-factor', { code: codes[1] })).status).toBe(401)

    // An emailed sign-in link still asks for the second factor.
    const link = anon()
    expect((await link(`/auth/verify?token=${await tokenFor(user.email)}`)).location).toBe('/login/2fa')
    expect((await link('/api/boards')).status).toBe(401)

    // So does a password reset.
    const reset = anon()
    const token = decodeURIComponent(await linkToken('password-reset', user.email))
    const res = await reset('/api/auth/reset-password', { token, password: 'newpass123' })
    expect(res.data).toEqual({ twoFactor: true })
    expect((await reset('/api/boards')).status).toBe(401)
    expect((await reset('/api/auth/two-factor', { code: codes[1] })).status).toBe(200)
    expect((await reset('/api/boards')).status).toBe(200)
  })

  it('regenerates recovery codes with a code from the app and turns off with the password', async () => {
    const user = await signUp('Twofa2')
    const secret = await enable(user)
    expect((await user.req('/api/account/two-factor/enable', { method: 'POST', body: { code: 'abcdef' } })).status).toBe(400)
    const { recoveryCodes: old } = (await user.req<{ recoveryCodes: string[] }>('/api/account/two-factor/enable', { method: 'POST', body: { code: await totp(secret, -1) } })).data

    const regen = (code: string) => user.req<{ recoveryCodes: string[] }>('/api/account/two-factor/recovery-codes', { method: 'POST', body: { code } })
    expect((await regen(old[0]!)).status).toBe(400)
    const fresh = await regen(await totp(secret))
    expect(fresh.status).toBe(200)
    expect(fresh.data.recoveryCodes).not.toContain(old[1])
    const http = anon()
    await http('/api/auth/login', { email: user.email, password: 'password123' })
    expect((await http('/api/auth/two-factor', { code: old[1] })).status).toBe(400)

    const disable = (body: unknown) => user.req('/api/account/two-factor/disable', { method: 'POST', body })
    expect((await disable({ password: 'wrong-password' })).status).toBe(400)
    expect((await disable({ password: 'password123' })).status).toBe(200)
    expect((await user.req<Account>('/api/account')).data).toMatchObject({ twoFactorEnabled: false, recoveryCodesLeft: 0 })
    const login = await anon()('/api/auth/login', { email: user.email, password: 'password123' })
    expect(login.data.email).toBe(user.email)
  })
})

describe('sessions', () => {
  it('lists sessions, revokes one, the others, or this one', async () => {
    const user = await signUp('Sessions')
    const phone = anon()
    await phone('/api/auth/login', { email: user.email, password: 'password123' })
    const list = (await user.req<AccountSession[]>('/api/account/sessions')).data
    expect(list).toHaveLength(2)
    expect(list.filter(s => s.current)).toHaveLength(1)
    expect(list.every(s => s.ip?.startsWith('10.'))).toBe(true)
    const phoneId = list.find(s => !s.current)!.id

    // Not someone else's.
    expect((await alice.req(`/api/account/sessions/${phoneId}`, { method: 'DELETE' })).status).toBe(404)
    expect((await user.req(`/api/account/sessions/${phoneId}`, { method: 'DELETE' })).data).toEqual({ current: false })
    expect((await phone('/api/boards')).status).toBe(401)
    expect((await user.req(`/api/account/sessions/${phoneId}`, { method: 'DELETE' })).status).toBe(404)

    const [laptop, tablet] = [anon(), anon()]
    await laptop('/api/auth/login', { email: user.email, password: 'password123' })
    await tablet('/api/auth/login', { email: user.email, password: 'password123' })
    expect((await user.req('/api/account/sessions/revoke-others', { method: 'POST' })).data).toEqual({ revoked: 2 })
    expect((await laptop('/api/boards')).status).toBe(401)
    expect((await tablet('/api/account')).status).toBe(401)
    expect((await user.req('/api/boards')).status).toBe(200)

    const mine = (await user.req<AccountSession[]>('/api/account/sessions')).data
    expect(mine).toHaveLength(1)
    expect((await user.req(`/api/account/sessions/${mine[0]!.id}`, { method: 'DELETE' })).data).toEqual({ current: true })
    expect((await user.req('/api/boards')).status).toBe(401)
  })

  it('signing out revokes the session row', async () => {
    const user = await signUp('Logout')
    const live = async () => (await authDb`select count(*)::int as n from user_sessions s join users u on u.id = s.user_id
      where u.email = ${user.email} and s.revoked_at is null`)[0]!.n
    expect(await live()).toBe(1)
    expect((await user.req('/api/auth/logout', { method: 'POST' })).status).toBe(200)
    expect(await live()).toBe(0)
  })
})

describe('admin audit log', () => {
  it('admins page through it; others get 403', async () => {
    expect((await alice.req('/api/admin/audit-log')).status).toBe(403)
    expect((await admin.req('/api/admin/audit-log?page=0')).status).toBe(400)
    const page = (await admin.req<AuditLogPage>('/api/admin/audit-log')).data
    expect(page.pageSize).toBe(50)
    expect(page.total).toBeGreaterThan(0)
    const mine = page.entries.filter(e => e.data.actor_email === adminEmail)
    expect(mine.map(e => e.action)).toContain('settings.update')
    expect(mine.map(e => e.action)).toContain('admin.bootstrap')
  })
})

describe('my work', () => {
  it('lists cards the caller is assigned to or watches, across boards', async () => {
    const { data: { id } } = await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'My work', template: 'basic' } })
    extraBoards.push(id)
    await alice.req(`/api/boards/${id}/members`, { method: 'POST', body: { email: bob.email, role: 'editor' } })
    const detail = (await alice.req<BoardDetail>(`/api/boards/${id}`)).data
    const [todo, , done] = detail.columns
    const bobId = detail.members.find(m => m.name === 'Bob')!.userId
    const add = async (title: string, columnId = todo!.id, patch: Record<string, unknown> = { assigneeIds: [bobId] }) => {
      const card = (await alice.req<Card>(`/api/boards/${id}/cards`, { method: 'POST', body: { columnId, title } })).data
      await alice.req(`/api/cards/${card.id}`, { method: 'PATCH', body: patch })
      return card
    }
    const assigned = await add('Assigned', todo!.id, { assigneeIds: [bobId], dueDate: '2026-01-02', priority: 'high' })
    const watched = await add('Watched', todo!.id, {})
    await bob.req(`/api/cards/${watched.id}/watch`, { method: 'PUT' })
    const finished = await add('Finished', done!.id)
    await add('Archived', todo!.id, { assigneeIds: [bobId], archived: true })
    await add('Not mine', todo!.id, {})
    await alice.req(`/api/cards/${assigned.id}/template`, { method: 'POST', body: { withAssignees: true } })

    const mine = async (u: typeof bob) => {
      const res = await u.req<MyWork>('/api/my-work')
      expect(res.status).toBe(200)
      return res.data.cards.filter(c => c.boardId === id)
    }
    const cards = await mine(bob)
    expect(cards.map(c => c.title)).toEqual(['Assigned', 'Watched', 'Finished'])
    expect(cards[0]).toEqual({
      id: assigned.id, title: 'Assigned', boardId: id, boardName: 'My work', columnId: todo!.id, columnTitle: 'To do',
      startDate: null, dueDate: '2026-01-02', priority: 'high', estimate: null, assigned: true, watching: false, done: false,
    })
    expect(cards.find(c => c.id === finished.id)).toMatchObject({ done: true, columnTitle: 'Done' })
    expect(cards.find(c => c.id === watched.id)).toMatchObject({ assigned: false, watching: true })
    // Alice watches the cards she created; the outsider sees nothing of the board.
    expect((await mine(alice)).map(c => c.title).sort()).toEqual(['Assigned', 'Finished', 'Not mine', 'Watched'])
    expect(await mine(outsider)).toEqual([])

    // Archived boards drop out.
    await alice.req(`/api/boards/${id}/archive`, { method: 'PUT' })
    expect(await mine(bob)).toEqual([])
  })
})

describe('pwa', () => {
  it('serves the web app manifest, the service worker and links them', async () => {
    const manifest = await fetch('/manifest.webmanifest')
    expect(manifest.status).toBe(200)
    expect(manifest.headers.get('content-type')).toContain('manifest+json')
    const m = await manifest.json() as { name: string, display: string, start_url: string, icons: { src: string, purpose?: string }[] }
    expect(m).toMatchObject({ name: 'Kanso', display: 'standalone', start_url: '/' })
    expect(m.icons.some(i => i.purpose === 'maskable')).toBe(true)
    for (const icon of m.icons) expect((await fetch(icon.src)).status).toBe(200)

    const sw = await fetch('/sw.js')
    expect(sw.status).toBe(200)
    const source = await sw.text()
    // Per-user runtime caches (cleared by app/plugins/cacheOwner.client.ts); no SSE or auth routes.
    expect(source).toContain('kanso-api')
    expect(source).toContain('kanso-pages')
    expect(source).not.toContain('events')

    const page = await (await fetch('/login')).text()
    expect(page).toContain('rel="manifest" href="/manifest.webmanifest"')
    expect(page).toContain('apple-touch-icon')
  })
})
