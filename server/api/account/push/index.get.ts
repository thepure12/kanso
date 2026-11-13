import { desc } from 'drizzle-orm'
import type { PushSettings } from '#shared/types/account'

/** The VAPID public key browsers subscribe with, and the user's push devices (push_subscriptions_select: own rows). */
export default defineUserHandler(async (_event, tx): Promise<PushSettings> => {
  const p = schema.pushSubscriptions
  const rows = await tx.select({ id: p.id, endpoint: p.endpoint, userAgent: p.userAgent, createdAt: p.createdAt, lastSuccessAt: p.lastSuccessAt })
    .from(p).orderBy(desc(p.createdAt))
  return {
    publicKey: vapidKeys().publicKey,
    devices: rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString(), lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null })),
  }
})
