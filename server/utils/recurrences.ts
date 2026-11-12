import { asc, eq } from 'drizzle-orm'
import type { CardRecurrence } from '#shared/types/board'

const r = schema.cardRecurrences
const fields = {
  id: r.id, templateId: r.templateCardId, columnId: r.columnId, rule: r.rule, interval: r.interval, weekdays: r.weekdays,
  dayOfMonth: r.dayOfMonth, dueInDays: r.dueInDays, active: r.active, nextRunAt: r.nextRunAt, lastRunAt: r.lastRunAt,
}

/** Recurring card schedules of a board (by template id) or of one template. Trashed templates are left out (the join goes through the cards policy). */
export async function loadRecurrences(tx: Tx, where: { boardId: string } | { templateId: string }): Promise<CardRecurrence[]> {
  const rows = await tx.select(fields).from(r)
    .innerJoin(schema.cards, eq(schema.cards.id, r.templateCardId))
    .where('boardId' in where ? eq(r.boardId, where.boardId) : eq(r.templateCardId, where.templateId))
    .orderBy(asc(r.createdAt))
  return rows.map(row => ({ ...row, nextRunAt: row.nextRunAt.toISOString(), lastRunAt: row.lastRunAt?.toISOString() ?? null }))
}
