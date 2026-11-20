import type { Priority } from './board'

/** An open checklist item assigned to the current user. */
export interface MyChecklistItem {
  id: string
  text: string
  /** YYYY-MM-DD */
  dueDate: string | null
}

/** A card the current user is assigned to, watches or has open checklist items on, on any board they can see. */
export interface MyWorkCard {
  id: string
  title: string
  boardId: string
  boardName: string
  columnId: string
  columnTitle: string
  /** YYYY-MM-DD */
  startDate: string | null
  /** YYYY-MM-DD */
  dueDate: string | null
  priority: Priority | null
  estimate: number | null
  assigned: boolean
  watching: boolean
  /** The card is in its board's last column ("done", as for blocked cards). */
  done: boolean
  /** Open checklist items of this card assigned to the current user (empty when none). */
  checklistItems: MyChecklistItem[]
}

/** GET /api/my-work: due first (no date last), then priority. */
export interface MyWork {
  cards: MyWorkCard[]
}
