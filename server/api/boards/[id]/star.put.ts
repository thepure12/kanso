/** Stars the board for the current user. Idempotent. */
export default defineUserHandler(async (event, tx, userId) => {
  const { id } = await paramsValidated(event, uuidParam)
  await assertBoardVisible(tx, id)
  // RLS: only for themselves, on boards they can see.
  await tx.insert(schema.boardStars).values({ userId, boardId: id }).onConflictDoNothing()
  return { starred: true }
})
