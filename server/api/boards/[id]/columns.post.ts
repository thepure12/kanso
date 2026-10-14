import { z } from 'zod'

const body = z.object({ title: z.string().trim().min(1).max(100) })

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { title } = await readValidated(event, body)
  const [col] = await tx.insert(schema.columns)
    .values({ boardId: id, title, position: await endPosition(tx, 'column', id) })
    .returning({ id: schema.columns.id, title: schema.columns.title, position: schema.columns.position, color: schema.columns.color, wipLimit: schema.columns.wipLimit })
  return { ...col!, rules: [] }
})
