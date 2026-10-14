import { eq } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({ name: z.string().trim().min(1).max(100) })

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { name } = await readValidated(event, body)
  const { teams } = schema
  const [row] = await tx.update(teams).set({ name }).where(eq(teams.id, id)).returning({ id: teams.id, name: teams.name })
  return row ?? notFound('Team not found or you are not an owner')
})
