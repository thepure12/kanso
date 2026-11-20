import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BoardRule } from '#shared/types/board'

// Either just { active } or the whole rule (event, conditions, actions; active optional).
const body = z.union([boardRuleBody, z.object({ active: z.boolean() }).strict()])

export default defineUserHandler(async (event, tx): Promise<BoardRule> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const r = schema.boardRules
  const values = 'event' in input ? boardRuleValues(input) : { active: input.active }
  const [row] = await tx.update(r).set(values).where(eq(r.id, id)).returning(boardRuleFields)
  if (!row) notFound('Rule not found or not allowed')
  return toBoardRule(row)
})
