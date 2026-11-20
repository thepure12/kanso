import type { BoardRule, NewBoardRule } from '#shared/types/board'

/** Tags a rule names (event, condition, actions); deleting one deletes the rule. */
export function ruleTagIds(r: NewBoardRule): string[] {
  return [r.eventTagId, r.conditions.tagId, r.actions.addTagId, r.actions.removeTagId].filter((x): x is string => !!x)
}

/** Columns a rule names; deleting one deletes the rule. */
export function ruleColumnIds(r: NewBoardRule): string[] {
  return [r.conditions.columnId, r.actions.moveColumnId].filter((x): x is string => !!x)
}

/** People a rule names; they must be on the board. */
export function ruleUserIds(r: NewBoardRule): string[] {
  return [r.eventUserId, r.conditions.assigneeId, r.actions.assignUserId].filter((x): x is string => !!x)
}

export function emptyRule(): NewBoardRule {
  return {
    event: 'card_created',
    eventTagId: null,
    eventUserId: null,
    conditions: { tagId: null, priority: null, columnId: null, assigneeId: null },
    actions: { moveColumnId: null, addTagId: null, removeTagId: null, assignUserId: null, priority: null, dueDays: null, archive: false },
  }
}

/** A copy of the rule's settings (no id or active flag), for editing. */
export function ruleDraft(r: BoardRule | NewBoardRule): NewBoardRule {
  return {
    event: r.event,
    eventTagId: r.eventTagId,
    eventUserId: r.eventUserId,
    conditions: { ...r.conditions },
    actions: { ...r.actions },
  }
}

/** Drops the event filter the event cannot have and checks that there is an action. */
export function normalizeRule(r: NewBoardRule): NewBoardRule {
  const out = ruleDraft(r)
  if (out.event !== 'tag_added') out.eventTagId = null
  if (out.event !== 'assigned') out.eventUserId = null
  return out
}

export function ruleHasAction(r: NewBoardRule): boolean {
  const a = r.actions
  return !!(a.moveColumnId || a.addTagId || a.removeTagId || a.assignUserId || a.priority || a.dueDays !== null || a.archive)
}

export function ruleValid(r: NewBoardRule): boolean {
  const a = r.actions
  return ruleHasAction(r) && (!a.addTagId || a.addTagId !== a.removeTagId)
    && (a.dueDays === null || (Number.isInteger(a.dueDays) && a.dueDays >= 0 && a.dueDays <= 365))
}
