import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installCommand, nameFromBoard } from '../../../cli/src/agentWizard'
import type { Io, ProgramResult } from '../../../cli/src/io'
import { run } from '../../../cli/src/main'
import { parseSelection, shellQuote } from '../../../cli/src/prompt'

const token = `kb_${'a'.repeat(43)}`
const other = `kb_${'b'.repeat(43)}`
const B1 = '11111111-1111-4111-8111-111111111111'
const B2 = '22222222-2222-4222-8222-222222222222'
const TODO = 'aaaaaaaa-0000-4000-8000-000000000001'
const DOING = 'aaaaaaaa-0000-4000-8000-000000000002'
const BOT = 'cccccccc-0000-4000-8000-000000000001'

let dir = ''
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'kanso-wizard-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

function harness(answers: string[], opts: { isBot?: boolean, interactive?: boolean, profiles?: Record<string, { url: string, token: string }>, secret?: string } = {}) {
  const { isBot = true, interactive = true, profiles = { default: { url: 'https://k.test/kanso', token } } } = opts
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname.replace(/^\/kanso/, '')
    if (path === '/api/me') return Response.json({ id: BOT, name: isBot ? 'Triage bot' : 'Alice', email: 'x@k.test', isBot, isAdmin: false, locale: null })
    if (path === '/api/boards') return Response.json([{ id: B1, name: 'Kanso', archivedAt: null }, { id: B2, name: 'Ops Board', archivedAt: null }])
    if (path === `/api/boards/${B1}`) {
      return Response.json({ id: B1, name: 'Kanso', columns: [{ id: TODO, title: 'To do' }, { id: DOING, title: 'Doing' }], agentRules: [
        { id: 'r1', botId: BOT, active: true }, { id: 'r2', botId: BOT, active: false },
      ] })
    }
    if (path === `/api/boards/${B2}`) return Response.json({ id: B2, name: 'Ops Board', columns: [], agentRules: [] })
    return Response.json({ statusCode: 404, message: 'Not found' }, { status: 404 })
  })
  const programs: string[] = []
  const runProgram = vi.fn(async (file: string, args: string[]): Promise<ProgramResult> => {
    programs.push([file, ...args].join(' '))
    if (file === 'git') return { code: 0, stdout: `${join(dir, 'repo', '.git')}\n`, stderr: '' }
    if (file === 'loginctl') return { code: 0, stdout: 'yes\n', stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  })
  const out: string[] = []
  const err: string[] = []
  const questions: string[] = []
  const queue = [...answers]
  const bin = join(dir, 'bin')
  const io: Io = {
    env: { KANSO_CONFIG: join(dir, 'config.json'), XDG_CONFIG_HOME: join(dir, 'cfg'), PATH: `${bin}:/usr/bin`, USER: 'tj' },
    home: dir,
    stdout: t => out.push(t),
    stderr: t => err.push(t),
    readSecret: async () => opts.secret ?? '',
    ask: async (q) => {
      questions.push(q)
      out.push(q)
      return queue.length ? queue.shift()! : null
    },
    interactive,
    fetch: fetch as unknown as Io['fetch'],
    self: { node: '/usr/bin/node', script: '/home/tj/.local/bin/kanso', cwd: dir },
    runProgram,
  }
  return {
    programs, questions, left: () => queue.length, out: () => out.join(''), err: () => err.join(''),
    cli: async (...argv: string[]) => {
      await mkdir(bin, { recursive: true })
      await writeFile(join(bin, 'claude'), '#!/bin/sh\n')
      await chmod(join(bin, 'claude'), 0o755)
      if (Object.keys(profiles).length) await writeFile(join(dir, 'config.json'), JSON.stringify({ profiles }))
      return run(argv, io)
    },
    unit: (name: string) => readFile(join(dir, 'cfg', 'systemd', 'user', `${name}.service`), 'utf8'),
  }
}

describe('prompt helpers', () => {
  it('parses numbered selections', () => {
    expect(parseSelection('1,3', 4)).toEqual([0, 2])
    expect(parseSelection('2-4 1', 4)).toEqual([0, 1, 2, 3])
    expect(parseSelection('all', 3)).toEqual([0, 1, 2])
    expect(parseSelection('none', 3)).toEqual([])
    expect(parseSelection('5', 4)).toBeNull()
    expect(parseSelection('3-2', 4)).toBeNull()
    expect(parseSelection('x', 4)).toBeNull()
  })

  it('quotes the printed command for the shell', () => {
    expect(shellQuote('--board')).toBe('--board')
    expect(shellQuote('it\'s done')).toBe(`'it'\\''s done'`)
    expect(installCommand(['--cmd', 'echo $HOME'])).toBe(`kanso agent install --cmd 'echo $HOME'`)
    expect(nameFromBoard('Ops Board!')).toBe('ops-board')
    expect(nameFromBoard('Ärger')).toBe('arger')
  })
})

