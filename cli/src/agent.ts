import type { Activity, AgentRule, AgentRuleEvent, BoardDetail, CardDetail } from '../../shared/types/board.ts'
import type { Inbox, Notification } from '../../shared/types/notifications.ts'
import { ApiError, type Client, describeApiError } from './client.ts'
import { CliError } from './io.ts'
import { readServerEvents } from './sse.ts'
import { VERSION } from './version.ts'

/** The x-client-id of the runner's own requests and its stream's `clients`, so its own comments trigger nothing. */
export const AGENT_CLIENT_ID = 'kanso-agent'

export interface AgentOptions {
  url: string
  token: string
  /** Boards to follow (activity triggers need at least one; notifications are limited to them when given). */
  boardIds: string[]
  /** Activity kinds that start a run (empty = no activity trigger). */
  activity: string[]
  /** Only activity of cards (now) in these columns; empty = every column. */
  columnIds: string[]
  /** Unread notifications (mentions, assignments, ... of the token's user) start a run and are marked read after it. */
  notifications: boolean
  /** Runs at once (never two on the same card). */
  concurrency: number
  /** Comment the exit status on the card: never, only for failures, or always. */
  comment: 'never' | 'failure' | 'always'
  /**
   * Rules mode: follow the agent rules of `boardIds` whose bot is this user (the
   * token's), instead of `activity`/`columnIds`/`notifications`. The rules are
   * read at every (re)connect and whenever the board changes.
   */
  rulesFor?: string | null
}

/** Activity kinds that can start an agent rule's event. */
export const agentRuleKinds: Record<AgentRuleEvent, string[]> = {
  card_created: ['created'],
  card_moved: ['moved'],
  tag_added: ['tagged'],
  assigned: ['assigned'],
  mentioned: ['commented', 'mentioned'],
}

/** The rules (active, of this bot) an activity event may start; the rest is checked by ruleSkipReason. */
export function rulesForEvent(rules: AgentRule[], botId: string, kind: string, columnId: string | null): AgentRule[] {
  return rules.filter(r => r.active && r.botId === botId && agentRuleKinds[r.event].includes(kind)
    && (!r.columnId || r.columnId === columnId))
}

/**
 * Why a rule does not apply to the card after all (null = it does), checked with
 * the loaded card: still in the rule's column, the tag, the bot assigned or
 * mentioned by that very activity, and never the bot's own changes.
 */
export function ruleSkipReason(rule: AgentRule, botId: string, context: Pick<CardContext, 'card' | 'column' | 'detail'>, tags: { id: string, name: string }[], activityId: string): string | null {
  const act: Activity | undefined = context.detail.activity.find(a => a.id === activityId)
  const data = (act?.data ?? {}) as { user_id?: unknown, mentions?: unknown, tag?: unknown }
  if (act && act.actorId === botId) return 'the bot made this change itself'
  if (rule.columnId && context.column?.id !== rule.columnId) return 'the card is no longer in the rule\'s column'
  if (rule.tagId) {
    if (rule.event === 'tag_added' && act) {
      const name = tags.find(t => t.id === rule.tagId)?.name
      if (data.tag !== name) return 'another card tag was added'
    } else if (!context.card.tagIds.includes(rule.tagId)) {
      return 'the card does not have the rule\'s tag'
    }
  }
  if (rule.event === 'assigned') {
    if (act ? data.user_id !== botId : !context.card.assigneeIds.includes(botId)) return 'someone else was assigned'
  }
  if (rule.event === 'mentioned') {
    if (!act || !Array.isArray(data.mentions) || !data.mentions.includes(botId)) return 'the bot was not mentioned'
  }
  return null
}

/** What a run gets: the trigger, and the card context written to the command's stdin. */
export interface Job {
  boardId: string
  cardId: string
  /** The activity kind (for notifications the kind of the activity that notified). */
  event: string
  source: 'activity' | 'notification'
  activityId: string
  notificationId?: string
  /** Rules mode: the agent rule this run follows. */
  rule?: AgentRule
}

