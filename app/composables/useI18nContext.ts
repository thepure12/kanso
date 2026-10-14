import type { I18nContext } from '#shared/i18n'

/**
 * vue-i18n's `t` and locale as the plain I18nContext that shared helpers take
 * (activityText, formatPoints, ...). `locale` is a getter, so reading it in a
 * template or computed tracks locale changes.
 */
export function useI18nContext(): I18nContext {
  const { t, locale } = useI18n()
  return {
    t: (key, named = {}, plural) => plural === undefined ? t(key, named) : t(key, named, plural),
    get locale() { return locale.value },
  }
}
