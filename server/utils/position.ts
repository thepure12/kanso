import { and, asc, eq, inArray, max } from 'drizzle-orm'

const STEP = 1024
const MIN_GAP = 1e-6

type Kind = 'card' | 'column' | 'checklist' | 'field'

function scope(kind: Kind) {
  switch (kind) {
    case 'card': return { table: schema.cards, scopeCol: schema.cards.columnId }
    case 'column': return { table: schema.columns, scopeCol: schema.columns.boardId }
    case 'checklist': return { table: schema.checklistItems, scopeCol: schema.checklistItems.cardId }
    case 'field': return { table: schema.boardFields, scopeCol: schema.boardFields.boardId }
  }
}

/** Position after the last item in a column (cards), board (columns, fields) or card (checklist items). */
export async function endPosition(tx: Tx, kind: Kind, scopeId: string): Promise<number> {
  const { table, scopeCol } = scope(kind)
  const [row] = await tx.select({ max: max(table.position) }).from(table).where(eq(scopeCol, scopeId))
  return (row?.max ?? 0) + STEP
}

/**
 * Fractional position between neighbours `aboveId` and `belowId` (either may be
 * null for start/end). Renumbers the scope when the gap gets too small.
 */
export async function positionBetween(
  tx: Tx, kind: Kind, scopeId: string, aboveId: string | null, belowId: string | null,
): Promise<number> {
  const { table, scopeCol } = scope(kind)
  const ids = [aboveId, belowId].filter((id): id is string => !!id)
  if (!ids.length) return endPosition(tx, kind, scopeId)

  const load = async () => {
    const rows = await tx.select({ id: table.id, position: table.position }).from(table)
      .where(and(eq(scopeCol, scopeId), inArray(table.id, ids)))
    if (rows.length !== ids.length) throw createError({ statusCode: 400, statusMessage: 'Neighbour not found' })
    const pos = (id: string | null) => rows.find(r => r.id === id)?.position
    return { above: pos(aboveId), below: pos(belowId) }
  }

  let { above, below } = await load()
  if (above !== undefined && below !== undefined && below - above < MIN_GAP) {
    const all = await tx.select({ id: table.id }).from(table).where(eq(scopeCol, scopeId)).orderBy(asc(table.position))
    for (const [i, row] of all.entries()) {
      await tx.update(table).set({ position: (i + 1) * STEP }).where(eq(table.id, row.id))
    }
    ;({ above, below } = await load())
  }

  if (above !== undefined && below !== undefined) return (above + below) / 2
  if (above !== undefined) return above + STEP
  return below! - STEP
}
