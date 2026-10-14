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

/** A non-archived card assigned to the caller that is due by tomorrow. */
export interface DueCard {
  boardId: string
  boardName: string
  cardId: string
  cardTitle: string
  dueDate: string
}

export interface Inbox {
  items: Notification[]
  unread: number
  dueSoon: DueCard[]
}
