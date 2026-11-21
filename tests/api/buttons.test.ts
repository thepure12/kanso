// HTTP API tests for board buttons: management, personal vs shared, and running
// card and board steps as the caller (POST /api/buttons/:id/run).
import { randomUUID } from 'node:crypto'
import { url } from '@nuxt/test-utils/e2e'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiToken } from '#shared/types/account'
import type { BoardButton } from '#shared/buttons'
import type { BoardDetail, Card, CardDetail, Tag } from '#shared/types/board'
import type { InstanceSettings } from '#shared/types/admin'
import { signEmailToken } from '../../server/utils/emailToken'
import { setupApi } from './server'

const adminEmail = `admin-${randomUUID()}@buttons.test`
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
  return { status: res.status, data: data as T, headers: res.headers }
}

async function signUp(name: string, email = `${name.toLowerCase()}-${randomUUID()}@buttons.test`) {
  const ip = randomIp()
  expect((await call('/api/auth/register', { method: 'POST', body: { name, email, password: 'password123' }, ip })).status).toBe(200)
  const [u] = await authDb`select id from users where email = ${email}`
  const verify = await globalThis.fetch(`${base}/auth/verify?token=${signEmailToken(u!.id, email, process.env.NUXT_SESSION_PASSWORD!)}`, { redirect: 'manual', headers: { 'x-forwarded-for': ip } })
  const cookie = verify.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const req = <T = any>(path: string, init: { method?: string, body?: unknown } = {}) => call<T>(path, { ...init, cookie, ip })
  const token = async (scopes: string[]) => (await req<ApiToken & { token: string }>('/api/account/tokens', { method: 'POST', body: { name: 'agent', scopes } })).data.token
  return { req, email, id: u!.id as string, cookie, token }
}

let admin: Awaited<ReturnType<typeof signUp>>
let savedSettings: InstanceSettings
let alice: Awaited<ReturnType<typeof signUp>>
let bob: Awaited<ReturnType<typeof signUp>>
let vera: Awaited<ReturnType<typeof signUp>>
let board: BoardDetail
let tag: Tag

const col = (i: number) => board.columns[i]!.id
const newCard = async (column: number, title = `Card ${randomUUID().slice(0, 6)}`) =>
  (await alice.req<Card>(`/api/boards/${board.id}/cards`, { method: 'POST', body: { columnId: col(column), title } })).data
const getCard = async (id: string) => (await alice.req<CardDetail>(`/api/cards/${id}`)).data
const boardCards = async () => (await alice.req<BoardDetail>(`/api/boards/${board.id}`)).data.cards

beforeAll(async () => {
  admin = await signUp('Admin', adminEmail)
  savedSettings = (await admin.req<InstanceSettings>('/api/admin/settings')).data
  expect((await admin.req('/api/admin/settings', { method: 'PUT', body: { ...savedSettings, signupMode: 'open' } })).status).toBe(200)
  ;[alice, bob, vera] = await Promise.all([signUp('Alice'), signUp('Bob'), signUp('Vera')])
  const created = await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Buttons board', template: 'basic' } })
  await alice.req(`/api/boards/${created.data.id}/members`, { method: 'POST', body: { email: bob.email, role: 'editor' } })
  await alice.req(`/api/boards/${created.data.id}/members`, { method: 'POST', body: { email: vera.email, role: 'viewer' } })
  tag = (await alice.req<Tag>(`/api/boards/${created.data.id}/tags`, { method: 'POST', body: { name: 'Shipped', color: '#00ff00' } })).data
  board = (await alice.req<BoardDetail>(`/api/boards/${created.data.id}`)).data
  expect(board.columns.length).toBeGreaterThanOrEqual(3)
})

afterAll(async () => {
  if (board) await alice?.req(`/api/boards/${board.id}`, { method: 'DELETE' })
  await admin?.req('/api/admin/settings', { method: 'PUT', body: savedSettings })
  await ownerDb`delete from admin_audit_log where data->>'actor_email' like '%@buttons.test' or data->>'target_email' like '%@buttons.test'`
  await ownerDb`delete from users where email = ${adminEmail}`
  await Promise.all([authDb.end(), ownerDb.end()])
})

