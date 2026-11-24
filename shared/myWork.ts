// My work panels: named card lists across boards on the My work page, each a
// saved query (people, column titles, boards, card tag names, priority, due).
// Saved per user in my_work_panels (0139_my_work_panels_rls.sql).
import { z } from 'zod'
import { priorities } from './types/board'

/**
 * Whose cards: involved = assigned to me, watched by me or with my open
 * checklist items (the classic My work list); assigned / watching = only that;
 * anyone = every card I can see; people = assigned to one of `userIds`.
 */
export const myWorkPeople = ['involved', 'assigned', 'watching', 'anyone', 'people'] as const
export type MyWorkPeople = (typeof myWorkPeople)[number]

/** Due date buckets in display order; soon = within the next 7 days, none = no due date. */
export const myWorkBuckets = ['overdue', 'today', 'soon', 'later', 'none'] as const
export type MyWorkBucket = (typeof myWorkBuckets)[number]

export const MY_WORK_PANEL_NAME_MAX = 50
export const MY_WORK_PANELS_MAX = 30

export const myWorkPanelName = z.string().trim().min(1).max(MY_WORK_PANEL_NAME_MAX)

const names = z.array(z.string().trim().min(1).max(200)).max(50)

export const myWorkPanelConfigSchema = z.object({
  people: z.enum(myWorkPeople),
  /** Assignees for people = 'people' (any of them). */
  userIds: z.array(z.uuid()).max(50),
  /** Column titles, matched case-insensitively on every board; empty = any column. */
  columns: names,
  /** Boards; empty = every board. */
  boardIds: z.array(z.uuid()).max(100),
  /** Card tag names, matched case-insensitively on every board (any of them); empty = any. */
  tags: names,
  /** Priorities, 'none' = no priority; empty = any. */
  priorities: z.array(z.enum([...priorities, 'none'])).max(5),
  /** Due date buckets; empty = any. */
  due: z.array(z.enum(myWorkBuckets)).max(5),
  /** Also cards in their board's last column. */
  showDone: z.boolean(),
})

export type MyWorkPanelConfig = z.infer<typeof myWorkPanelConfigSchema>

export const emptyMyWorkPanelConfig = (): MyWorkPanelConfig => ({
  people: 'assigned', userIds: [], columns: [], boardIds: [], tags: [], priorities: [], due: [], showDone: false,
})

/**
 * Query of GET /api/my-work for a panel: the server filters people, columns,
 * boards, tags and priority; due and done are filtered in the browser (they
 * depend on the local date and are cheap).
 */
export function myWorkQuery(c: MyWorkPanelConfig): Record<string, string | string[]> {
  const q: Record<string, string | string[]> = { people: c.people }
  if (c.people === 'people') q.user = c.userIds
  if (c.columns.length) q.column = c.columns
  if (c.boardIds.length) q.board = c.boardIds
  if (c.tags.length) q.tag = c.tags
  if (c.priorities.length) q.priority = c.priorities
  return q
}
