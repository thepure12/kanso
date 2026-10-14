import type { Card } from '#shared/types/board'
import { addDays } from './cardFilter'
import { daysBetween } from './calendar'

export type TimelineZoom = 'week' | 'month'

/** Pixels per day at each zoom level. */
export const timelineDayWidth: Record<TimelineZoom, number> = { week: 36, month: 10 }

/** Cards with a start or due date, the ones the timeline shows. */
export const isScheduled = (c: Pick<Card, 'startDate' | 'dueDate'>) => !!(c.startDate || c.dueDate)

/**
 * First and last day shown: every scheduled card and today, with `pad` days
 * either side. Starts on a Monday so week ticks line up.
 */
export function timelineRange(cards: Pick<Card, 'startDate' | 'dueDate'>[], today: string, pad = 7) {
  let start = today
  let end = today
  for (const c of cards) {
    for (const d of [c.startDate, c.dueDate]) {
      if (!d) continue
      if (d < start) start = d
      if (d > end) end = d
    }
  }
  start = addDays(start, -pad)
  const [y, m, d] = start.split('-').map(Number)
  start = addDays(start, -((new Date(y!, m! - 1, d!).getDay() + 6) % 7))
  return { start, end: addDays(end, pad), days: daysBetween(start, addDays(end, pad)) + 1 }
}

/**
 * A card's bar in days from the range start: from its start to its due date
 * (both included). Cards with only one of them get a one-day marker.
 */
export function timelineBar(card: Pick<Card, 'startDate' | 'dueDate'>, rangeStart: string) {
  const from = card.startDate ?? card.dueDate
  const to = card.dueDate ?? card.startDate
  if (!from || !to) return null
  return { offset: daysBetween(rangeStart, from), length: daysBetween(from, to) + 1, marker: !(card.startDate && card.dueDate) }
}

/** Month bands of the header: label, offset and length in days, clipped to the range. */
export function timelineMonths(start: string, days: number, locale?: string) {
  const format = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' })
  const months: { label: string, offset: number, length: number }[] = []
  for (let i = 0; i < days; i++) {
    const day = addDays(start, i)
    const [y, m, d] = day.split('-').map(Number)
    if (i === 0 || d === 1) months.push({ label: format.format(new Date(y!, m! - 1, 1)), offset: i, length: 0 })
    months.at(-1)!.length++
  }
  return months
}
