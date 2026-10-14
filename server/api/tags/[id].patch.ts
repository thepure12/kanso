import { eq } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  color: hexColor.optional(),
}).refine(b => b.name !== undefined || b.color !== undefined, 'Nothing to update')

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const patch = await readValidated(event, body)
  const { tags } = schema
  const [row] = await tx.update(tags).set(patch).where(eq(tags.id, id))
    .returning({ id: tags.id, name: tags.name, color: tags.color })
  return row ?? notFound('Tag not found or not allowed')
})
