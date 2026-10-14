import type { WebhookFormat } from '../webhooks'

/** A board webhook (GET /api/boards/:id/webhooks, owners only). The secret is only returned on creation. */
export interface BoardWebhook {
  id: string
  url: string
  format: WebhookFormat
  /** Activity kinds sent; empty = all. */
  events: string[]
  active: boolean
  createdAt: string
  lastStatus: number | null
  lastError: string | null
  lastDeliveryAt: string | null
  /** Failed attempts in a row; the webhook turns itself off at 20. */
  failureCount: number
}

/** Result of POST /api/webhooks/:id/test. */
export interface WebhookTestResult {
  ok: boolean
  status: number | null
  error: string | null
}