describe('board buttons', () => {
  it('creates, lists, edits and deletes buttons; personal ones stay personal', async () => {
    const shared = await alice.req<BoardButton>(`/api/boards/${board.id}/buttons`, { method: 'POST', body: { scope: 'card', name: 'Ship', shared: true, color: 'success', icon: 'i-lucide-rocket', steps: [{ kind: 'archive' }] } })
    expect(shared.status).toBe(200)
    expect(shared.data).toMatchObject({ scope: 'card', name: 'Ship', shared: true, color: 'success', icon: 'i-lucide-rocket' })
    const mine = await vera.req<BoardButton>(`/api/boards/${board.id}/buttons`, { method: 'POST', body: { scope: 'card', name: 'Watch it', steps: [{ kind: 'watch' }] } })
    expect(mine.status).toBe(200)
    expect(mine.data.shared).toBe(false)

    expect((await vera.req(`/api/boards/${board.id}/buttons`, { method: 'POST', body: { scope: 'card', name: 'Nope', shared: true, steps: [{ kind: 'archive' }] } })).status).toBe(403)
    expect((await alice.req(`/api/boards/${board.id}/buttons`, { method: 'POST', body: { scope: 'card', name: 'ship', shared: true, steps: [{ kind: 'archive' }] } })).status).toBe(409)
    // Board steps on a card button and vice versa are refused.
    expect((await alice.req(`/api/boards/${board.id}/buttons`, { method: 'POST', body: { scope: 'card', name: 'Bad', steps: [{ kind: 'archiveColumn', columnId: col(0) }] } })).status).toBe(400)
    expect((await alice.req(`/api/buttons/${shared.data.id}`, { method: 'PATCH', body: { steps: [{ kind: 'sortColumn', columnId: col(0), by: 'title' }] } })).status).toBe(400)

    const veraBoard = (await vera.req<BoardDetail>(`/api/boards/${board.id}`)).data
    expect(veraBoard.buttons.map(b => b.name)).toEqual(['Ship', 'Watch it'])
    expect((await alice.req<BoardDetail>(`/api/boards/${board.id}`)).data.buttons.map(b => b.name)).toEqual(['Ship'])

    const renamed = await alice.req<BoardButton>(`/api/buttons/${shared.data.id}`, { method: 'PATCH', body: { name: 'Ship it', steps: [{ kind: 'setPriority', priority: 'high' }] } })
    expect(renamed.data).toMatchObject({ name: 'Ship it', steps: [{ kind: 'setPriority', priority: 'high' }] })
    expect((await vera.req(`/api/buttons/${shared.data.id}`, { method: 'PATCH', body: { name: 'Mine now' } })).status).toBe(404)
    expect((await alice.req(`/api/buttons/${mine.data.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await vera.req(`/api/buttons/${mine.data.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await alice.req(`/api/buttons/${shared.data.id}`, { method: 'DELETE' })).status).toBe(200)
  })

  it('runs card steps in order as the caller', async () => {
    const card = await newCard(0)
    const button = (await alice.req<BoardButton>(`/api/boards/${board.id}/buttons`, { method: 'POST', body: {
      scope: 'card', name: 'Start work', shared: true, steps: [
        { kind: 'move', columnId: col(1) },
        { kind: 'addTag', tagId: tag.id },
        { kind: 'assignMe' },
        { kind: 'assign', userId: alice.id },
        { kind: 'setDue', inDays: 3 },
        { kind: 'setPriority', priority: 'urgent' },
        { kind: 'addChecklist', items: ['Write', 'Test'] },
        { kind: 'watch' },
      ],
    } })).data
    const run = await bob.req(`/api/buttons/${button.id}/run`, { method: 'POST', body: { cardId: card.id } })
    expect(run.status).toBe(200)
    expect(run.data).toEqual({ skipped: 0 })
    const detail = await getCard(card.id)
    const now = (await boardCards()).find(c => c.id === card.id)!
    expect(now.columnId).toBe(col(1))
    expect(now.tagIds).toEqual([tag.id])
    expect(new Set(now.assigneeIds)).toEqual(new Set([bob.id, alice.id]))
    expect(now.priority).toBe('urgent')
    const due = new Date(); due.setDate(due.getDate() + 3)
    expect(now.dueDate).toBe(`${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`)
    expect(detail.checklist.map(i => i.text)).toEqual(['Write', 'Test'])
    expect(detail.watchers.map(w => w.userId)).toContain(bob.id)

    // Remove the tag, unassign me, clear the due date, then archive.
    const undo = (await alice.req<BoardButton>(`/api/boards/${board.id}/buttons`, { method: 'POST', body: {
      scope: 'card', name: 'Wrap up', steps: [{ kind: 'removeTag', tagId: tag.id }, { kind: 'unassignMe' }, { kind: 'setDue', inDays: null }, { kind: 'archive' }],
    } })).data
    expect((await alice.req(`/api/buttons/${undo.id}/run`, { method: 'POST', body: { cardId: card.id } })).data).toEqual({ skipped: 0 })
    expect((await boardCards()).some(c => c.id === card.id)).toBe(false)
  })

  it('skips steps whose column, tag or person is gone', async () => {
    const card = await newCard(0)
    const extraTag = (await alice.req<Tag>(`/api/boards/${board.id}/tags`, { method: 'POST', body: { name: 'Temp', color: '#0000ff' } })).data
    const button = (await alice.req<BoardButton>(`/api/boards/${board.id}/buttons`, { method: 'POST', body: {
      scope: 'card', name: 'Stale refs', steps: [{ kind: 'addTag', tagId: extraTag.id }, { kind: 'assign', userId: randomUUID() }, { kind: 'move', columnId: randomUUID() }, { kind: 'setPriority', priority: 'low' }],
    } })).data
    await alice.req(`/api/tags/${extraTag.id}`, { method: 'DELETE' })
    expect((await alice.req(`/api/buttons/${button.id}/run`, { method: 'POST', body: { cardId: card.id } })).data).toEqual({ skipped: 3 })
    expect((await boardCards()).find(c => c.id === card.id)!.priority).toBe('low')
  })

  it('a refused step changes nothing; viewers cannot run on cards; card buttons need a card of the board', async () => {
    const card = await newCard(0)
    const button = (await alice.req<BoardButton>(`/api/boards/${board.id}/buttons`, { method: 'POST', body: {
      scope: 'card', name: 'Shared run', shared: true, steps: [{ kind: 'setPriority', priority: 'high' }, { kind: 'assign', userId: alice.id }] } })).data
    expect((await vera.req(`/api/buttons/${button.id}/run`, { method: 'POST', body: { cardId: card.id } })).status).toBe(404)
    expect((await alice.req(`/api/buttons/${button.id}/run`, { method: 'POST', body: {} })).status).toBe(400)
    const other = await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Other', template: 'basic' } })
    try {
      const otherBoard = (await alice.req<BoardDetail>(`/api/boards/${other.data.id}`)).data
      const foreign = (await alice.req<Card>(`/api/boards/${otherBoard.id}/cards`, { method: 'POST', body: { columnId: otherBoard.columns[0]!.id, title: 'x' } })).data
      expect((await alice.req(`/api/buttons/${button.id}/run`, { method: 'POST', body: { cardId: foreign.id } })).status).toBe(404)
    }
    finally {
      await alice.req(`/api/boards/${other.data.id}`, { method: 'DELETE' })
    }
    expect((await boardCards()).find(c => c.id === card.id)!.priority).toBeNull()
  })

  it('runs board steps: sort, move all cards, archive a column', async () => {
    const [c, a, b] = [await newCard(2, 'c'), await newCard(2, 'a'), await newCard(2, 'b')]
    const sort = (await alice.req<BoardButton>(`/api/boards/${board.id}/buttons`, { method: 'POST', body: {
      scope: 'board', name: 'Sort', shared: true, steps: [{ kind: 'sortColumn', columnId: col(2), by: 'title' }] } })).data
    expect((await bob.req(`/api/buttons/${sort.id}/run`, { method: 'POST', body: {} })).data).toEqual({ skipped: 0 })
    const order = (await boardCards()).filter(x => x.columnId === col(2)).sort((x, y) => x.position - y.position).map(x => x.id)
    expect(order).toEqual([a.id, b.id, c.id])

    // A viewer is refused once there is a card to touch.
    expect((await vera.req(`/api/buttons/${sort.id}/run`, { method: 'POST', body: {} })).status).toBe(403)

    const clear = (await alice.req<BoardButton>(`/api/boards/${board.id}/buttons`, { method: 'POST', body: {
      scope: 'board', name: 'Clear', shared: true, steps: [{ kind: 'moveColumnCards', from: col(2), to: col(0) }, { kind: 'archiveColumn', columnId: col(0) }] } })).data
    expect((await bob.req(`/api/buttons/${clear.id}/run`, { method: 'POST', body: {} })).data).toEqual({ skipped: 0 })
    const left = await boardCards()
    expect(left.filter(x => x.columnId === col(2) || x.columnId === col(0))).toEqual([])
  })

  it('runs with a write API token', async () => {
    const card = await newCard(0)
    const button = (await alice.req<BoardButton>(`/api/boards/${board.id}/buttons`, { method: 'POST', body: {
      scope: 'card', name: 'Token run', steps: [{ kind: 'setPriority', priority: 'medium' }] } })).data
    const token = await alice.token(['read', 'write'])
    const res = await call(`/api/buttons/${button.id}/run`, { method: 'POST', body: { cardId: card.id }, token })
    expect(res.status).toBe(200)
    expect((await boardCards()).find(c => c.id === card.id)!.priority).toBe('medium')
  })
})
