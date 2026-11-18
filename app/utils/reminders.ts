import type { CardReminder } from '#shared/types/board'

const pad = (n: number) => String(n).padStart(2, '0')

/** A `datetime-local` input value (YYYY-MM-DDTHH:mm) for a date, in local time. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Quick picks: an hour from now (whole minutes) and tomorrow at 09:00. */
export function reminderPresets(now = new Date()) {
  const inOneHour = new Date(now.getTime() + 3600_000)
  inOneHour.setSeconds(0, 0)
  const tomorrowMorning = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0)
  return { inOneHour, tomorrowMorning }
}

/** When a due-date reminder fires in local time: `days` before `due` (YYYY-MM-DD) at `time` (HH:MM). */
export function dueReminderDate(due: string, days: number, time: string): Date {
  const [y, m, d] = due.split('-').map(Number)
  const [h, min] = time.split(':').map(Number)
  return new Date(y!, m! - 1, d! - days, h, min)
}

/** Reminders still to come (not yet sent). */
export function pendingReminders(list: readonly CardReminder[]): CardReminder[] {
  return list.filter(r => !r.sentAt)
}
