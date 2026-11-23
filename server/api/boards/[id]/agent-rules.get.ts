import { eq } from 'drizzle-orm'
import type { AgentRule } from '#shared/types/board'

/** The board's agent rules (what `kanso agent run --board` follows). */
export default defineUserHandler(async (event, tx): Promise<AgentRule[]> => {
  const { id } = await paramsValidated(event, uuidParam)
  // 404 when the board is not visible, rather than an empty list.
  const [board] = await tx.select({ id: schema.boards.id }).from(schema.boards).where(eq(schema.boards.id, id))
  if (!board) notFound('Board not found')
  return loadAgentRules(tx, id)
})
