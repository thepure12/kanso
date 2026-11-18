import { addDays, isoDate } from './cardFilter'

export type SnoozePreset = 'tomorrow' | 'nextWeek' | 'nextMonth'

/**
 * Wake-up dates offered by the Snooze menu, from `today` (YYYY-MM-DD, local):
 * tomorrow, next Monday (a week on when today is Monday) and the same day next
 * month (the month's last day when it is shorter).
 */
export function snoozePresets(today: string): Record<SnoozePreset, string> {
  const [y, m, d] = today.split('-').map(Number)
  const weekday = new Date(y!, m! - 1, d!).getDay() // 0 = Sunday
  const toMonday = ((8 - weekday) % 7) || 7
  const lastOfNext = new Date(y!, m! + 1, 0).getDate()
  return {
    tomorrow: addDays(today, 1),
    nextWeek: addDays(today, toMonday),
    nextMonth: isoDate(new Date(y!, m!, Math.min(d!, lastOfNext))),
  }
}
