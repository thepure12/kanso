import { sql } from 'drizzle-orm'
import { isLocale } from '#shared/i18n'

import type { Me } from '#shared/types/account'

/** The signed-in user's instance-level flags and saved language (null = browser). */
export default defineUserHandler(async (_event, tx, userId): Promise<Me> => {
  const [row] = await tx.execute<{ is_admin: boolean, locale: string | null }>(
    sql`select app.is_admin() as is_admin, (select locale from users where id = ${userId}) as locale`)
  return { isAdmin: row!.is_admin, locale: isLocale(row!.locale) ? row!.locale : null }
})
