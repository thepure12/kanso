/** Width in px of a collapsed column strip in the board view and swimlanes. */
export const COLLAPSED_COLUMN_WIDTH = 44

export const collapsedColumnsKey = (boardId: string) => `kanban:collapsed-columns:${boardId}`

/** Reads a stored list of collapsed column ids, dropping anything that is not a string. */
export function parseCollapsedColumns(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  }
  catch {
    return []
  }
}

/** Keeps only ids of columns that still exist. */
export function pruneCollapsedColumns(collapsed: Iterable<string>, columnIds: Iterable<string>): string[] {
  const keep = new Set(columnIds)
  return [...new Set(collapsed)].filter(id => keep.has(id))
}

/**
 * Classes of the collapse button in column headers. With a mouse it shows only while
 * the column is hovered (or the button has keyboard focus) and takes no room before,
 * so the count badge sits next to the menu. Kept at zero width rather than `hidden`
 * so keyboard users can still tab to it. Touch always shows it, a bit bigger.
 */
export const collapseButtonClass = 'pointer-coarse:p-1.5 pointer-fine:w-0 pointer-fine:px-0 pointer-fine:overflow-hidden pointer-fine:opacity-0 pointer-fine:group-hover/col:w-auto pointer-fine:group-hover/col:px-1 pointer-fine:group-hover/col:opacity-100 pointer-fine:focus-visible:w-auto pointer-fine:focus-visible:px-1 pointer-fine:focus-visible:opacity-100'
