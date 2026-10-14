/** Watches the card as the current user. Idempotent. */
export default defineUserHandler(async (event, tx, userId) => {
  const { id } = await paramsValidated(event, uuidParam)
  const boardId = await cardBoardId(tx, id)
  // RLS: anyone with access to the board, for themselves only.
  await tx.insert(schema.cardWatchers).values({ cardId: id, boardId, userId }).onConflictDoNothing()
  return { watching: true }
})
