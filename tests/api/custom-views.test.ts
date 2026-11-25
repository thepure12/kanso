// HTTP API tests for custom views (/api/views): personal sets of columns from
// several boards, limited to columns the caller can see.
import { randomUUID } from 'node:crypto'
import { url } from '@nuxt/test-utils/e2e'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { BoardDetail } from '#shared/types/board'
import type { CustomView, CustomViewSummary, ViewColumn } from '#shared/types/customViews'
import type { InstanceSettings } from '#shared/types/admin'
import { signEmailToken } from '../../server/utils/emailToken'
import { setupApi } from './server'

const adminEmail = `admin-${randomUUID()}@custom-views.test`
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
      ...(init.body !== undefined && !(init.body instanceof FormData) && { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : init.body instanceof FormData ? init.body : JSON.stringify(init.body),
  })
  const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : await res.text()
  return { status: res.status, data: data as T, headers: res.headers }
}

async function signUp(name: string, email = `${name.toLowerCase()}-${randomUUID()}@custom-views.test`) {
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
let boardA: BoardDetail
let boardB: BoardDetail

const newBoard = async (who: typeof alice, name: string) => {
  const created = await who.req<{ id: string }>('/api/boards', { method: 'POST', body: { name, template: 'basic' } })
  return created.data.id
}

beforeAll(async () => {
  admin = await signUp('Admin', adminEmail)
  savedSettings = (await admin.req<InstanceSettings>('/api/admin/settings')).data
  expect((await admin.req('/api/admin/settings', { method: 'PUT', body: { ...savedSettings, signupMode: 'open' } })).status).toBe(200)
  ;[alice, bob] = await Promise.all([signUp('Alice'), signUp('Bob')])
  const a = await newBoard(alice, 'Views A')
  const b = await newBoard(alice, 'Views B')
  await alice.req(`/api/boards/${a}/members`, { method: 'POST', body: { email: bob.email, role: 'viewer' } })
  boardA = (await alice.req<BoardDetail>(`/api/boards/${a}`)).data
  boardB = (await alice.req<BoardDetail>(`/api/boards/${b}`)).data
})

afterAll(async () => {
  for (const b of [boardA, boardB]) if (b) await alice?.req(`/api/boards/${b.id}`, { method: 'DELETE' })
  await admin?.req('/api/admin/settings', { method: 'PUT', body: savedSettings })
  await ownerDb`delete from admin_audit_log where data->>'actor_email' like '%@custom-views.test' or data->>'target_email' like '%@custom-views.test'`
  await ownerDb`delete from users where email = ${adminEmail}`
  await Promise.all([authDb.end(), ownerDb.end()])
})

describe('custom views', () => {
  it('lists the columns one can pick: only visible boards', async () => {
    const mine = (await alice.req<ViewColumn[]>('/api/views/columns')).data
    expect(mine.filter(c => c.boardId === boardA.id).map(c => c.columnId)).toEqual(boardA.columns.map(c => c.id))
    expect(mine.some(c => c.boardId === boardB.id)).toBe(true)
    const bobs = (await bob.req<ViewColumn[]>('/api/views/columns')).data
    expect(bobs.some(c => c.boardId === boardA.id)).toBe(true)
    expect(bobs.some(c => c.boardId === boardB.id)).toBe(false)
  })

  it('creates, reads, edits and deletes a view of columns from two boards', async () => {
    const columnIds = [boardB.columns[0]!.id, boardA.columns[1]!.id]
    const created = await alice.req<CustomView>('/api/views', { method: 'POST', body: { name: 'Across', columnIds } })
    expect(created.status).toBe(200)
    expect(created.data.columns.map(c => c.columnId)).toEqual(columnIds)
    expect(created.data.columns[0]).toMatchObject({ boardId: boardB.id, boardName: 'Views B', title: boardB.columns[0]!.title })

    const list = (await alice.req<CustomViewSummary[]>('/api/views')).data
    expect(list.find(v => v.id === created.data.id)).toMatchObject({ name: 'Across', columnCount: 2, background: null, accent: null })
    // Personal: Bob neither lists nor reads it.
    expect((await bob.req<CustomViewSummary[]>('/api/views')).data.some(v => v.id === created.data.id)).toBe(false)
    expect((await bob.req(`/api/views/${created.data.id}`)).status).toBe(404)
    expect((await bob.req(`/api/views/${created.data.id}`, { method: 'PATCH', body: { name: 'Mine' } })).status).toBe(404)
    expect((await bob.req(`/api/views/${created.data.id}`, { method: 'DELETE' })).status).toBe(404)

    const edited = await alice.req<CustomView>(`/api/views/${created.data.id}`, { method: 'PATCH', body: { name: 'Renamed', columnIds: [columnIds[1], columnIds[0]] } })
    expect(edited.data).toMatchObject({ name: 'Renamed' })
    expect(edited.data.columns.map(c => c.columnId)).toEqual([columnIds[1], columnIds[0]])

    const taken = await alice.req('/api/views', { method: 'POST', body: { name: 'renamed' } })
    expect(taken.status).toBe(409)
    expect(taken.data.data).toMatchObject({ problem: 'nameTaken' })

    expect((await alice.req(`/api/views/${created.data.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await alice.req(`/api/views/${created.data.id}`)).status).toBe(404)
  })

  it('refuses columns the caller cannot see and repeats', async () => {
    expect((await bob.req('/api/views', { method: 'POST', body: { name: 'Sneaky', columnIds: [boardB.columns[0]!.id] } })).status).toBe(400)
    const twice = boardA.columns[0]!.id
    expect((await bob.req('/api/views', { method: 'POST', body: { name: 'Twice', columnIds: [twice, twice] } })).status).toBe(400)
  })

  it('leaves out columns the caller lost access to', async () => {
    const view = (await bob.req<CustomView>('/api/views', { method: 'POST', body: { name: `Lost ${randomUUID().slice(0, 6)}`, columnIds: [boardA.columns[0]!.id] } })).data
    expect(view.columns).toHaveLength(1)
    expect((await alice.req(`/api/boards/${boardA.id}/members/${bob.id}`, { method: 'DELETE' })).status).toBe(200)
    const after = (await bob.req<CustomView>(`/api/views/${view.id}`)).data
    expect(after.columns).toEqual([])
    expect((await bob.req<CustomViewSummary[]>('/api/views')).data.find(v => v.id === view.id)?.columnCount).toBe(0)
  })

  it('sets the look of a view: background, accent, outline, uploaded image', async () => {
    const view = (await alice.req<CustomView>('/api/views', { method: 'POST', body: { name: `Look ${randomUUID().slice(0, 6)}` } })).data
    expect(view).toMatchObject({ background: null, accent: null, columnOutline: null })
    const path = `/api/views/${view.id}`

    const outline = { color: '#ff0000', width: 3, glow: 2 }
    const set = await alice.req<CustomView>(path, { method: 'PATCH', body: { background: { kind: 'color', value: '#0f766e', logo: false }, accent: 'violet', columnOutline: outline } })
    expect(set.status).toBe(200)
    // logo: false is not stored.
    expect(set.data).toMatchObject({ background: { kind: 'color', value: '#0f766e' }, accent: 'violet', columnOutline: outline })
    expect(set.data.background).not.toHaveProperty('logo')
    // The home page list carries the look for the tile.
    expect((await alice.req<CustomViewSummary[]>('/api/views')).data.find(v => v.id === view.id))
      .toMatchObject({ background: { kind: 'color', value: '#0f766e' }, accent: 'violet' })
    // Other fields stay when only one changes.
    expect((await alice.req<CustomView>(path, { method: 'PATCH', body: { accent: null } })).data).toMatchObject({ accent: null, columnOutline: outline })

    for (const body of [{ background: { kind: 'photo', value: 'nowhere' } }, { background: { kind: 'photo', value: 'alps', logo: true } }, { accent: 'mauve' }, { background: { kind: 'upload', value: 'abc' } }]) {
      expect((await alice.req(path, { method: 'PATCH', body })).status).toBe(400)
    }
    expect((await bob.req(path, { method: 'PATCH', body: { accent: 'rose' } })).status).toBe(404)

    const form = () => {
      const f = new FormData()
      f.append('file', new Blob([Buffer.from('89504e470d0a1a0a00', 'hex')], { type: 'image/png' }), 'bg.png')
      return f
    }
    expect((await bob.req(`${path}/background`, { method: 'POST', body: form() })).status).toBe(404)
    const up = await alice.req<{ background: { kind: string, value: string } }>(`${path}/background`, { method: 'POST', body: form() })
    expect(up.status).toBe(200)
    expect(up.data.background.kind).toBe('upload')
    expect((await alice.req<CustomView>(path)).data.background).toEqual(up.data.background)
    const img = await alice.req(`${path}/background?v=${up.data.background.value}`)
    expect(img.status).toBe(200)
    expect(img.headers.get('content-type')).toBe('image/png')
    expect((await bob.req(`${path}/background`)).status).toBe(404)

    const text = new FormData()
    text.append('file', new Blob(['hello'], { type: 'image/png' }), 'x.png')
    expect((await alice.req(`${path}/background`, { method: 'POST', body: text })).status).toBe(400)

    // Clearing drops the image.
    expect((await alice.req<CustomView>(path, { method: 'PATCH', body: { background: null } })).data.background).toBeNull()
    expect((await alice.req(`${path}/background`)).status).toBe(404)
  })

  it('stars and unstars a view of the caller\'s only', async () => {
    const view = (await alice.req<CustomView>('/api/views', { method: 'POST', body: { name: `Star ${randomUUID().slice(0, 6)}` } })).data
    expect(view.starred).toBe(false)
    const path = `/api/views/${view.id}`
    expect((await bob.req(`${path}/star`, { method: 'PUT' })).status).toBe(404)
    expect((await bob.req(`${path}/star`, { method: 'DELETE' })).status).toBe(404)

    expect((await alice.req(`${path}/star`, { method: 'PUT' })).data).toEqual({ starred: true })
    // Idempotent.
    expect((await alice.req(`${path}/star`, { method: 'PUT' })).status).toBe(200)
    expect((await alice.req<CustomView>(path)).data.starred).toBe(true)
    expect((await alice.req<CustomViewSummary[]>('/api/views')).data.find(v => v.id === view.id)?.starred).toBe(true)

    expect((await alice.req(`${path}/star`, { method: 'DELETE' })).data).toEqual({ starred: false })
    expect((await alice.req<CustomView>(path)).data.starred).toBe(false)
  })
})
