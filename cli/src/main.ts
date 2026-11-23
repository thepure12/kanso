import { describeOptions, findCommand, globalOptions, parseCommandArgs } from './args.ts'
import { ApiError } from './client.ts'
import { configPath, profileName } from './config.ts'
import { login, logout, whoami } from './commands/auth.ts'
import type { Command } from './commands/types.ts'
import { CliError, type Io, UsageError } from './io.ts'
import { json } from './output.ts'
import { VERSION } from './version.ts'

export const commands: Command[] = [login, logout, whoami]

function mainHelp(): string {
  const width = Math.max(...commands.map(c => c.name.length))
  return `kanso ${VERSION}: command line client for Kanso boards

Usage: kanso <command> [options]

Commands:
${commands.map(c => `  ${c.name.padEnd(width)}  ${c.summary}`).join('\n')}

Options:
${describeOptions({ ...globalOptions, version: { type: 'boolean', description: 'Show the version' } })}

Environment:
  KANSO_URL, KANSO_TOKEN  Override the stored site URL and token
  KANSO_PROFILE           Profile to use when --profile is not given
  KANSO_CONFIG            Config file (default: ~/.config/kanso/config.json)

Run "kanso <command> --help" for a command's options.
`
}

function commandHelp(c: Command): string {
  return `Usage: kanso ${c.usage}

${c.summary}.${c.details ? `\n${c.details}` : ''}

Options:
${describeOptions({ ...c.options, ...globalOptions })}
`
}

/** Runs one CLI invocation; returns the exit code (0 ok, 1 failed, 2 usage). */
export async function run(argv: string[], io: Io): Promise<number> {
  const wantsJson = argv.includes('--json')
  try {
    if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v' || argv[0] === 'version')) {
      io.stdout(wantsJson ? json({ version: VERSION }) : `${VERSION}\n`)
      return 0
    }
    const first = findCommand(argv).command
    if (first === null || first === 'help') {
      const target = first === 'help' ? commands.find(c => c.name === argv[argv.indexOf('help') + 1]) : undefined
      io.stdout(target ? commandHelp(target) : mainHelp())
      return first === null && !argv.includes('--help') && !argv.includes('-h') ? 2 : 0
    }
    const command = commands.find(c => c.name === first)
    if (!command) throw new UsageError(`Unknown command "${first}". Run "kanso --help" for the list.`)
    const { values, positionals } = parseCommandArgs(argv, command.options)
    if (values.help) {
      io.stdout(commandHelp(command))
      return 0
    }
    await command.run({
      io,
      values,
      positionals,
      json: values.json === true,
      profile: profileName(values.profile as string | undefined, io.env),
      configPath: configPath(io.env, io.home),
    })
    return 0
  } catch (err) {
    if (!(err instanceof CliError)) throw err
    if (wantsJson) {
      io.stderr(json({ error: { message: err.message, ...(err instanceof ApiError && { status: err.status, serverMessage: err.serverMessage }) } }))
    } else {
      io.stderr(`kanso: ${err.message}\n${err instanceof UsageError ? 'Run "kanso --help" for usage.\n' : ''}`)
    }
    return err.exitCode
  }
}
