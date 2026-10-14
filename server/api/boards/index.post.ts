import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { boardTemplates } from '#shared/boardTemplates'

const body = z.object({
  name: z.string().trim().min(1).max(100),
  teamId: z.uuid().nullable().default(null),
  template: z.enum(boardTemplates.map(t => t.key) as [string, ...string[]]).default('basic'),
})

export default defineUserHandler(async (event, tx) => {
  const { name, teamId, template } = await readValidated(event, body)
  const { columns, tags } = boardTemplates.find(t => t.key === template)!
  const [board] = await tx.execute<{ id: string, name: string }>(sql`select id, name from app.create_board(${name}, ${teamId})`)
  if (columns.length) {
    await tx.insert(schema.columns).values(columns.map((c, i) => ({ boardId: board!.id, ...c, position: (i + 1) * 1024 })))
  }
  if (tags.length) await tx.insert(schema.tags).values(tags.map(t => ({ boardId: board!.id, ...t })))
  return board
})
