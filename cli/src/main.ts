import { describeOptions, findCommand, globalOptions, parseCommandArgs } from './args.ts'
import { ApiError } from './client.ts'
import { configPath, profileName } from './config.ts'
import { login, logout, whoami } from './commands/auth.ts'
import { boardShow, boardsLs } from './commands/boards.ts'
import { cardAdd, cardArchive, cardEdit, cardMv, cardShow, cardsLs, commentAdd } from './commands/cards.ts'
import { myWork, notificationsLs, notificationsRead, search } from './commands/inbox.ts'
import type { Command } from './commands/types.ts'
import { CliError, type Io, UsageError } from './io.ts'
import { json } from './output.ts'
import { AmbiguousError } from './resolve.ts'
import { VERSION } from './version.ts'

export const commands: Command[] = [
  login, logout, whoami,
  boardsLs, boardShow,
  cardsLs, cardShow, cardAdd, cardMv, cardEdit, cardArchive,
  commentAdd, myWork, notificationsLs, notificationsRead, search,
]

/** Command groups take singular and plural alike: `board ls` = `boards ls`, `cards show` = `card show`. */
const groupWords: Record<string, string[]> = {
  board: ['board', 'boards'],
  card: ['card', 'cards'],
  comment: ['comment', 'comments'],
  notification: ['notification', 'notifications'],
}

function groupOf(word: string): string[] {
  return Object.values(groupWords).find(words => words.includes(word)) ?? [word]
}

/** The command for the first one or two words, or the group's words when only a group was named. */
function lookup(first: string, second: string | null): { command?: Command, group?: string[] } {
  const words = groupOf(first)
  const sub = commands.filter(c => c.name.includes(' ') && words.includes(c.name.split(' ')[0]!))
  if (!sub.length) return { command: commands.find(c => c.name === first) }
  return { command: sub.find(c => c.name.split(' ')[1] === second), group: words }
}

function groupHelp(words: string[]): string {
  const sub = commands.filter(c => words.includes(c.name.split(' ')[0]!))
  const width = Math.max(...sub.map(c => c.name.length))
  return `Commands:\n${sub.map(c => `  ${c.name.padEnd(width)}  ${c.summary}`).join('\n')}\n\nRun "kanso <command> --help" for a command's options.\n`
}

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
    const { command: first, rest } = findCommand(argv)
    if (first === null || first === 'help') {
      const after = first === 'help' ? findCommand(rest) : { command: null, rest }
      const found = after.command ? lookup(after.command, findCommand(after.rest).command) : {}
      io.stdout(found.command ? commandHelp(found.command) : found.group ? groupHelp(found.group) : mainHelp())
      return first === null && !argv.includes('--help') && !argv.includes('-h') ? 2 : 0
    }
    const second = findCommand(rest).command
    const { command, group } = lookup(first, second)
    if (!command) {
      if (!group) throw new UsageError(`Unknown command "${first}". Run "kanso --help" for the list.`)
      if (second === null && (argv.includes('--help') || argv.includes('-h'))) {
        io.stdout(groupHelp(group))
        return 0
      }
      throw new UsageError(second === null
        ? `"${first}" needs a subcommand: ${commands.filter(c => group.includes(c.name.split(' ')[0]!)).map(c => c.name.split(' ')[1]).join(', ')}.`
        : `Unknown command "${first} ${second}". Run "kanso ${first} --help" for the list.`)
    }
    const { values, positionals } = parseCommandArgs(argv, command.options, command.name.split(' ').length)
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
      io.stderr(json({ error: {
        message: err.message,
        ...(err instanceof ApiError && { status: err.status, serverMessage: err.serverMessage }),
        ...(err instanceof AmbiguousError && { matches: err.matches }),
      } }))
    } else {
      io.stderr(`kanso: ${err.message}\n${err instanceof UsageError ? 'Run "kanso --help" for usage.\n' : ''}`)
    }
    return err.exitCode
  }
}
