/** Box of a card on screen (from getBoundingClientRect). */
export interface CardBox {
  id: string
  left: number
  top: number
  width: number
  height: number
}

export type FocusDirection = 'left' | 'right' | 'up' | 'down'

/** Arrow keys and h j k l to a direction; null for any other key. */
export function focusDirection(key: string): FocusDirection | null {
  switch (key) {
    case 'ArrowLeft': case 'h': return 'left'
    case 'ArrowRight': case 'l': return 'right'
    case 'ArrowUp': case 'k': return 'up'
    case 'ArrowDown': case 'j': return 'down'
    default: return null
  }
}

const centerX = (b: CardBox) => b.left + b.width / 2

/**
 * The card to focus next from `from` in `dir`, by position on screen, so it works for
 * the board columns and for swimlanes alike. Up/down stay in the same column (cards whose
 * centre lies within `from`'s width) and take the nearest one. Left/right take the nearest
 * column on that side, then the card in it closest to `from`'s height. Null when none.
 */
export function neighbourCard(from: CardBox, boxes: CardBox[], dir: FocusDirection): string | null {
  const others = boxes.filter(b => b.id !== from.id)
  if (dir === 'up' || dir === 'down') {
    const sign = dir === 'down' ? 1 : -1
    const inColumn = others.filter(b => centerX(b) >= from.left && centerX(b) <= from.left + from.width)
    const ahead = inColumn.filter(b => (b.top - from.top) * sign > 0)
    ahead.sort((a, b) => Math.abs(a.top - from.top) - Math.abs(b.top - from.top))
    return ahead[0]?.id ?? null
  }
  const sign = dir === 'right' ? 1 : -1
  const ahead = others.filter(b => (centerX(b) - centerX(from)) * sign > from.width / 2)
  if (!ahead.length) return null
  const nearest = Math.min(...ahead.map(b => Math.abs(centerX(b) - centerX(from))))
  // The nearest column: cards whose centre is within half a card of the nearest one.
  const column = ahead.filter(b => Math.abs(centerX(b) - centerX(from)) - nearest < from.width / 2)
  column.sort((a, b) => Math.abs(a.top - from.top) - Math.abs(b.top - from.top))
  return column[0]!.id
}
