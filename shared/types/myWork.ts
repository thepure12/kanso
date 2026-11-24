import type { Priority, Tag } from './board'
import type { MyWorkPanelConfig } from '../myWork'

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
  /** The card is marked complete or in its board's last column ("done", as for blocked cards). */
  done: boolean
  /** The card is marked complete (it may still sit in any column). */
  completed: boolean
  /** Open checklist items of this card assigned to the current user (empty when none). */
  checklistItems: MyChecklistItem[]
  /** The card's assignees, by name. */
  assignees: MyWorkPerson[]
  /** The card's tags, by name. */
  tags: Tag[]
}

export interface MyWorkPerson {
  id: string
  name: string
  avatarUrl: string | null
}

/** GET /api/my-work: due first (no date last), then priority. */
export interface MyWork {
  cards: MyWorkCard[]
}

/** A saved My work panel (GET /api/my-work/panels), in the user's order. */
export interface MyWorkPanel {
  id: string
  name: string
  config: MyWorkPanelConfig
}

/** Choices for the panel editor (GET /api/my-work/options): what the caller can see. */
export interface MyWorkOptions {
  boards: { id: string, name: string }[]
  /** Distinct column titles over all boards, case-insensitively (first spelling). */
  columns: string[]
  /** Distinct card tag names over all boards, case-insensitively, with a colour. */
  tags: { name: string, color: string }[]
  /** People sharing a board or team with the caller, the caller first. */
  people: (MyWorkPerson & { isBot: boolean })[]
}
