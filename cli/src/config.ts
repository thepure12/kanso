import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CliError, UsageError } from './io.ts'

/** One Kanso instance: its URL (with any base path, no trailing slash) and an API token. */
export interface Profile {
  url: string
  token: string
}

/** ~/.config/kanso/config.json (mode 600). */
export interface Config {
  profiles: Record<string, Profile>
}

export const defaultProfile = 'default'

/** `$XDG_CONFIG_HOME/kanso/config.json`, else `~/.config/kanso/config.json`; `KANSO_CONFIG` names the file directly. */
export function configPath(env: Record<string, string | undefined>, home: string): string {
  if (env.KANSO_CONFIG) return env.KANSO_CONFIG
  const base = env.XDG_CONFIG_HOME || join(home, '.config')
  return join(base, 'kanso', 'config.json')
}

export async function loadConfig(path: string): Promise<Config> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { profiles: {} }
    throw new CliError(`Cannot read ${path}: ${(err as Error).message}`)
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new CliError(`${path} is not valid JSON. Fix or delete it, then run kanso login again.`)
  }
  const profiles: Record<string, Profile> = {}
  const raw = (data as { profiles?: unknown })?.profiles
  if (raw && typeof raw === 'object') {
    for (const [name, p] of Object.entries(raw as Record<string, unknown>)) {
      const { url, token } = (p ?? {}) as Record<string, unknown>
      if (typeof url === 'string' && typeof token === 'string') profiles[name] = { url, token }
    }
  }
  return { profiles }
}

/** Writes the file readable by its owner only (dir 700, file 600), through a temp file so a crash never leaves half a file. */
export async function saveConfig(path: string, config: Config): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const tmp = `${path}.${process.pid}.tmp`
  try {
    await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
    await chmod(tmp, 0o600)
    await rename(tmp, path)
  } catch (err) {
    await rm(tmp, { force: true })
    throw new CliError(`Cannot write ${path}: ${(err as Error).message}`)
  }
}

/** The profile name: --profile, else KANSO_PROFILE, else "default". */
export function profileName(flag: string | undefined, env: Record<string, string | undefined>): string {
  const name = flag ?? env.KANSO_PROFILE ?? defaultProfile
  if (!/^[\w.-]{1,64}$/.test(name)) throw new UsageError(`Invalid profile name "${name}" (letters, digits, "_", "-", "." only).`)
  return name
}

/**
 * The site URL as stored: http(s) only, no query or fragment, no trailing slash
 * (a base path such as https://host/kanso stays).
 */
export function normalizeUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new UsageError(`Invalid URL "${input}". Use the address of the Kanso site, e.g. https://kanso.example.org.`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UsageError(`Invalid URL "${input}": only http and https are supported.`)
  if (url.username || url.password) throw new UsageError('Leave the user name and password out of the URL.')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

/** API tokens look like kb_<base64url> (Account → API tokens, or a bot's token). */
export function checkToken(token: string): string {
  const t = token.trim()
  if (!/^kb_[\w-]{20,}$/.test(t)) throw new UsageError('That does not look like a Kanso API token (kb_...). Create one under Account → API tokens.')
  return t
}

/** Where a command's URL and token come from: KANSO_URL / KANSO_TOKEN override the stored profile, each on its own. */
export interface Credentials {
  url: string
  token: string
  profile: string
  source: { url: 'env' | 'config', token: 'env' | 'config' }
}

export function resolveCredentials(config: Config, profile: string, env: Record<string, string | undefined>): Credentials {
  const stored = config.profiles[profile]
  const url = env.KANSO_URL || stored?.url
  const token = env.KANSO_TOKEN || stored?.token
  if (!url || !token) {
    const which = profile === defaultProfile ? '' : ` --profile ${profile}`
    throw new CliError(`Not logged in${profile === defaultProfile ? '' : ` (profile "${profile}")`}. Run: kanso login${which} --url <site> --token <kb_...>, or set KANSO_URL and KANSO_TOKEN.`)
  }
  return {
    url: normalizeUrl(url),
    token: checkToken(token),
    profile,
    source: { url: env.KANSO_URL ? 'env' : 'config', token: env.KANSO_TOKEN ? 'env' : 'config' },
  }
}
