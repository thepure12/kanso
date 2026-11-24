import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { systemdArg, unitPath } from '../../../cli/src/agentInstall'
import type { Io, ProgramResult } from '../../../cli/src/io'
import { run } from '../../../cli/src/main'

const token = `kb_${'a'.repeat(43)}`
const B = '11111111-1111-4111-8111-111111111111'
const TODO = 'aaaaaaaa-0000-4000-8000-000000000001'
const BOT = 'cccccccc-0000-4000-8000-000000000001'

let dir = ''
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'kanso-install-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

function harness(opts: { isBot?: boolean, systemd?: boolean, linger?: string, claude?: boolean } = {}) {
  const { isBot = true, systemd = true, linger = 'no', claude = true } = opts
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname.replace(/^\/kanso/, '')
    if (path === '/api/me') return Response.json({ id: BOT, name: isBot ? 'Triage bot' : 'Alice', email: 'x@k.test', isBot, isAdmin: false, locale: null })
    if (path === '/api/boards') return Response.json([{ id: B, name: 'Kanso' }])
    if (path === `/api/boards/${B}`) return Response.json({ id: B, name: 'Kanso', columns: [{ id: TODO, title: 'To do' }] })
    return Response.json({ statusCode: 404, message: 'Not found' }, { status: 404 })
  })
  const programs: string[] = []
  const runProgram = vi.fn(async (file: string, args: string[]): Promise<ProgramResult> => {
    programs.push([file, ...args].join(' '))
    if (!systemd && file === 'systemctl') return { code: null, stdout: '', stderr: 'spawn systemctl ENOENT' }
    if (file === 'loginctl') return { code: 0, stdout: `${linger}\n`, stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  })
  const out: string[] = []
  const err: string[] = []
  const bin = join(dir, 'bin')
  const io: Io = {
    env: { KANSO_CONFIG: join(dir, 'config.json'), KANSO_URL: 'https://k.test/kanso', KANSO_TOKEN: token, XDG_CONFIG_HOME: join(dir, 'cfg'), PATH: `${bin}:relative:/usr/bin`, USER: 'tj' },
    home: dir,
    stdout: t => out.push(t),
    stderr: t => err.push(t),
    readSecret: async () => '',
    fetch: fetch as unknown as Io['fetch'],
    self: { node: '/opt/node 22/bin/node', script: '/home/tj/.local/bin/kanso', cwd: dir },
    runProgram,
  }
  const setup = async () => {
    await mkdir(bin, { recursive: true })
    if (claude) {
      await writeFile(join(bin, 'claude'), '#!/bin/sh\n')
      await chmod(join(bin, 'claude'), 0o755)
    }
  }
  return {
    programs, out: () => out.join(''), err: () => err.join(''),
    cli: async (...argv: string[]) => { await setup(); return run(argv, io) },
    unit: (name = 'kanso-agent') => readFile(join(dir, 'cfg', 'systemd', 'user', `${name}.service`), 'utf8'),
    envPath: (name = 'agent') => join(dir, 'cfg', 'kanso', `${name}.env`),
  }
}

