import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { CHECKLIST_NAME_MAX } from '#shared/cards'
import type { Checklist, ChecklistItem } from '#shared/types/board'

export const checklistName = z.string().trim().min(1).max(CHECKLIST_NAME_MAX)
export const checklistItemText = z.string().trim().min(1).max(500)

/** Optional assignee and due date of a checklist item (null clears). The DB checks the assignee can see the card. */
export const checklistItemExtras = {
  assigneeId: z.uuid().nullable().optional(),
  dueDate: z.iso.date().nullable().optional(),
}

export const checklistItemColumns = () => {
  const { checklistItems: ci } = schema
  return { id: ci.id, checklistId: ci.checklistId, text: ci.text, done: ci.done, position: ci.position, assigneeId: ci.assigneeId, dueDate: ci.dueDate }
}

export const checklistColumns = () => {
  const { checklists: cl } = schema
  return { id: cl.id, name: cl.name, position: cl.position }
}

/** A card's checklists in order, each with its items in order. */
export async function loadChecklists(tx: Tx, cardId: string): Promise<Checklist[]> {
  const { checklists: cl, checklistItems: ci } = schema
  const [lists, items] = await Promise.all([
    tx.select(checklistColumns()).from(cl).where(eq(cl.cardId, cardId)).orderBy(asc(cl.position), asc(cl.createdAt), asc(cl.id)),
    tx.select(checklistItemColumns()).from(ci).where(eq(ci.cardId, cardId)).orderBy(asc(ci.position)),
  ])
  const byList = Map.groupBy(items, i => i.checklistId)
  return lists.map(l => ({ ...l, items: byList.get(l.id) ?? [] as ChecklistItem[] }))
}
