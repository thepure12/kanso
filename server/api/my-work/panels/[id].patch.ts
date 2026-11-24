import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { myWorkPanelConfigSchema, myWorkPanelName } from '#shared/myWork'
import type { MyWorkPanel } from '#shared/types/myWork'

const body = z.object({ name: myWorkPanelName.optional(), config: myWorkPanelConfigSchema.optional() })

/** Renames a My work panel or replaces its query. */
export default defineUserHandler(async (event, tx): Promise<MyWorkPanel> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  if (input.name === undefined && input.config === undefined) throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })
  const { myWorkPanels: p } = schema
  const rows = await tx.update(p).set(input).where(eq(p.id, id)).returning({ id: p.id })
  if (!rows.length) notFound('Panel not found')
  return (await loadMyWorkPanels(tx, id))[0]!
})
