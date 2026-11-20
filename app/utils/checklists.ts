import type { Checklist } from '#shared/types/board'

/** Done and total items over all of a card's checklists (the board card's badge). */
export function checklistCounts(lists: readonly Checklist[]): { done: number, total: number } {
  const items = lists.flatMap(l => l.items)
  return { done: items.filter(i => i.done).length, total: items.length }
}
