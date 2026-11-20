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
  items: Notification[]
  unread: number
  dueSoon: DueCard[]
}
