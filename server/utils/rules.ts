import type { ColumnRule } from '#shared/types/board'

export const columnRuleFields = {
  id: schema.columnRules.id,
  kind: schema.columnRules.kind,
  tagId: schema.columnRules.tagId,
  userId: schema.columnRules.userId,
  dueDays: schema.columnRules.dueDays,
}

type RuleRow = { id: string, kind: ColumnRule['kind'], tagId: string | null, userId: string | null, dueDays: number | null }

/** Drops the columns that do not belong to the rule's kind. */
export function toColumnRule(r: RuleRow): ColumnRule {
  switch (r.kind) {
    case 'apply_tag':
    case 'remove_tag':
      return { id: r.id, kind: r.kind, tagId: r.tagId! }
    case 'assign_to':
      return { id: r.id, kind: r.kind, userId: r.userId! }
    case 'set_due':
      return { id: r.id, kind: r.kind, dueDays: r.dueDays! }
  }
}
