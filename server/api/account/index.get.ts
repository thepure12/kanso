import { eq } from 'drizzle-orm'
import { isLocale } from '#shared/i18n'
import type { Account } from '#shared/types/account'

/**
 * The signed-in user's account settings. Read through kanban_auth, because
 * kanban_app cannot see password hashes or linked OAuth accounts.
 */
export default defineEventHandler(async (event): Promise<Account> => {
  const userId = await requireLiveSession(event)
  const db = useAuthDb()
  const [[user], providers, twoFactor, codesLeft] = await Promise.all([
    db.select().from(schema.users).where(eq(schema.users.id, userId)),
    db.select({ provider: schema.oauthAccounts.provider }).from(schema.oauthAccounts).where(eq(schema.oauthAccounts.userId, userId)),
    twoFactorEnabled(userId),
    recoveryCodesLeft(userId),
  ])
  if (!user) {
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'This account no longer exists' })
  }
  return {
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    hasPassword: !!user.passwordHash,
    providers: providers.map(p => p.provider).sort(),
    digestEnabled: user.digestEnabled,
    locale: isLocale(user.locale) ? user.locale : null,
    twoFactorEnabled: twoFactor,
    recoveryCodesLeft: twoFactor ? codesLeft : 0,
  }
})
