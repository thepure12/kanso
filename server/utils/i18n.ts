import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { createTranslator, defaultLocale, isLocale, type I18nContext, type Locale } from '#shared/i18n'
import de from '../../i18n/locales/de.json'
import en from '../../i18n/locales/en.json'

const catalogues: Record<Locale, object> = { en, de }

/**
 * Translate function and locale for server-side text (mails, digest, webhook
 * messages), from the same JSON the app loads. Unknown locales get English.
 */
export function serverI18n(locale: string | null | undefined): I18nContext {
  const l = isLocale(locale) ? locale : defaultLocale
  return { locale: l, t: createTranslator(catalogues[l], catalogues[defaultLocale]) }
}

/** Cookie in which @nuxtjs/i18n keeps the detected or chosen locale (nuxt.config.ts). */
export const localeCookie = 'i18n_locale'

/**
 * Language for mail to `userId`: their saved users.locale, else the locale
 * cookie of the request that triggered the mail, else English.
 */
export async function recipientLocale(event: H3Event | undefined, userId: string): Promise<Locale> {
  const [row] = await useAuthDb().select({ locale: schema.users.locale }).from(schema.users).where(eq(schema.users.id, userId))
  if (isLocale(row?.locale)) return row.locale
  const cookie = event && getCookie(event, localeCookie)
  return isLocale(cookie) ? cookie : defaultLocale
}
