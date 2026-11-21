import type { Notification } from '#shared/types/notifications'
import type { NotificationEvent } from '#shared/notificationSettings'
import { isoDate } from './cardFilter'

/** Inbox page filters (`GET /api/notifications` query, minus the cursor). */
export interface InboxFilter {
  unread: boolean
  boardId: string | null
  event: NotificationEvent | null
}

export const defaultInboxFilter = (): InboxFilter => ({ unread: false, boardId: null, event: null })

/** The query string params for a filter (and an optional cursor). */
export function inboxQuery(f: InboxFilter, before?: string | null, limit?: number): Record<string, string> {
  const q: Record<string, string> = {}
  if (f.unread) q.unread = '1'
  if (f.boardId) q.boardId = f.boardId
  if (f.event) q.event = f.event
  if (before) q.before = before
  if (limit) q.limit = String(limit)
  return q
}

export type InboxDay = 'today' | 'yesterday' | 'earlier'

export interface InboxGroup {
  /** `today`, `yesterday`, else the local YYYY-MM-DD of the notifications. */
  key: string
  day: InboxDay
  items: Notification[]
}

/** Notifications (newest first) grouped by local day; `today` is the local YYYY-MM-DD. */
export function groupInbox(items: Notification[], today: string): InboxGroup[] {
  const [y, m, d] = today.split('-').map(Number)
  const yesterday = isoDate(new Date(y!, m! - 1, d! - 1))
  const groups: InboxGroup[] = []
  for (const n of items) {
    const date = isoDate(new Date(n.activity.createdAt))
    const day: InboxDay = date >= today ? 'today' : date === yesterday ? 'yesterday' : 'earlier'
    const key = day === 'earlier' ? date : day
    const last = groups.at(-1)
    if (last?.key === key) last.items.push(n)
    else groups.push({ key, day, items: [n] })
  }
  return groups
}
