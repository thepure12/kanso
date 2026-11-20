import { z } from 'zod'
import { boardRuleEvents, priorities, type BoardRule } from '#shared/types/board'

const r = schema.boardRules

export const boardRuleFields = {
  id: r.id,
  event: r.event,
  eventTagId: r.eventTagId,
  eventUserId: r.eventUserId,
  condTagId: r.condTagId,
  condPriority: r.condPriority,
  condColumnId: r.condColumnId,
  condAssigneeId: r.condAssigneeId,
  moveColumnId: r.moveColumnId,
  addTagId: r.addTagId,
  removeTagId: r.removeTagId,
  assignUserId: r.assignUserId,
  setPriority: r.setPriority,
  setDueDays: r.setDueDays,
  archive: r.archive,
  active: r.active,
}

type RuleRow = Pick<typeof schema.boardRules.$inferSelect, keyof typeof boardRuleFields>

export function toBoardRule(row: RuleRow): BoardRule {
  return {
    id: row.id,
    event: row.event,
    eventTagId: row.eventTagId,
    eventUserId: row.eventUserId,
    conditions: { tagId: row.condTagId, priority: row.condPriority, columnId: row.condColumnId, assigneeId: row.condAssigneeId },
    actions: {
      moveColumnId: row.moveColumnId, addTagId: row.addTagId, removeTagId: row.removeTagId, assignUserId: row.assignUserId,
      priority: row.setPriority, dueDays: row.setDueDays, archive: row.archive,
    },
    active: row.active,
  }
}

const id = z.uuid().nullable()
const priority = z.enum(priorities).nullable()

export const boardRuleBody = z.object({
  event: z.enum(boardRuleEvents),
  eventTagId: id.default(null),
  eventUserId: id.default(null),
  conditions: z.object({
    tagId: id.default(null),
    priority: priority.default(null),
    columnId: id.default(null),
    assigneeId: id.default(null),
  }).default({ tagId: null, priority: null, columnId: null, assigneeId: null }),
  actions: z.object({
    moveColumnId: id.default(null),
    addTagId: id.default(null),
    removeTagId: id.default(null),
    assignUserId: id.default(null),
    priority: priority.default(null),
    dueDays: z.number().int().min(0).max(365).nullable().default(null),
    archive: z.boolean().default(false),
  }),
  active: z.boolean().optional(),
})
  .refine(b => b.event === 'tag_added' || !b.eventTagId, { message: 'Only for tag_added', path: ['eventTagId'] })
  .refine(b => b.event === 'assigned' || !b.eventUserId, { message: 'Only for assigned', path: ['eventUserId'] })
  .refine(b => Object.values(b.actions).some(v => v !== null && v !== false), { message: 'Choose at least one action', path: ['actions'] })
  .refine(b => !b.actions.addTagId || b.actions.addTagId !== b.actions.removeTagId, { message: 'Cannot add and remove the same tag', path: ['actions', 'removeTagId'] })

/** The table columns of a validated rule body. */
export function boardRuleValues(b: z.output<typeof boardRuleBody>) {
  return {
    event: b.event,
    eventTagId: b.eventTagId,
    eventUserId: b.eventUserId,
    condTagId: b.conditions.tagId,
    condPriority: b.conditions.priority,
    condColumnId: b.conditions.columnId,
    condAssigneeId: b.conditions.assigneeId,
    moveColumnId: b.actions.moveColumnId,
    addTagId: b.actions.addTagId,
    removeTagId: b.actions.removeTagId,
    assignUserId: b.actions.assignUserId,
    setPriority: b.actions.priority,
    setDueDays: b.actions.dueDays,
    archive: b.actions.archive,
    ...(b.active === undefined ? {} : { active: b.active }),
  }
}
