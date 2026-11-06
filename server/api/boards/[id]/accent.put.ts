import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { type BoardAccent, boardAccents } from '#shared/boardAccents'

const body = z.object({ accent: z.enum(boardAccents).nullable() })

export default defineUserHandler(async (event, tx): Promise<{ accent: BoardAccent | null }> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { accent } = await readValidated(event, body)
  // RLS: only owners of unarchived boards match the UPDATE.
  const [row] = await tx.update(schema.boards).set({ accent }).where(eq(schema.boards.id, id))
    .returning({ accent: schema.boards.accent })
  return row ?? notFound('Board not found or you are not an owner')
})
