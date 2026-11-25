import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { BoardDetail } from '../../../shared/types/board.ts'
import { AGENT_CLIENT_ID, type AgentDeps, type AgentOptions, type CardContext, type ExecResult, runAgent } from '../agent.ts'
import {
  agentUnitPaths, checkAgentName, checkWorkdir, envFile, fileExists, findProgram, maskToken, unitFile, unitPath, writeFileAtomic,
} from '../agentInstall.ts'
import {
  type CardWorktree, claudeArgs, downloadAttachments, type Git, localDate, prepareWorktree, timeEntry, workSection,
} from '../claudeWork.ts'
import { agentWizard, installCommand, wizardUsable } from '../agentWizard.ts'
import { parseCommandArgs } from '../args.ts'
import { type Client, createClient } from '../client.ts'
import { type Credentials, loadConfig, profileName, resolveCredentials } from '../config.ts'
import { CliError, UsageError } from '../io.ts'
import { json } from '../output.ts'
import { loadBoard } from '../resolve.ts'
import type { Command, Context } from './types.ts'


/** "a, b,,c" → ["a", "b", "c"] */
export function splitList(value: string | boolean | string[] | undefined): string[] {
  const text = Array.isArray(value) ? value.join(',') : value
  return typeof text === 'string' ? [...new Set(text.split(',').map(s => s.trim()).filter(Boolean))] : []
}

/** Column ids for --columns: ids, or titles (case-insensitive) of columns on the given boards. */
export function resolveColumns(names: string[], boards: Pick<BoardDetail, 'id' | 'name' | 'columns'>[]): string[] {
  const ids = new Set<string>()
  for (const name of names) {
    const all = boards.flatMap(b => b.columns)
    const byId = all.find(c => c.id === name.toLowerCase())
    const matches = byId ? [byId] : all.filter(c => c.title.trim().toLowerCase() === name.toLowerCase())
    if (!matches.length) {
      const known = boards.map(b => `${b.name}: ${b.columns.map(c => `"${c.title}"`).join(', ')}`).join('; ')
      throw new UsageError(`No column "${name}" on the given boards (${known}).`)
    }
    for (const c of matches) ids.add(c.id)
  }
  return [...ids]
}

const defaultInstructions = 'Do what the card asks (for a notification: what the comment or assignment asks of you). '
  + 'When you are done, comment on the card with a short summary of what you did. If something is unclear, ask in a comment instead of guessing.'

/** The prompt of the --claude preset. */
export function claudePrompt(ctx: CardContext, instructions?: string, work = ''): string {
  const n = ctx.event.notification
  const rule = ctx.rule ? `\nAgent rule: ${ctx.rule.name} (set on the board; its instructions follow)` : ''
  const event = n
    ? `notification: ${n.activity.kind}${n.activity.actorName ? ` by ${n.activity.actorName}` : ''}`
    : `${ctx.event.kind} (card activity)`
  return `You were started by "kanso agent run" for an event on a Kanso board.

Event: ${event}
Board: ${ctx.board.name} (id ${ctx.board.id})
Card: ${ctx.card.title} (id ${ctx.card.id})${ctx.column ? `, in column "${ctx.column.title}"` : ''}
Link: ${ctx.card.url}${rule}

The card is on stdin as JSON: {event, board, column, card, detail} (detail has checklists, comments, links and activity).
Use the kanso MCP tools to read and change the board (get_card with boardId and cardId, add_comment, update_card,
move_card, ...). You act as the token's user and only see and change what it may.
${work ? `\n${work}\n` : ''}
${ctx.rule?.instructions.trim() || instructions?.trim() || defaultInstructions}
`
}

