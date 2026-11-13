import { sql } from 'drizzle-orm'
import { z } from 'zod'

const base64url = z.string().regex(/^[\w-]+=*$/)

/** A browser's PushSubscription.toJSON(). */
const schemaBody = z.object({
  endpoint: z.string().max(2000).superRefine((url, ctx) => {
    const problem = pushEndpointProblem(url)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  }),
  keys: z.object({ p256dh: base64url.min(80).max(100), auth: base64url.min(16).max(40) }),
})

/**
 * Turns push on for this browser, tied to the current sign-in session
 * (app.save_push_subscription), so signing that session out stops it.
 */
export default defineUserHandler(async (event, tx) => {
  const body = await readValidated(event, schemaBody)
  const sid = (await getUserSession(event)).secure?.sessionId ?? null
  const ua = getHeader(event, 'user-agent') ?? null
  const [row] = await tx.execute<{ id: string }>(sql`select app.save_push_subscription(${sid}, ${body.endpoint}, ${body.keys.p256dh}, ${body.keys.auth}, ${ua}) as id`)
  return { id: row!.id }
})
