// HTTP API tests for the MCP endpoint (POST /api/mcp): token auth, read-only
// tokens seeing only read tools, and tools acting through the REST routes as
// the token's user. Builds and starts the app like boards.test.ts (from the shared build).
import { createHash, randomBytes, randomUUID } from 'node:crypto'
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
const appDb = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })

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
  await Promise.all([authDb.end(), ownerDb.end(), appDb.end()])
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
    const later = (await tool(writeToken, 'create_checklist', { cardId: card.id, name: 'Later' })).json()
    const laterItem = (await tool(writeToken, 'add_checklist_item', { cardId: card.id, checklistId: later.id, text: 'Then this' })).json()
    expect((await tool(writeToken, 'update_checklist_item', { itemId: item.id, done: true })).isError).toBe(false)

    const detail = (await tool(readToken, 'get_card', { boardId: board.id, cardId: card.id })).json()
    expect(detail).toMatchObject({ title: 'Written by an agent', priority: 'high', dueDate: '2030-01-02', column: doing!.title })
    expect(detail.comments[0]).toMatchObject({ author: 'Alice', body: 'Looks good' })
    expect(detail.checklists).toEqual([
      { id: item.checklistId, name: 'Checklist', items: [{ id: item.id, text: 'Check it', done: true }] },
      { id: later.id, name: 'Later', items: [{ id: laterItem.id, text: 'Then this', done: false }] },
    ])
    expect(detail.recentActivity.map((a: { kind: string }) => a.kind)).toEqual(expect.arrayContaining(['created', 'moved', 'commented']))

    // link_cards: the other card blocks this one, so get_card shows it as an incoming block.
    const blocker = (await tool(writeToken, 'create_card', { boardId: board.id, columnId: todo!.id, title: 'Do first' })).json()
    expect((await tool(writeToken, 'link_cards', { fromCardId: blocker.id, toCardId: card.id, kind: 'blocks' })).isError).toBe(false)
    const blocked = (await tool(readToken, 'get_card', { boardId: board.id, cardId: card.id })).json()
    expect(blocked.links).toEqual([expect.objectContaining({ kind: 'blocks', direction: 'in', card: expect.objectContaining({ id: blocker.id }) })])
    const cycle = await tool(writeToken, 'link_cards', { fromCardId: card.id, toCardId: blocker.id, kind: 'blocks' })
    expect(cycle.isError).toBe(true)
    expect(cycle.text).toMatch(/^409/)

    // Write tools are not listed for read tokens, and calling one anyway fails.
    const refused = await mcp(readToken, 'tools/call', { name: 'create_card', arguments: { boardId: board.id, columnId: todo!.id, title: 'x' } })
    expect(refused.body.result?.isError ?? refused.body.error).toBeTruthy()

    // Validation errors from the route come back as tool errors.
    const bad = await tool(writeToken, 'update_card', { cardId: card.id, startDate: '2031-01-01' })
    expect(bad.isError).toBe(true)
    expect(bad.text).toMatch(/^400/)
  })
  it('edits board structure: columns, card tags, column tags, automations and the accent', async () => {
    const col = (await tool(writeToken, 'create_column', { boardId: board.id, title: 'Review' })).json()
    expect(col.title).toBe('Review')
    expect((await tool(writeToken, 'update_column', { columnId: col.id, color: '#ff0000', wipLimit: 3, aboveId: null, belowId: board.columns[0]!.id })).json())
      .toMatchObject({ color: '#ff0000', wipLimit: 3 })

    const tag = (await tool(writeToken, 'create_tag', { boardId: board.id, name: 'Agent' })).json()
    expect(tag.color).toMatch(/^#[0-9a-f]{6}$/)
    expect((await tool(writeToken, 'update_tag', { tagId: tag.id, color: '#00AA00' })).json()).toMatchObject({ name: 'Agent', color: '#00aa00' })

    const group = (await tool(writeToken, 'create_column_tag', { boardId: board.id, name: 'Flow', columnIds: [col.id] })).json()
    expect(group.columnIds).toEqual([col.id])
    const done = board.columns.at(-1)!.id
    expect((await tool(writeToken, 'update_column_tag', { columnTagId: group.id, color: '#123456', columnIds: [col.id, done] })).json().columnIds).toHaveLength(2)

    const me = board.members[0]!.userId
    const people = (await tool(writeToken, 'create_assignee_group', { boardId: board.id, name: 'Crew', userIds: [me] })).json()
    expect(people).toMatchObject({ name: 'Crew', userIds: [me] })
    expect((await tool(writeToken, 'update_assignee_group', { assigneeGroupId: people.id, name: 'Team A', userIds: [] })).json())
      .toMatchObject({ name: 'Team A', userIds: [] })

    const auto = (await tool(writeToken, 'create_automation', { boardId: board.id, kind: 'tag_stale', days: 7, tagId: tag.id })).json()
    expect(auto).toMatchObject({ kind: 'tag_stale', days: 7, tagId: tag.id, active: true })
    expect((await tool(writeToken, 'update_automation', { automationId: auto.id, active: false })).json().active).toBe(false)
    const badAuto = await tool(writeToken, 'create_automation', { boardId: board.id, kind: 'tag_stale', days: 7 })
    expect(badAuto.isError).toBe(true)
    expect(badAuto.text).toMatch(/^400/)

    const rule = (await tool(writeToken, 'create_rule', { boardId: board.id, event: 'tag_added', eventTagId: tag.id, actions: { priority: 'high' } })).json()
    expect(rule).toMatchObject({ event: 'tag_added', eventTagId: tag.id, actions: { priority: 'high' }, active: true })
    expect((await tool(writeToken, 'update_rule', { ruleId: rule.id, active: false })).json().active).toBe(false)
    expect((await tool(writeToken, 'create_rule', { boardId: board.id, event: 'commented', actions: {} })).text).toMatch(/^400/)

    expect((await tool(writeToken, 'set_board_accent', { boardId: board.id, accent: 'teal' })).isError).toBe(false)

    const card = (await tool(writeToken, 'create_card', { boardId: board.id, columnId: col.id, title: 'Scheduled' })).json()
    const action = (await tool(writeToken, 'schedule_card_action', { cardId: card.id, kind: 'remind', runOn: '2099-01-01', note: 'ping' })).json()
    expect(action).toMatchObject({ kind: 'remind', runOn: '2099-01-01', note: 'ping', cardId: card.id })
    expect((await tool(writeToken, 'update_card', { cardId: card.id, skipAutomations: true })).isError).toBe(false)

    const view = (await tool(readToken, 'get_board', { boardId: board.id })).json()
    expect(view.accent).toBe('teal')
    expect(view.columns[0]).toMatchObject({ id: col.id, color: '#ff0000', wipLimit: 3 })
    expect(view.tags).toContainEqual({ id: tag.id, name: 'Agent', color: '#00aa00' })
    expect(view.columnTags).toEqual([{ id: group.id, name: 'Flow', color: '#123456', columnIds: [col.id, done] }])
    expect(view.assigneeGroups).toEqual([{ id: people.id, name: 'Team A', userIds: [] }])
    expect(view.automations).toEqual([expect.objectContaining({ id: auto.id, active: false })])
    expect(view.scheduledActions).toEqual([expect.objectContaining({ id: action.id })])
    expect(view.columns[0].cards[0]).toMatchObject({ id: card.id, skipAutomations: true })

    // Read tokens get none of these tools.
    const refused = await mcp(readToken, 'tools/call', { name: 'create_tag', arguments: { boardId: board.id, name: 'x' } })
    expect(refused.body.result?.isError ?? refused.body.error).toBeTruthy()
  })
  it('runs many tool calls in one batch, with references to earlier results', async () => {
    const [todo, doing] = board.columns
    const out = await tool(writeToken, 'batch', {
      calls: [
        { tool: 'create_card', arguments: { boardId: board.id, columnId: todo!.id, title: 'Batch one' } },
        { tool: 'create_card', arguments: { boardId: board.id, columnId: todo!.id, title: 'Batch two' } },
        { tool: 'add_checklist_item', arguments: { cardId: '$0.id', text: 'First step' } },
        { tool: 'move_card', arguments: { cardId: '$1.id', columnId: doing!.id } },
        { tool: 'update_card', arguments: { cardId: '$0.id', startDate: '2031-01-01', dueDate: '2030-01-01' } },
        { tool: 'add_comment', arguments: { cardId: '$4.id', body: 'never' } },
        { tool: 'update_card', arguments: { cardId: 'not-a-uuid' } },
        { tool: 'get_board', arguments: { boardId: board.id } },
      ],
    })
    expect(out.isError).toBe(true)
    const summary = out.json()
    expect(summary).toMatchObject({ succeeded: 5, failed: 3, skipped: 0 })
    const r = summary.results
    expect(r.map((x: { ok: boolean }) => x.ok)).toEqual([true, true, true, true, false, false, false, true])
    expect(r[2].result).toMatchObject({ text: 'First step', done: false })
    expect(r[4].error).toMatch(/^400/)
    expect(r[5].error).toMatch(/call 4 failed/)
    expect(r[6].error).toMatch(/^400 cardId/)
    const cards = r[7].result.columns.flatMap((c: { title: string, cards: { title: string }[] }) => c.cards.map(card => [c.title, card.title]))
    expect(cards).toEqual(expect.arrayContaining([[todo!.title, 'Batch one'], [doing!.title, 'Batch two']]))

    // stopOnError skips the rest; read tokens may batch read tools only.
    const stopped = (await tool(writeToken, 'batch', {
      stopOnError: true,
      calls: [{ tool: 'get_card', arguments: { boardId: board.id, cardId: randomUUID() } }, { tool: 'list_boards' }],
    })).json()
    expect(stopped).toMatchObject({ succeeded: 0, failed: 1, skipped: 1 })
    const reads = await tool(readToken, 'batch', { calls: [{ tool: 'list_boards' }, { tool: 'get_board', arguments: { boardId: board.id } }] })
    expect(reads.json()).toMatchObject({ succeeded: 2, failed: 0 })
    const refused = await mcp(readToken, 'tools/call', { name: 'batch', arguments: { calls: [{ tool: 'create_card', arguments: {} }] } })
    expect(refused.body.result?.isError ?? refused.body.error).toBeTruthy()
  })

  it('works with a bot token on the bot\'s board, acting as the bot', async () => {
    const bot = (await alice.req<{ id: string }>(`/api/boards/${board.id}/bots`, { method: 'POST', body: { name: 'Claude', role: 'editor' } })).data
    const { token } = (await alice.req<{ token: string }>(`/api/bots/${bot.id}/tokens`, { method: 'POST', body: { name: 'agent', scopes: ['read', 'write'] } })).data

    const boards = (await tool(token, 'list_boards')).json()
    expect(boards.map((b: { id: string }) => b.id)).toEqual([board.id])
    const view = (await tool(token, 'get_board', { boardId: board.id })).json()
    expect(view.yourRole).toBe('editor')
    expect(view.members).toContainEqual({ userId: bot.id, name: 'Claude', bot: true, role: 'editor' })

    const card = (await tool(token, 'create_card', { boardId: board.id, columnId: board.columns[0]!.id, title: 'Filed by the bot' })).json()
    const detail = (await tool(token, 'get_card', { boardId: board.id, cardId: card.id })).json()
    expect(detail.recentActivity).toContainEqual(expect.objectContaining({ kind: 'created', actor: 'Claude' }))
    expect((await alice.req(`/api/bots/${bot.id}`, { method: 'DELETE' })).status).toBe(200)
  })
})

