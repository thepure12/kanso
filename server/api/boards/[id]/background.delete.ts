import { eq } from 'drizzle-orm'

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  // RLS: only owners of unarchived boards match. A trigger drops an uploaded image.
  const [row] = await tx.update(schema.boards).set({ background: null }).where(eq(schema.boards.id, id))
    .returning({ id: schema.boards.id })
  if (!row) notFound('Board not found or you are not an owner')
  return { background: null }
})
