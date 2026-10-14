import { eq } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({ name: z.string().trim().min(1).max(100) })

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { name } = await readValidated(event, body)
  // RLS: only owners match the UPDATE.
  const [row] = await tx.update(schema.boards).set({ name }).where(eq(schema.boards.id, id)).returning({ id: schema.boards.id, name: schema.boards.name })
  return row ?? notFound('Board not found or you are not an owner')
})
