import { and, eq, isNull } from 'drizzle-orm'

/** Revokes one of the user's tokens (api_tokens_revoke: own, unrevoked rows only). */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const t = schema.apiTokens
  const [row] = await tx.update(t).set({ revokedAt: new Date() })
    .where(and(eq(t.id, id), isNull(t.revokedAt))).returning({ id: t.id })
  if (!row) notFound('Token not found')
  return { ok: true }
})
