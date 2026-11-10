/** Column widths in the board view, in px. Default matches Tailwind `w-72`. */
export const COLUMN_WIDTH_DEFAULT = 288
export const COLUMN_WIDTH_MIN = 200
export const COLUMN_WIDTH_MAX = 640
/** Keyboard step for the resize handle (arrow keys; Shift for a bigger step). */
export const COLUMN_WIDTH_STEP = 16

export type ColumnWidths = Record<string, number>

export const columnWidthsKey = (boardId: string) => `kanban:column-widths:${boardId}`

export function clampColumnWidth(px: number): number {
  if (!Number.isFinite(px)) return COLUMN_WIDTH_DEFAULT
  return Math.round(Math.min(COLUMN_WIDTH_MAX, Math.max(COLUMN_WIDTH_MIN, px)))
}

/** Reads a stored `{columnId: px}` map, dropping anything that is not a number. */
export function parseColumnWidths(raw: string | null): ColumnWidths {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: ColumnWidths = {}
    for (const [id, px] of Object.entries(parsed)) {
      if (typeof px === 'number' && Number.isFinite(px)) out[id] = clampColumnWidth(px)
    }
    return out
  }
  catch {
    return {}
  }
}

/** Drops widths of columns that no longer exist and widths equal to the default. */
export function pruneColumnWidths(widths: ColumnWidths, columnIds: Iterable<string>): ColumnWidths {
  const keep = new Set(columnIds)
  return Object.fromEntries(Object.entries(widths).filter(([id, px]) => keep.has(id) && px !== COLUMN_WIDTH_DEFAULT))
}
