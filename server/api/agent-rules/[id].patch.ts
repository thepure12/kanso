import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { AgentRule } from '#shared/types/board'

// Either just { active } or the whole rule (active optional).
const body = z.union([agentRuleBody, z.object({ active: z.boolean() }).strict()])

export default defineUserHandler(async (event, tx): Promise<AgentRule> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const r = schema.boardAgentRules
  const values = 'name' in input ? agentRuleValues(input) : { active: input.active }
  const [row] = await tx.update(r).set(values).where(eq(r.id, id)).returning(agentRuleFields)
  if (!row) notFound('Agent rule not found or not allowed')
  return toAgentRule(row)
})
