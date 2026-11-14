import { sql } from 'drizzle-orm'
import type { Activity } from '#shared/types/board'
import type { I18nContext } from '#shared/i18n'
import { actorLabel, describeActivity } from '../../app/utils/activityText'

type ClaimedMatrixDelivery = {
  delivery_id: string
  attempt: number
  homeserver_url: string
  room_id: string
  thread_id: string
  access_token: string
  kind: string
  data: Record<string, unknown>
  card_id: string
  card_title: string
  board_id: string
  board_name: string
  actor_name: string | null
  /** users.locale of whoever connected the room: language of the text. */
  locale: string | null
}

/** "Alice moved this card from To do to Done" as a bot notice in the card's thread. */
export function activityNotice(threadId: string, d: Pick<ClaimedMatrixDelivery, 'kind' | 'data' | 'actor_name'>, i18n: I18nContext) {
  const activity = { kind: d.kind as Activity['kind'], data: d.data as Activity['data'] }
  const text = `${actorLabel(d.actor_name, activity, i18n)} ${describeActivity(activity, i18n)}`
  return {
    'msgtype': 'm.notice',
    'body': text,
    'm.relates_to': { 'rel_type': 'm.thread', 'event_id': threadId, 'is_falling_back': true, 'm.in_reply_to': { event_id: threadId } },
    'app.kanso.activity': { kind: d.kind },
  }
}

let running: Promise<void> | undefined
let again = false

/**
 * Posts every due card activity into its card's Matrix thread
 * (matrix_deliveries outbox). Called on NOTIFY matrix_deliveries
 * (server/plugins/matrix.ts) and every minute (task matrix:deliver). One run
 * at a time per instance; instances share the work through
 * app.claim_matrix_deliveries. Deliveries of one card go out in order.
 */
export function deliverMatrixActivity(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    try {
      do {
        again = false
        while (await deliverBatch() === 20) { /* full batch: there may be more */ }
      } while (again)
    }
    finally {
      running = undefined
    }
  })()
  return running
}

async function deliverBatch(): Promise<number> {
  const db = useAuthDb()
  const rows = await db.execute<ClaimedMatrixDelivery>(sql`select * from app.claim_matrix_deliveries(20)`)
  // Same card: one after another, so the thread reads in order.
  const byCard = Map.groupBy(rows, r => r.card_id)
  await Promise.all([...byCard.values()].map(async (list) => {
    for (const r of list) {
      const accessToken = openMatrixToken(r.access_token)
      let error: string | null = null
      if (!accessToken) error = 'The stored token cannot be read'
      else {
        try {
          // The delivery id as transaction id: a retry after a lost answer posts nothing twice.
          await sendMessage({ homeserverUrl: r.homeserver_url, accessToken }, r.room_id, activityNotice(r.thread_id, r, serverI18n(r.locale)), `kanso-activity-${r.delivery_id}`)
        }
        catch (e) {
          error = e instanceof Error ? e.message : String(e)
        }
      }
      if (error) console.warn(`[matrix] activity for card ${r.card_id}: ${error}`)
      await db.execute(sql`select app.finish_matrix_delivery(${r.delivery_id}, ${!error}, ${error})`)
    }
  }))
  return rows.length
}
