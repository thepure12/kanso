import type { Translate } from '#shared/i18n'
import { fieldKindMeta } from './fields'
import { priorities, type BoardField, type Card, type Member, type Priority, type Tag } from '#shared/types/board'

/** Swimlane grouping of the board view; `field:<id>` is a select field. */
export type GroupBy = 'none' | 'assignee' | 'priority' | 'tag' | `field:${string}`

export interface Lane {
  /** Value id: user, priority, tag or option id, or 'none' for cards without one. */
  key: string
  label: string
  color?: string
  avatar?: string | null
}

export interface LaneContext {
  members: Pick<Member, 'userId' | 'name' | 'avatarUrl'>[]
  tags: Tag[]
  fields: BoardField[]
}

const fieldOf = (groupBy: GroupBy, fields: BoardField[]) =>
  groupBy.startsWith('field:') ? fields.find(f => f.id === groupBy.slice(6) && f.kind === 'select') : undefined

/** Whether a grouping still applies (its select field may have been deleted). */
export function isValidGroupBy(groupBy: string, fields: BoardField[]): groupBy is GroupBy {
  return ['none', 'assignee', 'priority', 'tag'].includes(groupBy) || !!fieldOf(groupBy as GroupBy, fields)
}

/**
 * Assignees and tags are multi-valued: a card with two of them shows in both
 * lanes, so dragging between lanes has no single meaning and is not offered.
 */
export const isMultiValued = (groupBy: GroupBy) => groupBy === 'assignee' || groupBy === 'tag'

/** Lane keys a card belongs to ('none' when it has no value). */
export function laneKeysOf(card: Card, groupBy: GroupBy, ctx: LaneContext): string[] {
  switch (groupBy) {
    case 'none': return ['none']
    case 'priority': return [card.priority ?? 'none']
    case 'assignee': {
      const ids = ctx.members.filter(m => card.assigneeIds.includes(m.userId)).map(m => m.userId)
      return ids.length ? ids : ['none']
    }
    case 'tag': {
      const ids = ctx.tags.filter(t => card.tagIds.includes(t.id)).map(t => t.id)
      return ids.length ? ids : ['none']
    }
    default: {
      const field = fieldOf(groupBy, ctx.fields)
      const value = field ? card.fields[field.id] : undefined
      return [field?.options.some(o => o.id === value) ? String(value) : 'none']
    }
  }
}

/**
 * Lanes in display order, the "none" lane last. Priority and select lanes are
 * all shown (cards can be dragged into empty ones); assignee and tag lanes
 * only when some card is in them.
 */
export function buildLanes(cards: Card[], groupBy: GroupBy, ctx: LaneContext, t: Translate): Lane[] {
  if (groupBy === 'none') return [{ key: 'none', label: '' }]
  const used = new Set(cards.flatMap(c => laneKeysOf(c, groupBy, ctx)))
  let lanes: Lane[]
  let none: string
  if (groupBy === 'priority') {
    lanes = priorities.map(p => ({ key: p, label: t(`priority.${p}`) }))
    none = t('swimlanes.noPriority')
  }
  else if (groupBy === 'assignee') {
    lanes = ctx.members.filter(m => used.has(m.userId)).map(m => ({ key: m.userId, label: m.name, avatar: m.avatarUrl }))
    none = t('swimlanes.unassigned')
  }
  else if (groupBy === 'tag') {
    lanes = ctx.tags.filter(t => used.has(t.id)).map(t => ({ key: t.id, label: t.name, color: t.color }))
    none = t('swimlanes.noTag')
  }
  else {
    const field = fieldOf(groupBy, ctx.fields)
    lanes = (field?.options ?? []).map(o => ({ key: o.id, label: o.label, color: o.color }))
    none = field ? t('swimlanes.noField', { field: field.name }) : t('swimlanes.noValue')
  }
  return [...lanes, { key: 'none', label: none }]
}

/** The priority a card dropped into a priority lane gets. */
export const lanePriority = (key: string): Priority | null => key === 'none' ? null : key as Priority

/**
 * Where a card dropped into a lane goes in its column's full card list, which
 * also holds cards of other lanes. `columnIds` is that list without the moved
 * card; `above` and `below` are its neighbours within the lane. It goes right
 * after the card above it in the lane, or right before the one below, or to
 * the end of the column when the lane cell was empty.
 */
export function laneInsertIndex(columnIds: string[], above: string | null, below: string | null): number {
  const a = above ? columnIds.indexOf(above) : -1
  if (a >= 0) return a + 1
  const b = below ? columnIds.indexOf(below) : -1
  return b >= 0 ? b : columnIds.length
}

/** Choices of a "Group by" select: the groupings plus one per select field. */
export function groupByItems(fields: BoardField[], t: Translate): { label: string, value: GroupBy, icon: string }[] {
  return [
    { label: t('swimlanes.none'), value: 'none', icon: 'i-lucide-square-dashed' },
    { label: t('swimlanes.assignee'), value: 'assignee', icon: 'i-lucide-user' },
    { label: t('swimlanes.priority'), value: 'priority', icon: 'i-lucide-flag' },
    { label: t('swimlanes.tag'), value: 'tag', icon: 'i-lucide-tag' },
    ...fields.filter(f => f.kind === 'select').map(f => ({ label: f.name, value: `field:${f.id}` as const, icon: fieldKindMeta.select.icon })),
  ]
}
