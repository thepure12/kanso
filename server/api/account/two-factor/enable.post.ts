import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({ code: z.string().trim().min(1).max(32) })

/**
 * Confirms setup with a code from the app: two-factor goes on and ten
 * recovery codes are returned (only now). Other sessions, which never passed
 * a second factor, are signed out; this one is renewed.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireLiveSession(event)
  const { code } = await readValidated(event, body)
  await rateLimit(`2fa:${userId}`)
  if (!(await confirmTotpSetup(userId, code))) {
    throw createError({ statusCode: 400, statusMessage: 'That code is not valid. Check the time on your device and try again.' })
  }
  const recoveryCodes = await replaceRecoveryCodes(userId)
  const [user] = await useAuthDb().update(schema.users).set({ sessionVersion: sql`${schema.users.sessionVersion} + 1` })
    .where(eq(schema.users.id, userId)).returning()
  await issueSession(event, user!)
  return { recoveryCodes }
})
