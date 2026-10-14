import type { Translate } from '#shared/i18n'
import type { Card, CardLink, CardLinkKind, Column } from '#shared/types/board'

/**
 * Cards that are blocked: some card with a 'blocks' link to them is still open.
 * A blocker is open while it is on the board (not archived) and not in the
 * board's last column, which counts as "done". `cards` are the board's
 * unarchived cards and `columns` are in board order.
 */
export function blockedCardIds(cards: Card[], columns: Pick<Column, 'id'>[]): Set<string> {
  const doneColumnId = columns.at(-1)?.id
  const columnOf = new Map(cards.map(c => [c.id, c.columnId]))
  const open = (id: string) => columnOf.has(id) && columnOf.get(id) !== doneColumnId
  return new Set(cards.filter(c => c.blockerIds.some(open)).map(c => c.id))
}

/** i18n keys of the groups; both relates directions share one. */
const groupKeys = {
  'blocks:out': 'cardLinks.blocks',
  'blocks:in': 'cardLinks.blockedBy',
  'relates:out': 'cardLinks.relatesTo',
  'relates:in': 'cardLinks.relatesTo',
  'duplicates:out': 'cardLinks.duplicates',
  'duplicates:in': 'cardLinks.duplicatedBy',
} as const satisfies Record<`${CardLinkKind}:${CardLink['direction']}`, string>

/** A card's links grouped for display ("Blocks", "Blocked by", ...), in a fixed group order. */
export function groupLinks(links: CardLink[], t: Translate): { label: string, links: CardLink[] }[] {
  const groups = new Map<string, CardLink[]>(Object.values(groupKeys).map(key => [key, []]))
  for (const l of links) groups.get(groupKeys[`${l.kind}:${l.direction}`])!.push(l)
  return [...groups].filter(([, ls]) => ls.length).map(([key, ls]) => ({ label: t(key), links: ls }))
}

/** Link kinds offered when adding a link, worded from the open card's side. */
export function linkKindItems(t: Translate): { label: string, value: CardLinkKind }[] {
  return [
    { label: t('cardLinks.blocks'), value: 'blocks' },
    { label: t('cardLinks.relatesTo'), value: 'relates' },
    { label: t('cardLinks.duplicates'), value: 'duplicates' },
  ]
}
