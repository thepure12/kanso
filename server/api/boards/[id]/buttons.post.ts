import { sql } from 'drizzle-orm'
import { createButtonSchema, type BoardButton } from '#shared/buttons'

/** Creates a button: personal, or shared on the board (editors only, RLS). */
export default defineUserHandler(async (event, tx): Promise<BoardButton> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, createButtonSchema)
  const { boardButtons: bb } = schema
  const [row] = await tx.insert(bb).values({
    boardId: id,
    userId: input.shared ? null : sql`app.current_user_id()`,
    createdBy: sql`app.current_user_id()`,
    scope: input.scope,
    name: input.name,
    icon: input.icon,
    color: input.color,
    steps: input.steps,
  }).returning({ id: bb.id })
  return (await loadButton(tx, row!.id))!
})
