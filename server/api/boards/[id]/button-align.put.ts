import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { type ButtonAlign, buttonAligns } from '#shared/buttons'

const body = z.object({ align: z.enum(buttonAligns).nullable() })

export default defineUserHandler(async (event, tx): Promise<{ align: ButtonAlign | null }> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { align } = await readValidated(event, body)
  // RLS: only owners of unarchived boards match the UPDATE.
  const [row] = await tx.update(schema.boards).set({ buttonAlign: align }).where(eq(schema.boards.id, id))
    .returning({ align: schema.boards.buttonAlign })
  return row ?? notFound('Board not found or you are not an owner')
})
