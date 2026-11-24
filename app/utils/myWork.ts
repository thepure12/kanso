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
