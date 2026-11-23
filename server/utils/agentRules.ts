import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  AGENT_RULE_INSTRUCTIONS_MAX, AGENT_RULE_NAME_MAX, agentRuleComments, agentRuleEvents, type AgentRule,
} from '#shared/types/board'

const r = schema.boardAgentRules

export const agentRuleFields = {
  id: r.id,
  name: r.name,
  botId: r.botId,
  event: r.event,
  columnId: r.columnId,
  tagId: r.tagId,
  instructions: r.instructions,
  moveColumnId: r.moveColumnId,
  comment: r.comment,
  active: r.active,
}

type AgentRuleRow = Pick<typeof schema.boardAgentRules.$inferSelect, keyof typeof agentRuleFields>

export function toAgentRule(row: AgentRuleRow): AgentRule {
  return { ...row, comment: row.comment as AgentRule['comment'] }
}

/** A board's agent rules by name (RLS decides which). */
export async function loadAgentRules(tx: Tx, boardId: string): Promise<AgentRule[]> {
  const rows = await tx.select(agentRuleFields).from(r).where(eq(r.boardId, boardId)).orderBy(asc(r.name), asc(r.id))
  return rows.map(toAgentRule)
}

const id = z.uuid().nullable()

export const agentRuleBody = z.object({
  name: z.string().trim().min(1).max(AGENT_RULE_NAME_MAX),
  botId: z.uuid(),
  event: z.enum(agentRuleEvents),
  columnId: id.default(null),
  tagId: id.default(null),
  instructions: z.string().trim().min(1).max(AGENT_RULE_INSTRUCTIONS_MAX),
  moveColumnId: id.default(null),
  comment: z.enum(agentRuleComments).default('never'),
  active: z.boolean().optional(),
})

/** The table columns of a validated rule body. */
export function agentRuleValues(b: z.output<typeof agentRuleBody>) {
  const { active, ...rest } = b
  return { ...rest, ...(active === undefined ? {} : { active }) }
}
