import type { SavedViewConfig } from '#shared/savedViews'
import type { BoardField, ColumnGroup, Member, Tag } from '#shared/types/board'
import type { CardFilter } from './cardFilter'
import { isFilterableField } from './fields'
import { isValidGroupBy, type GroupBy } from './swimlanes'

export interface ViewState {
  view: SavedViewConfig['view']
  groupBy: GroupBy
  columnGroupId: string | null
  filter: CardFilter
}

export interface ViewContext {
  tags: Pick<Tag, 'id'>[]
  members: Pick<Member, 'userId'>[]
  fields: BoardField[]
  columnGroups: Pick<ColumnGroup, 'id'>[]
}

/** A deep copy of the current settings, in the shape stored in saved_views.config. */
export function currentViewConfig(state: ViewState): SavedViewConfig {
  const f = state.filter
  return {
    view: state.view,
    groupBy: state.groupBy,
    columnGroupId: state.columnGroupId,
    filter: {
      text: f.text.trim(),
      tagIds: [...f.tagIds],
      assigneeIds: [...f.assigneeIds],
      priorities: [...f.priorities],
      due: f.due,
      fields: Object.fromEntries(Object.entries(f.fields).filter(([, v]) => v.length).map(([k, v]) => [k, [...v]])),
    },
  }
}

/**
 * A saved config fitted to the board as it is now: tags, people, fields, field
 * options and column groups that are gone are dropped, a grouping by a deleted
 * field becomes none.
 */
export function sanitizeViewConfig(config: SavedViewConfig, ctx: ViewContext): ViewState {
  const tagIds = new Set(ctx.tags.map(t => t.id))
  const userIds = new Set(ctx.members.map(m => m.userId))
  const f = config.filter
  const fields: Record<string, string[]> = {}
  for (const [fieldId, values] of Object.entries(f.fields)) {
    const field = ctx.fields.find(x => x.id === fieldId)
    if (!field || !isFilterableField(field)) continue
    const allowed = field.kind === 'select' ? new Set(['none', ...field.options.map(o => o.id)]) : new Set(['none', 'true'])
    const kept = values.filter(v => allowed.has(v))
    if (kept.length) fields[fieldId] = kept
  }
  return {
    view: config.view,
    groupBy: isValidGroupBy(config.groupBy, ctx.fields) ? config.groupBy : 'none',
    columnGroupId: config.columnGroupId && ctx.columnGroups.some(g => g.id === config.columnGroupId) ? config.columnGroupId : null,
    filter: {
      text: f.text,
      tagIds: f.tagIds.filter(t => tagIds.has(t)),
      assigneeIds: f.assigneeIds.filter(u => u === 'none' || userIds.has(u)),
      priorities: [...f.priorities],
      due: f.due,
      fields,
    },
  }
}

const sameSet = (a: readonly string[], b: readonly string[]) => {
  const s = new Set(a)
  return s.size === new Set(b).size && b.every(x => s.has(x))
}

/** Whether two configs show the same thing (list order and empty field filters do not matter). */
export function sameViewConfig(a: SavedViewConfig, b: SavedViewConfig): boolean {
  if (a.view !== b.view || a.groupBy !== b.groupBy || a.columnGroupId !== b.columnGroupId) return false
  const fa = a.filter, fb = b.filter
  if (fa.text.trim() !== fb.text.trim() || fa.due !== fb.due) return false
  if (!sameSet(fa.tagIds, fb.tagIds) || !sameSet(fa.assigneeIds, fb.assigneeIds) || !sameSet(fa.priorities, fb.priorities)) return false
  const keys = new Set([...Object.keys(fa.fields), ...Object.keys(fb.fields)])
  return [...keys].every(k => sameSet(fa.fields[k] ?? [], fb.fields[k] ?? []))
}

/** Views in the server's order: by name, case-insensitively. */
export const sortSavedViews = <T extends { name: string }>(list: T[]) =>
  list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
