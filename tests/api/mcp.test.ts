// HTTP API tests for the MCP endpoint (POST /api/mcp): token auth, read-only
// tokens seeing only read tools, and tools acting through the REST routes as
// the token's user. Builds and starts the app like boards.test.ts (from the shared build).
import { randomUUID } from 'node:crypto'
import { url } from '@nuxt/test-utils/e2e'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiToken } from '#shared/types/account'
import type { BoardDetail } from '#shared/types/board'
import type { InstanceSettings } from '#shared/types/admin'
import { signEmailToken } from '../../server/utils/emailToken'
import { setupApi } from './server'

const adminEmail = `admin-${randomUUID()}@mcp.test`
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

async function signUp(name: string, email = `${name.toLowerCase()}-${randomUUID()}@mcp.test`) {
  const ip = randomIp()
  expect((await call('/api/auth/register', { method: 'POST', body: { name, email, password: 'password123' }, ip })).status).toBe(200)
  const [u] = await authDb`select id from users where email = ${email}`
  const verify = await globalThis.fetch(`${base}/auth/verify?token=${signEmailToken(u!.id, email, process.env.NUXT_SESSION_PASSWORD!)}`, { redirect: 'manual', headers: { 'x-forwarded-for': ip } })
  const cookie = verify.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const req = <T = any>(path: string, init: { method?: string, body?: unknown } = {}) => call<T>(path, { ...init, cookie, ip })
  const token = async (scopes: string[]) => (await req<ApiToken & { token: string }>('/api/account/tokens', { method: 'POST', body: { name: 'agent', scopes } })).data.token
  return { req, email, id: u!.id as string, cookie, token }
}

