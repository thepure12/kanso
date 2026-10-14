import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { ColumnRule } from '#shared/types/board'

const body = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('apply_tag'), tagId: z.uuid() }),
  z.object({ kind: z.literal('remove_tag'), tagId: z.uuid() }),
  z.object({ kind: z.literal('assign_to'), userId: z.uuid() }),
  z.object({ kind: z.literal('set_due'), dueDays: z.number().int().min(0).max(365) }),
])

export default defineUserHandler(async (event, tx): Promise<ColumnRule> => {
  const { id } = await paramsValidated(event, uuidParam)
  const rule = await readValidated(event, body)
  const { columns, columnRules } = schema

  const [col] = await tx.select({ boardId: columns.boardId }).from(columns).where(eq(columns.id, id))
  if (!col) notFound('Column not found')

  // Composite FK rejects a tag from another board; the insert policy rejects a non-member.
  // Adding an existing rule is a no-op.
  await tx.insert(columnRules).values({ boardId: col.boardId, columnId: id, ...rule }).onConflictDoNothing()
  const match = 'tagId' in rule
    ? eq(columnRules.tagId, rule.tagId)
    : 'userId' in rule ? eq(columnRules.userId, rule.userId) : eq(columnRules.dueDays, rule.dueDays)
  const [row] = await tx.select(columnRuleFields).from(columnRules)
    .where(and(eq(columnRules.columnId, id), eq(columnRules.kind, rule.kind), match))
  // Only possible for set_due: the column already has one with other days.
  if (!row) throw createError({ statusCode: 409, statusMessage: 'Column already has a due date rule' })
  return toColumnRule(row)
})