export const agent: Command = {
  name: 'agent',
  summary: 'Run a command for board events (agent run), e.g. Claude for cards landing in a column; install it as a service',
  usage: `agent run (--board <ids|names> [--columns <ids|titles>] [--activity <kinds>] | --notifications) (--cmd "<command>" | --claude) [options]
       kanso agent install [--name <name>] [--workdir <dir>] [--dry-run] <agent run options>
       kanso agent setup     (asks for everything; also "kanso agent install" without options)
       kanso agent uninstall [--name <name>]`,
  options: {
    board: { type: 'string', value: '<ids|names>', description: 'Boards to follow (ids or names), comma-separated. Alone: follow the board\'s agent rules for this bot token' },
    columns: { type: 'string', value: '<ids|titles>', description: 'Only cards (now) in these columns; ids or titles, comma-separated. Default kinds then: created,moved' },
    activity: { type: 'string', value: '<kinds>', description: 'Activity kinds that start a run (created, moved, commented, assigned, tagged, ...)' },
    notifications: { type: 'boolean', description: 'Run for unread notifications (mentions, assignments, ...) and mark them read afterwards' },
    cmd: { type: 'string', value: '<command>', description: 'Shell command (sh -c) per event: KANSO_* variables, card JSON on stdin' },
    claude: { type: 'boolean', description: 'Run "claude -p" with this site\'s MCP server and a prompt built from the card' },
    prompt: { type: 'string', value: '<text>', description: 'With --claude: instructions instead of the default ("do what the card asks, then comment"); agent rules bring their own' },
    'permission-mode': { type: 'string', value: '<mode>', description: 'With --claude: claude\'s --permission-mode (e.g. auto, acceptEdits); Claude then keeps its usual tools besides the board' },
    worktree: { type: 'string', value: '<repo>', description: 'With --claude: run each card in its own git worktree of <repo> (.claude/worktrees/card-<id8>, branch card/<id8>-<title>), reused by later runs' },
    setup: { type: 'string', value: '<command>', description: 'With --claude: shell command run in the worktree (or working directory) before Claude, e.g. installing dependencies' },
    'log-time': { type: 'boolean', description: 'With --claude: log each run\'s duration as a time entry on the card' },
    concurrency: { type: 'string', value: '<n>', description: 'Runs at once, 1-32 (default 1); never two on the same card' },
    comment: { type: 'string', value: '<when>', description: 'Comment the exit status on the card: never (default), failure, always (agent rules set their own)' },
    timeout: { type: 'string', value: '<minutes>', description: 'Stop a run after this long (SIGTERM, then SIGKILL after 10 s)' },
    settle: { type: 'string', value: '<seconds>', description: 'Start a run only once the card has not changed for this long (0-3600); every change restarts the wait. Agent rules: the rule\'s own value wins; default 60 for created/moved/tagged, 0 for assigned/mentioned. Else default 0' },
    name: { type: 'string', value: '<name>', description: 'install/uninstall: the agent\'s name, for several agents (unit kanso-agent-<name>.service)' },
    workdir: { type: 'string', value: '<dir>', description: 'install: working directory of the runs (default: the current directory)' },
    'dry-run': { type: 'boolean', description: 'install: print the files and commands, change nothing' },
  },
  details: `
Opens GET /api/events with the token and runs the command for each event until it gets SIGINT/SIGTERM, then
waits for the runs in progress. Reconnects with backoff (1 s doubling to 60 s); stops on 401/403/404 or a board
the token cannot see, so systemd's Restart= decides what happens next.

Each run gets KANSO_URL, KANSO_TOKEN, KANSO_BOARD_ID, KANSO_CARD_ID, KANSO_CARD_URL, KANSO_EVENT (activity kind),
KANSO_EVENT_SOURCE (activity|notification), KANSO_ACTIVITY_ID, KANSO_NOTIFICATION_ID (notifications), and the
card JSON {event, board, column, card, detail} on stdin. The runner's own comments trigger nothing. Activity
during a disconnect is not replayed; unread notifications are read again after every (re)connect.

Agent rules: with only --board (no --activity, --columns or --notifications) and a bot's token, the runner
follows the agent rules set on the board in the UI (board menu "Agent rules") for that bot: for each matching
event it runs the command or Claude with the rule's instructions (KANSO_RULE_ID, KANSO_RULE_NAME; "rule" in the
card JSON), then moves the card to the rule's column after a successful run and comments as the rule says. The
rules are read again whenever the board changes; the bot's own changes never start a rule.

Settle: so that the agent does not take a card someone is still writing, a run starts only once the card has
had no new activity (and no checklist or attachment change) for a while; every change starts the wait again,
then the card and the rule are checked once more. The wait is the rule's own (set in the UI), else --settle,
else 60 s for card_created, card_moved and tag_added and 0 for assigned and mentioned. Without rules it is
--settle, default 0. Text typed in an open card dialog but not saved yet does not count as a change.

Install: "kanso agent install" takes the same options as "agent run", checks them and the token, then
writes a systemd user unit (~/.config/systemd/user/kanso-agent[-<name>].service) and its environment file
with the site and token (~/.config/kanso/agent[-<name>].env, mode 600), and enables and (re)starts it. Boards
and columns are stored as ids. Run it again to change the agent; "kanso agent uninstall" removes it. For the
agent to run while you are logged out: loginctl enable-linger.

Setup: "kanso agent setup" (or "kanso agent install" without options, on a terminal) asks for the site and
token, boards, trigger, what runs and the limits, prints the equivalent "kanso agent install ..." command for
scripts, then installs it (or shows a dry run).

Examples:
  kanso agent run --board <id> --claude                  (agent rules, with a bot token)
  kanso agent install --name triage --board Kanso --claude
  kanso agent run --board <id> --columns "To do" --claude --comment failure
  kanso agent run --notifications --cmd './handle-card.sh' --concurrency 2`,
  async run(ctx) {
    const sub = ctx.positionals[0]
    if (ctx.positionals.length !== 1 || !sub || !['run', 'install', 'uninstall', 'setup'].includes(sub)) {
      throw new UsageError('Usage: kanso agent run|install|uninstall|setup [options]. See kanso agent --help.')
    }
    if (sub === 'uninstall') return uninstallAgent(ctx)
    const noOptions = Object.keys(agent.options!).every(k => ctx.values[k] === undefined)
    if (sub === 'setup' || (sub === 'install' && noOptions)) {
      if (sub === 'setup' && !noOptions) throw new UsageError('kanso agent setup asks for everything; give the options to kanso agent install instead.')
      return setupAgent(ctx)
    }
    if (sub === 'run') {
      for (const k of installOnly) if (ctx.values[k] !== undefined) throw new UsageError(`--${k} goes with kanso agent install.`)
    }
    const prepared = await prepareRun(ctx)
    if (sub === 'install') return installAgent(ctx, prepared)
    const {
      creds, client, boards, boardIds, columnIds, activity, notifications, rulesMode, rulesFor, cmd, concurrency, comment, timeoutMs,
      settle, worktree, setup, permissionMode, logTime,
    } = prepared
    const v = ctx.values

    const log = (message: string, fields: Record<string, unknown> = {}) => {
      if (ctx.json) ctx.io.stdout(`${JSON.stringify({ at: new Date().toISOString(), message, ...fields })}\n`)
      else ctx.io.stderr(`kanso agent: ${message}\n`)
    }

    const signal = ctx.io.signal ?? new AbortController().signal
    let mcpDir: string | null = null
    try {
      let exec: AgentDeps['exec']
      if (v.claude) {
        // The token goes into a file only the user can read, not onto the command line (ps).
        const tmp = await mkdtemp(join(tmpdir(), 'kanso-agent-'))
        mcpDir = tmp
        const mcpConfig = join(tmp, 'mcp.json')
        await writeFile(mcpConfig, JSON.stringify({ mcpServers: { kanso: { type: 'http', url: `${creds.url}/api/mcp`, headers: { Authorization: `Bearer ${creds.token}` } } } }), { mode: 0o600 })
        const bin = ctx.io.env.KANSO_CLAUDE_BIN || 'claude'
        const prompt = typeof v.prompt === 'string' ? v.prompt : undefined
        const getBytes = async (path: string) => {
          const res = await ctx.io.fetch(creds.url + path, { headers: { 'authorization': `Bearer ${creds.token}`, 'x-client-id': AGENT_CLIENT_ID } })
          if (!res.ok) throw new Error(`GET ${path} failed with ${res.status}`)
          return new Uint8Array(await res.arrayBuffer())
        }
        // One `git worktree add` at a time: concurrent ones in the same repository can trip over git's locks.
        let gitQueue: Promise<unknown> = Promise.resolve()
        exec = async (job, env, stdin, context) => {
          const started = new Date()
          const deadline = timeoutMs > 0 ? started.getTime() + timeoutMs : 0
          const left = () => deadline ? Math.max(1, deadline - Date.now()) : 0
          let result: ExecResult
          try {
            let wt: CardWorktree | null = null
            if (worktree) {
              const step = gitQueue.then(() => prepareWorktree(worktree, job.cardId, context.card.title, runGit, fileExists))
              gitQueue = step.catch(() => {})
              wt = await step
              log(`card ${job.cardId}: ${wt.reused ? 'reusing' : 'created'} worktree ${wt.dir} on ${wt.branch}`, { card: job.cardId, worktree: wt.dir, branch: wt.branch })
            }
            const runEnv = { ...ctx.io.env, ...env, ...(wt && { KANSO_WORKTREE: wt.dir, KANSO_BRANCH: wt.branch }) }
            const cwd = wt?.dir
            const prepared = setup ? await execCommand('/bin/sh', ['-c', setup], runEnv, '', left(), signal, cwd) : null
            if (prepared && (prepared.code !== 0 || prepared.timedOut)) {
              result = { ...prepared, error: `--setup failed (${prepared.timedOut ? 'timed out' : `exit ${prepared.code ?? prepared.signal}`}); Claude did not run.` }
            } else {
              const files = await downloadAttachments(context.detail.attachments ?? [], join(tmp, 'attachments', job.cardId), getBytes,
                (a, err) => log(`could not download attachment "${a.name}" (${a.id}) of card ${job.cardId}: ${err.message}`, { card: job.cardId }))
              const args = claudeArgs(claudePrompt(context, prompt, workSection(wt, files)), mcpConfig, permissionMode)
              result = await execCommand(bin, args, runEnv, stdin, left(), signal, cwd)
            }
          } catch (err) {
            result = { code: 1, signal: null, timedOut: false, error: (err as Error).message }
          }
          if (logTime) {
            const outcome = result.timedOut ? 'timed out' : result.error ? 'failed' : `exit ${result.code ?? result.signal}`
            await client.post(`/api/cards/${job.cardId}/time`, timeEntry(context, Date.now() - started.getTime(), localDate(started), outcome))
              .catch((err: unknown) => log(`could not log time on card ${job.cardId}: ${(err as Error).message}`, { card: job.cardId }))
          }
          return result
        }
      } else {
        exec = (_job, env, stdin) => execCommand('/bin/sh', ['-c', cmd], { ...ctx.io.env, ...env }, stdin, timeoutMs, signal)
      }

      const options: AgentOptions = {
        url: creds.url, token: creds.token, boardIds, activity, columnIds, notifications, concurrency,
        comment: comment as AgentOptions['comment'], rulesFor, settle,
      }
      if (rulesMode) log(`following the agent rules of ${boards.map(b => `"${b.name}"`).join(', ')}`)
      else log(`following ${[
        notifications && 'notifications',
        activity.length && `${activity.join(',')} on ${boards.map(b => `"${b.name}"`).join(', ')}${columnIds.length ? ` in ${columnIds.map(id => `"${boards.flatMap(b => b.columns).find(c => c.id === id)?.title ?? id}"`).join(', ')}` : ''}`,
      ].filter(Boolean).join(' and ')}`)
      await runAgent(options, {
        client,
        fetch: ctx.io.fetch,
        log,
        signal,
        sleep: (ms, s) => new Promise((resolve) => {
          const t = setTimeout(done, ms)
          function done() {
            clearTimeout(t)
            s.removeEventListener('abort', done)
            resolve()
          }
          s.addEventListener('abort', done, { once: true })
        }),
        exec,
      })
      log('stopped')
    } finally {
      if (mcpDir) await rm(mcpDir, { recursive: true, force: true })
    }
  },
}

