import { asc, eq } from 'drizzle-orm'
import type { MyWorkPanel } from '#shared/types/myWork'

/** The caller's My work panels in their order (RLS: own rows only). */
export async function loadMyWorkPanels(tx: Tx, id?: string): Promise<MyWorkPanel[]> {
  const { myWorkPanels: p } = schema
  return tx.select({ id: p.id, name: p.name, config: p.config }).from(p)
    .where(id ? eq(p.id, id) : undefined)
    .orderBy(asc(p.position), asc(p.createdAt))
}
