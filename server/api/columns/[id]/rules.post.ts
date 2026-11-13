import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { ColumnRule } from '#shared/types/board'

const ruleBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('apply_tag'), tagId: z.uuid() }),
  z.object({ kind: z.literal('remove_tag'), tagId: z.uuid() }),
  z.object({ kind: z.literal('assign_to'), userId: z.uuid() }),
  z.object({ kind: z.literal('assign_mover') }),
  z.object({ kind: z.literal('set_due'), dueDays: z.number().int().min(0).max(365) }),
])
// applyToExisting: false leaves the cards already in the column alone (the UI asks).
const body = z.intersection(ruleBody, z.object({ applyToExisting: z.boolean().default(true) }))

export default defineUserHandler(async (event, tx): Promise<ColumnRule> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { applyToExisting, ...rule } = await readValidated(event, body)
  const { columns, columnRules } = schema

  const [col] = await tx.select({ boardId: columns.boardId }).from(columns).where(eq(columns.id, id))
  if (!col) notFound('Column not found')

  // Composite FK rejects a tag from another board; the insert policy rejects a non-member.
  // Adding an existing rule is a no-op.
  const inserted = await tx.insert(columnRules).values({ boardId: col.boardId, columnId: id, ...rule })
    .onConflictDoNothing().returning({ id: columnRules.id })
  if (inserted.length && applyToExisting) await applyToColumnCards(tx, id, rule)
  const match = 'tagId' in rule
    ? eq(columnRules.tagId, rule.tagId)
    : 'userId' in rule ? eq(columnRules.userId, rule.userId)
      : 'dueDays' in rule ? eq(columnRules.dueDays, rule.dueDays) : undefined
  const [row] = await tx.select(columnRuleFields).from(columnRules)
    .where(and(eq(columnRules.columnId, id), eq(columnRules.kind, rule.kind), match))
  // Only possible for set_due: the column already has one with other days.
  if (!row) throw createError({ statusCode: 409, statusMessage: 'Column already has a due date rule' })
  return toColumnRule(row)
})

type NewRule = z.infer<typeof ruleBody>

/**
 * A new tag or assignee rule also covers the cards already in the column
 * (not templates or archived cards), through the caller's policies like the
 * trigger. set_due is left out: it would overwrite dates people set on purpose;
 * assign_mover too: who moved those cards in is not known.
 */
async function applyToColumnCards(tx: Tx, columnId: string, rule: NewRule) {
  const cards = sql`select id, board_id from cards where column_id = ${columnId} and not is_template and archived_at is null`
  switch (rule.kind) {
    case 'apply_tag':
      await tx.execute(sql`insert into card_tags (card_id, tag_id, board_id)
        select c.id, ${rule.tagId}, c.board_id from (${cards}) c on conflict do nothing`)
      break
    case 'remove_tag':
      await tx.execute(sql`delete from card_tags where tag_id = ${rule.tagId} and card_id in (select id from (${cards}) c)`)
      break
    case 'assign_to':
      // Same as the trigger: someone without board access is skipped.
      await tx.execute(sql`insert into card_assignees (card_id, user_id, board_id)
        select c.id, ${rule.userId}, c.board_id from (${cards}) c
        where app.is_member(c.board_id, ${rule.userId}) on conflict do nothing`)
      break
  }
}
