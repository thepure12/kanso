import { count, max, sql } from 'drizzle-orm'
import { z } from 'zod'
import { MY_WORK_PANELS_MAX, myWorkPanelConfigSchema, myWorkPanelName } from '#shared/myWork'
import type { MyWorkPanel } from '#shared/types/myWork'

const body = z.object({ name: myWorkPanelName, config: myWorkPanelConfigSchema })

/** Adds a My work panel at the end. */
export default defineUserHandler(async (event, tx): Promise<MyWorkPanel> => {
  const input = await readValidated(event, body)
  const { myWorkPanels: p } = schema
  const [stats] = await tx.select({ n: count(), last: max(p.position) }).from(p)
  if ((stats?.n ?? 0) >= MY_WORK_PANELS_MAX) throw createError({ statusCode: 409, statusMessage: 'Too many panels' })
  const [row] = await tx.insert(p).values({
    userId: sql`app.current_user_id()`,
    name: input.name,
    config: input.config,
    position: (stats?.last ?? -1) + 1,
  }).returning({ id: p.id })
  return (await loadMyWorkPanels(tx, row!.id))[0]!
})
