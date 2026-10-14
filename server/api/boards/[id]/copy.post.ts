import { sql } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({
  name: z.string().trim().min(1).max(100),
  teamId: z.uuid().nullable().default(null),
  withCards: z.boolean().default(true),
})

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { name, teamId, withCards } = await readValidated(event, body)
  // Reads the source and writes the copy through RLS; see app.copy_board.
  const [board] = await tx.execute<{ id: string, name: string }>(sql`select id, name from app.copy_board(${id}, ${name}, ${teamId}, ${withCards})`)
  return board
})
