import { z } from 'zod'
import { recurrenceRules, type CardRecurrence } from '#shared/types/board'

const body = z.object({
  columnId: z.uuid(),
  rule: z.enum(recurrenceRules),
  interval: z.number().int().min(1).max(365).default(1),
  // ISO weekdays (1 = Monday) for weekly, day 1-31 (clamped to short months) for monthly.
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).transform(d => [...new Set(d)].sort((a, b) => a - b)).nullable().default(null),
  dayOfMonth: z.number().int().min(1).max(31).nullable().default(null),
  dueInDays: z.number().int().min(0).max(365).nullable().default(null),
  active: z.boolean().default(true),
})
  // Weekly needs weekdays and monthly a day; the other rules' fields are dropped.
  .refine(b => b.rule !== 'weekly' || b.weekdays, { message: 'Weekly schedules need weekdays', path: ['weekdays'] })
  .refine(b => b.rule !== 'monthly' || b.dayOfMonth, { message: 'Monthly schedules need a day of the month', path: ['dayOfMonth'] })
  .transform(b => ({ ...b, weekdays: b.rule === 'weekly' ? b.weekdays : null, dayOfMonth: b.rule === 'monthly' ? b.dayOfMonth : null }))

/** Creates or replaces the template's recurring schedule. The next run is set by trigger. */
export default defineUserHandler(async (event, tx, userId): Promise<CardRecurrence> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const boardId = await cardBoardId(tx, id)
  const { cardRecurrences: r } = schema
  // A trigger rejects cards that are not templates (KB008); RLS limits it to editors.
  const [row] = await tx.insert(r)
    .values({ ...input, boardId, templateCardId: id, createdBy: userId, nextRunAt: new Date() })
    .onConflictDoUpdate({ target: r.templateCardId, set: input })
    .returning({ id: r.id })
  if (!row) notFound('Card not found or not allowed')
  const [rec] = await loadRecurrences(tx, { templateId: id })
  return rec!
})
