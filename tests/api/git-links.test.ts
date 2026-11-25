// HTTP API tests for importing GitHub issues into a column. A local fake
// GitHub API (NUXT_GITHUB_API_URL, reached through NUXT_WEBHOOK_ALLOW_PRIVATE)
// serves the issues. Builds and starts the app like boards.test.ts.
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { url } from '@nuxt/test-utils/e2e'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { BoardDetail } from '#shared/types/board'
import type { InstanceSettings } from '#shared/types/admin'
import type { BoardGitLink, GitSyncResult } from '#shared/types/gitLinks'
import { signEmailToken } from '../../server/utils/emailToken'
import { setupApi } from './server'

// ---------------------------------------------------------------- fake GitHub

const TOKEN = 'github_pat_good'
type FakeIssue = { number: number, state: 'open' | 'closed', title: string, body?: string, labels?: string[], pr?: boolean, updated: number }
const fake = {
  issues: new Map<string, FakeIssue[]>(),
  requests: [] as { path: string, query: URLSearchParams, auth: string | undefined }[],
}

const github = createServer((req, res) => {
  const [path = '', query = ''] = req.url!.split('?')
  const q = new URLSearchParams(query)
  fake.requests.push({ path, query: q, auth: req.headers.authorization })
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const m = /^\/repos\/([^/]+\/[^/]+)\/issues$/.exec(path)
  if (req.headers.authorization && req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: 'Bad credentials' })
  const list = m && fake.issues.get(m[1]!)
  if (!list || (m![1] === 'acme/private' && !req.headers.authorization)) return send(404, { message: 'Not Found' })
  const state = q.get('state') ?? 'open'
  const label = q.get('labels')
  const since = q.get('since') ? Date.parse(q.get('since')!) : null
  const page = Number(q.get('page') ?? 1)
  const per = Number(q.get('per_page') ?? 30)
  const hits = list.filter(i => (state === 'all' || i.state === state) && (!label || i.labels?.includes(label)) && (since === null || i.updated >= since))
  send(200, hits.slice((page - 1) * per, page * per).map(i => ({
    number: i.number,
    state: i.state,
    title: i.title,
    body: i.body ?? null,
    html_url: `https://github.com/${m![1]}/${i.pr ? 'pull' : 'issues'}/${i.number}`,
    user: { login: 'octo' },
    labels: (i.labels ?? []).map(name => ({ name })),
    ...(i.pr && { pull_request: { url: 'x' } }),
  })))
})
await new Promise<void>(r => github.listen(0, '127.0.0.1', r))
const githubUrl = `http://127.0.0.1:${(github.address() as AddressInfo).port}`

const adminEmail = `admin-${randomUUID()}@git.test`
await setupApi({ NUXT_ADMIN_EMAIL: adminEmail, NUXT_MAIL_SMTP_URL: '', NUXT_MAIL_LOG_LINKS: 'true', NUXT_WEBHOOK_ALLOW_PRIVATE: 'true', NUXT_GITHUB_API_URL: githubUrl })

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

async function signUp(name: string, email = `${name.toLowerCase()}-${randomUUID()}@git.test`) {
  const ip = randomIp()
  expect((await call('/api/auth/register', { method: 'POST', body: { name, email, password: 'password123' }, ip })).status).toBe(200)
  const [u] = await authDb`select id from users where email = ${email}`
  const verify = await globalThis.fetch(`${base}/auth/verify?token=${signEmailToken(u!.id, email, process.env.NUXT_SESSION_PASSWORD!)}`, { redirect: 'manual', headers: { 'x-forwarded-for': ip } })
  const cookie = verify.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const req = <T = any>(path: string, init: { method?: string, body?: unknown } = {}) => call<T>(path, { ...init, cookie, ip })
  return { req, email, id: u!.id as string }
}

let admin: Awaited<ReturnType<typeof signUp>>
let savedSettings: InstanceSettings
let alice: Awaited<ReturnType<typeof signUp>>
let bob: Awaited<ReturnType<typeof signUp>>
let boardId = ''
let otherBoardId = ''
let inbox = ''
let done = ''
let bugTag = ''

