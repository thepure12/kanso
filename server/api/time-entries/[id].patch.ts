import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { TimeEntry } from '#shared/types/board'

const body = z.object({
  minutes: timeMinutes.optional(),
  spentOn: z.iso.date().optional(),
  note: z.string().trim().max(500).optional(),
})

export default defineUserHandler(async (event, tx): Promise<TimeEntry> => {
  const { id } = await paramsValidated(event, uuidParam)
  const patch = await readValidated(event, body)
  if (!Object.values(patch).some(v => v !== undefined)) throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })
  const { timeEntries: te } = schema
  // RLS: only the person who logged it matches the UPDATE.
  const rows = await tx.update(te).set(patch).where(eq(te.id, id)).returning({ id: te.id })
  if (!rows.length) notFound('Time entry not found or not yours')
  const [entry] = await loadTimeEntries(tx, sql`te.id = ${id}`)
  return entry!
})
