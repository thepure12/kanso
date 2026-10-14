import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { locales } from '#shared/i18n'

const body = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  digestEnabled: z.boolean().optional(),
  // null: follow the browser.
  locale: z.enum(locales).nullable().optional(),
})

/** Changes the display name, digest setting or language (users_update policy: own row only). */
export default defineUserHandler(async (event, tx, userId) => {
  const changes = await readValidated(event, body)
  if (changes.name === undefined && changes.digestEnabled === undefined && changes.locale === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'Nothing to change' })
  }
  const [user] = await tx.update(schema.users).set(changes).where(eq(schema.users.id, userId))
    .returning({ name: schema.users.name, digestEnabled: schema.users.digestEnabled, locale: schema.users.locale })
  if (!user) notFound('Account not found')
  // The header shows the name from the session cookie.
  if (changes.name !== undefined) {
    const session = await getUserSession(event)
    await setUserSession(event, { user: { ...session.user!, name: user.name } })
  }
  return user
})
