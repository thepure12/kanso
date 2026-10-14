import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(8).max(200),
})

/**
 * Changes the password, or sets a first one for an OAuth-only account. Other
 * sessions are signed out (session version goes up); this one is renewed.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireLiveSession(event)
  const { currentPassword, newPassword } = await readValidated(event, body)
  await rateLimit(`password:${userId}`)
  const db = useAuthDb()
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'This account no longer exists' })
  if (user.passwordHash && !(currentPassword && await verifyPassword(user.passwordHash, currentPassword))) {
    throw createError({ statusCode: 400, statusMessage: 'Your current password is wrong' })
  }
  const [updated] = await db.update(schema.users)
    .set({ passwordHash: await hashPassword(newPassword), sessionVersion: sql`${schema.users.sessionVersion} + 1` })
    .where(and(eq(schema.users.id, userId), eq(schema.users.sessionVersion, user.sessionVersion)))
    .returning()
  if (!updated) throw createError({ statusCode: 409, statusMessage: 'Your account changed meanwhile. Try again.' })
  // Already signed in with every factor: renew without asking again.
  await issueSession(event, updated)
  return { ok: true }
})
