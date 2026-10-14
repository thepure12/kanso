import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BoardField, FieldOption } from '#shared/types/board'

export const fieldName = z.string().trim().min(1).max(50)

/** Select choices. Options without an id are new and get one here; ids must be unique. */
export const fieldOptions = z.array(z.object({
  id: z.string().min(1).max(36).optional(),
  label: z.string().trim().min(1).max(50),
  color: hexColor,
})).max(100)
  .transform(opts => opts.map(o => ({ ...o, id: o.id ?? randomUUID() })))
  .refine(opts => new Set(opts.map(o => o.id)).size === opts.length, 'Option ids must be unique')

export const boardFieldColumns = {
  id: schema.boardFields.id,
  name: schema.boardFields.name,
  kind: schema.boardFields.kind,
  options: schema.boardFields.options,
  position: schema.boardFields.position,
  showOnCard: schema.boardFields.showOnCard,
}

type FieldRow = Omit<BoardField, 'options'> & { options: unknown }

export const toBoardField = (r: FieldRow): BoardField => ({ ...r, options: r.options as FieldOption[] })

/** A board's fields in position order. */
export async function loadBoardFields(tx: Tx, boardId: string): Promise<BoardField[]> {
  const { boardFields: f } = schema
  const rows = await tx.select(boardFieldColumns).from(f).where(eq(f.boardId, boardId)).orderBy(asc(f.position))
  return rows.map(toBoardField)
}
