import type { I18nContext } from '#shared/i18n'
import type { CardRecurrence, RecurrenceInput } from '#shared/types/board'

/** ISO weekday numbers (1 = Monday) with short names in `locale` ("Mon", "Mo."). */
export function weekdayLabels(locale: string): { value: number, label: string }[] {
  // 1 January 2024 was a Monday.
  return [1, 2, 3, 4, 5, 6, 7].map(value => ({
    value,
    label: new Date(2024, 0, value).toLocaleDateString(locale, { weekday: 'short' }),
  }))
}

/** "2nd", "31st" (recurrence.ordinal.<plural category>; German "2."). */
function ordinal(n: number, { t, locale }: I18nContext) {
  return t(`recurrence.ordinal.${new Intl.PluralRules(locale, { type: 'ordinal' }).select(n)}`, { n })
}

/** "Every day", "Every 2 weeks on Mon, Fri", "Every month on the 31st (or the last day)". */
export function describeRecurrence(r: Pick<CardRecurrence, 'rule' | 'interval' | 'weekdays' | 'dayOfMonth'>, i18n: I18nContext) {
  const { t } = i18n
  const text = t(`recurrence.every.${r.rule}`, { count: r.interval }, r.interval)
  if (r.rule === 'weekly' && r.weekdays?.length) {
    const labels = weekdayLabels(i18n.locale)
    return t('recurrence.onWeekdays', { text, days: [...r.weekdays].sort((a, b) => a - b).map(d => labels[d - 1]!.label).join(', ') })
  }
  if (r.rule === 'monthly' && r.dayOfMonth) {
    return t(r.dayOfMonth > 28 ? 'recurrence.onDayOrLast' : 'recurrence.onDay', { text, day: ordinal(r.dayOfMonth, i18n) })
  }
  return text
}

/** Input as the server expects it: weekdays only for weekly, the day only for monthly. Null when incomplete. */
export function recurrenceInput(r: RecurrenceInput): RecurrenceInput | null {
  if (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > 365) return null
  if (r.dueInDays !== null && !(Number.isInteger(r.dueInDays) && r.dueInDays >= 0 && r.dueInDays <= 365)) return null
  const weekdays = r.rule === 'weekly' ? [...new Set(r.weekdays ?? [])].sort((a, b) => a - b) : null
  const dayOfMonth = r.rule === 'monthly' ? r.dayOfMonth : null
  if (weekdays && !weekdays.length) return null
  if (r.rule === 'monthly' && !(Number.isInteger(dayOfMonth) && dayOfMonth! >= 1 && dayOfMonth! <= 31)) return null
  return { ...r, weekdays, dayOfMonth }
}