describe('board bots', () => {
  /** A bot on the board and a read+write token for it, made through the DB functions as the owner (Bots 1/4). */
  async function botToken(name: string) {
    const token = `kb_${randomBytes(32).toString('base64url')}`
    const hash = createHash('sha256').update(token).digest('hex')
    const bot = await appDb.begin(async (sql) => {
      await sql`select set_config('app.user_id', ${alice.id}, true)`
      const [{ id }] = await sql`select app.create_board_bot(${board.id}, ${name}, 'editor') as id` as any
      await sql`select app.create_bot_token(${id}, 'agent', ${['read', 'write']}, null, ${hash}, ${token.slice(0, 10)})`
      return id as string
    })
    return { bot: bot as string, token }
  }

  it('a bot polls list_notifications for mentions and assignments and marks them read', async () => {
    const { bot, token } = await botToken('Helper')
    const col = board.columns[0]!.id
    const card = (await tool(writeToken, 'create_card', { boardId: board.id, columnId: col, title: 'For the agent' })).json()
    expect((await tool(writeToken, 'add_comment', { cardId: card.id, body: `@[Helper](user:${bot}) can you take this?` })).isError).toBe(false)
    expect((await tool(writeToken, 'update_card', { cardId: card.id, assigneeIds: [bot] })).isError).toBe(false)

    const inbox = (await tool(token, 'list_notifications')).json()
    const mine = inbox.items.filter((n: { cardId: string }) => n.cardId === card.id)
    expect(mine.map((n: { activity: { kind: string } }) => n.activity.kind).sort()).toEqual(['assigned', 'commented'])
    expect(mine.find((n: { activity: { kind: string } }) => n.activity.kind === 'commented').activity.data.mentions).toEqual([bot])
    expect(inbox.unread).toBe(2)

    // The bot answers; it does not start watching the card, so Alice's next comment does not reach it.
    expect((await tool(token, 'add_comment', { cardId: card.id, body: 'On it.' })).isError).toBe(false)
    expect(await ownerDb`select 1 from card_watchers where user_id = ${bot}`).toHaveLength(0)

    expect((await tool(token, 'mark_notifications_read', { notificationIds: [mine[0].id] })).json()).toEqual({ updated: 1 })
    expect((await tool(token, 'list_notifications')).json().unread).toBe(1)
    expect((await tool(token, 'mark_notifications_read')).json()).toEqual({ updated: 1 })
    expect((await tool(token, 'list_notifications')).json().unread).toBe(0)
    // Someone else's notification is not found for the bot.
    const [other] = await ownerDb`select id from notifications where user_id <> ${bot} limit 1`
    if (other) expect((await tool(token, 'mark_notifications_read', { notificationIds: [other.id] })).text).toMatch(/^404/)
  })
})
