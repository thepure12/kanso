import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BoardAccess, MemberAccess } from '#shared/types/board'

export const boardAccessSchema = z.enum(['none', 'read', 'edit'])

export const memberAccessSchema = z.object({
  defaultAccess: boardAccessSchema,
  columns: z.record(z.uuid(), boardAccessSchema).default({}),
  cards: z.record(z.uuid(), boardAccessSchema).default({}),
}).refine(v => Object.keys(v.columns).length + Object.keys(v.cards).length <= 2000, 'Too many entries')

/** Limits on a board by user id, as far as RLS shows them (owners: all; others: their own). */
export async function loadMemberAccess(tx: Tx, boardId: string): Promise<Record<string, MemberAccess>> {
  const { boardMemberLimits: l, boardMemberAccess: a } = schema
  const [limits, entries] = await Promise.all([
    tx.select({ userId: l.userId, defaultAccess: l.defaultAccess }).from(l).where(eq(l.boardId, boardId)),
    tx.select({ userId: a.userId, columnId: a.columnId, cardId: a.cardId, access: a.access }).from(a).where(eq(a.boardId, boardId)),
  ])
  const out: Record<string, MemberAccess> = {}
  for (const r of limits) out[r.userId] = { defaultAccess: r.defaultAccess, columns: {}, cards: {} }
  for (const e of entries) {
    const m = out[e.userId]
    if (!m) continue
    if (e.columnId) m.columns[e.columnId] = e.access as BoardAccess
    else if (e.cardId) m.cards[e.cardId] = e.access as BoardAccess
  }
  return out
}

/** Replaces a member's limits. RLS: owners only, never on an owner. */
export async function setMemberAccess(tx: Tx, boardId: string, userId: string, access: MemberAccess) {
  const { boardMemberLimits: l, boardMemberAccess: a } = schema
  await tx.insert(l).values({ boardId, userId, defaultAccess: access.defaultAccess })
    .onConflictDoUpdate({ target: [l.boardId, l.userId], set: { defaultAccess: access.defaultAccess } })
  await tx.delete(a).where(and(eq(a.boardId, boardId), eq(a.userId, userId)))
  const rows = [
    ...Object.entries(access.columns).map(([columnId, v]) => ({ boardId, userId, columnId, access: v })),
    ...Object.entries(access.cards).map(([cardId, v]) => ({ boardId, userId, cardId, access: v })),
  ]
  if (rows.length) await tx.insert(a).values(rows)
}
