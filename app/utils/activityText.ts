import type { I18nContext } from '#shared/i18n'
import type { Activity } from '#shared/types/board'
import { formatDate, formatPoints } from './format'

/*
 * Shared by the app and the server (digest mails, webhook messages), so it
 * takes an I18nContext instead of using vue-i18n: useI18nContext() in
 * components, serverI18n(locale) on the server. Keys: activity.* and
 * notification.* in i18n/locales/*.json.
 */

/** What the actor did, e.g. "moved this card from Todo to Done". */
export function describeActivity(a: Pick<Activity, 'kind' | 'data'>, i18n: I18nContext): string {
  const { t, locale } = i18n
  const d = a.data
  switch (a.kind) {
    case 'created': return d.column ? t('activity.createdIn', { column: d.column }) : t('activity.created')
    case 'moved': return t('activity.moved', { from: d.from, to: d.to })
    case 'renamed': return t('activity.renamed', { from: d.from })
    case 'described': return t('activity.described')
    case 'start': return d.to ? t('activity.startSet', { date: formatDate(d.to, locale) }) : t('activity.startCleared')
    case 'estimate': return d.to ? t('activity.estimateSet', { points: formatPoints(Number(d.to), i18n) }) : t('activity.estimateCleared')
    case 'due': return d.to ? t('activity.dueSet', { date: formatDate(d.to, locale) }) : t('activity.dueCleared')
    case 'priority': return d.to ? t('activity.prioritySet', { priority: priorityLabel(d.to, t) }) : t('activity.priorityCleared')
    case 'archived': return t('activity.archived')
    case 'restored': return t('activity.restored')
    case 'tagged': return t('activity.tagged', { tag: d.tag })
    case 'untagged': return t('activity.untagged', { tag: d.tag })
    case 'assigned': return d.user ? t('activity.assigned', { user: d.user }) : t('activity.assignedSomeone')
    case 'unassigned': return d.user ? t('activity.unassigned', { user: d.user }) : t('activity.unassignedSomeone')
    case 'commented': return t('activity.commented')
    case 'mentioned': return t('activity.mentioned')
    case 'attached': return t('activity.attached', { name: d.name })
    case 'detached': return t('activity.detached', { name: d.name })
    case 'linked': return linkText(d, t)
    case 'unlinked': return t('activity.unlinked', { card: d.card })
    case 'field': return fieldText(d, i18n)
  }
  return a.kind
}

function priorityLabel(p: string, t: I18nContext['t']): string {
  return ['urgent', 'high', 'medium', 'low'].includes(p) ? t(`priority.${p}`) : p
}

/** Text of a linked activity: data.kind, data.direction ('out' on the linking card) and data.card (the other title). */
function linkText(d: Activity['data'], t: I18nContext['t']): string {
  const out = d.direction !== 'in'
  switch (d.kind) {
    case 'blocks': return t(out ? 'activity.link.blocksOut' : 'activity.link.blocksIn', { card: d.card })
    case 'duplicates': return t(out ? 'activity.link.duplicatesOut' : 'activity.link.duplicatesIn', { card: d.card })
  }
  return t('activity.link.relates', { card: d.card })
}

/** Text of a field activity: data.field (name), data.kind and data.to (new value as text, null = cleared). */
function fieldText(d: Activity['data'], { t, locale }: I18nContext): string {
  if (d.kind === 'checkbox') return t(d.to === 'true' ? 'activity.field.checked' : 'activity.field.unchecked', { field: d.field })
  if (d.to === null || d.to === undefined) return t('activity.field.cleared', { field: d.field })
  const value = d.kind === 'date' ? formatDate(d.to, locale) : d.kind === 'text' ? t('activity.field.text', { value: d.to }) : d.to
  return t('activity.field.set', { field: d.field, value })
}

/** User ids mentioned by a commented or mentioned activity. */
export function mentionsOf(a: Pick<Activity, 'data'>): string[] {
  const m = (a.data as { mentions?: unknown }).mentions
  return Array.isArray(m) ? m.filter((x): x is string => typeof x === 'string') : []
}

/** The same text for the recipient (`userId`) of a notification: assignments and mentions name them. */
export function describeNotification(a: Pick<Activity, 'kind' | 'data'>, i18n: I18nContext, userId?: string): string {
  if (a.kind === 'assigned') return i18n.t('notification.assignedYou')
  if (a.kind === 'mentioned' || (a.kind === 'commented' && userId && mentionsOf(a).includes(userId))) return i18n.t('notification.mentionedYou')
  return describeActivity(a, i18n)
}
