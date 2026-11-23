import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BoardDetail } from '../../../shared/types/board.ts'
import { AGENT_CLIENT_ID, type AgentOptions, type CardContext, type ExecResult, runAgent } from '../agent.ts'
import { createClient } from '../client.ts'
import { loadConfig, resolveCredentials } from '../config.ts'
import { UsageError } from '../io.ts'
import type { Command } from './types.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** "a, b,,c" → ["a", "b", "c"] */
export function splitList(value: string | boolean | undefined): string[] {
  return typeof value === 'string' ? [...new Set(value.split(',').map(s => s.trim()).filter(Boolean))] : []
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
export function claudePrompt(ctx: CardContext, instructions?: string): string {
  const n = ctx.event.notification
  const event = n
    ? `notification: ${n.activity.kind}${n.activity.actorName ? ` by ${n.activity.actorName}` : ''}`
    : `${ctx.event.kind} (card activity)`
  return `You were started by "kanso agent run" for an event on a Kanso board.

Event: ${event}
Board: ${ctx.board.name} (id ${ctx.board.id})
Card: ${ctx.card.title} (id ${ctx.card.id})${ctx.column ? `, in column "${ctx.column.title}"` : ''}
Link: ${ctx.card.url}

The card is on stdin as JSON: {event, board, column, card, detail} (detail has checklists, comments, links and activity).
Use the kanso MCP tools to read and change the board (get_card with boardId and cardId, add_comment, update_card,
move_card, ...). You act as the token's user and only see and change what it may.

${instructions?.trim() || defaultInstructions}
`
}

export const agent: Command = {
  name: 'agent',
  summary: 'Run a command for board events (agent run), e.g. Claude for cards landing in a column',
  usage: 'agent run (--notifications | --board <id> [--columns <ids|titles>] [--activity <kinds>]) (--cmd "<command>" | --claude) [options]',
  options: {
    board: { type: 'string', value: '<ids>', description: 'Boards to follow, comma-separated (needed for --activity/--columns; limits --notifications)' },
    columns: { type: 'string', value: '<ids|titles>', description: 'Only cards (now) in these columns; ids or titles, comma-separated. Default kinds then: created,moved' },
    activity: { type: 'string', value: '<kinds>', description: 'Activity kinds that start a run (created, moved, commented, assigned, tagged, ...)' },
    notifications: { type: 'boolean', description: 'Run for unread notifications (mentions, assignments, ...) and mark them read afterwards' },
    cmd: { type: 'string', value: '<command>', description: 'Shell command (sh -c) per event: KANSO_* variables, card JSON on stdin' },
    claude: { type: 'boolean', description: 'Run "claude -p" with this site\'s MCP server and a prompt built from the card' },
    prompt: { type: 'string', value: '<text>', description: 'With --claude: instructions instead of the default ("do what the card asks, then comment")' },
    concurrency: { type: 'string', value: '<n>', description: 'Runs at once, 1-32 (default 1); never two on the same card' },
    comment: { type: 'string', value: '<when>', description: 'Comment the exit status on the card: never (default), failure, always' },
    timeout: { type: 'string', value: '<minutes>', description: 'Stop a run after this long (SIGTERM, then SIGKILL after 10 s)' },
  },
  details: `
Opens GET /api/events with the token and runs the command for each event until it gets SIGINT/SIGTERM, then
waits for the runs in progress. Reconnects with backoff (1 s doubling to 60 s); stops on 401/403/404 or a board
the token cannot see, so systemd's Restart= decides what happens next.

Each run gets KANSO_URL, KANSO_TOKEN, KANSO_BOARD_ID, KANSO_CARD_ID, KANSO_CARD_URL, KANSO_EVENT (activity kind),
KANSO_EVENT_SOURCE (activity|notification), KANSO_ACTIVITY_ID, KANSO_NOTIFICATION_ID (notifications), and the
card JSON {event, board, column, card, detail} on stdin. The runner's own comments trigger nothing. Activity
during a disconnect is not replayed; unread notifications are read again after every (re)connect.

Examples:
  kanso agent run --board <id> --columns "To do" --claude --comment failure
  kanso agent run --notifications --cmd './handle-card.sh' --concurrency 2`,
  async run(ctx) {
    if (ctx.positionals[0] !== 'run' || ctx.positionals.length > 1) throw new UsageError('Usage: kanso agent run [options]. See kanso agent --help.')
    const v = ctx.values
    const boardIds = splitList(v.board)
    for (const b of boardIds) if (!uuid.test(b)) throw new UsageError(`--board takes board ids, not "${b}".`)
    let activity = splitList(v.activity)
    for (const k of activity) if (!/^[a-z_]{1,40}$/.test(k)) throw new UsageError(`Unknown activity kind "${k}".`)
    const columnNames = splitList(v.columns)
    if (columnNames.length && !activity.length) activity = ['created', 'moved']
    const notifications = v.notifications === true
    if (!notifications && !activity.length) throw new UsageError('Nothing to listen for: give --notifications, --activity or --columns.')
    if (activity.length && !boardIds.length) throw new UsageError('--activity and --columns need --board.')
    const cmd = typeof v.cmd === 'string' ? v.cmd.trim() : ''
    if (!cmd === !v.claude) throw new UsageError('Give either --cmd "<command>" or --claude.')
    if (v.prompt !== undefined && !v.claude) throw new UsageError('--prompt goes with --claude.')
    const concurrency = v.concurrency === undefined ? 1 : Number(v.concurrency)
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new UsageError('--concurrency takes a whole number from 1 to 32.')
    const comment = (v.comment ?? 'never') as string
    if (!['never', 'failure', 'always'].includes(comment)) throw new UsageError('--comment takes never, failure or always.')
    const timeoutMs = v.timeout === undefined ? 0 : Number(v.timeout) * 60_000
    if (!(timeoutMs > 0) && v.timeout !== undefined) throw new UsageError('--timeout takes minutes (a number above 0).')

    const creds = resolveCredentials(await loadConfig(ctx.configPath), ctx.profile, ctx.io.env)
    const client = createClient(creds, ctx.io.fetch, AGENT_CLIENT_ID)
    // Fails early on a wrong id or a token limited to other boards, and gives the column titles.
    const boards = await Promise.all(boardIds.map(b => client.get<BoardDetail>(`/api/boards/${b}`)))
    const columnIds = resolveColumns(columnNames, boards)

    const log = (message: string, fields: Record<string, unknown> = {}) => {
      if (ctx.json) ctx.io.stdout(`${JSON.stringify({ at: new Date().toISOString(), message, ...fields })}\n`)
      else ctx.io.stderr(`kanso agent: ${message}\n`)
    }

    const signal = ctx.io.signal ?? new AbortController().signal
    let mcpDir: string | null = null
    try {
      let command: (context: CardContext) => { file: string, args: string[] }
      if (v.claude) {
        // The token goes into a file only the user can read, not onto the command line (ps).
        mcpDir = await mkdtemp(join(tmpdir(), 'kanso-agent-'))
        const mcpConfig = join(mcpDir, 'mcp.json')
        await writeFile(mcpConfig, JSON.stringify({ mcpServers: { kanso: { type: 'http', url: `${creds.url}/api/mcp`, headers: { Authorization: `Bearer ${creds.token}` } } } }), { mode: 0o600 })
        const bin = ctx.io.env.KANSO_CLAUDE_BIN || 'claude'
        const prompt = typeof v.prompt === 'string' ? v.prompt : undefined
        command = context => ({ file: bin, args: ['-p', claudePrompt(context, prompt), '--mcp-config', mcpConfig, '--allowedTools', 'mcp__kanso'] })
      } else {
        command = () => ({ file: '/bin/sh', args: ['-c', cmd] })
      }

      const options: AgentOptions = {
        url: creds.url, token: creds.token, boardIds, activity, columnIds, notifications, concurrency,
        comment: comment as AgentOptions['comment'],
      }
      log(`following ${[
        notifications && 'notifications',
        activity.length && `${activity.join(',')} on ${boards.map(b => `"${b.name}"`).join(', ')}${columnNames.length ? ` in ${columnNames.join(', ')}` : ''}`,
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
        exec: (_job, env, stdin, context) => {
          const { file, args } = command(context)
          return execCommand(file, args, { ...ctx.io.env, ...env }, stdin, timeoutMs, signal)
        },
      })
      log('stopped')
    } finally {
      if (mcpDir) await rm(mcpDir, { recursive: true, force: true })
    }
  },
}

/**
 * Runs one command in its own process group (so a timeout or our own SIGTERM reaches
 * everything it started), stdout/stderr inherited, stdin = the card JSON.
 */
function execCommand(file: string, args: string[], env: Record<string, string | undefined>, stdin: string, timeoutMs: number, stop: AbortSignal): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: ['pipe', 'inherit', 'inherit'], detached: true })
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
