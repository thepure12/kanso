import { eq } from 'drizzle-orm'
import { type BoardBackground, presetBackgroundSchema } from '#shared/boardBackgrounds'

// Uploaded images go through POST /api/boards/:id/background.
export default defineUserHandler(async (event, tx): Promise<{ background: BoardBackground | null }> => {
  const { id } = await paramsValidated(event, uuidParam)
  const background = await readValidated(event, presetBackgroundSchema)
  // RLS: only owners of unarchived boards match the UPDATE.
  const [row] = await tx.update(schema.boards).set({ background }).where(eq(schema.boards.id, id))
    .returning({ background: schema.boards.background })
  return row ?? notFound('Board not found or you are not an owner')
})
