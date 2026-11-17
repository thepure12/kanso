import type { BoardAutomation } from '#shared/types/board'

export const boardAutomationFields = {
  id: schema.boardAutomations.id,
  kind: schema.boardAutomations.kind,
  days: schema.boardAutomations.days,
  tagId: schema.boardAutomations.tagId,
  priority: schema.boardAutomations.priority,
  columnId: schema.boardAutomations.columnId,
  targetColumnId: schema.boardAutomations.targetColumnId,
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
  active: boolean
  lastRunAt: Date | null
}

/** Drops the columns that do not belong to the automation's kind. */
export function toBoardAutomation(r: AutomationRow): BoardAutomation {
  const base = { id: r.id, days: r.days, columnId: r.columnId, active: r.active, lastRunAt: r.lastRunAt?.toISOString() ?? null }
  switch (r.kind) {
    case 'archive_done':
    case 'notify_stale':
      return { ...base, kind: r.kind }
    case 'tag_stale':
      return { ...base, kind: r.kind, tagId: r.tagId! }
    case 'raise_priority':
      return { ...base, kind: r.kind, priority: r.priority! }
    case 'move_card':
      return { ...base, kind: r.kind, columnId: r.columnId!, targetColumnId: r.targetColumnId! }
  }
}
