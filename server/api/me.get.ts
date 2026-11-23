import { sql } from 'drizzle-orm'
import { isLocale } from '#shared/i18n'

import type { Me } from '#shared/types/account'

/** The caller (cookie or API token): who they are, instance-level flags and saved language (null = browser). */
export default defineUserHandler(async (_event, tx, userId): Promise<Me> => {
  const [row] = await tx.execute<{ is_admin: boolean, name: string, email: string, is_bot: boolean, locale: string | null }>(
    sql`select app.is_admin() as is_admin, u.name, u.email, u.is_bot, u.locale from users u where u.id = ${userId}`)
  return {
    id: userId,
    name: row!.name,
    email: row!.email,
    isBot: row!.is_bot,
    isAdmin: row!.is_admin,
    locale: isLocale(row!.locale) ? row!.locale : null,
  }
})
