// The kanso CLI (cli/) against a real server: login and whoami with API tokens, then the board,
// card, comment, my-work, notification and search commands, and agent run, run in-process through
// `run` with a temporary config file and the global fetch.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { url } from '@nuxt/test-utils/e2e'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiToken } from '#shared/types/account'
import type { InstanceSettings } from '#shared/types/admin'
import type { BoardDetail, CardDetail } from '#shared/types/board'
import type { Io } from '../../cli/src/io'
import { run } from '../../cli/src/main'
import { signEmailToken } from '../../server/utils/emailToken'
import { setupApi } from './server'

const adminEmail = `admin-${randomUUID()}@cli.test`
await setupApi({ NUXT_ADMIN_EMAIL: adminEmail, NUXT_MAIL_SMTP_URL: '', NUXT_MAIL_LOG_LINKS: 'true' })

let base = ''
let dir = ''
const authDb = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })
const ownerDb = postgres(process.env.MIGRATION_DATABASE_URL!, { onnotice: () => {} })
const randomIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250)).join('.')}`

async function signUp(name: string, email = `${name.toLowerCase()}-${randomUUID()}@cli.test`) {
  const ip = randomIp()
  const post = (path: string, body: unknown, cookie = '') => globalThis.fetch(base + path, {
    method: 'POST',
    headers: { 'x-forwarded-for': ip, 'content-type': 'application/json', ...(cookie && { cookie }) },
    body: JSON.stringify(body),
  })
  expect((await post('/api/auth/register', { name, email, password: 'password123' })).status).toBe(200)
  const [u] = await authDb`select id from users where email = ${email}`
  const verify = await globalThis.fetch(`${base}/auth/verify?token=${signEmailToken(u!.id, email, process.env.NUXT_SESSION_PASSWORD!)}`, { redirect: 'manual', headers: { 'x-forwarded-for': ip } })
  const cookie = verify.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const token = async (scopes: string[]) => ((await (await post('/api/account/tokens', { name: 'cli', scopes }, cookie)).json()) as ApiToken & { token: string })
  const req = (path: string, init: { method?: string, body?: unknown } = {}) => globalThis.fetch(base + path, {
    method: init.method ?? 'GET',
    headers: { 'x-forwarded-for': ip, cookie, ...(init.body !== undefined && { 'content-type': 'application/json' }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  return { id: u!.id as string, email, cookie, token, req }
}

/** One CLI run against the test server; the client sends its own x-forwarded-for so the token rate limit stays per test. */
async function cli(argv: string[], env: Record<string, string> = {}, signal?: AbortSignal) {
  const out: string[] = []
  const err: string[] = []
  const ip = randomIp()
  const io: Io = {
    env: { KANSO_CONFIG: join(dir, 'config.json'), ...env },
    home: dir,
    stdout: t => out.push(t),
    stderr: t => err.push(t),
    readSecret: async () => '',
    fetch: (input, init = {}) => globalThis.fetch(input, { ...init, headers: { ...(init.headers as Record<string, string>), 'x-forwarded-for': ip } }),
    signal,
  }
  const code = await run(argv, io)
  return { code, out: out.join(''), err: err.join('') }
}

let admin: Awaited<ReturnType<typeof signUp>>
let savedSettings: InstanceSettings
let alice: Awaited<ReturnType<typeof signUp>>

beforeAll(async () => {
  base = url('/').replace(/\/$/, '')
  dir = await mkdtemp(join(tmpdir(), 'kanso-cli-api-'))
  admin = await signUp('Admin', adminEmail)
  savedSettings = await (await admin.req('/api/admin/settings')).json() as InstanceSettings
  expect((await admin.req('/api/admin/settings', { method: 'PUT', body: { ...savedSettings, signupMode: 'open' } })).status).toBe(200)
  alice = await signUp('Alice')
})

afterAll(async () => {
  if (savedSettings) await admin?.req('/api/admin/settings', { method: 'PUT', body: savedSettings })
  await ownerDb`delete from admin_audit_log where data->>'actor_email' like '%@cli.test' or data->>'target_email' like '%@cli.test'`
  await ownerDb`delete from boards where owner_id in (select id from users where email like '%@cli.test')`
  await ownerDb`delete from boards where id in (select board_id from board_members m join users u on u.id = m.user_id where u.email like '%@cli.test')`
  await ownerDb`delete from users where email like '%@cli.test'`
  await Promise.all([authDb.end(), ownerDb.end()])
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('kanso cli against the API', () => {
  it('logs in with a read-only token and shows who it acts as', async () => {
    const { token } = await alice.token(['read'])
    const login = await cli(['login', '--url', `${base}/`, '--token', token])
    expect(login.err).toBe('')
    expect(login.code).toBe(0)
    expect(login.out).toContain(`as Alice <${alice.email}>`)

    const who = await cli(['whoami', '--json'])
    expect(who.code).toBe(0)
    expect(JSON.parse(who.out)).toEqual({ id: alice.id, name: 'Alice', email: alice.email, isBot: false, isAdmin: false, locale: null, url: base, profile: 'default' })

    const text = await cli(['whoami'])
    expect(text.out).toMatch(/^Name: +Alice$/m)
    expect(text.out).toMatch(new RegExp(`^User id: +${alice.id}$`, 'm'))
  })

  it('refuses a revoked token with a 401 explanation', async () => {
    const created = await alice.token(['read'])
    expect((await alice.req(`/api/account/tokens/${created.id}`, { method: 'DELETE' })).ok).toBe(true)
    const who = await cli(['whoami', '--json'], { KANSO_URL: base, KANSO_TOKEN: created.token })
    expect(who.code).toBe(1)
    expect(JSON.parse(who.err).error).toMatchObject({ status: 401, message: expect.stringContaining('The token was refused') })
    const login = await cli(['login', '--profile', 'revoked', '--url', base, '--token', created.token])
    expect(login.code).toBe(1)
    expect((await cli(['whoami', '--profile', 'revoked'])).err).toContain('Not logged in (profile "revoked")')
  })

  it('logs out of the profile', async () => {
    expect((await cli(['logout'])).code).toBe(0)
    expect((await cli(['whoami'])).code).toBe(1)
  })
})

describe('kanso cli board and card commands', () => {
  let env: Record<string, string> = {}
  let boardId = ''
  let bob: Awaited<ReturnType<typeof signUp>>
  const json = async (argv: string[]) => {
    const r = await cli([...argv, '--json'], env)
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
    return JSON.parse(r.out)
  }

  beforeAll(async () => {
    bob = await signUp('Bob')
    const board = await (await alice.req('/api/boards', { method: 'POST', body: { name: `CLI board ${randomUUID()}` } })).json() as { id: string, name: string }
    boardId = board.id
    expect((await alice.req(`/api/boards/${boardId}/tags`, { method: 'POST', body: { name: 'Bug', color: '#ff0000' } })).status).toBe(200)
    expect((await alice.req(`/api/boards/${boardId}/members`, { method: 'POST', body: { email: bob.email, role: 'editor' } })).status).toBe(200)
    env = { KANSO_URL: base, KANSO_TOKEN: (await alice.token(['read', 'write'])).token }
  })

  it('finds the board by name and shows its columns', async () => {
    const boards = await json(['boards', 'ls'])
    const name = boards.find((b: { id: string }) => b.id === boardId).name as string
    const shown = await json(['board', 'show', name])
    expect(shown.columns.map((c: { title: string }) => c.title)).toEqual(['To do', 'In progress', 'Done'])
    expect(shown.members.map((m: { email: string }) => m.email).sort()).toEqual([alice.email, bob.email].sort())
  })

  it('adds, edits, moves, comments on, lists and archives a card', async () => {
    const added = await json(['card', 'add', boardId, 'to do', 'Fix the login'])
    expect(added).toMatchObject({ title: 'Fix the login', column: 'To do' })

    const edited = await json(['card', 'edit', boardId, 'fix the login', '--due', '2026-12-24', '--priority', 'high', '--add-tag', 'bug', '--assign', bob.email, '--assign', 'me'])
    expect(edited).toMatchObject({ dueDate: '2026-12-24', priority: 'high', tags: [{ name: 'Bug' }] })
    expect(edited.assignees.map((a: { email: string }) => a.email).sort()).toEqual([alice.email, bob.email].sort())

    expect(await json(['card', 'mv', boardId, added.id.slice(0, 8), 'In progress'])).toMatchObject({ column: 'In progress' })
    expect(await json(['comment', 'add', boardId, added.id, 'Looking into it'])).toMatchObject({ body: 'Looking into it', author: 'Alice' })

    const listed = await json(['cards', 'ls', boardId, '--assignee', 'Bob', '--tag', 'Bug', '--column', 'in progress'])
    expect(listed.map((c: { id: string }) => c.id)).toEqual([added.id])
    const shown = await json(['card', 'show', boardId, added.id])
    expect(shown.comments).toEqual([expect.objectContaining({ body: 'Looking into it' })])

    const work = await json(['my-work'])
    expect(work.map((c: { id: string }) => c.id)).toContain(added.id)
    const found = await json(['search', 'login'])
    expect(found.cards.map((c: { id: string }) => c.id)).toContain(added.id)

    await json(['card', 'archive', boardId, added.id])
    expect(await json(['cards', 'ls', boardId])).toEqual([])
    await json(['card', 'archive', boardId, added.id.slice(0, 8), '--restore'])
    expect((await json(['cards', 'ls', boardId])).map((c: { id: string }) => c.id)).toEqual([added.id])
  })

  it('refuses an ambiguous card title with the matches', async () => {
    await json(['card', 'add', boardId, 'To do', 'Twin one'])
    await json(['card', 'add', boardId, 'To do', 'Twin two'])
    const r = await cli(['card', 'show', boardId, 'twin', '--json'], env)
    expect(r.code).toBe(1)
    expect(JSON.parse(r.err).error.matches.map((m: { name: string }) => m.name).sort()).toEqual(['Twin one', 'Twin two'])
  })

  it('lists notifications and marks them read', async () => {
    const bobEnv = { KANSO_URL: base, KANSO_TOKEN: (await bob.token(['read', 'write'])).token }
    const inbox = JSON.parse((await cli(['notifications', 'ls', '--unread', '--json'], bobEnv)).out)
    expect(inbox.unread).toBeGreaterThan(0)
    const first = inbox.items[0]
    expect(first).toMatchObject({ read: false, board: expect.stringContaining('CLI board') })
    const read = await cli(['notifications', 'read', first.id.slice(0, 8)], bobEnv)
    expect(read.out).toBe('Marked 1 notification read.\n')
    const all = await cli(['notifications', 'read', '--all', '--json'], bobEnv)
    expect(all.code).toBe(0)
    expect(JSON.parse((await cli(['notifications', 'ls', '--json'], bobEnv)).out).unread).toBe(0)
  })

  it('refuses writes with a read-only token', async () => {
    const readEnv = { KANSO_URL: base, KANSO_TOKEN: (await alice.token(['read'])).token }
    const r = await cli(['card', 'add', boardId, 'To do', 'Nope', '--json'], readEnv)
    expect(r.code).toBe(1)
    expect(JSON.parse(r.err).error.status).toBe(403)
  })
})

describe('kanso agent run against the API', () => {
  const until = async (fn: () => Promise<boolean>) => {
    for (let i = 0; i < 200; i++) {
      if (await fn()) return
      await new Promise(r => setTimeout(r, 50))
    }
    throw new Error('timed out')
  }

  it('runs the command for cards landing in a column and for a bot\'s mentions', async () => {
    const board = await (await alice.req('/api/boards', { method: 'POST', body: { name: 'Agent board' } })).json() as { id: string }
    const detail = await (await alice.req(`/api/boards/${board.id}`)).json() as BoardDetail
    const todo = detail.columns.find(c => c.title === 'To do')!
    const doing = detail.columns.find(c => c.title === 'In progress')!
    const out = await mkdtemp(join(dir, 'runs-'))
    const files = async () => (await readdir(out)).sort()

    // Activity: cards created in or moved to "To do", as Alice.
    const { token } = await alice.token(['read', 'write'])
    const stop = new AbortController()
    const env = { KANSO_URL: base, KANSO_TOKEN: token, OUT: out }
    const running = cli(['agent', 'run', '--board', 'Agent board', '--columns', 'to do', '--comment', 'always',
      '--cmd', 'cat > "$OUT/$KANSO_EVENT-$KANSO_CARD_ID.json"'], env, stop.signal)
    await new Promise(r => setTimeout(r, 500))
    const create = async (columnId: string, title: string) => (await (await alice.req(`/api/boards/${board.id}/cards`, { method: 'POST', body: { columnId, title } })).json() as { id: string }).id
    const inTodo = await create(todo.id, 'Do it')
    const elsewhere = await create(doing.id, 'Not mine')
    expect((await alice.req(`/api/cards/${elsewhere}/move`, { method: 'POST', body: { columnId: todo.id, aboveId: null, belowId: null } })).ok).toBe(true)
    await until(async () => (await files()).length === 2)
    expect(await files()).toEqual([`created-${inTodo}.json`, `moved-${elsewhere}.json`].sort())
    const ctx = JSON.parse(await readFile(join(out, `created-${inTodo}.json`), 'utf8'))
    expect(ctx).toMatchObject({ event: { source: 'activity', kind: 'created' }, board: { id: board.id, name: 'Agent board' }, column: { title: 'To do' }, card: { id: inTodo, title: 'Do it' } })
    // The status comment is posted, and does not trigger a run of its own.
    await until(async () => ((await (await alice.req(`/api/cards/${inTodo}`)).json()) as CardDetail).comments.length === 1)
    const comment = ((await (await alice.req(`/api/cards/${inTodo}`)).json()) as CardDetail).comments[0]!
    expect(comment.body).toContain('the run for **created** finished')
    stop.abort()
    const result = await running
    expect(result.err).toContain('kanso agent: stopped')
    expect(result.code).toBe(0)

    // Notifications: a bot mentioned in a comment.
    const bot = await (await alice.req(`/api/boards/${board.id}/bots`, { method: 'POST', body: { name: 'Helper', role: 'editor' } })).json() as { id: string }
    const botToken = (await (await alice.req(`/api/bots/${bot.id}/tokens`, { method: 'POST', body: { name: 'agent', scopes: ['read', 'write'] } })).json() as { token: string }).token
    const stopBot = new AbortController()
    const botRun = cli(['agent', 'run', '--notifications', '--json', '--cmd', 'echo "$KANSO_NOTIFICATION_ID" > "$OUT/note-$KANSO_CARD_ID"'], { ...env, KANSO_TOKEN: botToken }, stopBot.signal)
    await new Promise(r => setTimeout(r, 500))
    expect((await alice.req(`/api/cards/${inTodo}/comments`, { method: 'POST', body: { body: `@[Helper](user:${bot.id}) please look` } })).ok).toBe(true)
    await until(async () => (await files()).includes(`note-${inTodo}`))
    const botApi = (path: string) => globalThis.fetch(base + path, { headers: { authorization: `Bearer ${botToken}`, 'x-forwarded-for': randomIp() } })
    await until(async () => ((await (await botApi('/api/notifications?unread=1')).json()) as { unread: number }).unread === 0)
    const notificationId = (await readFile(join(out, `note-${inTodo}`), 'utf8')).trim()
    const inbox = await (await botApi('/api/notifications')).json() as { items: { id: string, readAt: string | null }[] }
    expect(inbox.items.find(n => n.id === notificationId)?.readAt).toBeTruthy()
    stopBot.abort()
    const botResult = await botRun
    expect(botResult.code).toBe(0)
    const lines = botResult.out.trim().split('\n').map(l => JSON.parse(l) as { message: string })
    expect(lines.some(l => l.message.startsWith('done commented'))).toBe(true)
  })

  it('follows the agent rules set on the board for its bot', async () => {
    const board = await (await alice.req('/api/boards', { method: 'POST', body: { name: 'Agent rules board' } })).json() as { id: string }
    const detail = await (await alice.req(`/api/boards/${board.id}`)).json() as BoardDetail
    const todo = detail.columns.find(c => c.title === 'To do')!
    const doing = detail.columns.find(c => c.title === 'In progress')!
    const bot = await (await alice.req(`/api/boards/${board.id}/bots`, { method: 'POST', body: { name: 'Runner', role: 'editor' } })).json() as { id: string }
    const botToken = (await (await alice.req(`/api/bots/${bot.id}/tokens`, { method: 'POST', body: { name: 'agent', scopes: ['read', 'write'] } })).json() as { token: string }).token
    const out = await mkdtemp(join(dir, 'rules-'))
    const env = { KANSO_URL: base, OUT: out }

    // A person's token is refused: rules name a bot.
    const { token } = await alice.token(['read', 'write'])
    const refused = await cli(['agent', 'run', '--board', board.id, '--cmd', 'true'], { ...env, KANSO_TOKEN: token })
    expect(refused.code).toBe(2)
    expect(refused.err).toContain('not a bot\'s')

    // Routes: validation, then a rule; the bot token reads it (token route).
    const bad = await alice.req(`/api/boards/${board.id}/agent-rules`, { method: 'POST', body: { name: 'x', botId: alice.id, event: 'card_moved', instructions: 'Go' } })
    expect(bad.status).toBe(403)
    const created = await alice.req(`/api/boards/${board.id}/agent-rules`, {
      method: 'POST',
      body: { name: 'Pick up', botId: bot.id, event: 'card_moved', columnId: todo.id, instructions: 'Work on it.', moveColumnId: doing.id, comment: 'always' },
    })
    expect(created.status).toBe(200)
    const rule = await created.json() as { id: string, active: boolean, comment: string }
    expect(rule).toMatchObject({ active: true, comment: 'always' })
    const botGet = await globalThis.fetch(`${base}/api/boards/${board.id}/agent-rules`, { headers: { authorization: `Bearer ${botToken}`, 'x-forwarded-for': randomIp() } })
    expect((await botGet.json() as { id: string }[]).map(r => r.id)).toEqual([rule.id])

    const stop = new AbortController()
    const running = cli(['agent', 'run', '--board', board.id, '--json', '--cmd', 'cat > "$OUT/$KANSO_RULE_NAME-$KANSO_CARD_ID.json"'], { ...env, KANSO_TOKEN: botToken }, stop.signal)
    await new Promise(r => setTimeout(r, 500))
    const card = (await (await alice.req(`/api/boards/${board.id}/cards`, { method: 'POST', body: { columnId: doing.id, title: 'Rule me' } })).json() as { id: string }).id
    expect((await alice.req(`/api/cards/${card}/move`, { method: 'POST', body: { columnId: todo.id, aboveId: null, belowId: null } })).ok).toBe(true)
    await until(async () => (await readdir(out)).includes(`Pick up-${card}.json`))
    const ctx = JSON.parse(await readFile(join(out, `Pick up-${card}.json`), 'utf8'))
    expect(ctx.rule).toEqual({ id: rule.id, name: 'Pick up', instructions: 'Work on it.' })
    // Afterwards the card goes to "In progress" and the result is commented (the runner's own move starts nothing).
    await until(async () => {
      const b = await (await alice.req(`/api/boards/${board.id}`)).json() as BoardDetail
      return b.cards.find(c => c.id === card)?.columnId === doing.id
    })
    await until(async () => ((await (await alice.req(`/api/cards/${card}`)).json()) as CardDetail).comments.length === 1)

    // Pausing the rule (a board change) stops it.
    expect((await alice.req(`/api/agent-rules/${rule.id}`, { method: 'PATCH', body: { active: false } })).ok).toBe(true)
    await new Promise(r => setTimeout(r, 800))
    expect((await alice.req(`/api/cards/${card}/move`, { method: 'POST', body: { columnId: todo.id, aboveId: null, belowId: null } })).ok).toBe(true)
    await new Promise(r => setTimeout(r, 800))
    stop.abort()
    const result = await running
    expect(result.code).toBe(0)
    const messages = result.out.trim().split('\n').map(l => (JSON.parse(l) as { message: string }).message)
    expect(messages.filter(m => m.startsWith('run '))).toHaveLength(1)
    expect(messages.some(m => m.includes('no active agent rules'))).toBe(true)
    expect((await alice.req(`/api/agent-rules/${rule.id}`, { method: 'DELETE' })).ok).toBe(true)
  })

  it('refuses a board the token cannot see', async () => {
    const { token } = await alice.token(['read'])
    const r = await cli(['agent', 'run', '--board', randomUUID(), '--activity', 'moved', '--cmd', 'true'], { KANSO_URL: base, KANSO_TOKEN: token })
    expect(r.code).toBe(1)
    expect(r.err).toContain('Not found (404')
  })
})

describe('installing the CLI from the instance', () => {
  it('serves the CLI built with the server and an install script pointing at the site, without signing in', async () => {
    const js = await globalThis.fetch(`${base}/cli/kanso.mjs`)
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toContain('javascript')
    const body = await js.text()
    expect(body.startsWith('#!/usr/bin/env node')).toBe(true)
    const { VERSION } = await import('../../cli/src/version')
    expect(body).toContain(VERSION)

    const sh = await globalThis.fetch(`${base}/cli/install.sh`)
    expect(sh.status).toBe(200)
    expect(sh.headers.get('content-type')).toContain('text/x-shellscript')
    expect(sh.headers.get('cache-control')).toBe('no-store')
    const script = await sh.text()
    expect(script.startsWith('#!/bin/sh')).toBe(true)
    // NUXT_PUBLIC_SITE_URL when the environment sets one, else the request's origin.
    expect(script).toContain(`site='${process.env.NUXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') || base}'`)
  })
})
