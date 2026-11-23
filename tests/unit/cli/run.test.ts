import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '../../../shared/types/account'
import { describeApiError } from '../../../cli/src/client'
import type { Io } from '../../../cli/src/io'
import { run } from '../../../cli/src/main'

const token = `kb_${'a'.repeat(43)}`
const me: Me = { id: 'u1', name: 'Alice', email: 'alice@k.test', isBot: false, isAdmin: false, locale: null }

let dir = ''
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'kanso-cli-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

/** A fake site: answers /api/me for `token`, 401 for anything else. */
function site(answer?: (url: string, init: RequestInit) => Response) {
  return vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    if (answer) return answer(url, init)
    const auth = new Headers(init.headers).get('authorization')
    if (url === 'https://k.test/kanso/api/me' && auth === `Bearer ${token}`) return Response.json(me)
    return Response.json({ statusCode: 401, statusMessage: 'Unauthorized', message: 'Invalid token' }, { status: 401 })
  })
}

function harness(fetch: Io['fetch'], env: Record<string, string> = {}, secret = '') {
  const out: string[] = []
  const err: string[] = []
  const io: Io = {
    env: { KANSO_CONFIG: join(dir, 'config.json'), ...env },
    home: dir,
    stdout: t => out.push(t),
    stderr: t => err.push(t),
    readSecret: async () => secret,
    fetch,
  }
  return { io, out: () => out.join(''), err: () => err.join(''), cli: (...argv: string[]) => run(argv, io) }
}

