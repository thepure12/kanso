import { priorities, type BoardField, type Card, type Column, type Member, type Tag } from '#shared/types/board'
import { urlHost } from './fields'

/** Sortable list view columns; `field:<id>` is a custom field. */
export type CardSortKey = 'title' | 'column' | 'assignees' | 'tags' | 'priority' | 'start' | 'due' | 'estimate' | 'time' | `field:${string}`

export interface CardSort {
  key: CardSortKey
  desc: boolean
}

export interface CardSortContext {
  columns: Pick<Column, 'id'>[]
  members: Pick<Member, 'userId' | 'name'>[]
  tags: Pick<Tag, 'id' | 'name'>[]
  fields: BoardField[]
}

type SortValue = string | number | null

/** An index, or null when findIndex found nothing. */
const orNull = (i: number) => i < 0 ? null : i

function sortValue(card: Card, key: CardSortKey, ctx: CardSortContext): SortValue {
  switch (key) {
    case 'title': return card.title
    case 'column': return orNull(ctx.columns.findIndex(c => c.id === card.columnId))
    // By the first name (alphabetically), so cards of one person sort together.
    case 'assignees': return ctx.members.filter(m => card.assigneeIds.includes(m.userId)).map(m => m.name).sort()[0] ?? null
    case 'tags': return ctx.tags.filter(t => card.tagIds.includes(t.id)).map(t => t.name).sort()[0] ?? null
    case 'priority': return card.priority ? priorities.indexOf(card.priority) : null
    case 'start': return card.startDate
    case 'due': return card.dueDate
    case 'estimate': return card.estimate
    case 'time': return card.timeMinutes || null
    default: {
      const field = ctx.fields.find(f => f.id === key.slice(6))
      const value = field ? card.fields[field.id] : undefined
      if (!field || value === undefined) return null
      if (field.kind === 'number') return typeof value === 'number' ? value : null
      if (field.kind === 'checkbox') return value ? 1 : null
      if (field.kind === 'date') return String(value)
      // Select options sort in their defined order.
      if (field.kind === 'select') return orNull(field.options.findIndex(o => o.id === value))
      // Text and URL fields (by host); no locale-dependent text involved.
      return field.kind === 'url' ? urlHost(String(value)) : String(value)
    }
  }
}

/**
 * Cards sorted by a list view column. Empty values go last in either
 * direction; ties keep the given order (board order). Priority sorts urgent
 * first when ascending.
 */
export function sortCards(cards: Card[], sort: CardSort | null, ctx: CardSortContext): Card[] {
  if (!sort) return [...cards]
  const values = new Map(cards.map(c => [c.id, sortValue(c, sort.key, ctx)]))
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return [...cards].sort((a, b) => {
    const va = values.get(a.id) as SortValue
    const vb = values.get(b.id) as SortValue
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1
    const order = typeof va === 'number' && typeof vb === 'number' ? va - vb : collator.compare(String(va), String(vb))
    return sort.desc ? -order : order
  })
}