export interface CardContext {
  event: { source: Job['source'], kind: string, activityId: string, notificationId: string | null, notification: Notification | null }
  board: { id: string, name: string, url: string }
  column: { id: string, title: string } | null
  card: BoardDetail['cards'][number] & { url: string }
  detail: CardDetail
  /** Rules mode: the agent rule the run follows. */
  rule?: { id: string, name: string, instructions: string }
}

export interface ExecResult {
  /** Exit code, null when killed by a signal. */
  code: number | null
  signal: string | null
  timedOut: boolean
  /** Why the run failed before or around the command (worktree, --setup), for the log and the status comment. */
  error?: string
}

export interface AgentDeps {
  /** JSON client sending x-client-id AGENT_CLIENT_ID. */
  client: Client
  /** For the event stream. */
  fetch: typeof globalThis.fetch
  /** Runs the command for one job; env holds the KANSO_* variables, stdin the card JSON. */
  exec: (job: Job, env: Record<string, string>, stdin: string, context: CardContext) => Promise<ExecResult>
  log: (message: string, fields?: Record<string, unknown>) => void
  sleep: (ms: number, signal: AbortSignal) => Promise<void>
  signal: AbortSignal
  /** Abort a silent stream after this long (pings come every 25 s). */
  stallMs?: number
}

/** A board of --board that the token cannot see: the stream sent `gone`. */
export class BoardGoneError extends CliError {}

/** Errors that a reconnect will not fix: bad token, missing access, bad parameters. */
function fatal(err: unknown): boolean {
  return err instanceof BoardGoneError || (err instanceof ApiError && [400, 401, 403, 404].includes(err.status))
}

/** Reconnect delays: 1 s doubling to 60 s; reset once a stream is ready. */
export function backoff(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, attempt))
}

/** The /api/events query for the options. */
export function streamQuery(o: Pick<AgentOptions, 'boardIds' | 'activity' | 'columnIds' | 'notifications' | 'rulesFor'>): string {
  const q = new URLSearchParams()
  if (o.boardIds.length) q.set('boards', o.boardIds.join(','))
  if (o.rulesFor) {
    // Every kind a rule may need, so rule changes never reopen the stream; `change` reloads the rules.
    q.set('activity', [...new Set(Object.values(agentRuleKinds).flat())].join(','))
    q.set('change', '1')
    q.set('clients', AGENT_CLIENT_ID)
    return q.toString()
  }
  if (o.notifications) q.set('notifications', '1')
  if (o.activity.length) {
    q.set('activity', o.activity.join(','))
    q.set('change', '0')
  }
  if (o.columnIds.length) q.set('columns', o.columnIds.join(','))
  q.set('clients', AGENT_CLIENT_ID)
  return q.toString()
}

/** Text of the optional status comment. */
export function statusComment(job: Job, result: ExecResult, seconds: number): string {
  const how = result.timedOut
    ? 'was stopped after the timeout'
    : result.code === 0
      ? 'finished'
      : result.code === null
        ? `was killed (${result.signal ?? 'signal'})`
        : `failed with exit code ${result.code}`
  const rule = job.rule ? ` (agent rule "${job.rule.name}")` : ''
  return `kanso agent: the run for **${job.event}**${rule} ${how} after ${seconds} s.${result.error ? `\n\n${result.error}` : ''}`
}

/**
 * Follows the event stream and runs a command per event until `deps.signal` aborts,
 * then waits for the runs in progress. Throws a CliError for problems a reconnect
 * will not fix (token refused, board not visible, bad parameters).
 */
