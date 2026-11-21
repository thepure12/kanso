import type { Activity } from './board'

export interface Notification {
  id: string
  boardId: string
  boardName: string
  cardId: string
  cardTitle: string
  activity: Activity
  readAt: string | null
}

/** A non-archived card (or open checklist item) assigned to the caller that is due by tomorrow. */
export interface DueCard {
  boardId: string
  boardName: string
  cardId: string
  cardTitle: string
  dueDate: string
  /** Set for a checklist item assigned to the caller: its id and text. */
  itemId?: string
  item?: string
}

export interface Inbox {
  /** Newest first, one page (GET /api/notifications?before=&limit=&unread=1&boardId=&event=). */
  items: Notification[]
  /** Pass as `before` for the next page; null on the last one. */
  nextCursor: string | null
  /** Unread notifications overall, whatever the filters. */
  unread: number
  /** Boards the caller has notifications from, by name, with their unread counts (for the inbox filter). */
  boards: { id: string, name: string, unread: number }[]
  dueSoon: DueCard[]
}
