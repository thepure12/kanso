import type { Card, Priority } from '#shared/types/board'
import { fieldFilterKey } from './fields'

/** Date filter: due date states, plus started (start date today or earlier) and upcoming (start date later). */
export type DueFilter = 'any' | 'overdue' | 'today' | 'week' | 'none' | 'started' | 'upcoming'

/** Board filter. Empty lists mean "any"; within a list, any match passes. */
export interface CardFilter {
  text: string
  tagIds: string[]
  /** User ids, or 'none' for unassigned cards. */
  assigneeIds: string[]
  /** Priorities, or 'none' for cards without one. */
  priorities: (Priority | 'none')[]
  due: DueFilter
  /**
   * Select and checkbox field values by field id (see fieldFilterKey): option
   * ids or 'true', and 'none' for no value / unticked. Every field must match.
   */
  fields: Record<string, string[]>
}

export const emptyFilter = (): CardFilter => ({ text: '', tagIds: [], assigneeIds: [], priorities: [], due: 'any', fields: {} })

export function isFilterActive(f: CardFilter) {
  return !!f.text.trim() || !!f.tagIds.length || !!f.assigneeIds.length || !!f.priorities.length || f.due !== 'any'
    || Object.values(f.fields).some(v => v.length)
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** YYYY-MM-DD plus `days`. */
export function addDays(date: string, days: number) {
  const [y, m, d] = date.split('-').map(Number)
  return isoDate(new Date(y!, m! - 1, d! + days))
}

export type DueStatus = 'overdue' | 'today' | 'soon' | 'later'

/** How close a due date is; soon = within the next 7 days. */
export function dueStatus(dueDate: string | null, today: string): DueStatus | null {
  if (!dueDate) return null
  if (dueDate < today) return 'overdue'
  if (dueDate === today) return 'today'
  return dueDate <= addDays(today, 7) ? 'soon' : 'later'
}

export function matchesFilter(card: Card, f: CardFilter, today: string): boolean {
  const words = f.text.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length) {
    const haystack = `${card.title}\n${card.description}`.toLowerCase()
    if (!words.every(w => haystack.includes(w))) return false
  }
  if (f.tagIds.length && !card.tagIds.some(t => f.tagIds.includes(t))) return false
  if (f.assigneeIds.length) {
    const ok = card.assigneeIds.length
      ? card.assigneeIds.some(u => f.assigneeIds.includes(u))
      : f.assigneeIds.includes('none')
    if (!ok) return false
  }
  if (f.priorities.length && !f.priorities.includes(card.priority ?? 'none')) return false
  for (const [fieldId, keys] of Object.entries(f.fields)) {
    if (keys.length && !keys.includes(fieldFilterKey(card.fields[fieldId]))) return false
  }
  switch (f.due) {
    case 'any': return true
    case 'none': return card.dueDate === null
    case 'overdue': return dueStatus(card.dueDate, today) === 'overdue'
    case 'today': return card.dueDate === today
    case 'week': return card.dueDate !== null && card.dueDate >= today && card.dueDate <= addDays(today, 7)
    case 'started': return card.startDate !== null && card.startDate <= today
    case 'upcoming': return card.startDate !== null && card.startDate > today
  }
}