describe('kanso agent setup', () => {
  it('refuses without a terminal or with --json, pointing at the flags', async () => {
    const h = harness([], { interactive: false })
    expect(await h.cli('agent', 'setup')).toBe(2)
    expect(h.err()).toContain('cannot run without a terminal')
    expect(h.err()).toContain('kanso agent install --board')
    expect(await h.cli('agent', 'install')).toBe(2)
    expect(await harness([]).cli('agent', 'setup', '--json')).toBe(2)
    expect(await harness([]).cli('agent', 'setup', '--claude')).toBe(2)
    expect(h.questions).toEqual([])
  })

  it('walks through agent rules with Claude in worktrees, prints the command and does a dry run', async () => {
    execFileSync('git', ['init', '-q', join(dir, 'repo')])
    const h = harness([
      '', // saved profile "default"
      '1', // board Kanso
      '', // agent rules
      '', // Claude
      '3', // auto
      '', // worktree: yes (a repo is here)
      '', // the repo
      'pnpm install',
      'y', // log time
      '2', // concurrency
      '', // no timeout
      '', // name from the board: kanso
      '', // workdir
      '2', // dry run
    ])
    expect(await h.cli('agent', 'setup')).toBe(0)
    expect(h.left()).toBe(0)
    const out = h.out()
    expect(out).toContain('bot "Triage bot"')
    expect(out).toContain('agent rules for this bot  (1 active rule)')
    const command = `kanso agent install --profile default --board ${B1} --claude --permission-mode auto --worktree ${join(dir, 'repo')} --setup 'pnpm install' --log-time --concurrency 2 --name kanso`
    expect(out).toContain(command)
    // No --prompt or --comment question in rules mode.
    expect(h.questions.join('\n')).not.toMatch(/Instructions for Claude|exit status/)
    expect(out).toContain(`agent run --board ${B1} --claude --permission-mode auto --worktree ${join(dir, 'repo')} --setup "pnpm install" --log-time --concurrency 2\n`)
    expect(h.programs.filter(p => p.startsWith('systemctl'))).toEqual([])
    await expect(h.unit('kanso-agent-kanso')).rejects.toThrow()
  })

  it('takes a new token, columns and a command, and installs on "kanso agent install" without options', async () => {
    const h = harness([
      'https://k.test/kanso/', // site
      '', // profile name: default
      '1-2', // both boards
      '1', // columns (no rules: not a bot)
      '1', // Kanso: To do
      'moved, commented', // activity
      '2', // a command
      './handle.sh "$KANSO_CARD_ID"',
      '', // concurrency 1
      '30', // timeout
      '2', // comment on failure
      'none', // plain kanso-agent
      '', // workdir
      '', // install
    ], { isBot: false, profiles: {}, secret: other })
    expect(await h.cli('agent', 'install')).toBe(0)
    expect(h.left()).toBe(0)
    expect(h.out()).toContain('A bot\'s token is safer')
    expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))).toEqual({ profiles: { default: { url: 'https://k.test/kanso', token: other } } })
    expect(h.out()).toContain(`kanso agent install --profile default --board ${B1},${B2} --columns ${TODO} --activity moved,commented --cmd './handle.sh "$KANSO_CARD_ID"' --timeout 30 --comment failure\n`)
    const unit = await h.unit('kanso-agent')
    expect(unit).toContain(`agent run --board ${B1},${B2} --activity moved,commented --columns ${TODO} --cmd "./handle.sh \\"$$KANSO_CARD_ID\\"" --comment failure --timeout 30\n`)
    expect(h.programs).toContain('systemctl --user restart kanso-agent.service')
    expect(h.err()).toContain('the token is Alice\'s own')
  })

  it('asks again for a site URL without a scheme and for another profile name when not replacing', async () => {
    const h = harness([
      '2', // enter another site
      'k.test/kanso', // no scheme
      'https://k.test/kanso',
      'default', // exists
      'n', // keep it
      'second',
    ], { secret: other })
    expect(await h.cli('agent', 'setup')).toBe(1) // the answers end after the profile
    expect(h.out()).toContain('Start the URL with https:// (or http://), e.g. https://k.test/kanso')
    expect(h.questions.filter(q => q.startsWith('Save it as profile'))).toHaveLength(2)
    expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')).profiles).toEqual({
      default: { url: 'https://k.test/kanso', token },
      second: { url: 'https://k.test/kanso', token: other },
    })
  })

  it('suggests the main checkout for worktrees', async () => {
    const h = harness(['', '1', '', '', '2', '', '', '', '', '', '', '', '', '3'])
    expect(await h.cli('agent', 'setup')).toBe(0)
    expect(h.programs).toContain(`git -C ${dir} rev-parse --path-format=absolute --git-common-dir`)
    expect(h.out()).toContain(`Git repository [${join(dir, 'repo')}]`)
  })

  it('stops when the input ends, and can just print the command', async () => {
    const h = harness(['', '1'])
    expect(await h.cli('agent', 'setup')).toBe(1)
    expect(h.err()).toContain('Cancelled; nothing was changed.')
    const s = harness(['', '2', '3', '', '', '', '', 'n', '', '', '', '', '', '', '3'])
    expect(await s.cli('agent', 'setup')).toBe(0)
    expect(s.left()).toBe(0)
    expect(s.out()).toContain(`kanso agent install --profile default --board ${B2} --notifications --claude --name ops-board\n`)
    expect(s.out()).toContain('Nothing was installed.')
    expect(s.programs.filter(p => !p.startsWith('git'))).toEqual([])
  })
})