describe('kanso agent install', () => {
  it('quotes ExecStart arguments for systemd', () => {
    expect(systemdArg('--board')).toBe('--board')
    expect(systemdArg('50%')).toBe('"50%%"')
    expect(systemdArg('say "hi" $HOME\nnow')).toBe('"say \\"hi\\" $$HOME\\nnow"')
    expect(unitPath(['/n/bin', '/c/bin'], '/c/bin:rel:/usr/bin')).toBe('/n/bin:/c/bin:/usr/bin')
  })

  it('writes the unit and the token file, then enables and starts it', async () => {
    const h = harness()
    expect(await h.cli('agent', 'install', '--name', 'triage', '--board', 'Kanso', '--columns', 'to do', '--claude', '--comment', 'failure', '--prompt', 'Fix "it" 100%')).toBe(0)
    const unit = await h.unit('kanso-agent-triage')
    expect(unit).toContain(`EnvironmentFile=${h.envPath('agent-triage')}`)
    expect(unit).toContain(`WorkingDirectory=${dir}`)
    expect(unit).toContain(`Environment="PATH=/opt/node 22/bin:${join(dir, 'bin')}:/usr/bin"`)
    expect(unit).toContain(`ExecStart="/opt/node 22/bin/node" /home/tj/.local/bin/kanso agent run --board ${B} --activity created,moved --columns ${TODO} --claude --prompt "Fix \\"it\\" 100%%" --comment failure\n`)
    expect(unit).toContain('# Runs as Triage bot (bot) on https://k.test/kanso')
    expect(unit).toContain(`# Column ${TODO}: To do`)
    expect(unit).toContain('KillMode=mixed')
    const envPath = h.envPath('agent-triage')
    expect(await readFile(envPath, 'utf8')).toContain(`KANSO_URL='https://k.test/kanso'\nKANSO_TOKEN='${token}'\n`)
    expect((await stat(envPath)).mode & 0o777).toBe(0o600)
    expect(h.programs).toEqual([
      'systemctl --user show --property=Version',
      'systemctl --user daemon-reload',
      'systemctl --user enable kanso-agent-triage.service',
      'systemctl --user restart kanso-agent-triage.service',
      'loginctl show-user tj --property=Linger --value',
    ])
    expect(h.out()).toContain('journalctl --user -u kanso-agent-triage -f')
    expect(h.out()).toContain('loginctl enable-linger tj')
    expect(h.err()).toBe('')
  })

  it('previews without writing, and never prints the token', async () => {
    const h = harness({ linger: 'yes' })
    expect(await h.cli('agent', 'install', '--dry-run', '--notifications', '--cmd', './handle.sh')).toBe(0)
    expect(h.out()).toContain('ExecStart="/opt/node 22/bin/node" /home/tj/.local/bin/kanso agent run --notifications --cmd ./handle.sh')
    expect(h.out()).toContain("KANSO_TOKEN='kb_aaaa…'")
    expect(h.out()).not.toContain(token)
    expect(h.programs).toEqual([])
    await expect(h.unit()).rejects.toThrow()
  })

  it('checks the options like agent run and warns about a personal token', async () => {
    const h = harness({ isBot: false })
    expect(await h.cli('agent', 'install', '--board', 'Kanso', '--claude')).toBe(2)
    expect(h.err()).toContain('Agent rules name a bot')
    const p = harness({ isBot: false })
    expect(await p.cli('agent', 'install', '--board', 'Kanso', '--activity', 'moved', '--cmd', 'true')).toBe(0)
    expect(p.err()).toContain("the token is Alice's own")
    expect(await harness().cli('agent', 'run', '--name', 'x', '--notifications', '--cmd', 'true')).toBe(2)
  })

  it('needs claude on PATH for --claude', async () => {
    const h = harness({ claude: false })
    expect(await h.cli('agent', 'install', '--notifications', '--claude')).toBe(1)
    expect(h.err()).toContain('claude was not found on PATH')
  })

  it('writes nothing without a systemd user manager', async () => {
    const h = harness({ systemd: false })
    expect(await h.cli('agent', 'install', '--notifications', '--cmd', 'true')).toBe(1)
    expect(h.err()).toContain('No systemd user manager here')
    expect(h.out()).toContain('[Service]')
    await expect(h.unit()).rejects.toThrow()
  })

  it('uninstalls: stops the unit and removes both files', async () => {
    const h = harness()
    expect(await h.cli('agent', 'install', '--name', 'triage', '--notifications', '--cmd', 'true')).toBe(0)
    const u = harness()
    expect(await u.cli('agent', 'uninstall', '--name', 'triage')).toBe(0)
    expect(u.programs[0]).toBe('systemctl --user disable --now kanso-agent-triage.service')
    await expect(u.unit('kanso-agent-triage')).rejects.toThrow()
    await expect(readFile(u.envPath('agent-triage'))).rejects.toThrow()
    expect(u.out()).toContain('revoke it in Kanso')
    const again = harness()
    expect(await again.cli('agent', 'uninstall', '--name', 'triage')).toBe(1)
    expect(again.err()).toContain('No agent "triage" is installed')
    expect(await again.cli('agent', 'uninstall', '--board', 'x')).toBe(2)
  })
})
