import { createECDH } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { generateRequestDetails } from 'web-push'
import type { Activity } from '#shared/types/board'
import type { I18nContext } from '#shared/i18n'
import { actorLabel, describeNotification } from '../../app/utils/activityText'

export interface VapidKeys { publicKey: string, privateKey: string }

let derived: VapidKeys | undefined

/**
 * The VAPID key pair (base64url, raw P-256): NUXT_PUSH_VAPID_PUBLIC_KEY and
 * NUXT_PUSH_VAPID_PRIVATE_KEY when both are set, else derived from the session
 * password through HKDF, so a fresh install needs no setup. Changing it makes
 * every subscription invalid: push services answer 403, the rows are dropped
 * and browsers subscribe again with the new key on their next visit.
 */
export function vapidKeys(): VapidKeys {
  const { push, session } = useRuntimeConfig()
  if (push.vapidPublicKey && push.vapidPrivateKey) return { publicKey: push.vapidPublicKey, privateKey: push.vapidPrivateKey }
  if (!derived) derived = deriveVapidKeys(session.password)
  return derived
}

export function deriveVapidKeys(material: string): VapidKeys {
  const priv = secretKey(material, 'kanban/vapid/v1')
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(priv)
  return { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey: priv.toString('base64url') }
}

/** VAPID subject (contact for push services): NUXT_PUSH_SUBJECT, else the site URL, else mailto: the admin. */
function vapidSubject(): string {
  const { push, public: pub, adminEmail } = useRuntimeConfig()
  if (push.subject) return push.subject
  if (pub.siteUrl.startsWith('https://')) return pub.siteUrl
  return `mailto:${adminEmail || 'admin@example.com'}`
}

/** A push endpoint the server may send to: https, no credentials, no private address (unless allowed, as for webhooks). */
export function pushEndpointProblem(url: string, allowPrivate = webhookAllowPrivate()): string | null {
  if (!allowPrivate && !url.startsWith('https://')) return 'Only https endpoints are allowed'
  return webhookUrlProblem(url, allowPrivate)
}

export interface PushPayload {
  title: string
  body: string
  /** Notifications with the same tag replace each other (also those the open tab shows). */
  tag: string
  /** Page to open on click, with the base path. */
  url: string
  /** PATCHed with {read: true} on click, with the base path. */
  readUrl?: string
  /** Show it even while a Kanso tab is focused (test messages). */
  force?: boolean
}

export type PushTarget = { id: string, endpoint: string, p256dh: string, auth: string }

export type PushResult = PostResult & { gone: boolean }

/** Encrypts and sends one message. 400/403/404/410 mean the subscription is dead or was made for another key. */
export async function sendPush(target: PushTarget, payload: PushPayload): Promise<PushResult> {
  const allowPrivate = webhookAllowPrivate()
  const problem = pushEndpointProblem(target.endpoint, allowPrivate)
  if (problem) return { ok: false, status: null, error: problem, gone: true }
  let details: ReturnType<typeof generateRequestDetails>
  try {
    details = generateRequestDetails(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      { vapidDetails: { subject: vapidSubject(), ...vapidKeys() }, TTL: 86400, urgency: 'normal' },
    )
  }
  catch (err) {
    return { ok: false, status: null, error: (err as Error).message, gone: true }
  }
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(details.headers)) {
    if (k.toLowerCase() !== 'content-length') headers[k] = String(v)
  }
  const res = await postWebhook(details.endpoint, details.body as Buffer, headers, allowPrivate)
  const gone = res.status !== null && [400, 403, 404, 410].includes(res.status)
  if (!res.ok) console.warn(`[push] ${new URL(details.endpoint).host}: ${res.error}${gone ? ' (subscription dropped)' : ''} ${res.body?.trim() ?? ''}`)
  return { ...res, gone }
}

type ClaimedMessage = {
  message_id: string
  notification_id: string
  user_id: string
  read: boolean
  kind: Activity['kind']
  data: Activity['data']
  card_id: string
  card_title: string
  board_id: string
  board_name: string
  actor_name: string | null
  locale: string | null
  subscriptions: PushTarget[]
}

/** The message for a notification: card title, "<actor> <what happened>" and the board, linking to the card. */
export function notificationPayload(m: Pick<ClaimedMessage, 'notification_id' | 'user_id' | 'kind' | 'data' | 'card_id' | 'card_title' | 'board_id' | 'board_name' | 'actor_name'>, i18n: I18nContext): PushPayload {
  const activity = { kind: m.kind, data: m.data }
  return {
    title: m.card_title,
    body: `${actorLabel(m.actor_name, activity, i18n)} ${describeNotification(activity, i18n, m.user_id)}\n${m.board_name}`,
    tag: `kanso-notification-${m.notification_id}`,
    url: appPath(`/boards/${m.board_id}?card=${m.card_id}`),
    readUrl: appPath(`/api/notifications/${m.notification_id}`),
  }
}

let running: Promise<void> | undefined
let again = false

/**
 * Sends every queued push message (push_messages outbox). Called on NOTIFY
 * push_messages (server/plugins/push.ts) and every minute
 * (server/tasks/push/deliver.ts). One run at a time per instance; a call during
 * a run makes it go round once more. Instances share the work through
 * app.claim_push_messages (SKIP LOCKED plus a lease).
 */
export function deliverPush(): Promise<void> {
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
  const rows = await db.execute<ClaimedMessage>(sql`select * from app.claim_push_messages(20)`)
  await Promise.all(rows.map(async (m) => {
    // Read in another tab or device before it went out: nothing to tell.
    if (!m.read) {
      const payload = notificationPayload(m, serverI18n(m.locale))
      await Promise.all(m.subscriptions.map(async (s) => {
        const res = await sendPush(s, payload)
        await db.execute(sql`select app.record_push_result(${s.id}, ${res.ok}, ${res.gone})`)
      }))
    }
    await db.execute(sql`select app.finish_push_message(${m.message_id})`)
  }))
  return rows.length
}
