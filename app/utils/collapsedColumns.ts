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