/** One JSON-RPC request to the MCP endpoint (stateless, JSON responses). */
async function mcp(token: string | undefined, method: string, params: Record<string, unknown> = {}, cookie?: string) {
  const res = await globalThis.fetch(`${base}/api/mcp`, {
    method: 'POST',
    headers: {
      'x-forwarded-for': randomIp(),
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
      ...(token !== undefined && { authorization: `Bearer ${token}` }),
      ...(cookie && { cookie }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }
}

async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const { status, body } = await mcp(token, 'tools/call', { name, arguments: args })
  expect(status).toBe(200)
  const text = body.result.content[0].text as string
  return { isError: body.result.isError === true, text, json: () => JSON.parse(text) }
}

let admin: Awaited<ReturnType<typeof signUp>>
let savedSettings: InstanceSettings
let alice: Awaited<ReturnType<typeof signUp>>
let bob: Awaited<ReturnType<typeof signUp>>
let board: BoardDetail
let readToken: string
let writeToken: string

beforeAll(async () => {
  admin = await signUp('Admin', adminEmail)
  savedSettings = (await admin.req<InstanceSettings>('/api/admin/settings')).data
  expect((await admin.req('/api/admin/settings', { method: 'PUT', body: { ...savedSettings, signupMode: 'open' } })).status).toBe(200)
  ;[alice, bob] = await Promise.all([signUp('Alice'), signUp('Bob')])
  const created = await alice.req<{ id: string }>('/api/boards', { method: 'POST', body: { name: 'Agent board', template: 'basic' } })
  board = (await alice.req<BoardDetail>(`/api/boards/${created.data.id}`)).data
  ;[readToken, writeToken] = await Promise.all([alice.token(['read']), alice.token(['read', 'write'])])
})

afterAll(async () => {
  if (board) await alice?.req(`/api/boards/${board.id}`, { method: 'DELETE' })
  await admin?.req('/api/admin/settings', { method: 'PUT', body: savedSettings })
  await ownerDb`delete from admin_audit_log where data->>'actor_email' like '%@mcp.test' or data->>'target_email' like '%@mcp.test'`
  await ownerDb`delete from users where email = ${adminEmail}`
  await Promise.all([authDb.end(), ownerDb.end()])
})

describe('mcp endpoint', () => {
  it('needs an API token: none, a cookie or a bad token get 401', async () => {
    const none = await mcp(undefined, 'tools/list')
    expect(none.status).toBe(401)
    expect(none.headers.get('www-authenticate')).toBe('Bearer')
    expect((await mcp(undefined, 'tools/list', {}, alice.cookie)).status).toBe(401)
    expect((await mcp('kb_nope', 'tools/list')).status).toBe(401)
    expect((await call('/api/mcp', { token: readToken })).status).toBe(405)
  })

  it('initializes and lists only read tools for a read-only token', async () => {
    const init = await mcp(readToken, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    expect(init.status).toBe(200)
    expect(init.body.result.serverInfo.name).toBe('kanso')
    expect(init.body.result.instructions).toContain('get_board')

    const names = (token: string) => mcp(token, 'tools/list').then(r => r.body.result.tools.map((t: { name: string }) => t.name) as string[])
    const readOnly = await names(readToken)
    expect(readOnly).toEqual(expect.arrayContaining(['list_boards', 'get_board', 'get_card', 'search', 'my_work', 'list_notifications']))
    expect(readOnly).not.toContain('create_card')
    expect(await names(writeToken)).toEqual(expect.arrayContaining(['create_card', 'update_card', 'move_card', 'add_comment']))
  })

  it('reads boards and cards as the token user', async () => {
    const boards = (await tool(readToken, 'list_boards')).json()
    expect(boards).toContainEqual(expect.objectContaining({ id: board.id, name: 'Agent board', role: 'owner' }))

    const view = (await tool(readToken, 'get_board', { boardId: board.id })).json()
    expect(view.columns.map((c: { title: string }) => c.title)).toEqual(board.columns.map(c => c.title))
    expect(view.yourRole).toBe('owner')

    // Bob cannot see Alice's board through his own token.
    const bobRead = await bob.token(['read'])
    const denied = await tool(bobRead, 'get_board', { boardId: board.id })
    expect(denied.isError).toBe(true)
    expect(denied.text).toMatch(/^404/)
  })

  it('writes through the REST routes with a write token, and a read token cannot', async () => {
    const [todo, doing] = board.columns
    const card = (await tool(writeToken, 'create_card', { boardId: board.id, columnId: todo!.id, title: 'Written by an agent' })).json()
    expect(card.title).toBe('Written by an agent')

    expect((await tool(writeToken, 'update_card', { cardId: card.id, priority: 'high', dueDate: '2030-01-02' })).isError).toBe(false)
    expect((await tool(writeToken, 'move_card', { cardId: card.id, columnId: doing!.id })).isError).toBe(false)
    expect((await tool(writeToken, 'add_comment', { cardId: card.id, body: 'Looks good' })).isError).toBe(false)
    const item = (await tool(writeToken, 'add_checklist_item', { cardId: card.id, text: 'Check it' })).json()
    expect((await tool(writeToken, 'update_checklist_item', { itemId: item.id, done: true })).isError).toBe(false)

    const detail = (await tool(readToken, 'get_card', { boardId: board.id, cardId: card.id })).json()
    expect(detail).toMatchObject({ title: 'Written by an agent', priority: 'high', dueDate: '2030-01-02', column: doing!.title })
    expect(detail.comments[0]).toMatchObject({ author: 'Alice', body: 'Looks good' })
    expect(detail.checklist).toEqual([{ id: item.id, text: 'Check it', done: true }])
    expect(detail.recentActivity.map((a: { kind: string }) => a.kind)).toEqual(expect.arrayContaining(['created', 'moved', 'commented']))

    // Write tools are not listed for read tokens, and calling one anyway fails.
    const refused = await mcp(readToken, 'tools/call', { name: 'create_card', arguments: { boardId: board.id, columnId: todo!.id, title: 'x' } })
    expect(refused.body.result?.isError ?? refused.body.error).toBeTruthy()

    // Validation errors from the route come back as tool errors.
    const bad = await tool(writeToken, 'update_card', { cardId: card.id, startDate: '2031-01-01' })
    expect(bad.isError).toBe(true)
    expect(bad.text).toMatch(/^400/)
  })
})
