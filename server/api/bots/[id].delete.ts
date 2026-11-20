import { sql } from 'drizzle-orm'

/**
 * Deletes a bot (app.delete_board_bot: owners of its board). Its tokens go with
 * it; its cards, comments and activity stay with no author. Cookie only.
 */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  await botBoard(tx, id)
  await tx.execute(sql`select app.delete_board_bot(${id})`)
  return { ok: true }
})
