import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { TimeEntry } from '#shared/types/board'

const body = z.object({
  minutes: timeMinutes,
  spentOn: z.iso.date().optional(),
  note: z.string().trim().max(500).default(''),
})

/** Logs time on a card as the current user (RLS: editors and owners). */
export default defineUserHandler(async (event, tx, userId): Promise<TimeEntry> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const boardId = await cardBoardId(tx, id)
  const { timeEntries: te } = schema
  const [row] = await tx.insert(te).values({ cardId: id, boardId, userId, ...input }).returning({ id: te.id })
  const [entry] = await loadTimeEntries(tx, sql`te.id = ${row!.id}`)
  return entry!
})
