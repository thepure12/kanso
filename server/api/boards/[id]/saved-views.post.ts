import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { savedViewConfigSchema, savedViewName } from '#shared/savedViews'
import type { SavedView } from '#shared/types/board'

const body = z.object({
  name: savedViewName,
  /** Shared on the board (editors only) instead of personal. */
  shared: z.boolean().default(false),
  config: savedViewConfigSchema,
})

/** Saves a view: personal, or shared on the board. */
export default defineUserHandler(async (event, tx): Promise<SavedView> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const { savedViews: v } = schema
  const [row] = await tx.insert(v).values({
    boardId: id,
    userId: input.shared ? null : sql`app.current_user_id()`,
    createdBy: sql`app.current_user_id()`,
    name: input.name,
    config: input.config,
  }).returning({ id: v.id })
  return (await loadSavedView(tx, row!.id))!
})
