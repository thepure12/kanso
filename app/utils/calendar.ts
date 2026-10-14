import type { Card, CardPatch } from '#shared/types/board'
import { addDays, isoDate } from './cardFilter'

/** Which date places a card on the calendar. */
export type CalendarMode = 'due' | 'start'

/** YYYY-MM of a YYYY-MM-DD date. */
export const monthOf = (date: string) => date.slice(0, 7)

/** YYYY-MM plus `months`. */
export function shiftMonth(month: string, months: number) {
  const [y, m] = month.split('-').map(Number)
  return isoDate(new Date(y!, m! - 1 + months, 1)).slice(0, 7)
}

/**
 * The weeks (Monday first) covering a YYYY-MM month, as rows of seven
 * YYYY-MM-DD dates. Days of the neighbouring months fill the first and last row.
 */
export function monthGrid(month: string): string[][] {
  const first = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  // getDay: 0 = Sunday; days back to the Monday on or before the 1st.
  const lead = (new Date(y!, m! - 1, 1).getDay() + 6) % 7
  const last = isoDate(new Date(y!, m!, 0))
  const weeks: string[][] = []
  let day = addDays(first, -lead)
  while (day <= last) {
    const week = Array.from({ length: 7 }, (_, i) => addDays(day, i))
    weeks.push(week)
    day = addDays(day, 7)
  }
  return weeks
}

/** Short weekday names, Monday first, in the given (or the browser's) locale. */
export function weekdayNames(locale?: string) {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(2024, 0, 1 + i)))
}

/** "October 2026" in the given (or the browser's) locale. */
export function monthTitle(month: string, locale?: string) {
  const [y, m] = month.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(y!, m! - 1, 1))
}

/** Cards by the date that places them (see CalendarMode); cards without it are under null. */
export function cardsByDate(cards: Card[], mode: CalendarMode): Map<string | null, Card[]> {
  const byDate = new Map<string | null, Card[]>()
  for (const card of cards) {
    const date = mode === 'due' ? card.dueDate : card.startDate
    const list = byDate.get(date)
    if (list) list.push(card)
    else byDate.set(date, [card])
  }
  return byDate
}

/** Whole days from `a` to `b` (YYYY-MM-DD), negative when b is earlier. */
export function daysBetween(a: string, b: string) {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!)) / 86_400_000)
}

/**
 * Patch that moves a card's due (or start) date to `date`. The start date may
 * not come after the due date, so when the move would break that the other
 * date shifts by the same number of days, keeping the card's length.
 */
export function moveDatePatch(card: Pick<Card, 'startDate' | 'dueDate'>, mode: CalendarMode, date: string): CardPatch {
  if (mode === 'due') {
    if (card.startDate && card.startDate > date) {
      return { dueDate: date, startDate: card.dueDate ? addDays(card.startDate, daysBetween(card.dueDate, date)) : date }
    }
    return { dueDate: date }
  }
  if (card.dueDate && card.dueDate < date) {
    return { startDate: date, dueDate: card.startDate ? addDays(card.dueDate, daysBetween(card.startDate, date)) : date }
  }
  return { startDate: date }
}
