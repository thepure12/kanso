import type { Column, ColumnGroup } from '#shared/types/board'

/** The group's columns in board order; all columns when group is null. */
export function columnsInGroup<C extends Pick<Column, 'id'>>(columns: C[], group: Pick<ColumnGroup, 'columnIds'> | null | undefined): C[] {
  if (!group) return columns
  const ids = new Set(group.columnIds)
  return columns.filter(c => ids.has(c.id))
}

/** Groups the column belongs to, in group order. */
export function groupsForColumn<G extends Pick<ColumnGroup, 'columnIds'>>(groups: G[], columnId: string): G[] {
  return groups.filter(g => g.columnIds.includes(columnId))
}

/** Same set of column ids with columnId added or removed. */
export function toggleColumn(columnIds: string[], columnId: string, member: boolean): string[] {
  const rest = columnIds.filter(c => c !== columnId)
  return member ? [...rest, columnId] : rest
}
