/**
 * Drag picture for a group drag: the dragged card drawn as the top of a stack
 * with a count badge (styles in `main.css`, `[data-drag-count]`).
 */

/** Attribute holding the number of cards in the group; the CSS badge shows it. */
export const DRAG_COUNT_ATTR = 'data-drag-count'
/** Room around the card in the drag picture for the stacked edges and the badge. */
export const DRAG_STACK_PAD = 14

export interface Point { x: number, y: number }

/** Where the pointer holds the picture: the grab point on the card (kept inside it), shifted by the padding. */
export function dragImageOffset(rect: { left: number, top: number, width: number, height: number }, pointer: Point | null, pad = DRAG_STACK_PAD): Point {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max)
  const x = pointer ? clamp(pointer.x - rect.left, rect.width) : rect.width / 2
  const y = pointer ? clamp(pointer.y - rect.top, rect.height) : rect.height / 2
  return { x: Math.round(x + pad), y: Math.round(y + pad) }
}

/**
 * Sets a native drag picture for `el` drawn as a stack of `count` cards. The
 * picture is built off-screen and removed once the browser has taken it.
 */
export function setStackDragImage(dataTransfer: Pick<DataTransfer, 'setDragImage'>, el: HTMLElement, count: number, pointer: Point | null) {
  const rect = el.getBoundingClientRect()
  const wrap = document.createElement('div')
  Object.assign(wrap.style, {
    position: 'fixed',
    top: '-10000px',
    left: '-10000px',
    padding: `${DRAG_STACK_PAD}px`,
    width: `${rect.width + 2 * DRAG_STACK_PAD}px`,
    pointerEvents: 'none',
  })
  const card = el.cloneNode(true) as HTMLElement
  card.removeAttribute('id')
  card.classList.add('drag-stack')
  card.setAttribute(DRAG_COUNT_ATTR, String(count))
  card.style.width = `${rect.width}px`
  wrap.appendChild(card)
  document.body.appendChild(wrap)
  const at = dragImageOffset(rect, pointer)
  dataTransfer.setDragImage(wrap, at.x, at.y)
  setTimeout(() => wrap.remove())
  return wrap
}
