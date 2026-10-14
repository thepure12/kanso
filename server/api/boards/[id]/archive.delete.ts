import { sql } from 'drizzle-orm'

/** Unarchives the board. Owners only, enforced by app.set_board_archived. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  await assertBoardVisible(tx, id)
  await tx.execute(sql`select app.set_board_archived(${id}, false)`)
  return { archivedAt: null }
})
