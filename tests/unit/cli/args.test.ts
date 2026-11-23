import { describe, expect, it } from 'vitest'
import { findCommand, parseCommandArgs } from '../../../cli/src/args'
import { UsageError } from '../../../cli/src/io'

describe('cli arguments', () => {
  it('finds the command after global options and their values', () => {
    expect(findCommand(['whoami'])).toEqual({ command: 'whoami', rest: [] })
    expect(findCommand(['--profile', 'work', '--json', 'whoami', 'x'])).toEqual({ command: 'whoami', rest: ['--profile', 'work', '--json', 'x'] })
    expect(findCommand(['--profile=work', 'login'])).toEqual({ command: 'login', rest: ['--profile=work'] })
    expect(findCommand(['--json'])).toEqual({ command: null, rest: ['--json'] })
    expect(findCommand([])).toEqual({ command: null, rest: [] })
  })

  it('parses global and command options anywhere around the command', () => {
    const parsed = parseCommandArgs(['login', '--url', 'https://x', '--profile', 'p', '--json'], { url: { type: 'string', description: '' } })
    expect(parsed).toEqual({ command: 'login', positionals: [], values: { url: 'https://x', profile: 'p', json: true } })
    expect(parseCommandArgs(['-h', 'whoami']).values.help).toBe(true)
    expect(parseCommandArgs(['whoami', 'extra']).positionals).toEqual(['extra'])
  })

  it('refuses unknown options and missing values as usage errors', () => {
    expect(() => parseCommandArgs(['whoami', '--nope'])).toThrow(UsageError)
    expect(() => parseCommandArgs(['whoami', '--nope'])).toThrow("Unknown option '--nope'.")
    expect(() => parseCommandArgs(['whoami', '--profile'])).toThrow(UsageError)
    // A command's options belong to that command only.
    expect(() => parseCommandArgs(['whoami', '--url', 'x'])).toThrow(UsageError)
  })
})
