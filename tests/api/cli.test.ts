// The kanso CLI (cli/) against a real server: login and whoami with API tokens,
// run in-process through `run` with a temporary config file and the global fetch.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { url } from '@nuxt/test-utils/e2e'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiToken } from '#shared/types/account'
import type { InstanceSettings } from '#shared/types/admin'
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
async function cli(argv: string[], env: Record<string, string> = {}) {
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
