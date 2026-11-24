import type { Me } from '../../shared/types/account.ts'
import type { BoardDetail, BoardSummary } from '../../shared/types/board.ts'
import { agentUnitPaths, checkAgentName, fileExists } from './agentInstall.ts'
import { type Client, createClient } from './client.ts'
import { checkToken, defaultProfile, loadConfig, normalizeUrl, saveConfig } from './config.ts'
import { type Io, UsageError } from './io.ts'
import { type Choice, createPrompter, type Prompter, shellQuote } from './prompt.ts'

/**
 * `kanso agent setup` (and `kanso agent install` without options on a terminal): asks for every
 * choice `kanso agent install` takes and returns its arguments, so the install itself goes
 * through the same checks as when the options are typed by hand.
 */

export interface WizardResult {
  /** Arguments after `kanso agent install`, profile included when one was chosen. */
  argv: string[]
  /** The profile the install uses; null = KANSO_URL / KANSO_TOKEN from the environment. */
  profile: string | null
  /** install = install now, dry-run = preview only, stop = print the command only. */
  action: 'install' | 'dry-run' | 'stop'
}

export interface WizardInput {
  io: Io
  configPath: string
  /** The profile named by --profile / KANSO_PROFILE (preselected). */
  profile: string
}

/** Refuses the wizard without a terminal (or with --json), pointing at the flags. */
export function wizardUsable(io: Io, json: boolean): void {
  const why = json ? 'with --json' : !io.interactive || !io.ask ? 'without a terminal' : null
  if (why) {
    throw new UsageError(`The agent setup wizard asks questions, so it cannot run ${why}. Give the options instead, e.g. `
      + 'kanso agent install --board <board> --claude (agent rules, bot token) or --columns <titles> / --notifications with --cmd "<command>"; see kanso agent --help.')
  }
}

const activityHint = 'created, moved, commented, mentioned, assigned, tagged, due, priority, archived, ...'

/** A service name from a board name: "Kanso Ops" → "kanso-ops". */
export function nameFromBoard(board: string): string {
  return board.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'agent'
}

/** The printed command: `kanso agent install` and the arguments, each shell-quoted. */
export function installCommand(argv: string[]): string {
  return ['kanso', 'agent', 'install', ...argv].map(shellQuote).join(' ')
}

