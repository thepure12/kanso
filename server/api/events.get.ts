import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { webhookEvents } from '#shared/webhooks'

const COALESCE_MS = 250
const PING_MS = 25_000
/** How often a token stream checks that its token still works (revoked, expired, account gone: the stream closes). */
const TOKEN_CHECK_MS = PING_MS
/** Caps per stream; the client stays below them (app/utils/liveEvents.ts). */
const MAX_BOARDS = 50
const MAX_CLIENTS = 50
const MAX_COLUMNS = 200

const list = (max: number, item: z.ZodType<string, string>) => z.string().optional()
  .transform(s => [...new Set((s ?? '').split(',').filter(Boolean))])
  .pipe(z.array(item).max(max))

const querySchema = z.object({
  boards: list(MAX_BOARDS, z.uuid()),
  clients: list(MAX_CLIENTS, z.string().regex(/^[\w-]{1,64}$/)),
  notifications: z.enum(['0', '1']).optional(),
  activity: list(webhookEvents.length, z.enum(webhookEvents)),
  columns: list(MAX_COLUMNS, z.uuid()),
  change: z.enum(['0', '1']).optional(),
})

/**
 * One server-sent event stream per browser (the tab holding the `kanso-events` lock
 * opens it for all tabs and relays the events, see app/utils/liveEvents.ts), or per
 * script with an API token (`Authorization: Bearer`, read scope is enough):
 *
 * - `notifications` whenever the user gets a notification (with ?notifications=1);
 * - `change` `{b, c}` when board `b` (one of ?boards=) changed; `c` lists the tabs that
 *   made the changes of this burst: their ids when given in ?clients=, '' for anyone
 *   else, so each tab can skip its own changes. Left out when ?activity= is given,
 *   unless ?change=1 (and always with ?change=0);
 * - `activity` `{a, b, card, kind, column}` per card activity entry of a subscribed
 *   board whose kind is in ?activity= and whose card is (now) in one of ?columns= (all
 *   columns without it); for a move, the column the card landed in. Ids only. Sent only
 *   when the user may read the entry (limited members and bots never hear about hidden
 *   cards); entries made by one of ?clients= are left out (the listener's own changes);
 * - `gone` `{b}` when the user cannot (or can no longer) see board `b`; it is dropped;
 * - `ready` once everything is subscribed (the client then closes its previous stream),
 *   `ping` at once and every 25 s.
 *
 * Clients reconnect with new parameters when the set of boards or tabs changes. A token
 * stream follows the token's board limits and closes once the token stops working.
 */
