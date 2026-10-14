import { eq } from 'drizzle-orm'

/** Starts two-factor setup: a new secret and its QR code. Nothing changes until it is confirmed (enable). */
export default defineEventHandler(async (event) => {
  const userId = await requireLiveSession(event)
  const [user] = await useAuthDb().select().from(schema.users).where(eq(schema.users.id, userId))
  const setup = user && await beginTotpSetup(user)
  if (!setup) throw createError({ statusCode: 409, statusMessage: 'Two-factor authentication is already on' })
  return setup
})
