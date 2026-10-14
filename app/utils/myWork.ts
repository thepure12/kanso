import type { MyWorkCard } from '#shared/types/myWork'
import { dueStatus } from './cardFilter'

export type MyWorkScope = 'all' | 'assigned' | 'watching'
/** Due date buckets in display order; soon = within the next 7 days, none = no due date. */
export const myWorkBuckets = ['overdue', 'today', 'soon', 'later', 'none'] as const
export type MyWorkBucket = (typeof myWorkBuckets)[number]

export function filterMyWork(cards: MyWorkCard[], f: { scope: MyWorkScope, showDone: boolean }): MyWorkCard[] {
  return cards.filter(c => (f.showDone || !c.done)
    && (f.scope === 'all' || (f.scope === 'assigned' ? c.assigned : c.watching)))
}

/** Cards by due date bucket, keeping their order; empty buckets are left out. */
export function groupMyWork(cards: MyWorkCard[], today: string): { bucket: MyWorkBucket, cards: MyWorkCard[] }[] {
  const groups = new Map<MyWorkBucket, MyWorkCard[]>(myWorkBuckets.map(b => [b, []]))
  for (const c of cards) groups.get(dueStatus(c.dueDate, today) ?? 'none')!.push(c)
  return myWorkBuckets.filter(b => groups.get(b)!.length).map(b => ({ bucket: b, cards: groups.get(b)! }))
}
