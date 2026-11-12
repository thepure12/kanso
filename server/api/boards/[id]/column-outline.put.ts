import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { type ColumnOutline, columnOutlineSchema } from '#shared/columnOutline'

const body = z.object({ outline: columnOutlineSchema.nullable() })

export default defineUserHandler(async (event, tx): Promise<{ outline: ColumnOutline | null }> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { outline } = await readValidated(event, body)
  // RLS: only owners of unarchived boards match the UPDATE.
  const [row] = await tx.update(schema.boards).set({ columnOutline: outline }).where(eq(schema.boards.id, id))
    .returning({ outline: schema.boards.columnOutline })
  return row ?? notFound('Board not found or you are not an owner')
})
