import type { BoardAutomation, ScheduledCardAction } from '#shared/types/board'

export const boardAutomationFields = {
  id: schema.boardAutomations.id,
  kind: schema.boardAutomations.kind,
  days: schema.boardAutomations.days,
  tagId: schema.boardAutomations.tagId,
  priority: schema.boardAutomations.priority,
  columnId: schema.boardAutomations.columnId,
  targetColumnId: schema.boardAutomations.targetColumnId,
  cardId: schema.boardAutomations.cardId,
  active: schema.boardAutomations.active,
  lastRunAt: schema.boardAutomations.lastRunAt,
}

type AutomationRow = {
  id: string
  kind: BoardAutomation['kind']
  days: number
  tagId: string | null
  priority: (BoardAutomation & { kind: 'raise_priority' })['priority'] | null
  columnId: string | null
  targetColumnId: string | null
  cardId: string | null
  active: boolean
  lastRunAt: Date | null
}

/** Drops the columns that do not belong to the automation's kind. */
export function toBoardAutomation(r: AutomationRow): BoardAutomation {
  const base = { id: r.id, days: r.days, columnId: r.columnId, cardId: r.cardId, active: r.active, lastRunAt: r.lastRunAt?.toISOString() ?? null }
  switch (r.kind) {
    case 'archive_done':
    case 'notify_stale':
      return { ...base, kind: r.kind }
    case 'tag_stale':
      return { ...base, kind: r.kind, tagId: r.tagId! }
    case 'raise_priority':
      return { ...base, kind: r.kind, priority: r.priority! }
    case 'move_card':
      return { ...base, kind: r.kind, targetColumnId: r.targetColumnId! }
  }
}

export const scheduledActionFields = {
  id: schema.cardScheduledActions.id,
  cardId: schema.cardScheduledActions.cardId,
  kind: schema.cardScheduledActions.kind,
  runOn: schema.cardScheduledActions.runOn,
  targetColumnId: schema.cardScheduledActions.targetColumnId,
  priority: schema.cardScheduledActions.priority,
  note: schema.cardScheduledActions.note,
}

type ScheduledActionRow = {
  id: string
  cardId: string
  kind: ScheduledCardAction['kind']
  runOn: string
  targetColumnId: string | null
  priority: (ScheduledCardAction & { kind: 'priority' })['priority'] | null
  note: string | null
}

/** Drops the columns that do not belong to the action's kind. */
export function toScheduledAction(r: ScheduledActionRow): ScheduledCardAction {
  const base = { id: r.id, cardId: r.cardId, runOn: r.runOn }
  switch (r.kind) {
    case 'move':
      return { ...base, kind: r.kind, targetColumnId: r.targetColumnId! }
    case 'priority':
      return { ...base, kind: r.kind, priority: r.priority! }
    case 'remind':
      return { ...base, kind: r.kind, note: r.note }
    case 'archive':
      return { ...base, kind: r.kind }
  }
}
