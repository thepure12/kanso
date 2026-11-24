import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { customViewColumnIds, customViewName } from '#shared/customViews'
import type { CustomView } from '#shared/types/customViews'

const body = z.object({ name: customViewName, columnIds: customViewColumnIds.default([]) })

/** Creates a custom view of the caller's. */
export default defineUserHandler(async (event, tx): Promise<CustomView> => {
  const input = await readValidated(event, body)
  const { customViews: v } = schema
  const [row] = await tx.insert(v).values({ userId: sql`app.current_user_id()`, name: input.name }).returning({ id: v.id })
  await setCustomViewColumns(tx, row!.id, input.columnIds)
  return (await loadCustomView(tx, row!.id))!
})
