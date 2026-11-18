import { sql } from 'drizzle-orm'
import { z } from 'zod'

const COALESCE_MS = 250
const PING_MS = 25_000
/** Caps per stream; the client stays below them (app/utils/liveEvents.ts). */
const MAX_BOARDS = 50
const MAX_CLIENTS = 50

const list = (max: number, item: z.ZodType<string, string>) => z.string().optional()
  .transform(s => [...new Set((s ?? '').split(',').filter(Boolean))])
  .pipe(z.array(item).max(max))

const querySchema = z.object({
  boards: list(MAX_BOARDS, z.uuid()),
  clients: list(MAX_CLIENTS, z.string().regex(/^[\w-]{1,64}$/)),
  notifications: z.enum(['0', '1']).optional(),
})

/**
 * One server-sent event stream per browser (the tab holding the `kanso-events` lock
 * opens it for all tabs and relays the events, see app/utils/liveEvents.ts):
 *
 * - `notifications` whenever the session user gets a notification (with ?notifications=1);
 * - `change` `{b, c}` when board `b` (one of ?boards=) changed; `c` lists the tabs that
 *   made the changes of this burst: their ids when given in ?clients=, '' for anyone
 *   else, so each tab can skip its own changes;
 * - `gone` `{b}` when the user cannot (or can no longer) see board `b`; it is dropped;
 * - `ready` once everything is subscribed (the client then closes its previous stream),
 *   `ping` at once and every 25 s.
 *
 * Clients reconnect with new parameters when the set of boards or tabs changes.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireLiveSession(event)
  const { session } = await requireSessionUser(event)
  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid stream parameters' })
  const { boards, clients, notifications } = parsed.data
  const ownClients = new Set(clients)

  /** Boards (of `ids`) the user can still see. */
  const visible = async (ids: string[]) => {
    if (!ids.length) return new Set<string>()
    const rows = await withUser(userId, tx => tx.execute<{ id: string }>(sql`
      select v.id from (values ${sql.join(ids.map(id => sql`(${id}::uuid)`), sql`, `)}) v(id)
      where app.board_role(v.id) is not null`), '', session)
    return new Set(rows.map(r => r.id))
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
    // Bursts of changes become one event per board. Access is re-checked before each one.
    let timer: ReturnType<typeof setTimeout> | undefined
    const authors = new Set<string>()
    let unsubscribe = () => {}
    const flush = async () => {
      timer = undefined
      const c = [...authors]
      authors.clear()
      if (closed) return
      const ok = (await visible([b]).catch(() => new Set<string>())).has(b)
      if (closed) return
      if (!ok) {
        unsubscribe()
        await gone(b)
        return
      }
      await stream.push({ event: 'change', data: JSON.stringify({ b, c }) })
    }
    const stop = await onBoardChange(b, (client) => {
      authors.add(client && ownClients.has(client) ? client : '')
      timer ??= setTimeout(flush, COALESCE_MS)
    })
    // Once only: a second call could drop another stream's listener set (realtime.ts).
    let subscribed = true
    unsubscribe = () => {
      if (subscribed) stop()
      subscribed = false
    }
    onClose(() => {
      clearTimeout(timer)
      unsubscribe()
    })
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
  void stream.push({ event: 'ready', data: '' })
  return stream.send()
})
