import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BoardAutomation } from '#shared/types/board'

// Kind, tag and priority are fixed; the check constraint limits days per kind (400).
const body = z.object({
  days: z.number().int().min(0).max(365).optional(),
  active: z.boolean().optional(),
}).refine(b => b.days !== undefined || b.active !== undefined, 'Nothing to update')

export default defineUserHandler(async (event, tx): Promise<BoardAutomation> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const a = schema.boardAutomations
  const [row] = await tx.update(a).set(input).where(eq(a.id, id)).returning(boardAutomationFields)
  if (!row) notFound('Automation not found or not allowed')
  return toBoardAutomation(row)
})
