import type { I18nContext } from '#shared/i18n'
import type { Priority } from '#shared/types/board'

/** Colour and icon per priority; the label is `t('priority.<p>')`. */
export const priorityMeta: Record<Priority, { color: 'error' | 'warning' | 'info' | 'neutral', icon: string }> = {
  urgent: { color: 'error', icon: 'i-lucide-chevrons-up' },
  high: { color: 'warning', icon: 'i-lucide-chevron-up' },
  medium: { color: 'info', icon: 'i-lucide-equal' },
  low: { color: 'neutral', icon: 'i-lucide-chevron-down' },
}

/**
 * The date helpers take the active locale (`useI18n().locale.value` in
 * components, the recipient's on the server); undefined = runtime default.
 */

/** "12 Mar" this year, "12 Mar 2027" otherwise. Takes YYYY-MM-DD. */
export function formatDate(date: string, locale?: string) {
  const [y, m, d] = date.split('-').map(Number)
  const value = new Date(y!, m! - 1, d!)
  return value.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(y !== new Date().getFullYear() && { year: 'numeric' }) })
}

export function formatDateTime(iso: string, locale?: string) {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatBytes(n: number, locale?: string) {
  if (n < 1024) return `${n} B`
  const one = (x: number) => x.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  if (n < 1024 * 1024) return `${one(n / 1024)} KB`
  return `${one(n / 1024 / 1024)} MB`
}

/** Story points without trailing zeros: "3 points", "0.5 points", "1 point". */
export function formatPoints(n: number, i18n: I18nContext) {
  const points = n.toLocaleString(i18n.locale, { maximumFractionDigits: 2 })
  return i18n.t('format.points', { points }, n === 1 ? 1 : 2)
}

/** Start and due date as one range, e.g. "3 Mar – 9 Mar"; either side may be missing. */
export function formatDateRange(start: string | null, due: string | null, i18n: I18nContext) {
  if (start && due) return `${formatDate(start, i18n.locale)} – ${formatDate(due, i18n.locale)}`
  if (start) return i18n.t('format.from', { date: formatDate(start, i18n.locale) })
  return due ? formatDate(due, i18n.locale) : ''
}
