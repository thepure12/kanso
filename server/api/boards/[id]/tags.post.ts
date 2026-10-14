import { z } from 'zod'

const body = z.object({ name: z.string().trim().min(1).max(50), color: hexColor })

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { name, color } = await readValidated(event, body)
  const { tags } = schema
  const [tag] = await tx.insert(tags).values({ boardId: id, name, color })
    .returning({ id: tags.id, name: tags.name, color: tags.color })
  return tag
})
