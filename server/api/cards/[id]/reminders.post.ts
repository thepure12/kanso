import { z } from 'zod'
import type { CardReminder } from '#shared/types/board'

const note = z.string().trim().max(500).nullable().optional().transform(n => n || null)
const timeZone = z.string().min(1).max(64).refine((tz) => {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true }
  catch { return false }
}, 'Unknown time zone')
const body = z.union([
  z.object({ at: z.iso.datetime({ offset: true }), note }),
  z.object({
    beforeDueDays: z.number().int().min(0).max(365),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timeZone,
    note,
  }),
])

/**
 * Adds a personal reminder: at a fixed time (`at`), or `beforeDueDays` days
 * before the due date at `time` in `timeZone` (the browser's). The cards:reminders
 * task notifies only the caller. A time that has passed is refused (400).
 */
export default defineUserHandler(async (event, tx, userId): Promise<CardReminder> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const boardId = await cardBoardId(tx, id)
  // RLS: own rows on cards the caller can see, not templates. The insert trigger computes due-date times.
  const values = 'at' in input
    ? { remindAt: new Date(input.at), note: input.note }
    : { beforeDueDays: input.beforeDueDays, dueTime: input.time, timeZone: input.timeZone, note: input.note }
  const [row] = await tx.insert(schema.cardReminders)
    .values({ ...values, cardId: id, boardId, userId })
    .returning(reminderFields)
  return toCardReminder(row!)
})
