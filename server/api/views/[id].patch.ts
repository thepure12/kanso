import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { customViewColumnIds, customViewName } from '#shared/customViews'
import type { CustomView } from '#shared/types/customViews'

const body = z.object({ name: customViewName.optional(), columnIds: customViewColumnIds.optional() })

/** Renames a custom view and/or replaces its columns. */
export default defineUserHandler(async (event, tx): Promise<CustomView> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const { customViews: v } = schema
  const [row] = await tx.select({ id: v.id }).from(v).where(eq(v.id, id))
  if (!row) notFound('View not found')
  if (input.name !== undefined) await tx.update(v).set({ name: input.name }).where(eq(v.id, id))
  if (input.columnIds) await setCustomViewColumns(tx, id, input.columnIds)
  return (await loadCustomView(tx, id))!
})
