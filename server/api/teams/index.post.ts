import { sql } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({ name: z.string().trim().min(1).max(100) })

export default defineUserHandler(async (event, tx) => {
  const { name } = await readValidated(event, body)
  const [team] = await tx.execute<{ id: string, name: string }>(sql`select id, name from app.create_team(${name})`)
  return team
})