async function chooseSite(p: Prompter, input: WizardInput): Promise<{ client: Client, me: Me, profile: string | null }> {
  const { io } = input
  p.say('\n1. Site and token')
  if (io.env.KANSO_URL && io.env.KANSO_TOKEN) {
    const url = normalizeUrl(io.env.KANSO_URL)
    const client = createClient({ url, token: checkToken(io.env.KANSO_TOKEN) }, io.fetch)
    p.say(`KANSO_URL and KANSO_TOKEN are set, so they are used (${url}). Unset them to pick a saved profile.`)
    return { client, me: await client.get<Me>('/api/me'), profile: null }
  }
  const config = await loadConfig(input.configPath)
  const names = Object.keys(config.profiles).sort()
  let profile: string | null = null
  if (names.length) {
    const choices: Choice<string | null>[] = [
      ...names.map(n => ({ label: n, value: n, hint: config.profiles[n]!.url })),
      { label: 'Enter another site URL and token', value: null },
    ]
    const def = Math.max(0, names.indexOf(input.profile))
    profile = await p.pickOne('Which saved login should the agent use?', choices, def)
  }
  if (profile) {
    const client = createClient(config.profiles[profile]!, io.fetch)
    return { client, me: await client.get<Me>('/api/me'), profile }
  }
  p.say('A bot\'s token is best: the agent then acts as the bot (board menu "Bots", or Account → Bots).')
  const url = normalizeUrl(await p.text('Kanso site URL (with its base path, e.g. https://host/kanso)', {
    check: (v) => {
      if (!/^[a-z][a-z\d+.-]*:\/\//i.test(v)) return `Start the URL with https:// (or http://), e.g. https://${v || 'host/kanso'}`
      try {
        normalizeUrl(v)
        return null
      } catch (err) {
        return (err as Error).message
      }
    },
  }))
  const token = checkToken(await io.readSecret('API token (kb_..., not shown): '))
  const client = createClient({ url, token }, io.fetch)
  const me = await client.get<Me>('/api/me')
  const fresh = names.includes(defaultProfile) ? nameFromBoard(me.name) : defaultProfile
  const suggested = names.includes(fresh) ? `${fresh}-2` : fresh
  let name: string
  for (;;) {
    name = await p.text('Save it as profile', {
      default: suggested,
      check: v => /^[\w.-]{1,64}$/.test(v) ? null : 'Letters, digits, "_", "-" and "." only.',
    })
    // Declining a replace asks for another name, so the checked token is not lost.
    if (!config.profiles[name] || await p.confirm(`Profile "${name}" exists; replace it?`, false)) break
  }
  config.profiles[name] = { url, token }
  await saveConfig(input.configPath, config)
  p.say(`Saved profile "${name}" to ${input.configPath}.`)
  return { client, me, profile: name }
}

export async function agentWizard(input: WizardInput): Promise<WizardResult> {
  const { io } = input
  const p = createPrompter(io.ask!, io.stdout)
  p.say('Set up a Kanso agent: answer each question, or press Enter for the [default]. Ctrl+C cancels.')

  // 1. Site and token
  const { client, me, profile } = await chooseSite(p, input)
  p.say(me.isBot
    ? `The token is the bot "${me.name}"'s: the agent acts as that bot. Good.`
    : `The token is ${me.name}'s own: the agent would act as you. A bot's token is safer (board menu "Bots"); agent rules need one.`)

  // 2. Boards
  p.say('\n2. Boards')
  const summaries = (await client.get<BoardSummary[]>('/api/boards')).filter(b => !b.archivedAt)
  if (!summaries.length) throw new UsageError('The token sees no boards. Add the bot (or you) to a board first.')
  const boardIds = summaries.length === 1
    ? (p.say(`The token sees one board: ${summaries[0]!.name}.`), [summaries[0]!.id])
    : await p.pickMany('Which boards should the agent follow?', summaries.map(b => ({ label: b.name, value: b.id })), [0])
  const boards = await Promise.all(boardIds.map(id => client.get<BoardDetail>(`/api/boards/${id}`)))

  // 3. Trigger
  p.say('\n3. What starts a run')
  type Trigger = 'rules' | 'columns' | 'notifications'
  const rules = boards.flatMap(b => (b.agentRules ?? []).filter(r => r.botId === me.id && r.active).map(r => ({ board: b, rule: r })))
  const triggers: Choice<Trigger>[] = [
    ...(me.isBot ? [{ label: 'The board\'s agent rules for this bot', value: 'rules' as const, hint: `${rules.length} active rule${rules.length === 1 ? '' : 's'}` }] : []),
    { label: 'Cards landing in columns (or other card activity)', value: 'columns' },
    { label: 'Notifications: mentions, assignments, ...', value: 'notifications' },
  ]
  const trigger = await p.pickOne('What should start a run?', triggers, 0)
  if (trigger === 'rules' && !rules.length) p.say('No active rules yet: add them in the board menu "Agent rules"; the agent picks them up without a restart.')
  const argv: string[] = []
  if (profile) argv.push('--profile', profile)
  argv.push('--board', boardIds.join(','))
  if (trigger === 'columns') {
    const columns = boards.flatMap(b => b.columns.map(c => ({ label: boards.length > 1 ? `${b.name}: ${c.title}` : c.title, value: c.id })))
    const columnIds = await p.pickMany('Cards in which columns? (none = anywhere on the board)', columns, [], { allowNone: true })
    const kinds = await p.text(`Which card activity? (comma-separated: ${activityHint})`, {
      default: 'created,moved',
      check: v => v.split(',').map(s => s.trim()).filter(Boolean).every(k => /^[a-z_]{1,40}$/.test(k)) ? null : 'Activity kinds are lower-case words, comma-separated.',
    })
    if (columnIds.length) argv.push('--columns', columnIds.join(','))
    argv.push('--activity', kinds.split(',').map(s => s.trim()).filter(Boolean).join(','))
  } else if (trigger === 'notifications') {
    argv.push('--notifications')
  }

  // 4. What runs
  p.say('\n4. What runs')
  const claude = await p.pickOne('What should run for each event?', [
    { label: 'Claude Code (claude -p with the board\'s MCP tools and a prompt built from the card)', value: true },
    { label: 'A shell command of your own (card JSON on stdin, KANSO_* variables)', value: false },
  ], 0)
  if (!claude) {
    argv.push('--cmd', await p.text('Command (run with sh -c)', { check: v => v.trim() ? null : 'Enter a command.' }))
  } else {
    argv.push('--claude')
    const mode = await p.pickOne('What may Claude touch?', [
      { label: 'Only the board (the kanso MCP tools)', value: '' },
      { label: 'Also edit files in its working directory (acceptEdits)', value: 'acceptEdits' },
      { label: 'Its usual tools, asking nothing (auto)', value: 'auto' },
    ], 0)
    if (mode) argv.push('--permission-mode', mode)
    // The main checkout (also from inside a worktree), as the install stores it.
    const repo = io.runProgram ? await io.runProgram('git', ['-C', io.self?.cwd ?? '.', 'rev-parse', '--path-format=absolute', '--git-common-dir']) : null
    const here = repo?.code === 0 ? repo.stdout.trim().replace(/\/\.git\/?$/, '') : ''
    if (await p.confirm('Run each card in its own git worktree (branch card/<id>-<title>)?', !!here && !!mode)) {
      argv.push('--worktree', await p.text('Git repository', { default: here || undefined, check: v => v ? null : 'Enter the repository path.' }))
    }
    const setup = await p.text('Setup command before Claude, e.g. pnpm install (empty = none)')
    if (setup) argv.push('--setup', setup)
    if (await p.confirm('Log each run\'s time on the card?', false)) argv.push('--log-time')
    if (trigger !== 'rules') {
      const prompt = await p.text('Instructions for Claude (empty = do what the card asks, then comment)')
      if (prompt) argv.push('--prompt', prompt)
    }
  }

  // 5. Limits
  p.say('\n5. Limits and service')
  const concurrency = await p.text('Runs at once (1-32)', {
    default: '1',
    check: v => /^\d+$/.test(v) && +v >= 1 && +v <= 32 ? null : 'A whole number from 1 to 32.',
  })
  if (concurrency !== '1') argv.push('--concurrency', concurrency)
  const timeout = await p.text('Stop a run after how many minutes? (empty = never)', {
    check: v => !v || +v > 0 ? null : 'A number of minutes above 0, or empty.',
  })
  if (timeout) argv.push('--timeout', timeout)
  if (trigger !== 'rules') {
    const comment = await p.pickOne('Comment the exit status on the card?', [
      { label: 'never', value: 'never' }, { label: 'only on failure', value: 'failure' }, { label: 'always', value: 'always' },
    ], 0)
    if (comment !== 'never') argv.push('--comment', comment)
  }
  const name = await p.text('Service name (unit kanso-agent-<name>; "none" = plain kanso-agent)', {
    default: nameFromBoard(boards[0]!.name),
    check: (v) => {
      try {
        checkAgentName(v === 'none' ? undefined : v)
        return null
      } catch (err) {
        return (err as Error).message
      }
    },
  })
  if (name !== 'none') argv.push('--name', name)
  const unit = agentUnitPaths(name === 'none' ? undefined : name, io.env, io.home)
  if (await fileExists(unit.unitPath)) p.say(`  ${unit.unit} is already installed; installing replaces it.`)
  const cwd = io.self?.cwd ?? '.'
  const workdir = await p.text('Working directory of the runs', { default: cwd })
  if (workdir !== cwd) argv.push('--workdir', workdir)

  // 6. Summary
  p.say(`\n6. Summary\nThe same agent from a script:\n\n  ${installCommand(argv)}\n`)
  const action = await p.pickOne('Install it now?', [
    { label: 'Yes, install and start it', value: 'install' as const },
    { label: 'Dry run: show the files and commands, change nothing', value: 'dry-run' as const },
    { label: 'No, stop here', value: 'stop' as const },
  ], 0)
  return { argv, profile, action }
}
