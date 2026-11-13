import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { webhookEvents, type WebhookFormat } from '#shared/webhooks'
import type { BoardWebhook } from '#shared/types/webhooks'

type ClaimedDelivery = {
  delivery_id: string
  webhook_id: string
  url: string
  format: WebhookFormat
  secret: string
  attempt: number
  activity_id: string
  kind: string
  data: Record<string, unknown>
  created_at: string | Date
  card_id: string
  card_title: string
  board_id: string
  board_name: string
  actor_id: string | null
  actor_name: string | null
  /** The webhook creator's users.locale: language of the message text. */
  locale: string | null
}

/** NUXT_WEBHOOK_ALLOW_PRIVATE: let webhooks reach private and loopback addresses (dev and tests only). */
export function webhookAllowPrivate(): boolean {
  const v: unknown = useRuntimeConfig().webhook.allowPrivate
  return v === true || v === 'true'
}

function webhookSiteUrl(): string | null {
  return useRuntimeConfig().public.siteUrl.replace(/\/+$/, '') || null
}

let running: Promise<void> | undefined
let again = false

/**
 * Sends every due delivery (webhook_deliveries outbox). Called on NOTIFY
 * board_webhooks (server/plugins/webhooks.ts) and every minute
 * (server/tasks/webhooks/deliver.ts). One run at a time per instance; a call
 * during a run makes it go round once more. Instances share the work through
 * app.claim_webhook_deliveries (SKIP LOCKED plus a lease).
 */
export function deliverWebhooks(): Promise<void> {
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
  const rows = await db.execute<ClaimedDelivery>(sql`select * from app.claim_webhook_deliveries(20)`)
  const allowPrivate = webhookAllowPrivate()
  const siteUrl = webhookSiteUrl()
  await Promise.all(rows.map(async (r) => {
    const { body, headers } = webhookRequest(r.format, {
      deliveryId: r.delivery_id,
      board: { id: r.board_id, name: r.board_name },
      activity: {
        id: r.activity_id,
        kind: r.kind,
        data: r.data,
        createdAt: new Date(r.created_at).toISOString(),
        card: { id: r.card_id, title: r.card_title },
        actor: r.actor_id ? { id: r.actor_id, name: r.actor_name ?? '' } : null,
      },
    }, r.secret, siteUrl, serverI18n(r.locale))
    const res = await postWebhook(r.url, body, headers, allowPrivate)
    await db.execute(sql`select app.finish_webhook_delivery(${r.delivery_id}, ${res.ok}, ${res.status}::integer, ${res.error})`)
  }))
  return rows.length
}

/** Sends a ping to a webhook and records the result on it (not counted as a failure). */
export async function pingWebhook(webhookId: string, target: { url: string, format: WebhookFormat, secret: string, boardId: string, boardName: string, locale: string | null }) {
  const { body, headers } = webhookRequest(target.format, {
    deliveryId: crypto.randomUUID(),
    board: { id: target.boardId, name: target.boardName },
  }, target.secret, webhookSiteUrl(), serverI18n(target.locale))
  const res = await postWebhook(target.url, body, headers, webhookAllowPrivate())
  await useAuthDb().execute(sql`select app.record_webhook_result(${webhookId}, ${res.ok}, ${res.status}::integer, ${res.error}, false)`)
  // Not the response body: owners must not read what arbitrary URLs answer.
  return { ok: res.ok, status: res.status, error: res.error }
}

const w = schema.boardWebhooks

/** What kanban_app may read of board_webhooks (no secret). */
export const webhookColumns = {
  id: w.id, url: w.url, format: w.format, events: w.events, active: w.active, createdAt: w.createdAt,
  lastStatus: w.lastStatus, lastError: w.lastError, lastDeliveryAt: w.lastDeliveryAt, failureCount: w.failureCount,
}

export function toBoardWebhook(r: { createdAt: Date, lastDeliveryAt: Date | null } & Omit<BoardWebhook, 'createdAt' | 'lastDeliveryAt'>): BoardWebhook {
  return { ...r, createdAt: r.createdAt.toISOString(), lastDeliveryAt: r.lastDeliveryAt?.toISOString() ?? null }
}

/** A webhook URL: http(s), no credentials, no private IP literal (unless allowed). Hostnames are checked again on every send. */
export const webhookUrlSchema = z.string().trim().max(2000).superRefine((url, ctx) => {
  const problem = webhookUrlProblem(url, webhookAllowPrivate())
  if (problem) ctx.addIssue({ code: 'custom', message: problem })
})

export const webhookEventsSchema = z.array(z.enum(webhookEvents)).max(webhookEvents.length).transform(e => [...new Set(e)])
