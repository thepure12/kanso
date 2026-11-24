import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { MY_WORK_PANELS_MAX } from '#shared/myWork'
import type { MyWorkPanel } from '#shared/types/myWork'

const body = z.object({ ids: z.array(z.uuid()).max(MY_WORK_PANELS_MAX) })

/** Puts the caller's panels in this order; every panel exactly once, else 409. */
export default defineUserHandler(async (event, tx): Promise<MyWorkPanel[]> => {
  const { ids } = await readValidated(event, body)
  const current = await loadMyWorkPanels(tx)
  if (new Set(ids).size !== ids.length || ids.length !== current.length || current.some(p => !ids.includes(p.id))) {
    throw createError({ statusCode: 409, statusMessage: 'Panels changed, reload' })
  }
  const { myWorkPanels: p } = schema
  for (const [i, id] of ids.entries()) await tx.update(p).set({ position: i }).where(eq(p.id, id))
  return loadMyWorkPanels(tx)
})