beforeAll(async () => {
  admin = await signUp('Admin', adminEmail)
  savedSettings = (await admin.req<InstanceSettings>('/api/admin/settings')).data
  expect((await admin.req('/api/admin/settings', { method: 'PUT', body: { ...savedSettings, signupMode: 'open' } })).status).toBe(200)
  ;[alice, bob] = await Promise.all([signUp('Alice'), signUp('Bob')])
  boardId = (await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Git board', template: 'basic' } })).data.id
  otherBoardId = (await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Other', template: 'basic' } })).data.id
  expect((await alice.req(`/api/boards/${boardId}/members`, { method: 'POST', body: { email: bob.email, role: 'editor' } })).status).toBe(200)
  const board = (await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data
  inbox = board.columns[0]!.id
  done = board.columns.at(-1)!.id
  bugTag = (await alice.req<{ id: string }>(`/api/boards/${boardId}/tags`, { method: 'POST', body: { name: 'Bug', color: '#ff0000' } })).data.id
})

afterAll(async () => {
  for (const id of [boardId, otherBoardId]) if (id) await alice?.req(`/api/boards/${id}`, { method: 'DELETE' })
  await admin?.req('/api/admin/settings', { method: 'PUT', body: savedSettings })
  await new Promise(r => github.close(r))
  await Promise.all([authDb.end(), ownerDb.end()])
})

beforeEach(() => { fake.requests.length = 0 })

const link = (who: typeof alice, body: Record<string, unknown>) =>
  who.req<BoardGitLink>(`/api/boards/${boardId}/git-links`, { method: 'POST', body: { columnId: inbox, ...body } })
const sync = (who: typeof alice, id: string) => who.req<GitSyncResult>(`/api/git-links/${id}/sync`, { method: 'POST' })
const cards = async () => (await alice.req<BoardDetail>(`/api/boards/${boardId}`)).data.cards

describe('linking a GitHub repository', () => {
  it('is for owners only', async () => {
    expect((await link(bob, { repo: 'acme/widgets' })).status).toBe(403)
    const created = await link(alice, { repo: 'acme/widgets' })
    expect(created.status).toBe(200)
    expect((await bob.req(`/api/boards/${boardId}/git-links`)).data).toEqual([])
    expect((await bob.req(`/api/git-links/${created.data.id}`, { method: 'PATCH', body: { active: false } })).status).toBe(404)
    expect((await sync(bob, created.data.id)).status).toBe(404)
    expect((await bob.req(`/api/git-links/${created.data.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await alice.req(`/api/git-links/${created.data.id}`, { method: 'DELETE' })).status).toBe(200)
  })

  it('checks the repository and the column', async () => {
    expect((await link(alice, { repo: 'not a repo' })).status).toBe(400)
    const other = (await alice.req<BoardDetail>(`/api/boards/${otherBoardId}`)).data.columns[0]!.id
    expect((await link(alice, { repo: 'acme/widgets', columnId: other })).status).toBe(400)
    expect((await link(alice, { repo: 'acme/widgets', closeAction: 'close' })).status).toBe(400)
  })

  it('stores the token sealed and never returns it', async () => {
    const res = await link(alice, { repo: 'https://github.com/Acme/Private.git', token: TOKEN })
    expect(res.data).toMatchObject({ repo: 'acme/private', hasToken: true, label: null, closeAction: 'none', active: true })
    expect(JSON.stringify(res.data)).not.toContain(TOKEN)
    const [row] = await ownerDb`select token from board_git_links where id = ${res.data.id}`
    expect(row!.token).toMatch(/^v1\./)
    expect(row!.token).not.toContain(TOKEN)
    const cleared = await alice.req<BoardGitLink>(`/api/git-links/${res.data.id}`, { method: 'PATCH', body: { token: null } })
    expect(cleared.data.hasToken).toBe(false)
    await alice.req(`/api/git-links/${res.data.id}`, { method: 'DELETE' })
  })
})

describe('importing issues', () => {
  it('adds open issues (not pull requests) as cards once, with matching tags, then marks closed ones complete', async () => {
    const t0 = Date.now() - 60 * 60_000
    fake.issues.set('acme/widgets', [
      { number: 1, state: 'open', title: 'First bug', body: 'It breaks', labels: ['bug', 'ui'], updated: t0 },
      { number: 2, state: 'open', title: 'A pull request', pr: true, updated: t0 },
      { number: 3, state: 'closed', title: 'Old and closed', updated: t0 },
      { number: 4, state: 'open', title: 'Second', updated: t0 },
    ])
    const l = (await link(alice, { repo: 'acme/widgets', closeAction: 'complete', token: TOKEN })).data
    const first = await sync(alice, l.id)
    expect(first.data).toEqual({ imported: 2, completed: 0, error: null })
    expect(fake.requests[0]!.auth).toBe(`Bearer ${TOKEN}`)
    expect(fake.requests[0]!.query.get('state')).toBe('open')
    expect(fake.requests[0]!.query.get('since')).toBeNull()

    let list = (await cards()).filter(c => c.columnId === inbox)
    const bug = list.find(c => c.title === 'First bug')!
    expect(bug.description).toBe('[acme/widgets#1](https://github.com/acme/widgets/issues/1) · @octo\n\nIt breaks')
    expect(bug.tagIds).toEqual([bugTag])
    expect(list.map(c => c.title).slice(-2)).toEqual(['First bug', 'Second'])
    const [activity] = await ownerDb`select actor_id, data from card_activity where card_id = ${bug.id} and kind = 'created'`
    expect(activity).toMatchObject({ actor_id: null, data: { automation: true } })

    // Nothing new: nothing imported again, and only changes since the last sync are fetched.
    fake.requests.length = 0
    const again = await sync(alice, l.id)
    expect(again.data).toEqual({ imported: 0, completed: 0, error: null })
    expect(fake.requests[0]!.query.get('state')).toBe('all')
    expect(fake.requests[0]!.query.get('since')).not.toBeNull()

    // Issue 1 closes, issue 5 opens.
    const now = Date.now()
    fake.issues.get('acme/widgets')![0] = { ...fake.issues.get('acme/widgets')![0]!, state: 'closed', updated: now }
    fake.issues.get('acme/widgets')!.push({ number: 5, state: 'open', title: 'Third', updated: now })
    expect((await sync(alice, l.id)).data).toEqual({ imported: 1, completed: 1, error: null })
    list = await cards()
    expect(list.find(c => c.id === bug.id)!.completedAt).not.toBeNull()
    expect(list.filter(c => c.title === 'Third')).toHaveLength(1)

    // A deleted card's issue does not come back, even when the link starts over.
    expect((await alice.req(`/api/cards/${list.find(c => c.title === 'Second')!.id}`, { method: 'DELETE' })).status).toBe(200)
    await alice.req(`/api/git-links/${l.id}`, { method: 'PATCH', body: { active: false } })
    expect((await sync(alice, l.id)).status).toBe(409)
    await alice.req(`/api/git-links/${l.id}`, { method: 'PATCH', body: { active: true } })
    expect((await sync(alice, l.id)).data).toEqual({ imported: 0, completed: 0, error: null })
    await alice.req(`/api/git-links/${l.id}`, { method: 'DELETE' })
  })

  it('passes the label filter and imports into the chosen column', async () => {
    fake.issues.set('acme/labels', [
      { number: 1, state: 'open', title: 'Tagged', labels: ['kanso'], updated: Date.now() },
      { number: 2, state: 'open', title: 'Untagged', updated: Date.now() },
    ])
    const l = (await link(alice, { repo: 'acme/labels', label: 'kanso', columnId: done })).data
    expect((await sync(alice, l.id)).data.imported).toBe(1)
    expect(fake.requests[0]!.query.get('labels')).toBe('kanso')
    expect(fake.requests[0]!.auth).toBeUndefined()
    expect((await cards()).filter(c => c.columnId === done).map(c => c.title)).toEqual(['Tagged'])
    await alice.req(`/api/git-links/${l.id}`, { method: 'DELETE' })
  })

  it('reports GitHub errors on the link', async () => {
    fake.issues.set('acme/private', [{ number: 1, state: 'open', title: 'Secret', updated: Date.now() }])
    const l = (await link(alice, { repo: 'acme/private' })).data
    const res = await sync(alice, l.id)
    expect(res.data.imported).toBe(0)
    expect(res.data.error).toMatch(/repository not found.*HTTP 404/)
    const after = (await alice.req<BoardGitLink[]>(`/api/boards/${boardId}/git-links`)).data.find(x => x.id === l.id)
    expect(after!.lastError).toBe(res.data.error)
    expect(after!.lastSyncedAt).toBeNull()

    const bad = await alice.req<BoardGitLink>(`/api/git-links/${l.id}`, { method: 'PATCH', body: { token: 'github_pat_wrong' } })
    expect(bad.data.lastError).toBeNull()
    expect((await sync(alice, l.id)).data.error).toMatch(/token is not valid \(HTTP 401\): Bad credentials/)

    await alice.req(`/api/git-links/${l.id}`, { method: 'PATCH', body: { token: TOKEN } })
    expect((await sync(alice, l.id)).data).toEqual({ imported: 1, completed: 0, error: null })
    await alice.req(`/api/git-links/${l.id}`, { method: 'DELETE' })
  })
})
