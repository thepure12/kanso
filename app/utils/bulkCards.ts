import type { BulkCardAction, Card } from '#shared/types/board'

export type BulkRequest = BulkCardAction & { cardIds: string[] }

type BulkCardState = Pick<Card, 'id' | 'tagIds' | 'assigneeIds' | 'priority' | 'dueDate'>

/** Requests that give `key` back its old value, one per distinct old value. */
function restoreValue<K extends 'priority' | 'dueDate'>(cards: BulkCardState[], key: K, value: BulkCardState[K]): BulkRequest[] {
  const byOld = new Map<BulkCardState[K], string[]>()
  for (const c of cards) {
    if (c[key] !== value) byOld.set(c[key], [...byOld.get(c[key]) ?? [], c.id])
  }
  return [...byOld].map(([old, cardIds]) => ({ cardIds, [key]: old }))
}

/** Requests that undo an added (`added`) or removed set member on the cards that changed. */
function restoreMembers(cards: BulkCardState[], key: 'tagIds' | 'assigneeIds', ids: string[] | undefined, added: boolean): BulkRequest[] {
  const inverse = key === 'tagIds' ? (added ? 'removeTagIds' : 'addTagIds') : (added ? 'removeAssigneeIds' : 'addAssigneeIds')
  return (ids ?? []).flatMap((id) => {
    const cardIds = cards.filter(c => c[key].includes(id) !== added).map(c => c.id)
    return cardIds.length ? [{ cardIds, [inverse]: [id] }] : []
  })
}

/**
 * Bulk requests that undo `action` on `cards` (their state before it), for
 * tags, assignees, priority and due date. Only cards the action changed are
 * touched. Moves and archiving are undone by the caller.
 */
export function bulkInverse(cards: BulkCardState[], action: BulkCardAction): BulkRequest[] {
  return [
    ...restoreMembers(cards, 'tagIds', action.addTagIds, true),
    ...restoreMembers(cards, 'tagIds', action.removeTagIds, false),
    ...restoreMembers(cards, 'assigneeIds', action.addAssigneeIds, true),
    ...restoreMembers(cards, 'assigneeIds', action.removeAssigneeIds, false),
    ...(action.priority !== undefined ? restoreValue(cards, 'priority', action.priority) : []),
    ...(action.dueDate !== undefined ? restoreValue(cards, 'dueDate', action.dueDate) : []),
  ]
}

/** Undo label key (board.bulk.done.*) of a bulk action. */
export function bulkLabel(action: BulkCardAction): string {
  if (action.columnId) return 'board.bulk.done.moved'
  if (action.archived !== undefined) return action.archived ? 'board.bulk.done.archived' : 'board.bulk.done.restored'
  if (action.addTagIds?.length || action.removeTagIds?.length) return 'board.bulk.done.tags'
  if (action.addAssigneeIds?.length || action.removeAssigneeIds?.length) return 'board.bulk.done.assignees'
  if (action.priority !== undefined) return 'board.bulk.done.priority'
  return 'board.bulk.done.dueDate'
}

/**
 * Card ids per column after dragging `draggedId` (already at its drop place in
 * `lists`) together with the other selected cards: `groupIds` (board order,
 * dragged card included) gather around it in `columnId`, keeping their order,
 * so cards above the dragged one land above it and the rest below.
 */
export function gatherGroup(lists: Record<string, string[]>, columnId: string, draggedId: string, groupIds: string[]): Record<string, string[]> {
  const others = new Set(groupIds.filter(id => id !== draggedId))
  const next = Object.fromEntries(Object.entries(lists).map(([col, ids]) => [col, ids.filter(id => !others.has(id))]))
  const target = next[columnId] ?? []
  const at = target.indexOf(draggedId)
  if (at < 0) return lists
  target.splice(at, 1, ...(groupIds.includes(draggedId) ? groupIds : [draggedId, ...groupIds]))
  next[columnId] = target
  return next
}

/** Neighbours of `ids[index]` for a move request, skipping cards in `skip` (not yet saved there). */
export function savedNeighbours(ids: string[], index: number, skip: Set<string>) {
  let above: string | null = null
  for (let i = index - 1; i >= 0; i--) if (!skip.has(ids[i]!)) { above = ids[i]!; break }
  let below: string | null = null
  for (let i = index + 1; i < ids.length; i++) if (!skip.has(ids[i]!)) { below = ids[i]!; break }
  return { aboveId: above, belowId: below }
}
