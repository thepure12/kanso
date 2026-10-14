import type { Priority } from './board'

/** A card the current user is assigned to or watches, on any board they can see. */
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
}

/** GET /api/my-work: due first (no date last), then priority. */
export interface MyWork {
  cards: MyWorkCard[]
}