export async function runAgent(o: AgentOptions, deps: AgentDeps): Promise<void> {
  const { client, log, signal } = deps
  const pending: Job[] = []
  /** Card id → its run. */
  const running = new Map<string, Promise<void>>()
  /** Notification ids of queued and running jobs. */
  const active = new Set<string>()
  /** Notification ids queued, running or handled (until the inbox no longer lists them as unread). */
  const knownNotifications = new Set<string>()
  const seenActivity = new Set<string>()
  const notifications = new Map<string, Notification>()
  /** Rules mode: board id → its active rules for this bot. */
  const rules = new Map<string, AgentRule[]>()
  /** Board id → its card tags, as of the last card context. */
  const boardTags = new Map<string, { id: string, name: string }[]>()
  let stopError: unknown

  /** Activity ids only guard against duplicates of recent events. */
  const seen = (id: string) => {
    if (seenActivity.has(id)) return true
    seenActivity.add(id)
    if (seenActivity.size > 2000) seenActivity.delete(seenActivity.values().next().value!)
    return false
  }

  function pump() {
    while (!signal.aborted && running.size < o.concurrency) {
      const i = pending.findIndex(j => !running.has(j.cardId))
      if (i < 0) return
      const [job] = pending.splice(i, 1)
      const p = runJob(job!).catch((err: unknown) => log(`run failed: ${(err as Error).message}`, { card: job!.cardId }))
        .finally(() => {
          running.delete(job!.cardId)
          if (job!.notificationId) {
            active.delete(job!.notificationId)
            notifications.delete(job!.notificationId)
          }
          pump()
        })
      running.set(job!.cardId, p)
    }
  }

  function enqueue(job: Job) {
    pending.push(job)
    if (job.notificationId) active.add(job.notificationId)
    log(`queued ${job.event} on card ${job.cardId}${job.rule ? ` for agent rule "${job.rule.name}"` : ''}`,
      { board: job.boardId, card: job.cardId, event: job.event, source: job.source, ...(job.rule && { rule: job.rule.id }) })
    pump()
  }

  async function cardContext(job: Job): Promise<CardContext | null> {
    let board: BoardDetail
    let detail: CardDetail
    try {
      [board, detail] = await Promise.all([
        client.get<BoardDetail>(`/api/boards/${job.boardId}`),
        client.get<CardDetail>(`/api/cards/${job.cardId}`),
      ])
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
    boardTags.set(board.id, board.tags.map(t => ({ id: t.id, name: t.name })))
    const card = board.cards.find(c => c.id === job.cardId)
    // Archived, trashed or snoozed since, or a template.
    if (!card) return null
    const column = board.columns.find(c => c.id === card.columnId)
    const n = job.notificationId ? notifications.get(job.notificationId) ?? null : null
    return {
      event: { source: job.source, kind: job.event, activityId: job.activityId, notificationId: job.notificationId ?? null, notification: n },
      board: { id: board.id, name: board.name, url: `${o.url}/boards/${board.id}` },
      column: column ? { id: column.id, title: column.title } : null,
      card: { ...card, url: `${o.url}/boards/${board.id}?card=${card.id}` },
      detail,
      ...(job.rule && { rule: { id: job.rule.id, name: job.rule.name, instructions: job.rule.instructions } }),
    }
  }

  async function runJob(job: Job) {
    try {
      const context = await cardContext(job)
      if (!context) {
        log(`skipped ${job.event} on card ${job.cardId}: the card is not on the board (any more)`, { card: job.cardId })
        return
      }
      const rule = job.rule
      if (rule) {
        const why = ruleSkipReason(rule, o.rulesFor!, context, boardTags.get(job.boardId) ?? [], job.activityId)
        if (why) {
          log(`skipped agent rule "${rule.name}" on card ${job.cardId}: ${why}`, { card: job.cardId, rule: rule.id })
          return
        }
      }
      const env: Record<string, string> = {
        KANSO_URL: o.url,
        KANSO_TOKEN: o.token,
        KANSO_BOARD_ID: job.boardId,
        KANSO_CARD_ID: job.cardId,
        KANSO_EVENT: job.event,
        KANSO_EVENT_SOURCE: job.source,
        KANSO_ACTIVITY_ID: job.activityId,
        KANSO_CARD_URL: context.card.url,
        ...(job.notificationId && { KANSO_NOTIFICATION_ID: job.notificationId }),
        ...(rule && { KANSO_RULE_ID: rule.id, KANSO_RULE_NAME: rule.name }),
      }
      log(`run ${job.event} on card "${context.card.title}" (${job.cardId})${rule ? ` for agent rule "${rule.name}"` : ''}`,
        { card: job.cardId, event: job.event, ...(rule && { rule: rule.id }) })
      const started = Date.now()
      const result = await deps.exec(job, env, `${JSON.stringify(context)}\n`, context)
      const seconds = Math.round((Date.now() - started) / 1000)
      const ok = result.code === 0 && !result.timedOut
      log(`done ${job.event} on card ${job.cardId}: ${ok ? 'ok' : result.timedOut ? 'timed out' : `exit ${result.code ?? result.signal}`} after ${seconds} s${result.error ? ` (${result.error})` : ''}`, {
        card: job.cardId, event: job.event, code: result.code, signal: result.signal, timedOut: result.timedOut, seconds,
      })
      if (ok && rule?.moveColumnId) await moveToEnd(job.cardId, job.boardId, rule.moveColumnId)
      const comment = rule ? rule.comment : o.comment
      if (comment === 'always' || (comment === 'failure' && !ok)) {
        await client.post(`/api/cards/${job.cardId}/comments`, { body: statusComment(job, result, seconds) })
          .catch((err: unknown) => log(`could not comment on card ${job.cardId}: ${(err as Error).message}`))
      }
    } finally {
      // Handled (or skipped): mark read even when the command failed, so it does not run again and again.
      if (job.notificationId) {
        await client.patch(`/api/notifications/${job.notificationId}`, { read: true })
          .catch((err: unknown) => log(`could not mark notification ${job.notificationId} read: ${(err as Error).message}`))
      }
    }
  }

  /** Moves the card to the end of the column (column rules run). */
  async function moveToEnd(cardId: string, boardId: string, columnId: string) {
    try {
      const board = await client.get<BoardDetail>(`/api/boards/${boardId}`)
      const last = board.cards.filter(c => c.columnId === columnId && c.id !== cardId).at(-1)
      await client.post(`/api/cards/${cardId}/move`, { columnId, aboveId: last?.id ?? null, belowId: null })
      log(`moved card ${cardId} to column ${board.columns.find(c => c.id === columnId)?.title ?? columnId}`, { card: cardId, column: columnId })
    } catch (err) {
      log(`could not move card ${cardId}: ${(err as Error).message}`, { card: cardId })
    }
  }

  // Rules mode: rule reads one at a time; a request while one runs reads again afterwards.
  let rulesBusy: Promise<void> | null = null
  let rulesAgain = false
  function loadRules() {
    if (rulesBusy) {
      rulesAgain = true
      return rulesBusy
    }
    rulesBusy = (async () => {
      do {
        rulesAgain = false
        for (const b of o.boardIds) {
          const list = await client.get<AgentRule[]>(`/api/boards/${b}/agent-rules`)
          const mine = list.filter(r => r.active && r.botId === o.rulesFor)
          const before = rules.get(b)
          rules.set(b, mine)
          if (JSON.stringify(before) !== JSON.stringify(mine)) {
            log(mine.length
              ? `board ${b}: following ${mine.length} agent rule(s): ${mine.map(r => `"${r.name}"`).join(', ')}`
              : `board ${b}: no active agent rules for this bot (waiting for some)`, { board: b, rules: mine.map(r => r.id) })
          }
        }
      } while (rulesAgain && !signal.aborted)
    })().catch((err: unknown) => {
      if (fatal(err)) stopError ??= err
      log(`could not read the agent rules: ${(err as Error).message}`)
    }).finally(() => { rulesBusy = null })
    return rulesBusy
  }

  // Inbox reads one at a time; a request while one runs reads again afterwards.
  let inboxBusy: Promise<void> | null = null
  let inboxAgain = false
  function readInbox() {
    if (inboxBusy) {
      inboxAgain = true
      return inboxBusy
    }
    inboxBusy = (async () => {
      do {
        inboxAgain = false
        const inbox = await client.get<Inbox>('/api/notifications?unread=1&limit=100')
        const unread = new Set(inbox.items.map(n => n.id))
        // Handled ones the inbox no longer lists as unread can be forgotten.
        for (const id of knownNotifications) {
          if (!unread.has(id) && !active.has(id)) knownNotifications.delete(id)
        }
        // Oldest first.
        for (const n of [...inbox.items].reverse()) {
          if (knownNotifications.has(n.id) || n.readAt) continue
          if (o.boardIds.length && !o.boardIds.includes(n.boardId)) continue
          knownNotifications.add(n.id)
          notifications.set(n.id, n)
          enqueue({ boardId: n.boardId, cardId: n.cardId, event: n.activity.kind, source: 'notification', activityId: n.activity.id, notificationId: n.id })
        }
      } while (inboxAgain && !signal.aborted)
    })().catch((err: unknown) => {
      if (fatal(err)) stopError ??= err
      log(`could not read the inbox: ${(err as Error).message}`)
    }).finally(() => { inboxBusy = null })
    return inboxBusy
  }

  // One stream at a time; reconnects with backoff.
  let attempt = 0
  const path = `/api/events?${streamQuery(o)}`
  while (!signal.aborted && !stopError) {
    const ctrl = new AbortController()
    const abort = () => ctrl.abort()
    signal.addEventListener('abort', abort)
    let stall: ReturnType<typeof setTimeout> | undefined
    const alive = () => {
      clearTimeout(stall)
      stall = setTimeout(() => ctrl.abort(), deps.stallMs ?? 70_000)
    }
    try {
      alive()
      let res: Response
      try {
        res = await deps.fetch(o.url + path, {
          signal: ctrl.signal,
          redirect: 'manual',
          headers: { 'authorization': `Bearer ${o.token}`, 'accept': 'text/event-stream', 'user-agent': `kanso-cli/${VERSION}`, 'x-client-id': AGENT_CLIENT_ID },
        })
      } catch (err) {
        if (signal.aborted) break
        throw new CliError(`Cannot reach ${o.url}: ${(err as { cause?: { code?: string } }).cause?.code ?? (err as Error).message}`)
      }
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        let message = ''
        try {
          const d = JSON.parse(text) as { message?: string, statusMessage?: string }
          message = d.message || d.statusMessage || ''
        } catch {}
        throw new ApiError(res.status, message, text, describeApiError(res.status, message, 'GET', '/api/events'))
      }
      for await (const e of readServerEvents(res.body, alive)) {
        if (signal.aborted || stopError) break
        if (e.event === 'ready') {
          attempt = 0
          log('listening for events')
          if (o.rulesFor) {
            await loadRules()
            if (stopError) break
          }
          else if (o.notifications) void readInbox()
        } else if (e.event === 'notifications') {
          void readInbox()
        } else if (e.event === 'change') {
          if (o.rulesFor) void loadRules()
        } else if (e.event === 'activity') {
          const a = JSON.parse(e.data) as { a: string, b: string, card: string, kind: string, column?: string | null }
          if (seen(a.a)) continue
          if (o.rulesFor) {
            // Rules read when the activity happened (a change event may still be on its way).
            if (rulesBusy) await rulesBusy
            for (const rule of rulesForEvent(rules.get(a.b) ?? [], o.rulesFor, a.kind, a.column ?? null)) {
              enqueue({ boardId: a.b, cardId: a.card, event: a.kind, source: 'activity', activityId: a.a, rule })
            }
            continue
          }
          enqueue({ boardId: a.b, cardId: a.card, event: a.kind, source: 'activity', activityId: a.a })
        } else if (e.event === 'gone') {
          const { b } = JSON.parse(e.data) as { b: string }
          throw new BoardGoneError(`Board ${b} is not visible to this token (wrong id, a token limited to other boards, or access lost).`)
        }
      }
      if (!signal.aborted && !stopError) log('the event stream closed; reconnecting')
    } catch (err) {
      if (signal.aborted) break
      if (fatal(err)) {
        stopError = err
        break
      }
      log(`event stream error: ${(err as Error).message}`)
    } finally {
      clearTimeout(stall)
      signal.removeEventListener('abort', abort)
      ctrl.abort()
    }
    if (signal.aborted || stopError) break
    const wait = backoff(attempt++)
    log(`reconnecting in ${Math.round(wait / 1000)} s`)
    await deps.sleep(wait, signal)
  }

  pending.length = 0
  if (running.size) log(`waiting for ${running.size} run(s) to finish`)
  await Promise.all([...running.values()])
  if (inboxBusy) await inboxBusy
  if (rulesBusy) await rulesBusy
  if (stopError) throw stopError
}
