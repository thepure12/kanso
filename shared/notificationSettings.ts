// Notification settings (0070_notification_settings_rls.sql).
//
// users.notification_prefs: per event, which channels are on. Missing entries
// are on, so '{}' (the default) notifies everything everywhere. The inbox
// channel decides whether a notification is created at all (the bell, in-app
// toasts and desktop notifications follow it); push and email only pick from
// what reaches the inbox. The SQL side (app.notification_event,
// app.notify_on) mirrors notificationEvent and channelOn.
//
// users.notify_watching: false = cards one only watches stay quiet (assigned
// cards and mentions still notify).
//
// board_notification_settings.level per user and board: all (no row),
// direct (only mentions and being assigned) or none.
import { z } from 'zod'

export const notificationEvents = ['assigned', 'mentioned', 'commented', 'moved', 'due', 'archived', 'stale'] as const
export type NotificationEvent = (typeof notificationEvents)[number]

export const notificationChannels = ['inbox', 'push', 'email'] as const
export type NotificationChannel = (typeof notificationChannels)[number]

export type NotificationPrefs = Partial<Record<NotificationEvent, Partial<Record<NotificationChannel, boolean>>>>

const channelsSchema = z.strictObject({
  inbox: z.boolean().optional(),
  push: z.boolean().optional(),
  email: z.boolean().optional(),
})

export const notificationPrefsSchema = z.strictObject(
  Object.fromEntries(notificationEvents.map(e => [e, channelsSchema.optional()])) as Record<NotificationEvent, z.ZodOptional<typeof channelsSchema>>,
)

export const boardNotificationLevels = ['all', 'direct', 'none'] as const
export type BoardNotificationLevel = (typeof boardNotificationLevels)[number]

/** The event a notification counts as for its recipient: a comment that mentions them is a mention. */
export function notificationEvent(kind: string, data: Record<string, unknown> | null | undefined, userId: string): NotificationEvent | null {
  const mentions = Array.isArray(data?.mentions) ? data.mentions : []
  if (kind === 'mentioned' || (kind === 'commented' && mentions.includes(userId))) return 'mentioned'
  return (notificationEvents as readonly string[]).includes(kind) ? kind as NotificationEvent : null
}

/** Whether a channel is on for an event. Push and email need the inbox. */
export function channelOn(prefs: NotificationPrefs, event: NotificationEvent, channel: NotificationChannel): boolean {
  const p = prefs[event]
  if (channel !== 'inbox' && p?.inbox === false) return false
  return p?.[channel] ?? true
}

/** Prefs with one channel changed; entries back at the default (all on) are dropped. */
export function withChannel(prefs: NotificationPrefs, event: NotificationEvent, channel: NotificationChannel, on: boolean): NotificationPrefs {
  const next: NotificationPrefs = { ...prefs }
  const entry = { ...next[event], [channel]: on }
  for (const c of notificationChannels) if (entry[c] !== false) delete entry[c]
  if (Object.keys(entry).length) next[event] = entry
  else delete next[event]
  return next
}