describe('kanso cli', () => {
  it('logs in after checking the token, then whoami uses the stored profile', async () => {
    const fetch = site()
    const h = harness(fetch as unknown as Io['fetch'])
    expect(await h.cli('login', '--url', 'https://k.test/kanso/', '--token', token)).toBe(0)
    expect(h.out()).toContain('Logged in to https://k.test/kanso as Alice <alice@k.test>, profile "default"')
    expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))).toEqual({ profiles: { default: { url: 'https://k.test/kanso', token } } })
    const headers = new Headers(fetch.mock.calls[0]![1]!.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${token}`)
    expect(headers.get('x-client-id')).toBe('cli')

    const w = harness(fetch as unknown as Io['fetch'])
    expect(await w.cli('whoami')).toBe(0)
    expect(w.out()).toMatch(/^Name: +Alice$/m)
    expect(w.out()).toMatch(/^Site: +https:\/\/k\.test\/kanso$/m)
    expect(w.out()).toMatch(/^Profile: +default$/m)

    const j = harness(fetch as unknown as Io['fetch'])
    expect(await j.cli('whoami', '--json')).toBe(0)
    expect(JSON.parse(j.out())).toEqual({ ...me, url: 'https://k.test/kanso', profile: 'default' })
  })

  it('reads the token from stdin when --token is missing', async () => {
    const h = harness(site() as unknown as Io['fetch'], {}, token)
    expect(await h.cli('login', '--url', 'https://k.test/kanso')).toBe(0)
    expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')).profiles.default.token).toBe(token)
  })

  it('stores nothing when the site refuses the token', async () => {
    const other = `kb_${'z'.repeat(43)}`
    const h = harness(site() as unknown as Io['fetch'])
    expect(await h.cli('login', '--url', 'https://k.test/kanso', '--token', other)).toBe(1)
    expect(h.err()).toContain('The token was refused (401: Invalid token)')
    await expect(readFile(join(dir, 'config.json'), 'utf8')).rejects.toThrow()
  })

  it('keeps profiles apart and logs out of one', async () => {
    const fetch = site() as unknown as Io['fetch']
    const h = harness(fetch)
    expect(await h.cli('login', '--profile', 'work', '--url', 'https://k.test/kanso', '--token', token)).toBe(0)
    expect(await harness(fetch).cli('whoami')).toBe(1)
    expect(await harness(fetch, { KANSO_PROFILE: 'work' }).cli('whoami')).toBe(0)
    const out = harness(fetch)
    expect(await out.cli('logout', '--profile', 'work')).toBe(0)
    expect(out.out()).toContain('Logged out of profile "work"')
    expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))).toEqual({ profiles: {} })
    expect(await harness(fetch).cli('logout', '--json')).toBe(0)
  })

  it('uses KANSO_URL and KANSO_TOKEN without a config file', async () => {
    const h = harness(site() as unknown as Io['fetch'], { KANSO_URL: 'https://k.test/kanso', KANSO_TOKEN: token })
    expect(await h.cli('whoami')).toBe(0)
    expect(h.out()).toContain('KANSO_URL, KANSO_TOKEN from the environment')
  })

  it('prints JSON errors with --json and plain ones otherwise', async () => {
    const fetch = site(() => Response.json({ statusCode: 403, message: 'Forbidden' }, { status: 403 })) as unknown as Io['fetch']
    const env = { KANSO_URL: 'https://k.test', KANSO_TOKEN: token }
    const j = harness(fetch, env)
    expect(await j.cli('whoami', '--json')).toBe(1)
    expect(JSON.parse(j.err())).toEqual({ error: { message: expect.stringContaining('Not allowed (403: Forbidden)'), status: 403, serverMessage: 'Forbidden' } })
    const t = harness(fetch, env)
    expect(await t.cli('whoami')).toBe(1)
    expect(t.err()).toMatch(/^kanso: Not allowed \(403: Forbidden\)/)
  })

  it('explains redirects, non-JSON answers and unreachable sites', async () => {
    const env = { KANSO_URL: 'https://k.test', KANSO_TOKEN: token }
    const redirect = harness((async () => new Response(null, { status: 302, headers: { location: '/login' } })) as unknown as Io['fetch'], env)
    expect(await redirect.cli('whoami')).toBe(1)
    expect(redirect.err()).toContain('redirected (302) to /login')
    const html = harness((async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })) as unknown as Io['fetch'], env)
    expect(await html.cli('whoami')).toBe(1)
    expect(html.err()).toContain('Is https://k.test a Kanso site?')
    const down = harness((async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) }) as unknown as Io['fetch'], env)
    expect(await down.cli('whoami')).toBe(1)
    expect(down.err()).toContain('Cannot reach https://k.test: ECONNREFUSED')
  })

  it('handles help, version and usage errors', async () => {
    const fetch = site() as unknown as Io['fetch']
    const help = harness(fetch)
    expect(await help.cli('--help')).toBe(0)
    expect(help.out()).toContain('whoami')
    const none = harness(fetch)
    expect(await none.cli()).toBe(2)
    const cmd = harness(fetch)
    expect(await cmd.cli('login', '--help')).toBe(0)
    expect(cmd.out()).toContain('Usage: kanso login --url <site>')
    const helpCmd = harness(fetch)
    expect(await helpCmd.cli('help', 'whoami')).toBe(0)
    expect(helpCmd.out()).toContain('Usage: kanso whoami')
    const version = harness(fetch)
    expect(await version.cli('--version')).toBe(0)
    expect(version.out()).toMatch(/^\d+\.\d+\.\d+\n$/)
    const unknown = harness(fetch)
    expect(await unknown.cli('frobnicate')).toBe(2)
    expect(unknown.err()).toContain('Unknown command "frobnicate"')
    const noUrl = harness(fetch)
    expect(await noUrl.cli('login', '--token', token)).toBe(2)
    expect(noUrl.err()).toContain('Missing --url')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('words each error status with what to do', () => {
    expect(describeApiError(401, '', 'GET', '/api/me')).toMatch(/^The token was refused \(401\)\./)
    expect(describeApiError(403, 'Forbidden', 'POST', '/api/cards')).toContain('POST /api/cards')
    expect(describeApiError(404, 'Board not found', 'GET', '/api/boards/x')).toBe('Not found (404: Board not found). It does not exist or you cannot see it.')
    expect(describeApiError(500, 'Server Error', 'GET', '/x')).toBe('GET /x failed with 500: Server Error.')
  })
})
