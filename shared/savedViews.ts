// Saved views: a named board view (board/list/calendar/timeline), swimlane
// grouping, column group and card filter. Personal (saved_views.user_id = the
// user) or shared on the board (user_id null). See 0066_saved_views_rls.sql.
import { z } from 'zod'
import { priorities } from './types/board'

export const boardViews = ['board', 'list', 'calendar', 'timeline'] as const
export type BoardView = (typeof boardViews)[number]

export const dueFilters = ['any', 'overdue', 'today', 'week', 'none', 'started', 'upcoming'] as const

const ids = z.array(z.string().max(64)).max(200)

export const savedViewFilterSchema = z.object({
  text: z.string().max(200),
  tagIds: ids,
  /** User ids, or 'none' for unassigned cards. */
  assigneeIds: ids,
  priorities: z.array(z.enum([...priorities, 'none'])).max(5),
  due: z.enum(dueFilters),
  /** Field id -> option ids | 'true' | 'none'. */
  fields: z.record(z.string().max(64), ids).refine(r => Object.keys(r).length <= 100, 'Too many fields'),
})

export const savedViewConfigSchema = z.object({
  view: z.enum(boardViews),
  /** Swimlane grouping (board view): none | assignee | priority | tag | field:<id>. */
  groupBy: z.string().max(80),
  /** Column group shown in the board view; null = all columns. */
  columnGroupId: z.uuid().nullable(),
  filter: savedViewFilterSchema,
})

export type SavedViewConfig = z.infer<typeof savedViewConfigSchema>

export const savedViewName = z.string().trim().min(1).max(50)