export default defineEventHandler(async (event) => {
  const token = bearerToken(getHeader(event, 'authorization'))
  let userId: string
  let auth: RequestAuth
  if (token === undefined) {
    userId = await requireLiveSession(event)
    auth = (await requireSessionUser(event)).session
  }
  else {
    ({ userId, auth } = await requireTokenUser(event, token))
  }
  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid stream parameters' })
  const { boards, clients, notifications, activity, columns, change } = parsed.data
  const ownClients = new Set(clients)
  const kinds = new Set<string>(activity)
  const columnSet = new Set(columns)
  const sendChanges = change ? change === '1' : !kinds.size

  /** Boards (of `ids`) the user can still see. */
  const visible = async (ids: string[]) => {
    if (!ids.length) return new Set<string>()
    const rows = await withUser(userId, tx => tx.execute<{ id: string }>(sql`
      select v.id from (values ${sql.join(ids.map(id => sql`(${id}::uuid)`), sql`, `)}) v(id)
      where app.board_role(v.id) is not null`), '', auth)
    return new Set(rows.map(r => r.id))
  }
  /** Whether the user may read activity entry `id` (card_activity_select: board, limits, personal reminders). */
  const canRead = async (id: string) => {
    const rows = await withUser(userId, tx => tx.execute(sql`select 1 from card_activity where id = ${id}`), '', auth)
    return rows.length > 0
  }
  const initial = await visible(boards)

  const stream = createEventStream(event)
  let closed = false
  const cleanups: (() => void)[] = []
  // Runs at once when the stream closed while setting up.
  const onClose = (fn: () => void) => closed ? fn() : cleanups.push(fn)
  stream.onClosed(() => {
    closed = true
    for (const fn of cleanups.splice(0)) fn()
  })
  // h3 sends the response headers with the first write; without one the
  // stream would only open at the first event.
  void stream.push({ event: 'ping', data: '' })

  const gone = (b: string) => stream.push({ event: 'gone', data: JSON.stringify({ b }) })

  for (const b of boards) {
    if (!initial.has(b)) {
      // Not awaited: writes wait for the reader, which starts once the handler returns.
      void gone(b)
      continue
    }
    const stops: (() => void)[] = []
    let dropped = false
    // Once only: a second call could drop another stream's listener set (realtime.ts).
    const unsubscribe = () => {
      for (const stop of stops.splice(0)) stop()
    }
    const drop = async () => {
      if (dropped) return
      dropped = true
      unsubscribe()
      await gone(b)
    }

    if (sendChanges) {
      // Bursts of changes become one event per board. Access is re-checked before each one.
      let timer: ReturnType<typeof setTimeout> | undefined
      const authors = new Set<string>()
      const flush = async () => {
        timer = undefined
        const c = [...authors]
        authors.clear()
        if (closed || dropped) return
        const ok = (await visible([b]).catch(() => new Set<string>())).has(b)
        if (closed || dropped) return
        if (!ok) return drop()
        await stream.push({ event: 'change', data: JSON.stringify({ b, c }) })
      }
      stops.push(await onBoardChange(b, (client) => {
        authors.add(client && ownClients.has(client) ? client : '')
        timer ??= setTimeout(flush, COALESCE_MS)
      }))
      onClose(() => clearTimeout(timer))
    }

    if (kinds.size) {
      // One entry at a time, so events keep their order.
      let queue = Promise.resolve()
      const forward = async (e: ActivityNotice) => {
        if (closed || dropped) return
        if (await canRead(e.a)) {
          if (!closed && !dropped) {
            await stream.push({ event: 'activity', data: JSON.stringify({ a: e.a, b, card: e.card, kind: e.kind, column: e.col }) })
          }
          return
        }
        // Hidden card, or the board itself is gone.
        if (!(await visible([b])).has(b) && !closed) await drop()
      }
      stops.push(await onCardActivity(b, (e) => {
        if (!kinds.has(e.kind) || (columnSet.size && !(e.col && columnSet.has(e.col))) || (e.c && ownClients.has(e.c))) return
        queue = queue.then(() => forward(e)).catch(() => {})
      }))
    }
    onClose(unsubscribe)
  }

  if (notifications === '1') {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = await onUserNotification(userId, () => {
      timer ??= setTimeout(() => {
        timer = undefined
        if (!closed) stream.push({ event: 'notifications', data: '' })
      }, COALESCE_MS)
    })
    onClose(() => {
      clearTimeout(timer)
      unsubscribe()
    })
  }

  const ping = setInterval(() => stream.push({ event: 'ping', data: '' }), PING_MS)
  onClose(() => clearInterval(ping))
  if (token !== undefined) {
    const check = setInterval(async () => {
      if (closed) return
      const live = await apiTokenLive(token).catch(() => true)
      if (!live && !closed) await stream.close()
    }, tokenCheckMs())
    onClose(() => clearInterval(check))
  }
  void stream.push({ event: 'ready', data: '' })
  return stream.send()
})

/** NUXT_EVENTS_TOKEN_CHECK_MS shortens the check for tests. */
function tokenCheckMs() {
  const ms = Number(process.env.NUXT_EVENTS_TOKEN_CHECK_MS)
  return ms > 0 ? ms : TOKEN_CHECK_MS
}
