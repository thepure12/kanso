import type { Translate } from '#shared/i18n'
import type { Card, CardLink, CardLinkKind, Column } from '#shared/types/board'

/** Whether a card id is open: on the board (unarchived), not marked complete, not in the last column. */
function openCheck(cards: Card[], columns: Pick<Column, 'id'>[]): (id: string) => boolean {
  const doneColumnId = columns.at(-1)?.id
  const byId = new Map(cards.map(c => [c.id, c]))
  return (id) => {
    const c = byId.get(id)
    return !!c && !c.completedAt && c.columnId !== doneColumnId
  }
}

/**
 * Cards that are blocked: some card with a 'blocks' link to them is still open.
 * A blocker is open while it is on the board (not archived), not marked
 * complete and not in the board's last column, which counts as "done". `cards` are the board's
 * unarchived cards and `columns` are in board order.
 */
export function blockedCardIds(cards: Card[], columns: Pick<Column, 'id'>[]): Set<string> {
  const open = openCheck(cards, columns)
  return new Set(cards.filter(c => c.blockerIds.some(open)).map(c => c.id))
}

/**
 * Cards that block: they are open and block some other open card, the
 * counterpart of `blockedCardIds` (same idea of open: on the board, not
 * complete, not in the last column). A card whose blocked cards are all done or archived blocks
 * nothing any more.
 */
export function blockingCardIds(cards: Card[], columns: Pick<Column, 'id'>[]): Set<string> {
  const open = openCheck(cards, columns)
  const blocking = new Set<string>()
  for (const c of cards) {
    if (!open(c.id)) continue
    for (const id of c.blockerIds) if (open(id)) blocking.add(id)
  }
  return blocking
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

/** A link choice in the add form: kind plus direction seen from the open card. */
export type LinkChoice = `${CardLinkKind}:${CardLink['direction']}`

/** Link kinds offered when adding a link, worded from the open card's side ("Blocked by" = the other card blocks it). */
export function linkKindItems(t: Translate): { label: string, value: LinkChoice }[] {
  return [
    { label: t('cardLinks.blocks'), value: 'blocks:out' },
    { label: t('cardLinks.blockedBy'), value: 'blocks:in' },
    { label: t('cardLinks.relatesTo'), value: 'relates:out' },
    { label: t('cardLinks.duplicates'), value: 'duplicates:out' },
  ]
}

/** Splits a LinkChoice into the kind and direction the API takes. */
export function parseLinkChoice(choice: LinkChoice): { kind: CardLinkKind, direction: CardLink['direction'] } {
  const [kind, direction] = choice.split(':') as [CardLinkKind, CardLink['direction']]
  return { kind, direction }
}
