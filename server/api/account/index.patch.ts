import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { locales } from '#shared/i18n'
import { notificationPrefsSchema } from '#shared/notificationSettings'

const body = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  digestEnabled: z.boolean().optional(),
  // null: follow the browser.
  locale: z.enum(locales).nullable().optional(),
  // Replaces the whole set; missing events and channels are on.
  notificationPrefs: notificationPrefsSchema.optional(),
  notifyWatching: z.boolean().optional(),
})

/** Changes the display name, notification settings or language (users_update policy: own row only). */
export default defineUserHandler(async (event, tx, userId) => {
  const changes = await readValidated(event, body)
  if (Object.values(changes).every(v => v === undefined)) {
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
  // kanban_app cannot read the notification settings back (no SELECT grant), so echo them.
  return { ...user, notificationPrefs: changes.notificationPrefs, notifyWatching: changes.notifyWatching }
})
