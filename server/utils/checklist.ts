import { z } from 'zod'

/** Columns of a ChecklistItem (shared/types/board.ts) for select / returning. */
export function checklistItemColumns() {
  const ci = schema.checklistItems
  return { id: ci.id, text: ci.text, done: ci.done, position: ci.position, assigneeId: ci.assigneeId, dueDate: ci.dueDate }
}

/** Optional assignee and due date of a checklist item (null clears). The DB checks the assignee can see the card. */
export const checklistItemExtras = {
  assigneeId: z.uuid().nullable().optional(),
  dueDate: z.iso.date().nullable().optional(),
}
