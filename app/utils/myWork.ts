import type { MyWorkCard } from '#shared/types/myWork'
import { myWorkBuckets, type MyWorkBucket, type MyWorkPanelConfig } from '#shared/myWork'
import { dueStatus } from './cardFilter'

export { myWorkBuckets, type MyWorkBucket }

export type MyWorkScope = 'all' | 'assigned' | 'watching'

export function filterMyWork(cards: MyWorkCard[], f: { scope: MyWorkScope, showDone: boolean }): MyWorkCard[] {
  return cards.filter(c => (f.showDone || !c.done)
    && (f.scope === 'all' || (f.scope === 'assigned' ? c.assigned || c.checklistItems.length > 0 : c.watching)))
}

/** The earliest of the card's due date and its assigned checklist items' due dates. */
export function myWorkDueDate(c: MyWorkCard): string | null {
  return [c.dueDate, ...c.checklistItems.map(i => i.dueDate)]
    .filter((d): d is string => !!d).sort()[0] ?? null
}

/** Cards by due date bucket, keeping their order; empty buckets are left out. */
export function groupMyWork(cards: MyWorkCard[], today: string): { bucket: MyWorkBucket, cards: MyWorkCard[] }[] {
  const groups = new Map<MyWorkBucket, MyWorkCard[]>(myWorkBuckets.map(b => [b, []]))
  for (const c of cards) groups.get(myWorkBucket(c, today))!.push(c)
  // Stable: cards keep the server order (priority, board) for the same date.
  const byDue = (a: MyWorkCard, b: MyWorkCard) => (myWorkDueDate(a) ?? '').localeCompare(myWorkDueDate(b) ?? '')
  return myWorkBuckets.filter(b => groups.get(b)!.length).map(b => ({ bucket: b, cards: groups.get(b)!.sort(byDue) }))
}

/** The card's due date bucket (its own or its assigned checklist items' earliest date). */
export function myWorkBucket(c: MyWorkCard, today: string): MyWorkBucket {
  return dueStatus(myWorkDueDate(c), today) ?? 'none'
}

/** The parts of a panel's query the server leaves to the browser: due buckets and done cards. */
export function filterPanelCards(cards: MyWorkCard[], c: Pick<MyWorkPanelConfig, 'due' | 'showDone'>, today: string): MyWorkCard[] {
  return cards.filter(card => (c.showDone || !card.done) && (!c.due.length || c.due.includes(myWorkBucket(card, today))))
}

/** How My work lists group their cards. */
export const myWorkGroupings = ['due', 'board'] as const
export type MyWorkGroupBy = (typeof myWorkGroupings)[number]

/** A group of a My work list: a due date bucket or a board. */
export interface MyWorkGroup {
  key: string
  bucket?: MyWorkBucket
  board?: { id: string, name: string }
  cards: MyWorkCard[]
}

const byDueDate = (a: MyWorkCard, b: MyWorkCard) => (myWorkDueDate(a) ?? '￿').localeCompare(myWorkDueDate(b) ?? '￿')

/** Cards by board (boards by name), each board's cards by due date (no date last), keeping the server order otherwise. */
export function groupMyWorkByBoard(cards: MyWorkCard[]): MyWorkGroup[] {
  const groups = new Map<string, MyWorkGroup>()
  for (const c of cards) {
    let g = groups.get(c.boardId)
    if (!g) groups.set(c.boardId, g = { key: c.boardId, board: { id: c.boardId, name: c.boardName }, cards: [] })
    g.cards.push(c)
  }
  return [...groups.values()]
    .sort((a, b) => a.board!.name.localeCompare(b.board!.name, undefined, { sensitivity: 'base' }))
    .map(g => ({ ...g, cards: [...g.cards].sort(byDueDate) }))
}

export function groupMyWorkBy(cards: MyWorkCard[], by: MyWorkGroupBy, today: string): MyWorkGroup[] {
  return by === 'board' ? groupMyWorkByBoard(cards) : groupMyWork(cards, today).map(g => ({ key: g.bucket, ...g }))
}

/**
 * Cards whose title, board, column, card tags or assigned checklist items
 * contain every word of `query` (case-insensitive); all cards for a blank query.
 */
export function searchMyWork(cards: MyWorkCard[], query: string): MyWorkCard[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return cards
  return cards.filter((c) => {
    const text = [c.title, c.boardName, c.columnTitle, ...c.tags.map(t => t.name), ...c.checklistItems.map(i => i.text)]
      .join('\n').toLocaleLowerCase()
    return words.every(w => text.includes(w))
  })
}

/** Open (not done) cards per due date bucket, plus `open` = all of them. */
export function myWorkSummary(cards: MyWorkCard[], today: string): Record<MyWorkBucket | 'open', number> {
  const counts = { open: 0, ...Object.fromEntries(myWorkBuckets.map(b => [b, 0])) } as Record<MyWorkBucket | 'open', number>
  for (const c of cards) {
    if (c.done) continue
    counts.open++
    counts[myWorkBucket(c, today)]++
  }
  return counts
}

/**
 * The list with the card marked complete or open again, as far as known here:
 * a card that was done only because it was complete is open again (the reload
 * after the request settles cards in their board's last column).
 */
export function withCompleted(cards: MyWorkCard[], id: string, completed: boolean): MyWorkCard[] {
  return cards.map(c => c.id === id ? { ...c, completed, done: completed || (c.done && !c.completed) } : c)
}
