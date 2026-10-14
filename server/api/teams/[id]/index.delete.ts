import { eq } from 'drizzle-orm'

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  // Cascades to the team's boards.
  const rows = await tx.delete(schema.teams).where(eq(schema.teams.id, id)).returning({ id: schema.teams.id })
  if (!rows.length) notFound('Team not found or you are not an owner')
  return { ok: true }
})
