import type { BoardRule } from '#shared/types/board'

/** Adds an event-triggered rule (runs when a matching change is saved). */
export default defineUserHandler(async (event, tx, userId): Promise<BoardRule> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, boardRuleBody)
  // The insert policy rejects viewers and people who are not on the board; the
  // composite FKs a tag or column of another board (400).
  const [row] = await tx.insert(schema.boardRules)
    .values({ boardId: id, createdBy: userId, ...boardRuleValues(input) })
    .returning(boardRuleFields)
  return toBoardRule(row!)
})
