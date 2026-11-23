// The kanso CLI installer served at /cli/install.sh (server/utils/cliInstall.ts), run for real
// with sh against a file:// "site" holding a stand-in cli/kanso.mjs.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { cliInstallScript, shellQuote } from '../../server/utils/cliInstall'
import { cliInstallCommand, cliLoginCommand } from '../../app/utils/cliInstall'

const run = promisify(execFile)
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))) })

async function site(cli: string) {
  const dir = await mkdtemp(join(tmpdir(), 'kanso-install-'))
  dirs.push(dir)
  await mkdir(join(dir, 'site', 'cli'), { recursive: true })
  await writeFile(join(dir, 'site', 'cli', 'kanso.mjs'), cli)
  await writeFile(join(dir, 'install.sh'), cliInstallScript(`file://${join(dir, 'site')}`))
  return dir
}

const sh = (dir: string, env: Record<string, string> = {}) =>
  run('sh', [join(dir, 'install.sh')], { env: { PATH: process.env.PATH!, HOME: join(dir, 'home'), ...env } })

describe('cli install script', () => {
  it('quotes the site for sh', () => {
    expect(shellQuote(`a'b`)).toBe(`'a'"'"'b'`)
    expect(cliInstallScript(`https://x.test/it's`)).toContain(`site='https://x.test/it'"'"'s'`)
  })

  it('downloads kanso.mjs into ~/.local/bin/kanso, executable, and prints the version and the next step', async () => {
    const dir = await site(`#!/usr/bin/env node\nconsole.log('9.9.9')\n`)
    const { stdout } = await sh(dir)
    const bin = join(dir, 'home', '.local', 'bin', 'kanso')
    expect(await readFile(bin, 'utf8')).toContain(`console.log('9.9.9')`)
    expect((await stat(bin)).mode & 0o777).toBe(0o755)
    expect(stdout).toContain(`Installed kanso 9.9.9 to ${bin}`)
    expect(stdout).toContain('is not on your PATH')
    expect(stdout).toContain(`Next: kanso login --url file://${join(dir, 'site')}`)
  })

  it('honours KANSO_BIN_DIR and replaces an older copy', async () => {
    const dir = await site(`#!/usr/bin/env node\nconsole.log('2.0.0')\n`)
    const binDir = join(dir, 'bin')
    await mkdir(binDir)
    await writeFile(join(binDir, 'kanso'), 'old')
    const { stdout } = await sh(dir, { KANSO_BIN_DIR: binDir, PATH: `${binDir}:${process.env.PATH}` })
    expect(await readFile(join(binDir, 'kanso'), 'utf8')).toContain('2.0.0')
    expect(stdout).not.toContain('is not on your PATH')
  })

  it('refuses a download that is not the CLI and leaves nothing behind', async () => {
    const dir = await site('<html>login</html>')
    await expect(sh(dir)).rejects.toMatchObject({ stderr: expect.stringContaining('is not the kanso CLI') })
    await expect(stat(join(dir, 'home', '.local', 'bin', 'kanso'))).rejects.toThrow()
  })

  it('builds the commands shown in the UI', () => {
    expect(cliInstallCommand('https://h.test/kanso')).toBe('curl -fsSL https://h.test/kanso/cli/install.sh | sh')
    expect(cliLoginCommand('https://h.test/kanso')).toBe('kanso login --url https://h.test/kanso')
  })
})
