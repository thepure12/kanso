import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { boardAccents } from '#shared/boardAccents'
import { presetBackgroundSchema } from '#shared/boardBackgrounds'
import { columnOutlineSchema } from '#shared/columnOutline'
import { customViewColumnIds, customViewName } from '#shared/customViews'
import type { CustomView } from '#shared/types/customViews'

const body = z.object({
  name: customViewName.optional(),
  columnIds: customViewColumnIds.optional(),
  // Look of the view, as on a board. Uploaded images go through POST /api/views/:id/background.
  background: presetBackgroundSchema.nullable().optional(),
  accent: z.enum(boardAccents).nullable().optional(),
  columnOutline: columnOutlineSchema.nullable().optional(),
})

/** Renames a custom view, replaces its columns and/or changes its look. */
export default defineUserHandler(async (event, tx): Promise<CustomView> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { columnIds, ...input } = await readValidated(event, body)
  const { customViews: v } = schema
  const [row] = await tx.select({ id: v.id }).from(v).where(eq(v.id, id))
  if (!row) notFound('View not found')
  const set = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
  // RLS: only the view's user sees the row; a trigger drops a replaced upload.
  if (Object.keys(set).length) await tx.update(v).set(set).where(eq(v.id, id))
  if (columnIds) await setCustomViewColumns(tx, id, columnIds)
  return (await loadCustomView(tx, id))!
})
