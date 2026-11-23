import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkToken, configPath, loadConfig, normalizeUrl, profileName, resolveCredentials, saveConfig } from '../../../cli/src/config'
import { CliError, UsageError } from '../../../cli/src/io'

const token = `kb_${'a'.repeat(43)}`
let dir = ''
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'kanso-cli-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('cli config file', () => {
  it('lives in KANSO_CONFIG, else XDG_CONFIG_HOME, else ~/.config', () => {
    expect(configPath({}, '/home/u')).toBe('/home/u/.config/kanso/config.json')
    expect(configPath({ XDG_CONFIG_HOME: '/x' }, '/home/u')).toBe('/x/kanso/config.json')
    expect(configPath({ XDG_CONFIG_HOME: '/x', KANSO_CONFIG: '/c.json' }, '/home/u')).toBe('/c.json')
  })

  it('starts empty, round-trips and is readable by its owner only', async () => {
    const path = join(dir, 'kanso', 'config.json')
    expect(await loadConfig(path)).toEqual({ profiles: {} })
    await saveConfig(path, { profiles: { default: { url: 'https://k.test', token } } })
    expect(await loadConfig(path)).toEqual({ profiles: { default: { url: 'https://k.test', token } } })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(dir, 'kanso'))).mode & 0o777).toBe(0o700)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ profiles: { default: { url: 'https://k.test', token } } })
  })

  it('tightens an existing file to 600 when saving', async () => {
    const path = join(dir, 'config.json')
    await writeFile(path, '{}', { mode: 0o644 })
    await saveConfig(path, { profiles: {} })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('reports a broken file and skips malformed profiles', async () => {
    const path = join(dir, 'config.json')
    await writeFile(path, 'not json')
    await expect(loadConfig(path)).rejects.toThrow(CliError)
    await writeFile(path, JSON.stringify({ profiles: { ok: { url: 'https://a', token }, bad: { url: 1 }, nul: null } }))
    expect(await loadConfig(path)).toEqual({ profiles: { ok: { url: 'https://a', token } } })
  })
})

describe('cli profiles and credentials', () => {
  it('picks the profile from the flag, then KANSO_PROFILE, then default', () => {
    expect(profileName(undefined, {})).toBe('default')
    expect(profileName(undefined, { KANSO_PROFILE: 'work' })).toBe('work')
    expect(profileName('home', { KANSO_PROFILE: 'work' })).toBe('home')
    expect(() => profileName('a/b', {})).toThrow(UsageError)
  })

  it('normalizes site URLs and keeps a base path', () => {
    expect(normalizeUrl('https://k.test/')).toBe('https://k.test')
    expect(normalizeUrl(' https://host/kanso/?x=1#y ')).toBe('https://host/kanso')
    expect(normalizeUrl('http://localhost:3000')).toBe('http://localhost:3000')
    expect(() => normalizeUrl('k.test')).toThrow(UsageError)
    expect(() => normalizeUrl('ftp://k.test')).toThrow(UsageError)
    expect(() => normalizeUrl('https://u:p@k.test')).toThrow(UsageError)
  })

  it('accepts only kb_ tokens', () => {
    expect(checkToken(` ${token}\n`)).toBe(token)
    expect(() => checkToken('kb_short')).toThrow(UsageError)
    expect(() => checkToken('ghp_abcdefghijklmnopqrstuvwxyz')).toThrow(UsageError)
  })

  it('lets KANSO_URL and KANSO_TOKEN override the stored profile, each on its own', () => {
    const config = { profiles: { default: { url: 'https://a.test', token }, work: { url: 'https://w.test', token } } }
    expect(resolveCredentials(config, 'default', {})).toEqual({ url: 'https://a.test', token, profile: 'default', source: { url: 'config', token: 'config' } })
    const other = `kb_${'b'.repeat(43)}`
    expect(resolveCredentials(config, 'work', { KANSO_TOKEN: other })).toEqual({ url: 'https://w.test', token: other, profile: 'work', source: { url: 'config', token: 'env' } })
    expect(resolveCredentials({ profiles: {} }, 'default', { KANSO_URL: 'https://e.test/', KANSO_TOKEN: token }).url).toBe('https://e.test')
  })

  it('says how to log in when nothing is stored', () => {
    expect(() => resolveCredentials({ profiles: {} }, 'default', {})).toThrow(/Not logged in\. Run: kanso login --url/)
    expect(() => resolveCredentials({ profiles: {} }, 'work', { KANSO_URL: 'https://e.test' })).toThrow(/profile "work".*--profile work/)
  })
})
