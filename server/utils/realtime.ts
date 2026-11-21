import postgres from 'postgres'

type Listener = (clientId: string) => void

const boardListeners = new Map<string, Set<Listener>>()
const userListeners = new Map<string, Set<() => void>>()
const activityListeners = new Map<string, Set<(e: ActivityNotice) => void>>()

/** One card activity entry (card_activity NOTIFY, see 0115_activity_events.sql): ids only. */
export interface ActivityNotice { a: string, b: string, card: string, kind: string, col: string | null, c: string }
let conn: postgres.Sql | undefined
const listening = new Map<string, Promise<unknown>>()

/**
 * LISTENs on `channel` over one dedicated connection per server, shared by all
 * channels. postgres.js re-listens after a reconnect.
 */
function listen(channel: string, fn: (payload: Record<string, string>) => void) {
  let p = listening.get(channel)
  if (!p) {
    conn ??= postgres(useRuntimeConfig().databaseUrl, { max: 1, onnotice: () => {} })
    p = conn.listen(channel, (payload) => {
      try {
        fn(JSON.parse(payload))
      }
      catch { /* ignore malformed payloads */ }
    }).catch((err) => {
      listening.delete(channel)
      throw err
    })
    listening.set(channel, p)
  }
  return p
}

function subscribe<F>(map: Map<string, Set<F>>, key: string, fn: F): () => void {
  let set = map.get(key)
  if (!set) map.set(key, set = new Set())
  set.add(fn)
  return () => {
    set.delete(fn)
    if (!set.size) map.delete(key)
  }
}

/**
 * Calls `fn` with the client id of each change to `boardId` (board_changes,
 * sent by the notify triggers, see 0014_board_notify_copy.sql). Returns the
 * unsubscribe function.
 */
export async function onBoardChange(boardId: string, fn: Listener): Promise<() => void> {
  await listen('board_changes', ({ b, c }) => boardListeners.get(b!)?.forEach(l => l(c!)))
  return subscribe(boardListeners, boardId, fn)
}

/**
 * Calls `fn` whenever `userId` gets a notification (user_notifications, see
 * 0016_notifications_rls.sql). Returns the unsubscribe function.
 */
export async function onUserNotification(userId: string, fn: () => void): Promise<() => void> {
  await listen('user_notifications', ({ u }) => userListeners.get(u!)?.forEach(l => l()))
  return subscribe(userListeners, userId, fn)
}

/**
 * Calls `fn` with each card activity entry of `boardId` (card_activity, see
 * 0115_activity_events.sql). No access check: callers check before passing it on.
 * Returns the unsubscribe function.
 */
export async function onCardActivity(boardId: string, fn: (e: ActivityNotice) => void): Promise<() => void> {
  await listen('card_activity', p => activityListeners.get(p.b!)?.forEach(l => l(p as unknown as ActivityNotice)))
  return subscribe(activityListeners, boardId, fn)
}

/** Calls `fn` whenever webhook deliveries are queued (board_webhooks, see 0041_api_tokens_webhooks_rls.sql). */
export async function onWebhooksQueued(fn: () => void): Promise<void> {
  await listen('board_webhooks', () => fn())
}

/** Calls `fn` whenever push messages are queued (push_messages, see 0068_push_rls.sql). */
export async function onPushQueued(fn: () => void): Promise<void> {
  await listen('push_messages', () => fn())
}

/** Calls `fn` whenever card activity is queued for Matrix threads (matrix_deliveries, see 0080_matrix_activity_rls.sql). */
export async function onMatrixQueued(fn: () => void): Promise<void> {
  await listen('matrix_deliveries', () => fn())
}
