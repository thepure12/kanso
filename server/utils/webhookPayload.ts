import { createHmac } from 'node:crypto'
import type { I18nContext } from '#shared/i18n'
import type { Activity } from '#shared/types/board'
import type { WebhookFormat } from '#shared/webhooks'
import { actorLabel, describeActivity } from '../../app/utils/activityText'

/** One activity as a webhook sends it (from app.claim_webhook_deliveries), or a test ping (no activity). */
export interface WebhookEvent {
  deliveryId: string
  board: { id: string, name: string }
  activity?: {
    id: string
    kind: string
    data: Record<string, unknown>
    createdAt: string
    card: { id: string, title: string }
    actor: { id: string, name: string } | null
  }
}

/** `sha256=<hex>` HMAC of `<timestamp>.<body>` with the webhook's secret (X-Kanban-Signature). */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

/** "Alice moved this card from Todo to Done", or the ping text. */
function sentence(e: WebhookEvent, i18n: I18nContext): string {
  const a = e.activity
  if (!a) return i18n.t('webhook.ping', { board: e.board.name })
  return `${actorLabel(a.actor?.name, { data: a.data as Activity['data'] }, i18n)} ${describeActivity({ kind: a.kind as Activity['kind'], data: a.data as Activity['data'] }, i18n)}`
}

function links(e: WebhookEvent, siteUrl: string | null) {
  if (!siteUrl) return { board: null, card: null }
  const board = `${siteUrl}/boards/${e.board.id}`
  return { board, card: e.activity ? `${board}?card=${e.activity.card.id}` : null }
}

/** Slack mrkdwn needs &, < and > escaped; link text must also not contain |. */
const slackEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** Discord markdown: escape formatting characters so titles show as typed. */
const discordEscape = (s: string) => s.replace(/[\\*_~`|>[\]()]/g, '\\$&').replace(/@/g, '@\u200B')

/**
 * Request body and headers for `format`. json carries the activity, card,
 * board and actor plus `text`, and is signed (X-Kanban-Timestamp, seconds, and
 * X-Kanban-Signature); slack sends `{ text }` and discord `{ content }` with
 * the same sentence and a link to the card when NUXT_PUBLIC_SITE_URL is set.
 * Text is in `i18n`'s language (the webhook creator's, see webhooks.ts).
 */
export function webhookRequest(format: WebhookFormat, e: WebhookEvent, secret: string, siteUrl: string | null, i18n: I18nContext, now = Date.now()) {
  const text = sentence(e, i18n)
  const url = links(e, siteUrl)
  const a = e.activity
  let body: string
  if (format === 'slack') {
    const card = a ? (url.card ? `<${url.card}|${slackEscape(a.card.title).replace(/\|/g, '¦')}>` : `"${slackEscape(a.card.title)}"`) : ''
    body = JSON.stringify({ text: `${slackEscape(text)}${a ? ` · ${i18n.t('webhook.cardOnBoard', { card, board: slackEscape(e.board.name) })}` : ''}` })
  }
  else if (format === 'discord') {
    const title = a ? discordEscape(a.card.title) : ''
    const card = a ? (url.card ? `[${title}](<${url.card}>)` : `"${title}"`) : ''
    body = JSON.stringify({
      content: `${discordEscape(text)}${a ? ` · ${i18n.t('webhook.cardOnBoard', { card, board: discordEscape(e.board.name) })}` : ''}`.slice(0, 2000),
      allowed_mentions: { parse: [] },
    })
  }
  else {
    body = JSON.stringify({
      event: a ? a.kind : 'ping',
      deliveryId: e.deliveryId,
      text,
      board: { ...e.board, url: url.board },
      ...(a && {
        activity: { id: a.id, kind: a.kind, data: a.data, createdAt: a.createdAt },
        card: { ...a.card, url: url.card },
        actor: a.actor,
      }),
    })
  }
  const timestamp = Math.floor(now / 1000)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'Kanso-Webhooks/1',
    'x-kanban-event': a ? a.kind : 'ping',
    'x-kanban-delivery': e.deliveryId,
  }
  if (format === 'json') {
    headers['x-kanban-timestamp'] = String(timestamp)
    headers['x-kanban-signature'] = signWebhook(secret, timestamp, body)
  }
  return { body, headers }
}
