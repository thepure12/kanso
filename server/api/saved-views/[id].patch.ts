import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { savedViewConfigSchema, savedViewName } from '#shared/savedViews'
import type { SavedView } from '#shared/types/board'

const body = z.object({
  name: savedViewName.optional(),
  config: savedViewConfigSchema.optional(),
})

/** Renames a saved view or replaces its settings. */
export default defineUserHandler(async (event, tx): Promise<SavedView> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  if (input.name === undefined && input.config === undefined) throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })
  const { savedViews: v } = schema
  const rows = await tx.update(v).set(input).where(eq(v.id, id)).returning({ id: v.id })
  if (!rows.length) notFound('Saved view not found or not allowed')
  return (await loadSavedView(tx, id))!
})
