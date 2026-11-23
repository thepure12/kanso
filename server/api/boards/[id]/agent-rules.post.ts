import type { AgentRule } from '#shared/types/board'

/** Adds an agent rule. */
export default defineUserHandler(async (event, tx, userId): Promise<AgentRule> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, agentRuleBody)
  // The insert policy rejects viewers, limited members and bots without access
  // to the board (403); the composite FKs a tag or column of another board (400).
  const [row] = await tx.insert(schema.boardAgentRules)
    .values({ boardId: id, createdBy: userId, ...agentRuleValues(input) })
    .returning(agentRuleFields)
  return toAgentRule(row!)
})
