import { describe, expect, it } from 'vitest'
import type { BoardField, Card } from '#shared/types/board'
import { serverI18n } from '../../server/utils/i18n'
import { buildLanes as build, groupByItems as items, isMultiValued, isValidGroupBy, laneInsertIndex, laneKeysOf, lanePriority } from '../../app/utils/swimlanes'

const card = (over: Partial<Card> = {}): Card => ({
  id: 'c', columnId: 'col', title: 'Card', description: '', position: 1,
  assigneeIds: [], tagIds: [], startDate: null, dueDate: null, priority: null, estimate: null, coverAttachmentId: null,
  checklist: { done: 0, total: 0 }, commentCount: 0, attachmentCount: 0, timeMinutes: 0, watching: false, blockerIds: [], fields: {}, ...over,
})
const size: BoardField = { id: 'f', name: 'Size', kind: 'select', options: [{ id: 's', label: 'S', color: '#000000' }, { id: 'l', label: 'L', color: '#ffffff' }], position: 1, showOnCard: false }
const { t } = serverI18n('en')
type P = Parameters<typeof build>
const buildLanes = (cards: P[0], groupBy: P[1], c: P[2]) => build(cards, groupBy, c, t)
const groupByItems = (fields: BoardField[]) => items(fields, t)
const ctx = {
  members: [{ userId: 'u1', name: 'Alice', avatarUrl: null }, { userId: 'u2', name: 'Bob', avatarUrl: null }],
  tags: [{ id: 't1', name: 'bug', color: '#ef4444' }, { id: 't2', name: 'ui', color: '#3b82f6' }],
  fields: [size, { ...size, id: 'n', kind: 'number' as const, options: [] }],
}

describe('swimlanes', () => {
  it('keys cards by priority, assignees, tags and select value', () => {
    const c = card({ priority: 'high', assigneeIds: ['u2', 'u1'], tagIds: ['t2'], fields: { f: 'l' } })
    expect(laneKeysOf(c, 'priority', ctx)).toEqual(['high'])
    expect(laneKeysOf(c, 'assignee', ctx)).toEqual(['u1', 'u2'])
    expect(laneKeysOf(c, 'tag', ctx)).toEqual(['t2'])
    expect(laneKeysOf(c, 'field:f', ctx)).toEqual(['l'])
    const bare = card({ fields: { f: 'gone' } })
    for (const g of ['priority', 'assignee', 'tag', 'field:f'] as const) expect(laneKeysOf(bare, g, ctx)).toEqual(['none'])
  })

  it('lists all priority and option lanes but only used assignee and tag lanes', () => {
    const cards = [card({ assigneeIds: ['u2'], tagIds: ['t1'] })]
    expect(buildLanes(cards, 'priority', ctx).map(l => l.key)).toEqual(['urgent', 'high', 'medium', 'low', 'none'])
    expect(buildLanes(cards, 'field:f', ctx).map(l => l.label)).toEqual(['S', 'L', 'No Size'])
    expect(buildLanes(cards, 'assignee', ctx).map(l => l.key)).toEqual(['u2', 'none'])
    expect(buildLanes(cards, 'tag', ctx).map(l => l.label)).toEqual(['bug', 'No tag'])
  })

  it('validates groupings and offers select fields only', () => {
    expect(isValidGroupBy('priority', ctx.fields)).toBe(true)
    expect(isValidGroupBy('field:f', ctx.fields)).toBe(true)
    expect(isValidGroupBy('field:n', ctx.fields)).toBe(false)
    expect(isValidGroupBy('field:x', ctx.fields)).toBe(false)
    expect(groupByItems(ctx.fields).map(i => i.value)).toEqual(['none', 'assignee', 'priority', 'tag', 'field:f'])
    expect(isMultiValued('tag')).toBe(true)
    expect(isMultiValued('priority')).toBe(false)
    expect(lanePriority('none')).toBeNull()
    expect(lanePriority('low')).toBe('low')
  })

  it('places a lane drop in the full column order', () => {
    // Column a b c d; the lane holds a and c.
    const ids = ['a', 'b', 'c', 'd']
    expect(laneInsertIndex(ids, 'a', 'c')).toBe(1)
    expect(laneInsertIndex(ids, null, 'c')).toBe(2)
    expect(laneInsertIndex(ids, 'c', null)).toBe(3)
    expect(laneInsertIndex(ids, null, null)).toBe(4)
  })
})
