/**
 * New column order of a custom view after the shown columns were dragged into
 * `shownOrder`. Columns of the view that are not shown (their board did not
 * load) keep their slots; the shown ones fill the other slots in their new order.
 */
export function reorderViewColumnIds(allIds: string[], shownOrder: string[]): string[] {
  const shown = new Set(shownOrder)
  const next = [...shownOrder]
  return allIds.map(id => shown.has(id) ? next.shift()! : id)
}
