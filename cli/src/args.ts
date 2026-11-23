import { parseArgs } from 'node:util'
import { UsageError } from './io.ts'

export type OptionSpec = { type: 'string' | 'boolean', short?: string, description: string, value?: string, /** May be given several times (values collected in order). */ multiple?: boolean }
export type OptionSpecs = Record<string, OptionSpec>

/** Options every command takes. */
export const globalOptions: OptionSpecs = {
  profile: { type: 'string', value: '<name>', description: 'Use this stored profile (default: KANSO_PROFILE, else "default")' },
  json: { type: 'boolean', description: 'Print JSON instead of text (errors too, on stderr)' },
  help: { type: 'boolean', short: 'h', description: 'Show help' },
}

export type Values = Record<string, string | boolean | string[] | undefined>

export interface Parsed {
  /** The command words (e.g. `cards ls`), or null when there is none (e.g. `kanso --help`). */
  command: string | null
  positionals: string[]
  values: Values
}

/** Global options that take a value, so their value is not mistaken for the command. */
const valued = new Set(Object.entries(globalOptions).filter(([, o]) => o.type === 'string').flatMap(([k, o]) => ['--' + k, ...(o.short ? ['-' + o.short] : [])]))

/** The command word: the first argument that is neither an option nor a global option's value. */
export function findCommand(argv: string[]): { command: string | null, rest: string[] } {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--') return { command: argv[i + 1] ?? null, rest: [...argv.slice(0, i), ...argv.slice(i + 2)] }
    if (a.startsWith('-')) {
      if (valued.has(a)) i++
      continue
    }
    return { command: a, rest: [...argv.slice(0, i), ...argv.slice(i + 1)] }
  }
  return { command: null, rest: argv }
}

/**
 * Parses the arguments after the command (`words` words long, e.g. 2 for `cards ls`) with the
 * global options plus the command's own; unknown options are usage errors.
 */
export function parseCommandArgs(argv: string[], options: OptionSpecs = {}, words = 1): Parsed {
  const names: string[] = []
  let rest = argv
  for (let i = 0; i < words; i++) {
    const found = findCommand(rest)
    if (found.command === null) break
    names.push(found.command)
    rest = found.rest
  }
  const command = names.length ? names.join(' ') : null
  const all = { ...globalOptions, ...options }
  const config = Object.fromEntries(Object.entries(all).map(([k, o]) => [k, { type: o.type, ...(o.short && { short: o.short }), ...(o.multiple && { multiple: true }) }]))
  try {
    const { values, positionals } = parseArgs({ args: rest, options: config, allowPositionals: true, strict: true })
    return { command, positionals, values: values as Values }
  } catch (err) {
    // Node's message goes on about '--' for positionals; the first sentence is enough.
    throw new UsageError(`${(err as Error).message.split(/\.\s/)[0]!.replace(/\.$/, '')}.`)
  }
}

/** Option lines for help text, aligned. */
export function describeOptions(options: OptionSpecs): string {
  const rows = Object.entries(options).map(([k, o]) => [`${o.short ? `-${o.short}, ` : '    '}--${k}${o.value ? ` ${o.value}` : ''}`, o.description] as const)
  const width = Math.max(...rows.map(([l]) => l.length))
  return rows.map(([l, d]) => `  ${l.padEnd(width)}  ${d}`).join('\n')
}
