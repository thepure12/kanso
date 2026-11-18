import { and, asc, eq, sql } from 'drizzle-orm'
import type { CardReminder } from '#shared/types/board'

const r = schema.cardReminders

export const reminderFields = {
  id: r.id,
  remindAt: r.remindAt,
  beforeDueDays: r.beforeDueDays,
  dueTime: r.dueTime,
  timeZone: r.timeZone,
  note: r.note,
  sentAt: r.sentAt,
}

type ReminderRow = {
  id: string
  remindAt: Date | null
  beforeDueDays: number | null
  dueTime: string | null
  timeZone: string | null
  note: string | null
  sentAt: Date | null
}

export function toCardReminder(row: ReminderRow): CardReminder {
  return {
    ...row,
    remindAt: row.remindAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
  }
}

/** The caller's reminders on a card (RLS: own rows only), soonest first, unscheduled last. */
export async function loadReminders(tx: Tx, cardId: string, userId: string): Promise<CardReminder[]> {
  const rows = await tx.select(reminderFields).from(r)
    .where(and(eq(r.cardId, cardId), eq(r.userId, userId)))
    .orderBy(sql`${r.remindAt} asc nulls last`, asc(r.createdAt))
  return rows.map(toCardReminder)
}
