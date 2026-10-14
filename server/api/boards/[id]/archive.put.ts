import { sql } from 'drizzle-orm'

/** Archives the board (read-only for everyone). Owners only, enforced by app.set_board_archived. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  await assertBoardVisible(tx, id)
  const [row] = await tx.execute<{ archived_at: Date | string }>(sql`select archived_at from app.set_board_archived(${id}, true)`)
  return { archivedAt: new Date(row!.archived_at).toISOString() }
})
