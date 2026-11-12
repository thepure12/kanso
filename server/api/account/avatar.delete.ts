import { eq } from 'drizzle-orm'

/** Removes the profile picture: an uploaded one and one taken from an OAuth provider. */
export default defineUserHandler(async (event, tx, userId) => {
  const { userAvatars: ua, users } = schema
  await tx.delete(ua).where(eq(ua.userId, userId))
  const [row] = await tx.update(users).set({ avatarUrl: null }).where(eq(users.id, userId)).returning({ id: users.id })
  if (!row) notFound('Account not found')
  // The header shows the picture from the session cookie.
  const session = await getUserSession(event)
  await setUserSession(event, { user: { ...session.user!, avatarUrl: null } })
  return { avatarUrl: null }
})