/** Options only `kanso agent install` / `uninstall` take. */
const installOnly = ['name', 'workdir', 'dry-run'] as const

/** Options that only go with --claude. */
const claudeOnly = ['prompt', 'permission-mode', 'worktree', 'setup', 'log-time'] as const

/** Runs git without a shell and collects its output. */
const runGit: Git = args => new Promise((done) => {
  execFile('git', args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
    const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : null) : 0
    done({ code, stdout: String(stdout), stderr: String(stderr) || (err && code === null ? err.message : '') })
  })
})

type Me = { id: string, name: string, isBot: boolean }

/** `agent run`'s options, checked, with boards and columns resolved through the API. */
export interface PreparedRun {
  creds: Credentials
  client: Client
  boards: BoardDetail[]
  boardIds: string[]
  columnIds: string[]
  columnNames: string[]
  activity: string[]
  notifications: boolean
  rulesMode: boolean
  rulesFor: string | null
  me: Me | null
  cmd: string
  concurrency: number
  comment: AgentOptions['comment']
  timeoutMs: number
  /** --settle in seconds; null = not given. */
  settle: number | null
  /** --worktree: the repository's main checkout, absolute. */
  worktree: string | null
  setup: string
  permissionMode: string | undefined
  logTime: boolean
}

async function prepareRun(ctx: Context): Promise<PreparedRun> {
    const v = ctx.values
    const boardRefs = splitList(v.board)
    let activity = splitList(v.activity)
    for (const k of activity) if (!/^[a-z_]{1,40}$/.test(k)) throw new UsageError(`Unknown activity kind "${k}".`)
    const columnNames = splitList(v.columns)
    if (columnNames.length && !activity.length) activity = ['created', 'moved']
    const notifications = v.notifications === true
    const rulesMode = !notifications && !activity.length && boardRefs.length > 0
    if (!notifications && !activity.length && !rulesMode) throw new UsageError('Nothing to listen for: give --board (agent rules), --notifications, --activity or --columns.')
    if (rulesMode && v.comment !== undefined) throw new UsageError('Agent rules set their own --comment; give --activity or --columns to use it.')
    if (activity.length && !boardRefs.length) throw new UsageError('--activity and --columns need --board.')
    const cmd = typeof v.cmd === 'string' ? v.cmd.trim() : ''
    if (!cmd === !v.claude) throw new UsageError('Give either --cmd "<command>" or --claude.')
    for (const k of claudeOnly) if (v[k] !== undefined && !v.claude) throw new UsageError(`--${k} goes with --claude.`)
    const permissionMode = typeof v['permission-mode'] === 'string' ? v['permission-mode'].trim() : undefined
    if (permissionMode !== undefined && !/^[A-Za-z]{1,40}$/.test(permissionMode)) throw new UsageError('--permission-mode takes a claude permission mode, e.g. auto or acceptEdits.')
    const setup = typeof v.setup === 'string' ? v.setup.trim() : ''
    if (v.setup !== undefined && !setup) throw new UsageError('--setup needs a command.')
    let worktree: string | null = null
    if (typeof v.worktree === 'string') {
      const dir = resolve(ctx.io.self?.cwd ?? process.cwd(), v.worktree)
      const r = await runGit(['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
      if (r.code !== 0) throw new UsageError(`--worktree: ${dir} is not a git repository.`)
      worktree = r.stdout.trim().replace(/\/\.git\/?$/, '')
    }
    const concurrency = v.concurrency === undefined ? 1 : Number(v.concurrency)
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new UsageError('--concurrency takes a whole number from 1 to 32.')
    const comment = (v.comment ?? 'never') as string
    if (!['never', 'failure', 'always'].includes(comment)) throw new UsageError('--comment takes never, failure or always.')
    const timeoutMs = v.timeout === undefined ? 0 : Number(v.timeout) * 60_000
    if (!(timeoutMs > 0) && v.timeout !== undefined) throw new UsageError('--timeout takes minutes (a number above 0).')
    const settle = v.settle === undefined ? null : Number(v.settle)
    if (settle !== null && (!Number.isInteger(settle) || settle < 0 || settle > 3600)) throw new UsageError('--settle takes whole seconds from 0 to 3600.')

    const creds = resolveCredentials(await loadConfig(ctx.configPath), ctx.profile, ctx.io.env)
    const client = createClient(creds, ctx.io.fetch, AGENT_CLIENT_ID)
    // Fails early on a wrong id or a token limited to other boards, and gives the column titles.
    const boards = await Promise.all(boardRefs.map(b => loadBoard(client, b)))
    const boardIds = boards.map(b => b.id)
    const columnIds = resolveColumns(columnNames, boards)
    let rulesFor: string | null = null
    let me: Me | null = null
    if (rulesMode) {
      me = await client.get<Me>('/api/me')
      if (!me.isBot) throw new UsageError(`Agent rules name a bot; this token is ${me.name}'s, not a bot's. Use a token of the rule's bot (board menu "Bots"), or give --activity, --columns or --notifications.`)
      rulesFor = me.id
    }
  return {
    creds, client, boards, boardIds, columnIds, columnNames, activity, notifications, rulesMode, rulesFor, me, cmd, concurrency,
    comment: comment as AgentOptions['comment'], timeoutMs, settle, worktree, setup, permissionMode, logTime: v['log-time'] === true,
  }
}

/** The `agent run` arguments for the unit, with boards and columns as ids (names may change). */
export function runArgsFor(p: PreparedRun, v: Context['values']): string[] {
  const args: string[] = []
  if (p.boardIds.length) args.push('--board', p.boardIds.join(','))
  if (p.activity.length) args.push('--activity', p.activity.join(','))
  if (p.columnIds.length) args.push('--columns', p.columnIds.join(','))
  if (p.notifications) args.push('--notifications')
  if (p.cmd) args.push('--cmd', p.cmd)
  else args.push('--claude')
  if (typeof v.prompt === 'string') args.push('--prompt', v.prompt)
  if (p.permissionMode) args.push('--permission-mode', p.permissionMode)
  if (p.worktree) args.push('--worktree', p.worktree)
  if (p.setup) args.push('--setup', p.setup)
  if (p.logTime) args.push('--log-time')
  if (p.concurrency !== 1) args.push('--concurrency', String(p.concurrency))
  if (v.comment !== undefined) args.push('--comment', p.comment)
  if (v.timeout !== undefined) args.push('--timeout', String(v.timeout))
  if (p.settle !== null) args.push('--settle', String(p.settle))
  return args
}

function needProgramRunner(ctx: Context) {
  const { self, runProgram } = ctx.io
  if (!self || !runProgram) throw new CliError('kanso agent install needs the installed kanso command.')
  return { self, runProgram }
}

async function installAgent(ctx: Context, p: PreparedRun): Promise<void> {
  const { self, runProgram } = needProgramRunner(ctx)
  const v = ctx.values
  const name = checkAgentName(v.name as string | undefined)
  const dryRun = v['dry-run'] === true
  const env = ctx.io.env
  if (/\.[cm]?ts$/.test(self.script)) throw new CliError(`Install from the built CLI (kanso.mjs), not ${self.script}.`)
  const workdir = await checkWorkdir(typeof v.workdir === 'string' ? v.workdir : self.cwd, self.cwd)
  const paths = agentUnitPaths(name, env, ctx.io.home)

  const dirs = [dirname(self.node)]
  const extraEnv: Record<string, string> = {}
  if (!p.cmd) {
    const bin = env.KANSO_CLAUDE_BIN || 'claude'
    const found = await findProgram(bin, env.PATH, self.cwd)
    if (!found) throw new CliError(`${bin} was not found on PATH; install Claude Code (and log in) first, or set KANSO_CLAUDE_BIN.`)
    dirs.push(dirname(found))
    if (env.KANSO_CLAUDE_BIN) extraEnv.KANSO_CLAUDE_BIN = found
  }
  const me = p.me ?? await p.client.get<Me>('/api/me')
  const notes = [
    `Runs as ${me.name}${me.isBot ? ' (bot)' : ''} on ${p.creds.url}`,
    ...p.boards.map(b => `Board ${b.id}: ${b.name}`),
    ...p.columnIds.map(id => `Column ${id}: ${p.boards.flatMap(b => b.columns).find(c => c.id === id)?.title ?? ''}`),
  ]
  const unit = unitFile({
    name, envPath: paths.envPath, workdir, node: self.node, script: self.script, runArgs: runArgsFor(p, v),
    path: unitPath(dirs, env.PATH), env: extraEnv, notes,
  })
  const envText = envFile(p.creds.url, p.creds.token)
  const short = paths.unit.replace(/\.service$/, '')
  const nameOpt = name ? ` --name ${name}` : ''
  const commands = [
    'systemctl --user daemon-reload',
    `systemctl --user enable ${paths.unit}`,
    `systemctl --user restart ${paths.unit}`,
  ]
  const user = env.USER || env.LOGNAME || ''
  const out = (text: string) => { if (!ctx.json) ctx.io.stdout(text) }
  const warn = (text: string) => ctx.io.stderr(`kanso agent: ${text}\n`)
  if (!me.isBot) warn(`the token is ${me.name}'s own: the agent will act as you. A bot's token (board menu "Bots") is safer.`)

  const preview = () => {
    out(`# ${paths.envPath} (mode 600)\n${envText.replace(p.creds.token, maskToken(p.creds.token))}\n# ${paths.unitPath}\n${unit}\n`)
    out(`Then:\n${commands.map(c => `  ${c}\n`).join('')}`)
  }
  if (dryRun) {
    preview()
    if (ctx.json) ctx.io.stdout(json({ dryRun: true, unit: paths.unit, unitPath: paths.unitPath, envPath: paths.envPath, unitFile: unit, commands }))
    return
  }

  const manager = await runProgram('systemctl', ['--user', 'show', '--property=Version'])
  if (manager.code !== 0) {
    preview()
    throw new CliError(`No systemd user manager here (${(manager.stderr || 'systemctl not found').trim()}). Nothing was written; the files above show what to set up by hand.`)
  }
  await writeFileAtomic(paths.envPath, envText, 0o600, 0o700)
  out(`Wrote ${paths.envPath} (site and token, mode 600)\n`)
  await writeFileAtomic(paths.unitPath, unit, 0o644)
  out(`Wrote ${paths.unitPath}\n`)
  for (const c of commands) {
    const args = c.split(' ').slice(1)
    const r = await runProgram('systemctl', args)
    if (r.code !== 0) throw new CliError(`${c} failed: ${(r.stderr || r.stdout).trim()}`)
  }
  let linger: boolean | null = null
  if (user) {
    const r = await runProgram('loginctl', ['show-user', user, '--property=Linger', '--value'])
    if (r.code === 0) linger = r.stdout.trim() === 'yes'
  }
  if (ctx.json) {
    ctx.io.stdout(json({ unit: paths.unit, unitPath: paths.unitPath, envPath: paths.envPath, started: true, linger }))
    return
  }
  out(`Started ${paths.unit}; it starts again when you log in.
Logs:    journalctl --user -u ${short} -f
Status:  systemctl --user status ${short}
Remove:  kanso agent uninstall${nameOpt}
`)
  if (linger !== true) {
    out(`${linger === false ? 'Linger is off' : 'Linger is unknown'}: the agent stops when you log out. To run it from boot and while logged out:
  loginctl enable-linger ${user || '$USER'}
`)
  }
}

/** The wizard: asks, prints the equivalent command, then installs through the same checks as the flags. */
async function setupAgent(ctx: Context): Promise<void> {
  wizardUsable(ctx.io, ctx.json)
  needProgramRunner(ctx)
  const result = await agentWizard({ io: ctx.io, configPath: ctx.configPath, profile: ctx.profile })
  if (result.action === 'stop') {
    ctx.io.stdout('Nothing was installed. Run the command above when you are ready.\n')
    return
  }
  const argv = [...result.argv, ...(result.action === 'dry-run' ? ['--dry-run'] : [])]
  const { values } = parseCommandArgs(['agent', 'install', ...argv], agent.options, 1)
  const install: Context = { ...ctx, values, positionals: ['install'], profile: profileName(values.profile as string | undefined, ctx.io.env) }
  ctx.io.stdout('\n')
  await installAgent(install, await prepareRun(install))
  if (result.action === 'dry-run') ctx.io.stdout(`\nTo install it: ${installCommand(result.argv)}\n`)
}

async function uninstallAgent(ctx: Context): Promise<void> {
  const { runProgram } = needProgramRunner(ctx)
  const v = ctx.values
  for (const k of Object.keys(agent.options!)) {
    if (k !== 'name' && v[k] !== undefined) throw new UsageError(`kanso agent uninstall takes only --name, not --${k}.`)
  }
  const name = checkAgentName(v.name as string | undefined)
  const paths = agentUnitPaths(name, ctx.io.env, ctx.io.home)
  const [hasUnit, hasEnv] = await Promise.all([fileExists(paths.unitPath), fileExists(paths.envPath)])
  if (!hasUnit && !hasEnv) throw new CliError(`No agent${name ? ` "${name}"` : ''} is installed (no ${paths.unitPath}).`)
  const stopped = await runProgram('systemctl', ['--user', 'disable', '--now', paths.unit])
  await rm(paths.unitPath, { force: true })
  await rm(paths.envPath, { force: true })
  await runProgram('systemctl', ['--user', 'daemon-reload'])
  await runProgram('systemctl', ['--user', 'reset-failed', paths.unit])
  if (ctx.json) {
    ctx.io.stdout(json({ unit: paths.unit, removed: [paths.unitPath, paths.envPath], stopped: stopped.code === 0 }))
    return
  }
  if (stopped.code !== 0) ctx.io.stderr(`kanso agent: could not stop ${paths.unit}: ${(stopped.stderr || 'systemctl not found').trim()}\n`)
  ctx.io.stdout(`${stopped.code === 0 ? `Stopped and disabled ${paths.unit}; r` : 'R'}emoved ${paths.unitPath} and ${paths.envPath}.
The token still works: revoke it in Kanso if nothing else uses it.
`)
}

/**
 * Runs one command in its own process group (so a timeout or our own SIGTERM reaches
 * everything it started), stdin = the card JSON. Its stdout/stderr go through our own: journald
 * files a line under the process that wrote it, and a short run has exited before journald looks
 * it up, so inherited output would land outside the unit's log (journalctl -u).
 */
function execCommand(file: string, args: string[], env: Record<string, string | undefined>, stdin: string, timeoutMs: number, stop: AbortSignal, cwd?: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    child.stdout!.on('data', (chunk: Buffer) => process.stdout.write(chunk))
    child.stderr!.on('data', (chunk: Buffer) => process.stderr.write(chunk))
    let timedOut = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const kill = (sig: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, sig)
      } catch {}
    }
    const terminate = () => {
      kill('SIGTERM')
      killTimer ??= setTimeout(() => kill('SIGKILL'), 10_000)
    }
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true
        terminate()
      }, timeoutMs)
      : undefined
    stop.addEventListener('abort', terminate)
    const cleanup = () => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      stop.removeEventListener('abort', terminate)
    }
    child.on('error', (err) => {
      cleanup()
      reject(new Error(`cannot start ${file}: ${err.message}`))
    })
    child.on('close', (code, signal) => {
      cleanup()
      resolve({ code, signal, timedOut })
    })
    // The command may not read stdin at all.
    child.stdin.on('error', () => {})
    child.stdin.end(stdin)
  })
}
