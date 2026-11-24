import { access, constants, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { CliError, UsageError } from './io.ts'

/** `kanso agent install` / `uninstall`: a systemd user unit that runs `kanso agent run`. */

export interface AgentUnitPaths {
  /** systemd unit name, e.g. kanso-agent-triage.service */
  unit: string
  unitPath: string
  envPath: string
}

/** The agent's name (--name): letters, digits, "_" and "-"; none = the plain kanso-agent unit. */
export function checkAgentName(name: string | undefined): string | undefined {
  if (name === undefined || name === '') return undefined
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(name)) throw new UsageError(`Invalid --name "${name}" (up to 40 letters, digits, "_" and "-").`)
  return name
}

/** Where the unit and its environment file go: $XDG_CONFIG_HOME (else ~/.config)/systemd/user and /kanso. */
export function agentUnitPaths(name: string | undefined, env: Record<string, string | undefined>, home: string): AgentUnitPaths {
  const base = env.XDG_CONFIG_HOME || join(home, '.config')
  const suffix = name ? `-${name}` : ''
  const unit = `kanso-agent${suffix}.service`
  return { unit, unitPath: join(base, 'systemd', 'user', unit), envPath: join(base, 'kanso', `agent${suffix}.env`) }
}

/**
 * One argument for ExecStart=: plain when safe, else double-quoted with C escapes. systemd
 * expands %-specifiers and $VARIABLES there, so % and $ are doubled either way.
 */
export function systemdArg(arg: string): string {
  const escaped = arg.replace(/%/g, '%%').replace(/\$/g, '$$$$')
  if (/^[\w@+=:,./-]+$/.test(arg)) return escaped
  return `"${escaped.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`
}

/** A value for Environment="KEY=value": quoted with C escapes, % doubled (no $ expansion there). */
function systemdEnv(key: string, value: string): string {
  return `Environment="${`${key}=${value}`.replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** A path for WorkingDirectory= / EnvironmentFile= (no quoting there, only specifiers). */
function systemdPath(path: string): string {
  if (/[\n\r]/.test(path)) throw new UsageError(`Unusable path "${path}".`)
  return path.replace(/%/g, '%%')
}

/** PATH for the unit: node's and claude's directories first, then the absolute entries of the current PATH. */
export function unitPath(dirs: string[], current: string | undefined): string {
  const all = [...dirs, ...(current ?? '').split(delimiter)].filter(d => d && isAbsolute(d))
  return [...new Set(all)].join(delimiter)
}

export interface UnitSpec {
  name: string | undefined
  envPath: string
  workdir: string
  node: string
  script: string
  /** Arguments after `agent run`. */
  runArgs: string[]
  path: string
  /** Extra Environment= lines (KANSO_CLAUDE_BIN). */
  env: Record<string, string>
  /** Comment lines naming the boards and columns (the arguments carry ids). */
  notes: string[]
}

export function unitFile(spec: UnitSpec): string {
  const exec = [spec.node, spec.script, 'agent', 'run', ...spec.runArgs].map(systemdArg).join(' ')
  const name = spec.name ? ` --name ${spec.name}` : ''
  return `# Written by "kanso agent install${name}". Run it again to change the agent,
# "kanso agent uninstall${name}" to remove it.
${spec.notes.map(n => `# ${n.replace(/[\r\n]+/g, ' ')}\n`).join('')}
[Unit]
Description=kanso agent run${spec.name ? ` (${spec.name})` : ''}
After=network-online.target

[Service]
EnvironmentFile=${systemdPath(spec.envPath)}
${[['PATH', spec.path] as const, ...Object.entries(spec.env)].map(([k, v]) => systemdEnv(k, v)).join('\n')}
WorkingDirectory=${systemdPath(spec.workdir)}
ExecStart=${exec}
Restart=on-failure
RestartSec=30
# The runner sends its runs SIGTERM first and waits for them.
KillMode=mixed
TimeoutStopSec=120

[Install]
WantedBy=default.target
`
}

/** The environment file: URL and token, single-quoted (systemd reads it without expanding anything). */
export function envFile(url: string, token: string): string {
  for (const v of [url, token]) if (/['\n\r\\]/.test(v)) throw new CliError('The site URL or token contains characters the environment file cannot hold.')
  return `# kanso agent: the site and token the agent uses. Keep this file private (mode 600).\nKANSO_URL='${url}'\nKANSO_TOKEN='${token}'\n`
}

/** kb_abcd… : enough to recognise the token in --dry-run output, never the token. */
export function maskToken(token: string): string {
  return `${token.slice(0, 7)}…`
}

/** Writes a file through a temp file in the same directory (dir created with `dirMode`). */
export async function writeFileAtomic(path: string, text: string, mode: number, dirMode = 0o755): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: dirMode })
  const tmp = `${path}.${process.pid}.tmp`
  try {
    await writeFile(tmp, text, { mode })
    await rename(tmp, path)
  } catch (err) {
    await rm(tmp, { force: true })
    throw new CliError(`Cannot write ${path}: ${(err as Error).message}`)
  }
}

/** An existing directory, as an absolute path. */
export async function checkWorkdir(dir: string, cwd: string): Promise<string> {
  const abs = resolve(cwd, dir)
  const s = await stat(abs).catch(() => null)
  if (!s?.isDirectory()) throw new UsageError(`--workdir ${dir}: no such directory.`)
  return abs
}

/** The absolute path of a program: as given when it has a slash, else the first executable match on PATH. */
export async function findProgram(program: string, path: string | undefined, cwd: string): Promise<string | null> {
  const candidates = program.includes('/') ? [resolve(cwd, program)] : (path ?? '').split(delimiter).filter(isAbsolute).map(d => join(d, program))
  for (const c of candidates) {
    if (await access(c, constants.X_OK).then(() => true, () => false)) return c
  }
  return null
}

export function fileExists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false)
}
