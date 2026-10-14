import { eq } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({ body: z.string().trim().min(1).max(10_000) })

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const { cardComments: cc } = schema
  // RLS: only the author matches the UPDATE.
  const [row] = await tx.update(cc).set({ body: input.body }).where(eq(cc.id, id))
    .returning({ id: cc.id, body: cc.body, updatedAt: cc.updatedAt })
  if (!row) notFound('Comment not found or not yours')
  return { ...row, updatedAt: row.updatedAt.toISOString() }
})
